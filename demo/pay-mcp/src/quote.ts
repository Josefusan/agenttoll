import { decodePaymentRequiredHeader } from "@x402/core/http";
import type { PaymentRequired, PaymentRequirements } from "@x402/core/types";

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

/** Decodes a base64 `PAYMENT-REQUIRED` header (KB-X402-01) and checks the v2 shape (KB-X402-06). */
export function decodeChallenge(header: string): PaymentRequired {
  let decoded: unknown;
  try {
    decoded = decodePaymentRequiredHeader(header);
  } catch (err) {
    throw new QuoteError(`PAYMENT-REQUIRED header is not base64 JSON: ${(err as Error).message}`);
  }
  if (!isPaymentRequired(decoded)) throw new QuoteError("PAYMENT-REQUIRED is not an x402 v2 PaymentRequired");
  for (const a of decoded.accepts) parseAtomic(a.amount);
  return decoded;
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
    if (isPaymentRequired(body)) return body;
  } catch {
    // fall through
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
}

export interface QuoteSummary {
  resource: { url: string; description?: string; mimeType?: string };
  error?: string;
  options: QuoteOption[];
}

export function describeQuote(pr: PaymentRequired): QuoteSummary {
  const summary: QuoteSummary = {
    resource: { url: pr.resource.url },
    options: pr.accepts.map((a) => {
      const o: QuoteOption = {
        scheme: a.scheme,
        network: a.network,
        network_name: networkName(a.network),
        usd: atomicToUsd(parseAtomic(a.amount)),
        amount_atomic: a.amount,
        asset: a.asset,
        payTo: a.payTo,
        maxTimeoutSeconds: a.maxTimeoutSeconds,
      };
      const feePayer = a.extra?.feePayer;
      if (typeof feePayer === "string") o.feePayer = feePayer;
      return o;
    }),
  };
  if (pr.resource.description) summary.resource.description = pr.resource.description;
  if (pr.resource.mimeType) summary.resource.mimeType = pr.resource.mimeType;
  if (pr.error) summary.error = pr.error;
  return summary;
}

export interface Selection {
  requirement: PaymentRequirements;
  amount: Atomic;
}

/**
 * Picks the `exact` option on the preferred rail, else any rail the wallet has a key for.
 * Returns undefined when the seller accepts nothing this wallet can pay.
 */
export function selectRequirement(
  pr: PaymentRequired,
  preferred: Namespace,
  available: ReadonlySet<string>,
): Selection | undefined {
  const exact = pr.accepts.filter((a) => a.scheme === "exact" && available.has(namespaceOf(a.network)));
  const pick = exact.find((a) => namespaceOf(a.network) === preferred) ?? exact[0];
  if (!pick) return undefined;
  return { requirement: pick, amount: parseAtomic(pick.amount) };
}
