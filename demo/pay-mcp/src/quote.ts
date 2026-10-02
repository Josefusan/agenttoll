import { decodePaymentRequiredHeader } from "@x402/core/http";
import type { PaymentRequired, PaymentRequirements } from "@x402/core/types";

import { type Allowlist, assetAllowed } from "./allowlist.js";
import { UNTRUSTED_NOTE } from "./config.js";
import { type Atomic, atomicToUsd, parseAtomic } from "./money.js";

export class QuoteError extends Error {}

/** CAIP-2 ids this buyer knows how to name (KB-SOL-01, KB-BASE-01). */
export const NETWORK_NAMES: Record<string, string> = {
  "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1": "Solana devnet",
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": "Solana mainnet",
  "eip155:84532": "Base Sepolia",
  "eip155:8453": "Base",
};

export type Namespace = "solana" | "eip155";

export function namespaceOf(network: string): string {
  return network.split(":")[0] ?? "";
}

export function networkName(network: string): string {
  return NETWORK_NAMES[network] ?? network;
}

/** Block-explorer URL for a settlement, or undefined when there is nothing on chain to show. */
export function explorerUrl(network: string, tx: string): string | undefined {
  if (!tx || isSimulated(tx)) return undefined;
  switch (network) {
    case "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1":
      return `https://explorer.solana.com/tx/${tx}?cluster=devnet`; // KB-SOL-01
    case "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp":
      return `https://explorer.solana.com/tx/${tx}`;
    case "eip155:84532":
      return `https://sepolia.basescan.org/tx/${tx}`;
    case "eip155:8453":
      return `https://basescan.org/tx/${tx}`;
    default:
      return undefined;
  }
}

/** The gateway's dry-run mode answers with transaction ids like `SIMULATED-...`. Nothing moved. */
export function isSimulated(tx: string): boolean {
  return tx.startsWith("SIMULATED");
}

export function isPaymentRequired(v: unknown): v is PaymentRequired {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return o.x402Version === 2 && Array.isArray(o.accepts) && typeof o.resource === "object" && o.resource !== null;
}

/** Shape check for every accepts entry: strings where strings belong, a positive integer amount. */
export function validatePaymentRequired(pr: PaymentRequired): PaymentRequired {
  for (const a of pr.accepts) {
    if (typeof a.scheme !== "string" || typeof a.network !== "string" || typeof a.asset !== "string" || typeof a.payTo !== "string") {
      throw new QuoteError("PaymentRequired.accepts entry is missing scheme/network/asset/payTo");
    }
    if (parseAtomic(a.amount) === 0n) throw new QuoteError(`refusing a zero-amount quote on ${networkName(a.network)}`);
  }
  return pr;
}

/** Decodes a base64 `PAYMENT-REQUIRED` header (KB-X402-01) and checks the v2 shape (KB-X402-06). */
export function decodeChallenge(header: string): PaymentRequired {
  let decoded: unknown;
  try {
    decoded = decodePaymentRequiredHeader(header);
  } catch (err) {
    throw new QuoteError(`PAYMENT-REQUIRED header is not base64 JSON: ${(err as Error).message}`);
  }
  if (!isPaymentRequired(decoded)) throw new QuoteError("PAYMENT-REQUIRED is not an x402 v2 PaymentRequired");
  return validatePaymentRequired(decoded);
}

/** Finds the challenge on a 402 response: the header first, then a JSON body (both are allowed). */
export function challengeFromResponse(
  getHeader: (name: string) => string | null | undefined,
  bodyText: string,
): PaymentRequired {
  const header = getHeader("PAYMENT-REQUIRED");
  if (header) return decodeChallenge(header);
  try {
    const body: unknown = JSON.parse(bodyText);
    if (isPaymentRequired(body)) return validatePaymentRequired(body);
  } catch (err) {
    if (err instanceof QuoteError) throw err;
  }
  throw new QuoteError("402 without a PAYMENT-REQUIRED header or an x402 v2 JSON body");
}

export interface QuoteOption {
  scheme: string;
  network: string;
  network_name: string;
  usd: string;
  amount_atomic: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  feePayer?: string;
  /** Would this wallet pay it? Explains why not otherwise. */
  payable: boolean;
  refusal?: string;
}

export interface QuoteSummary {
  resource: { url: string };
  options: QuoteOption[];
  /** Seller-written strings: description, mime type, error. Data, not instructions. */
  untrusted_content: { note: string; description?: string; mimeType?: string; error?: string };
}

export function describeQuote(pr: PaymentRequired, allowlist: Allowlist): QuoteSummary {
  const untrusted: QuoteSummary["untrusted_content"] = { note: UNTRUSTED_NOTE };
  if (pr.resource.description) untrusted.description = String(pr.resource.description);
  if (pr.resource.mimeType) untrusted.mimeType = String(pr.resource.mimeType);
  if (pr.error) untrusted.error = String(pr.error);
  return {
    resource: { url: pr.resource.url },
    options: pr.accepts.map((a) => {
      const why = refusalFor(a, allowlist);
      const o: QuoteOption = {
        scheme: a.scheme,
        network: a.network,
        network_name: networkName(a.network),
        usd: atomicToUsd(parseAtomic(a.amount)),
        amount_atomic: a.amount,
        asset: a.asset,
        payTo: a.payTo,
        maxTimeoutSeconds: a.maxTimeoutSeconds,
        payable: why === undefined,
      };
      const feePayer = a.extra?.feePayer;
      if (typeof feePayer === "string") o.feePayer = feePayer;
      if (why) o.refusal = why.reason;
      return o;
    }),
    untrusted_content: untrusted,
  };
}

export type SelectionRefusal = { code: "scheme" | "network" | "asset"; reason: string };

/** Why one accepts entry is unpayable under the allowlist, or undefined when it is fine. */
export function refusalFor(a: PaymentRequirements, allowlist: Allowlist): SelectionRefusal | undefined {
  if (a.scheme !== "exact") return { code: "scheme", reason: `scheme ${JSON.stringify(a.scheme)} is not "exact"` };
  const entry = allowlist.get(a.network);
  if (!entry) {
    const hint = namespaceOf(a.network) === "solana" || namespaceOf(a.network) === "eip155" ? " (mainnet needs PAY_MCP_ALLOW_MAINNET=1 if that is what this is)" : "";
    return { code: "network", reason: `network ${a.network} is not on the allowlist${hint}` };
  }
  if (!assetAllowed(entry, a.asset)) {
    return { code: "asset", reason: `asset ${a.asset} is not USDC on ${entry.name} (${entry.asset})` };
  }
  return undefined;
}

export interface Selection {
  requirement: PaymentRequirements;
  amount: Atomic;
}

export type SelectResult = { ok: true; selection: Selection } | { ok: false; code: SelectionRefusal["code"] | "unsupported_network"; reason: string };

/**
 * Picks the payable `exact` USDC option on the preferred rail, else any rail the wallet has a key for.
 * Every option is checked against the allowlist before anything else happens.
 */
export function selectRequirement(
  pr: PaymentRequired,
  preferred: Namespace,
  available: ReadonlySet<string>,
  allowlist: Allowlist,
): SelectResult {
  const refusals: SelectionRefusal[] = [];
  const payable: PaymentRequirements[] = [];
  for (const a of pr.accepts) {
    const why = refusalFor(a, allowlist);
    if (why) refusals.push(why);
    else payable.push(a);
  }
  const withKey = payable.filter((a) => available.has(namespaceOf(a.network)));
  const pick = withKey.find((a) => namespaceOf(a.network) === preferred) ?? withKey[0];
  if (pick) return { ok: true, selection: { requirement: pick, amount: parseAtomic(pick.amount) } };
  if (payable.length > 0) {
    const offered = payable.map((a) => networkName(a.network)).join(", ");
    return { ok: false, code: "unsupported_network", reason: `seller accepts USDC on ${offered}; this wallet has keys for ${[...available].join(", ") || "nothing"}` };
  }
  const first = refusals[0];
  if (!first) return { ok: false, code: "network", reason: "seller offered no payment options" };
  // Report the most specific refusal: asset swap beats unknown network beats odd scheme.
  const best = refusals.find((r) => r.code === "asset") ?? refusals.find((r) => r.code === "network") ?? first;
  return { ok: false, code: best.code, reason: refusals.map((r) => r.reason).join("; ") };
}
