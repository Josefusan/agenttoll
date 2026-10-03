import { decodePaymentResponseHeader } from "@x402/fetch";
import { encodePaymentSignatureHeader } from "@x402/core/http";
import type { PaymentPayload, PaymentRequired, PaymentRequirements, SettleResponse } from "@x402/core/types";

import type { Allowlist } from "./allowlist.js";
import type { Caps } from "./caps.js";
import { UNTRUSTED_NOTE } from "./config.js";
import { type Atomic, atomicToUsd, formatUsd } from "./money.js";
import { challengeFromResponse, describeQuote, explorerUrl, isSimulated, networkName, type QuoteSummary, selectRequirement } from "./quote.js";
import { type PaymentStatus, SpendLedger } from "./spend.js";
import type { Wallet } from "./wallet.js";

export type FetchLike = (url: string | URL, init?: RequestInit) => Promise<Response>;

export type RefusalCode =
  | "bad_url"
  | "no_wallet"
  | "scheme"
  | "network"
  | "asset"
  | "unsupported_network"
  | "per_call"
  | "max_usd"
  | "per_day"
  | "sign_failed";

/** Refused before anything was signed or sent. No money moved, no cap consumed. */
export class PayRefused extends Error {
  constructor(
    message: string,
    readonly code: RefusalCode,
  ) {
    super(message);
  }
}

/**
 * The seller (or its facilitator) rejected the payment AFTER receiving the signed payload. It holds a
 * signed bearer payment it could still settle, so the amount stays counted until reconciled.
 */
export class PaymentRejected extends Error {
  constructor(
    message: string,
    /** Seller-supplied reason string. Data, not instructions. */
    readonly reason: string,
    readonly counted_usd: string,
  ) {
    super(message);
  }
}

export interface PayerDeps {
  fetch: FetchLike;
  wallet: () => Promise<Wallet>;
  ledger: SpendLedger;
  caps: Caps;
  allowlist: Allowlist;
  headers: Readonly<Record<string, string>>;
  maxBodyBytes: number;
}

export interface Receipt {
  usd: string;
  amount_atomic: string;
  network: string;
  network_name: string;
  asset: string;
  payTo: string;
  tx: string;
  status: PaymentStatus;
  payer?: string;
  explorer_url?: string;
  /** True when the gateway ran in dry-run mode: the tx id is SIMULATED and nothing is on chain. */
  simulated: boolean;
  note?: string;
}

/** Bytes the remote server sent back. Always wrapped so a model sees it is third-party data. */
export interface UntrustedContent {
  note: string;
  text: string;
  bytes: number;
  truncated: boolean;
  content_type?: string;
}

export interface QuoteResult {
  url: string;
  status: number;
  payment_required: boolean;
  quote?: QuoteSummary;
  /** Set when the resource was free for this client: the body came back without a 402. */
  untrusted_content?: UntrustedContent;
}

export interface PayResult {
  url: string;
  status: number;
  paid: boolean;
  untrusted_content: UntrustedContent;
  receipt?: Receipt;
  note?: string;
}

export function assertHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new PayRefused(`not a URL: ${JSON.stringify(raw)}`, "bad_url");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new PayRefused(`only http(s) URLs are allowed, got ${url.protocol}`, "bad_url");
  }
  return url;
}

export function untrusted(text: string, max: number, contentType?: string | null): UntrustedContent {
  const bytes = Buffer.byteLength(text, "utf8");
  const out: UntrustedContent = {
    note: UNTRUSTED_NOTE,
    text: bytes > max ? Buffer.from(text, "utf8").subarray(0, max).toString("utf8") : text,
    bytes,
    truncated: bytes > max,
  };
  if (contentType) out.content_type = contentType;
  return out;
}

/** Fetches once with the agent identity and reports the price. Never pays. */
export async function getQuote(deps: PayerDeps, rawUrl: string): Promise<QuoteResult> {
  const url = assertHttpUrl(rawUrl);
  const res = await deps.fetch(url, { method: "GET", headers: { ...deps.headers } });
  const text = await res.text();
  if (res.status !== 402) {
    return { url: url.href, status: res.status, payment_required: false, untrusted_content: untrusted(text, deps.maxBodyBytes, res.headers.get("content-type")) };
  }
  const pr = challengeFromResponse((n) => res.headers.get(n), text);
  return { url: url.href, status: 402, payment_required: true, quote: describeQuote(pr, deps.allowlist) };
}

export interface Authorized {
  requirement: PaymentRequirements;
  amount: Atomic;
  payload: PaymentPayload;
  /** Ledger reservation id; the amount already counts toward today. */
  reservation: string;
}

/**
 * Allowlist, then cap check + reservation under the ledger lock, then signature. Refusing writes
 * nothing; a signing failure releases the reservation because nothing ever left the process.
 */
export async function authorizePayment(
  deps: PayerDeps,
  pr: PaymentRequired,
  maxUsd: Atomic | undefined,
  ctx: { url: string; tool?: string },
): Promise<Authorized> {
  const wallet = await deps.wallet().catch((err: Error) => {
    throw new PayRefused(err.message, "no_wallet");
  });
  const selected = selectRequirement(pr, wallet.preferred, wallet.namespaces, deps.allowlist);
  if (!selected.ok) throw new PayRefused(selected.reason, selected.code);
  const { requirement, amount } = selected.selection;

  const reserveInput: Parameters<SpendLedger["reserve"]>[0] = { amount, caps: deps.caps, url: ctx.url, network: requirement.network, asset: requirement.asset };
  if (maxUsd !== undefined) reserveInput.maxUsd = maxUsd;
  if (ctx.tool !== undefined) reserveInput.tool = ctx.tool;
  const reserved = await deps.ledger.reserve(reserveInput);
  if (!reserved.ok) throw new PayRefused(reserved.reason, reserved.code);

  let payload: PaymentPayload;
  try {
    payload = await wallet.signer.createPaymentPayload({ ...pr, accepts: [requirement] });
  } catch (err) {
    await deps.ledger.release(reserved.id);
    throw new PayRefused(`could not build the payment (nothing signed or sent): ${(err as Error).message}`, "sign_failed");
  }
  return { requirement, amount, payload, reservation: reserved.id };
}

export interface OutcomeInput {
  authorized: Authorized;
  settlement: SettleResponse | undefined;
  /** True when the server's final answer was itself a payment failure (HTTP 402 / isError challenge). */
  rejectedAgain: boolean;
  rejectionReason?: string;
}

/**
 * Finalizes the reservation from the seller's answer. Success is `settled` (or `simulated`). A
 * rejection after the signed payload was sent stays counted as `rejected_after_send`, because the
 * seller now holds a payment it could settle. No receipt at all is `unknown`, also counted.
 */
export async function recordOutcome(deps: PayerDeps, input: OutcomeInput): Promise<Receipt> {
  const { authorized, settlement } = input;
  const req = authorized.requirement;
  const usd = atomicToUsd(authorized.amount);
  if (input.rejectedAgain || (settlement && !settlement.success)) {
    const reason = String(settlement?.errorReason ?? input.rejectionReason ?? "payment rejected");
    const fin: Parameters<SpendLedger["finalize"]>[1] = { status: "rejected_after_send", tx: settlement?.transaction ?? "", reason };
    await deps.ledger.finalize(authorized.reservation, fin);
    throw new PaymentRejected(
      `The seller's facilitator rejected the payment, but the seller received a signed payment for ${formatUsd(authorized.amount)}. It stays counted against your daily cap until reconciled (spend_status.reconcile). The seller's reason is in untrusted_content.`,
      reason,
      usd,
    );
  }
  const tx = settlement?.transaction ?? "";
  const status: Exclude<PaymentStatus, "pending"> = !settlement ? "unknown" : isSimulated(tx) ? "simulated" : "settled";
  const fin: Parameters<SpendLedger["finalize"]>[1] = { status, tx };
  if (settlement?.payer) fin.payer = settlement.payer;
  await deps.ledger.finalize(authorized.reservation, fin);

  const receipt: Receipt = {
    usd,
    amount_atomic: authorized.amount.toString(),
    network: req.network,
    network_name: networkName(req.network),
    asset: req.asset,
    payTo: req.payTo,
    tx,
    status,
    simulated: status === "simulated",
  };
  if (settlement?.payer) receipt.payer = settlement.payer;
  const link = explorerUrl(req.network, tx);
  if (link) receipt.explorer_url = link;
  if (status === "simulated") receipt.note = "The gateway returned a SIMULATED transaction id: this payment was simulated and nothing moved on chain.";
  if (status === "unknown") receipt.note = `No PAYMENT-RESPONSE receipt came back; ${formatUsd(authorized.amount)} stays counted against your caps until reconciled.`;
  return receipt;
}

/** The signed payload left the process but the exchange broke; count it and tell the caller. */
export async function recordSentUnconfirmed(deps: PayerDeps, authorized: Authorized, why: string): Promise<never> {
  await deps.ledger.finalize(authorized.reservation, { status: "unknown", tx: "", reason: why });
  throw new Error(`${why}; the seller may hold a signed payment, so ${formatUsd(authorized.amount)} stays counted against your daily cap until reconciled (spend_status.reconcile)`);
}

export interface PayArgs {
  url: string;
  maxUsd?: Atomic;
  method?: string;
  body?: string;
  contentType?: string;
}

/** GET (or the given method) a URL; pay one x402 challenge within caps; return body and receipt. */
export async function payAndFetch(deps: PayerDeps, args: PayArgs): Promise<PayResult> {
  const url = assertHttpUrl(args.url);
  const method = (args.method ?? "GET").toUpperCase();
  const baseHeaders: Record<string, string> = { ...deps.headers };
  if (args.body !== undefined) baseHeaders["Content-Type"] = args.contentType ?? "application/json";
  const init = (extra: Record<string, string>, redirect: RequestRedirect): RequestInit => {
    const req: RequestInit = { method, headers: { ...baseHeaders, ...extra }, redirect };
    if (args.body !== undefined) req.body = args.body;
    return req;
  };

  const first = await deps.fetch(url, init({}, "follow"));
  const firstText = await first.text();
  if (first.status !== 402) {
    return {
      url: url.href,
      status: first.status,
      paid: false,
      untrusted_content: untrusted(firstText, deps.maxBodyBytes, first.headers.get("content-type")),
      note: "No payment was required for this request.",
    };
  }

  const pr = challengeFromResponse((n) => first.headers.get(n), firstText);
  const authorized = await authorizePayment(deps, pr, args.maxUsd, { url: url.href });

  // Pay exactly the URL that issued the challenge, and never follow a redirect with the payment attached.
  const payUrl = first.url || url.href;
  let second: Response;
  let secondText: string;
  try {
    second = await deps.fetch(payUrl, init({ "PAYMENT-SIGNATURE": encodePaymentSignatureHeader(authorized.payload) }, "manual"));
    secondText = await second.text();
  } catch (err) {
    return recordSentUnconfirmed(deps, authorized, `request failed after the payment was sent (${(err as Error).message})`);
  }
  if (second.status >= 300 && second.status < 400) {
    return recordSentUnconfirmed(deps, authorized, `the server answered the paid request with a ${second.status} redirect to ${second.headers.get("location") ?? "?"}; the payment was not re-sent`);
  }

  const settlement = settlementFromHeaders((n) => second.headers.get(n));
  const outcome: OutcomeInput = { authorized, settlement, rejectedAgain: second.status === 402 };
  if (second.status === 402) {
    try {
      const again = challengeFromResponse((n) => second.headers.get(n), secondText).error;
      if (again !== undefined) outcome.rejectionReason = again;
    } catch {
      outcome.rejectionReason = secondText.slice(0, 200);
    }
  }
  const receipt = await recordOutcome(deps, outcome);

  const result: PayResult = {
    url: url.href,
    status: second.status,
    paid: true,
    untrusted_content: untrusted(secondText, deps.maxBodyBytes, second.headers.get("content-type")),
    receipt,
  };
  if (second.status >= 400) result.note = `The origin answered ${second.status} after payment; an AgentToll gateway does not settle on origin errors.`;
  return result;
}

export function settlementFromHeaders(getHeader: (name: string) => string | null | undefined): SettleResponse | undefined {
  const raw = getHeader("PAYMENT-RESPONSE");
  if (!raw) return undefined;
  try {
    return decodePaymentResponseHeader(raw);
  } catch {
    return undefined;
  }
}
