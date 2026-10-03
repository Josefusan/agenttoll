// Facilitator HTTP client: POST /verify and /settle with x402 v2 bodies, GET /supported for
// the Solana fee payer (KB-X402-04, KB-X402-06, KB-X402-07). Chain-agnostic: the facilitator
// does the chain work. Mirrors crates/agenttoll-gateway/src/{facilitator,supported}.rs.

import { X402_VERSION, type PaymentRequirements } from './x402';

/** /verify and /settle budgets come from the config (`timeouts.verify_ms`, `timeouts.settle_ms`). */
const SUPPORTED_TIMEOUT_MS = 10_000;

export class FacilitatorError extends Error {}

export interface VerifyResponse {
  isValid: boolean;
  invalidReason?: string;
  payer?: string;
}

export interface SettleResponse {
  success: boolean;
  /** Base58 signature on Solana, tx hash on EVM; "" when nothing was broadcast. */
  transaction: string;
  network: string;
  payer?: string;
  errorReason?: string;
}

/**
 * Settled, or broadcast and still confirming (`settlement_pending` is non-terminal and
 * guarantees a transaction id, KB-X402-06).
 */
export function isSettled(s: SettleResponse): boolean {
  return (s.success || s.errorReason === 'settlement_pending') && s.transaction !== '';
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const optionalString = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** Fetches and reads the whole body under one deadline: headers that arrive in time but a
 * body that never ends still fail at `timeoutMs`. */
async function fetchText(url: string, init: RequestInit, timeoutMs: number): Promise<{ res: Response; text: string }> {
  const signal = AbortSignal.timeout(timeoutMs);
  const res = await fetch(url, { ...init, signal });
  return { res, text: await res.text() };
}

/**
 * Sends `{x402Version, paymentPayload, paymentRequirements}` to `<facilitator>/<op>` and
 * returns the parsed JSON. Facilitators may answer a rejected payment with a 4xx that still
 * carries a well-formed body, so the body is parsed whatever the status.
 */
async function call(
  facilitator: string,
  op: 'verify' | 'settle',
  payload: unknown,
  requirements: PaymentRequirements,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const url = `${facilitator.replace(/\/+$/, '')}/${op}`;
  let res: Response;
  let text: string;
  try {
    ({ res, text } = await fetchText(
      url,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          x402Version: X402_VERSION,
          paymentPayload: payload,
          paymentRequirements: requirements,
        }),
      },
      timeoutMs,
    ));
  } catch (e) {
    throw new FacilitatorError(`facilitator request failed: ${String(e)}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new FacilitatorError(
      `facilitator answered ${res.status} with an unreadable body: ${text.slice(0, 300)}`,
    );
  }
  if (!isRecord(raw)) {
    throw new FacilitatorError(`facilitator answered ${res.status} with a non-object body`);
  }
  return raw;
}

export async function verify(
  facilitator: string,
  payload: unknown,
  requirements: PaymentRequirements,
  timeoutMs: number,
): Promise<VerifyResponse> {
  const raw = await call(facilitator, 'verify', payload, requirements, timeoutMs);
  if (typeof raw.isValid !== 'boolean') {
    throw new FacilitatorError('facilitator /verify answer has no boolean isValid');
  }
  return {
    isValid: raw.isValid,
    invalidReason: optionalString(raw.invalidReason),
    payer: optionalString(raw.payer),
  };
}

/**
 * Returns the parsed response and the raw JSON, which is echoed to the buyer verbatim in
 * PAYMENT-RESPONSE so fields this gateway does not model (amount, extensions) survive.
 */
export async function settle(
  facilitator: string,
  payload: unknown,
  requirements: PaymentRequirements,
  timeoutMs: number,
): Promise<{ parsed: SettleResponse; raw: Record<string, unknown> }> {
  const raw = await call(facilitator, 'settle', payload, requirements, timeoutMs);
  if (typeof raw.success !== 'boolean') {
    throw new FacilitatorError('facilitator /settle answer has no boolean success');
  }
  return {
    parsed: {
      success: raw.success,
      transaction: optionalString(raw.transaction) ?? '',
      network: optionalString(raw.network) ?? '',
      payer: optionalString(raw.payer),
      errorReason: optionalString(raw.errorReason),
    },
    raw,
  };
}

/**
 * Reads the facilitator's `GET /supported` to learn the Solana fee payer quoted in
 * `extra.feePayer`. Never hardcoded: it differs per facilitator (KB-X402-04).
 */
export async function feePayer(facilitator: string, network: string): Promise<string> {
  const url = `${facilitator.replace(/\/+$/, '')}/supported`;
  let body: unknown;
  try {
    const { res, text } = await fetchText(url, { method: 'GET' }, SUPPORTED_TIMEOUT_MS);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    body = JSON.parse(text);
  } catch (e) {
    throw new FacilitatorError(`GET ${url}: ${String(e)}`);
  }
  const kinds = isRecord(body) && Array.isArray(body.kinds) ? body.kinds : undefined;
  if (!kinds) throw new FacilitatorError(`GET ${url}: unexpected body`);
  for (const kind of kinds) {
    if (
      isRecord(kind) &&
      kind.x402Version === 2 &&
      kind.scheme === 'exact' &&
      kind.network === network &&
      isRecord(kind.extra) &&
      typeof kind.extra.feePayer === 'string'
    ) {
      return kind.extra.feePayer;
    }
  }
  throw new FacilitatorError(`${url} lists no v2 exact feePayer for ${network}`);
}
