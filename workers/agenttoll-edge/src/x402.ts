// x402 v2 wire types and the 402 challenge (KB-X402-01, KB-X402-06, KB-X402-07). Mirrors
// crates/agenttoll-gateway/src/x402.rs field for field and in field order, so the Worker's
// PAYMENT-REQUIRED is byte-identical to the gateway's for the same config.

export const X402_VERSION = 2;
/** How long a quote stays payable. Solana blockhashes live ~60–90 s (KB-X402-07). */
export const MAX_TIMEOUT_SECONDS = 60;

/** Header names. HTTP header names are case-insensitive; Workers' Headers lowercases them. */
export const headers = {
  /** v2 challenge, server to client with 402: base64 PaymentRequired (KB-X402-01). */
  PAYMENT_REQUIRED: 'payment-required',
  /** v2 payment, client to server: base64 PaymentPayload (KB-X402-01). */
  PAYMENT_SIGNATURE: 'payment-signature',
  /** v2 receipt, server to client: base64 SettlementResponse (KB-X402-01). */
  PAYMENT_RESPONSE: 'payment-response',
  /** v1 payment header, recognized only so detection treats v1 payers as agents. */
  X_PAYMENT: 'x-payment',
} as const;

export interface PaymentRequirements {
  scheme: string;
  /** CAIP-2 (KB-SOL-01, KB-BASE-01). */
  network: string;
  /** Atomic units as a decimal string. v2 field name; v1 called it maxAmountRequired. */
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: Record<string, unknown>;
}

export interface ResourceInfo {
  url: string;
  description?: string;
  mimeType?: string;
}

export interface PaymentRequired {
  x402Version: number;
  error?: string;
  resource: ResourceInfo;
  accepts: PaymentRequirements[];
}

/** What a request costs and what it is buying, as the core pricer reports it. */
export interface PriceTag {
  /** Atomic USDC as a decimal string (KB-AMT-01). */
  amount: string;
  /** The route pattern that matched (`GET /api/quote`) or `mcp:<tool>[+<tool>...]`. */
  resource: string;
  description?: string | null;
}

/** One `networks.<name>` entry as `Core.networks_json()` reports it. */
export interface NetworkConfig {
  name: string;
  network: string;
  asset: string;
  payTo: string;
  facilitator: string;
  feePayer?: string | null;
}

/** A configured network with its scheme-specific `extra` resolved (fee payer etc.). */
export interface QuoteNetwork {
  config: NetworkConfig;
  extra: Record<string, unknown>;
}

/**
 * `feePayer` is required for Solana networks (KB-X402-07) and ignored elsewhere. Key order
 * inside `extra` is alphabetical, like serde_json's BTreeMap-backed Map in the gateway.
 */
export function quoteNetwork(config: NetworkConfig, feePayer: string | undefined): QuoteNetwork {
  const namespace = config.network.split(':', 1)[0];
  let extra: Record<string, unknown>;
  if (namespace === 'solana') {
    if (!feePayer) throw new Error(`no Solana fee payer for ${config.network}`);
    extra = { feePayer };
  } else if (namespace === 'eip155') {
    // EIP-3009 domain of USDC (KB-BASE-01).
    extra = { name: 'USDC', version: '2' };
  } else {
    extra = {};
  }
  return { config, extra };
}

export function requirements(net: QuoteNetwork, tag: PriceTag): PaymentRequirements {
  return {
    scheme: 'exact',
    network: net.config.network,
    amount: tag.amount,
    asset: net.config.asset,
    payTo: net.config.payTo,
    maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
    extra: net.extra,
  };
}

/** One `accepts[]` entry per configured network. */
export function paymentRequired(
  networks: QuoteNetwork[],
  tag: PriceTag,
  url: string,
  error: string,
): PaymentRequired {
  return {
    x402Version: X402_VERSION,
    error,
    resource: { url, description: tag.description ?? tag.resource },
    accepts: networks.map((n) => requirements(n, tag)),
  };
}

const utf8 = new TextEncoder();
const utf8Decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });

function base64Encode(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64Decode(text: string): Uint8Array | undefined {
  // Strict standard alphabet with padding, like base64::STANDARD in the gateway.
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4 !== 0) return undefined;
  try {
    const binary = atob(text);
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return undefined;
  }
}

/** Header encoding for PAYMENT-REQUIRED / PAYMENT-RESPONSE: base64 of the compact JSON. */
export function encodeHeader(value: unknown): string {
  return base64Encode(utf8.encode(JSON.stringify(value)));
}

/** Wire text of each object's `x402Version`, recorded while parsing (JSON.parse source
 * access, V8 11.4+; where a runtime lacks it the parsed value alone is checked). */
const versionSource = new WeakMap<object, string>();

function paymentReviver(this: unknown, key: string, value: unknown, context?: { source?: string }): unknown {
  if (key === 'x402Version' && typeof this === 'object' && this !== null && typeof context?.source === 'string') {
    versionSource.set(this, context.source);
  }
  return value;
}

/** `JSON.parse` for payment material: remembers how `x402Version` was spelled on the wire. */
export function parsePaymentJson(text: string): unknown {
  return JSON.parse(text, paymentReviver as unknown as (this: unknown, key: string, value: unknown) => unknown);
}

/**
 * True only when `x402Version` is exactly the integer 2 on the wire, like the Rust gateway's
 * `Value::as_u64() == Some(2)`: `2.0` and `2e0` are refused even though they parse to 2.
 */
export function isX402V2(payload: Record<string, unknown>): boolean {
  if (payload.x402Version !== X402_VERSION) return false;
  const source = versionSource.get(payload);
  return source === undefined || source === String(X402_VERSION);
}

/** Inverse of {@link encodeHeader}; `undefined` for anything that is not base64 JSON. */
export function decodeHeader(header: string): unknown | undefined {
  const bytes = base64Decode(header.trim());
  if (!bytes) return undefined;
  try {
    return parsePaymentJson(utf8Decoder.decode(bytes));
  } catch {
    return undefined;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Validates a client-echoed `accepted` object the way serde validates the gateway's
 * `PaymentRequirements`: five required strings, a non-negative integer timeout, optional
 * object `extra`.
 */
export function parseRequirements(value: unknown): PaymentRequirements | undefined {
  if (!isRecord(value)) return undefined;
  const { scheme, network, amount, asset, payTo, maxTimeoutSeconds, extra } = value;
  for (const s of [scheme, network, amount, asset, payTo]) {
    if (typeof s !== 'string') return undefined;
  }
  if (typeof maxTimeoutSeconds !== 'number' || !Number.isInteger(maxTimeoutSeconds) || maxTimeoutSeconds < 0) {
    return undefined;
  }
  if (extra !== undefined && !isRecord(extra)) return undefined;
  return {
    scheme: scheme as string,
    network: network as string,
    amount: amount as string,
    asset: asset as string,
    payTo: payTo as string,
    maxTimeoutSeconds,
    extra: (extra as Record<string, unknown> | undefined) ?? {},
  };
}
