import { decodePaymentResponseHeader } from "@x402/fetch";
import { encodePaymentSignatureHeader } from "@x402/core/http";
import type { PaymentPayload, PaymentRequired, PaymentRequirements, SettleResponse } from "@x402/core/types";

import { type Caps, checkCaps } from "./caps.js";
import { type Atomic, atomicToUsd, formatUsd } from "./money.js";
import {
  challengeFromResponse,
  describeQuote,
  explorerUrl,
  isSimulated,
  networkName,
  type QuoteSummary,
  selectRequirement,
} from "./quote.js";
import { type PaymentStatus, SpendLedger } from "./spend.js";
import type { Wallet } from "./wallet.js";

export type FetchLike = (url: string | URL, init?: RequestInit) => Promise<Response>;

/** Refused before anything was signed. No money moved, no cap consumed. */
export class PayRefused extends Error {
  constructor(
    message: string,
    readonly code: "bad_url" | "no_wallet" | "unsupported_network" | "per_call" | "max_usd" | "per_day" | "sign_failed",
  ) {
    super(message);
  }
}

/** The gateway or facilitator rejected the signed payment. No money moved, no cap consumed. */
export class PaymentRejected extends Error {
  constructor(
    message: string,
    readonly reason: string,
  ) {
    super(message);
  }
}

export interface PayerDeps {
  fetch: FetchLike;
  wallet: () => Promise<Wallet>;
  ledger: SpendLedger;
  caps: Caps;
  headers: Readonly<Record<string, string>>;
  maxBodyBytes: number;
}

export interface Receipt {
  usd: string;
  amount_atomic: string;
  network: string;
  network_name: string;
  payTo: string;
  tx: string;
  status: PaymentStatus;
  payer?: string;
  explorer_url?: string;
  /** True when the gateway ran in dry-run mode: the tx id is SIMULATED and nothing is on chain. */
  simulated: boolean;
  note?: string;
}

export interface Body {
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
  body?: Body;
}

export interface PayResult {
  url: string;
  status: number;
  paid: boolean;
  body: Body;
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

export function truncateBody(text: string, max: number, contentType?: string | null): Body {
  const bytes = Buffer.byteLength(text, "utf8");
  const body: Body = { text: bytes > max ? Buffer.from(text, "utf8").subarray(0, max).toString("utf8") : text, bytes, truncated: bytes > max };
  if (contentType) body.content_type = contentType;
  return body;
}

/** Fetches once with the agent identity and reports the price. Never pays. */
export async function getQuote(deps: PayerDeps, rawUrl: string): Promise<QuoteResult> {
  const url = assertHttpUrl(rawUrl);
  const res = await deps.fetch(url, { method: "GET", headers: { ...deps.headers } });
  const text = await res.text();
  if (res.status !== 402) {
    return { url: url.href, status: res.status, payment_required: false, body: truncateBody(text, deps.maxBodyBytes, res.headers.get("content-type")) };
  }
  const pr = challengeFromResponse((n) => res.headers.get(n), text);
  return { url: url.href, status: 402, payment_required: true, quote: describeQuote(pr) };
}

export interface Authorized {
  requirement: PaymentRequirements;
  amount: Atomic;
  payload: PaymentPayload;
}

/**
 * Cap check, then signature. Order matters: refusing is free, signing is not.
 * Throws PayRefused; never records spend.
 */
export async function authorizePayment(deps: PayerDeps, pr: PaymentRequired, maxUsd: Atomic | undefined): Promise<Authorized> {
  const wallet = await deps.wallet().catch((err: Error) => {
    throw new PayRefused(err.message, "no_wallet");
  });
  const selection = selectRequirement(pr, wallet.preferred, wallet.namespaces);
  if (!selection) {
    const offered = pr.accepts.map((a) => `${a.scheme} on ${networkName(a.network)}`).join(", ") || "nothing";
    throw new PayRefused(`seller accepts ${offered}; this wallet pays on ${[...wallet.namespaces].join(", ")}`, "unsupported_network");
  }
  const verdict = checkCaps(selection.amount, { caps: deps.caps, maxUsd, spentToday: await deps.ledger.spentToday() });
  if (!verdict.ok) throw new PayRefused(verdict.reason, verdict.code);

  let payload: PaymentPayload;
  try {
    payload = await wallet.signer.createPaymentPayload({ ...pr, accepts: [selection.requirement] });
  } catch (err) {
    throw new PayRefused(`could not build the payment (nothing signed or sent): ${(err as Error).message}`, "sign_failed");
  }
  return { requirement: selection.requirement, amount: selection.amount, payload };
}

export interface OutcomeInput {
  url: string;
  tool?: string;
  authorized: Authorized;
  settlement: SettleResponse | undefined;
  /** True when the server's final answer was itself a payment failure (HTTP 402 / isError challenge). */
  rejectedAgain: boolean;
  rejectionReason?: string;
}

/**
 * Turns the server's answer into a receipt and writes the ledger. A second rejection means no money
 * moved. A success receipt is recorded as settled. No receipt at all is recorded as `unknown`, so the
 * daily cap errs on the side of counting it.
 */
export async function recordOutcome(deps: PayerDeps, input: OutcomeInput): Promise<Receipt> {
  const { authorized, settlement } = input;
  const req = authorized.requirement;
  if (input.rejectedAgain || (settlement && !settlement.success)) {
    const reason = settlement?.errorReason ?? input.rejectionReason ?? "payment rejected";
    throw new PaymentRejected(`payment rejected by the seller's facilitator (${reason}); no money moved and nothing counted against your caps`, reason);
  }
  const tx = settlement?.transaction ?? "";
  const status: PaymentStatus = !settlement ? "unknown" : isSimulated(tx) ? "simulated" : "settled";
  const base = { url: input.url, network: req.network, asset: req.asset, amount_atomic: authorized.amount.toString(), tx, status };
  const rec = input.tool !== undefined ? { ...base, tool: input.tool } : base;
  await deps.ledger.record(settlement?.payer ? { ...rec, payer: settlement.payer } : rec);

  const receipt: Receipt = {
    usd: atomicToUsd(authorized.amount),
    amount_atomic: authorized.amount.toString(),
    network: req.network,
    network_name: networkName(req.network),
    payTo: req.payTo,
    tx,
    status,
    simulated: status === "simulated",
  };
  if (settlement?.payer) receipt.payer = settlement.payer;
  const link = explorerUrl(req.network, tx);
  if (link) receipt.explorer_url = link;
  if (status === "simulated") receipt.note = "The gateway returned a SIMULATED transaction id: this payment was simulated and nothing moved on chain.";
  if (status === "unknown") receipt.note = `No PAYMENT-RESPONSE receipt came back; ${formatUsd(authorized.amount)} was counted against your caps to be safe.`;
  return receipt;
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
  const init = (extra: Record<string, string>): RequestInit => {
    const req: RequestInit = { method, headers: { ...baseHeaders, ...extra } };
    if (args.body !== undefined) req.body = args.body;
    return req;
  };

  const first = await deps.fetch(url, init({}));
  const firstText = await first.text();
  if (first.status !== 402) {
    return {
      url: url.href,
      status: first.status,
      paid: false,
      body: truncateBody(firstText, deps.maxBodyBytes, first.headers.get("content-type")),
      note: "No payment was required for this request.",
    };
  }

  const pr = challengeFromResponse((n) => first.headers.get(n), firstText);
  const authorized = await authorizePayment(deps, pr, args.maxUsd);

  const paymentHeader = encodePaymentSignatureHeader(authorized.payload);
  let second: Response;
  let secondText: string;
  try {
    second = await deps.fetch(url, init({ "PAYMENT-SIGNATURE": paymentHeader }));
    secondText = await second.text();
  } catch (err) {
    // The signed transfer may have reached the gateway. Count it rather than risk overspending.
    await recordOutcome(deps, { url: url.href, authorized, settlement: undefined, rejectedAgain: false });
    throw new Error(`request failed after the payment was sent (${(err as Error).message}); ${formatUsd(authorized.amount)} counted against caps`);
  }

  const settlement = settlementFromHeaders((n) => second.headers.get(n));
  let rejectionReason: string | undefined;
  if (second.status === 402) {
    try {
      rejectionReason = challengeFromResponse((n) => second.headers.get(n), secondText).error;
    } catch {
      rejectionReason = secondText.slice(0, 200);
    }
  }
  const outcome: OutcomeInput = { url: url.href, authorized, settlement, rejectedAgain: second.status === 402 };
  if (rejectionReason !== undefined) outcome.rejectionReason = rejectionReason;
  const receipt = await recordOutcome(deps, outcome);

  const result: PayResult = {
    url: url.href,
    status: second.status,
    paid: true,
    body: truncateBody(secondText, deps.maxBodyBytes, second.headers.get("content-type")),
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
