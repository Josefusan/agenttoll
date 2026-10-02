// The paid path: verify → forward → settle (ARCHITECTURE.md §1.1, §1.4). Mirrors
// crates/agenttoll-gateway/src/pay.rs step for step.
//
// Money rules enforced here:
// - The facilitator is sent *our* quote, never the requirements the client echoes back.
// - The origin is reached only after /verify says the payment is valid.
// - /settle runs only after the origin answers 2xx; agents never pay for errors.
// - The origin's content is released only after settlement succeeds.
// - A payment header is accepted once per 120 s window (KB-X402-07 replay guard).

import * as facilitator from './facilitator';
import { challenge, text, type Gateway, type Incoming, type Verdict } from './gateway';
import { forward } from './proxy';
import type { RevenueEvent } from './ledger';
import {
  X402_VERSION,
  decodeHeader,
  encodeHeader,
  headers as x402Headers,
  parseRequirements,
  requirements,
  type PriceTag,
  type QuoteNetwork,
} from './x402';

/** Paid responses are buffered so content is withheld if settlement fails. */
export const PAID_RESPONSE_LIMIT = 16 * 1024 * 1024;

export interface PaidRequest {
  inc: Incoming;
  body: BodyInit | null;
  tag: PriceTag;
  verdict: Verdict;
  /** Raw PAYMENT-SIGNATURE header value. */
  header: string;
  networks: QuoteNetwork[];
  waitUntil: (p: Promise<unknown>) => void;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Reads at most `limit` bytes; `undefined` when the body is larger or breaks off. */
export async function readLimited(body: ReadableStream<Uint8Array> | null, limit: number): Promise<Uint8Array | undefined> {
  if (!body) return new Uint8Array(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        return undefined;
      }
      chunks.push(value);
    }
  } catch {
    return undefined;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

export async function handlePaid(gw: Gateway, req: PaidRequest): Promise<Response> {
  const started = Date.now();
  const { inc, body, tag, verdict, header, networks } = req;
  const refuse = (error: string) => challenge(gw, networks, inc, tag, verdict, error);

  // 1. Decode. Malformed is a client error (400), per the v2 HTTP transport.
  const payload = decodeHeader(header);
  if (!isRecord(payload)) {
    return text(400, 'PAYMENT-SIGNATURE is not base64-encoded JSON');
  }
  if (payload.x402Version !== X402_VERSION) {
    return refuse('only x402Version 2 payments are accepted');
  }
  const accepted = parseRequirements(payload.accepted);
  if (!accepted) {
    return text(400, 'PAYMENT-SIGNATURE has no valid `accepted` requirements');
  }

  // 2. The payment must answer the quote we would issue for this exact request.
  const network = networks.find((n) => n.config.network === accepted.network);
  if (!network) {
    return refuse('payment network is not offered for this resource');
  }
  const ours = requirements(network, tag);
  const matches =
    accepted.scheme === ours.scheme &&
    accepted.amount === ours.amount &&
    accepted.asset === ours.asset &&
    accepted.payTo === ours.payTo;
  if (!matches) {
    return refuse("payment does not match this resource's price quote");
  }

  // 3. Replay guard.
  if (!gw.replay.claim(header)) {
    return refuse('duplicate_settlement');
  }
  const facilitatorUrl = network.config.facilitator;

  // 4. Verify before the origin sees anything.
  let verified: facilitator.VerifyResponse;
  try {
    verified = await facilitator.verify(facilitatorUrl, payload, ours);
  } catch (e) {
    gw.replay.release(header);
    console.warn('facilitator verify failed', String(e));
    return text(502, 'payment facilitator unavailable');
  }
  if (!verified.isValid) {
    gw.replay.release(header);
    return refuse(verified.invalidReason ?? 'payment is invalid');
  }

  // 5. Forward, telling the origin who paid.
  const gatewayHeaders: Record<string, string> = { 'x-agenttoll-paid': '1' };
  if (verdict.agent) gatewayHeaders['x-agenttoll-agent'] = verdict.agent;
  if (verified.payer) gatewayHeaders['x-agenttoll-payer'] = verified.payer;
  const origin = await forward(
    inc.request,
    inc.rawPathAndQuery,
    body,
    { origin: gw.origin, preserveHost: gw.preserveHost, peer: inc.peer, proto: inc.proto },
    gatewayHeaders,
  );
  if (!(origin.status >= 200 && origin.status < 300)) {
    // Not settled, so the payment was not consumed: let the agent retry it.
    gw.replay.release(header);
    console.log(`origin answered ${origin.status}; payment not settled`);
    return origin;
  }
  const content = await readLimited(origin.body, PAID_RESPONSE_LIMIT);
  if (content === undefined) {
    gw.replay.release(header);
    return text(502, 'origin response too large or interrupted; payment not settled');
  }

  // 6. Settle. Content is released only on success.
  let settled: facilitator.SettleResponse;
  let raw: Record<string, unknown>;
  try {
    ({ parsed: settled, raw } = await facilitator.settle(facilitatorUrl, payload, ours));
  } catch (e) {
    console.error('facilitator settle failed; content withheld', String(e));
    return text(502, 'payment settlement failed; you were not served');
  }
  const paymentResponse = encodeHeader(raw);
  if (!facilitator.isSettled(settled)) {
    const res = refuse(settled.errorReason ?? 'settlement failed');
    res.headers.set(x402Headers.PAYMENT_RESPONSE, paymentResponse);
    return res;
  }

  // 7. Record and publish. A ledger failure must not take back content that was paid for.
  const event: RevenueEvent = {
    ts: Date.now(),
    route: tag.resource,
    mcpTool: tag.resource.startsWith('mcp:') ? tag.resource.slice('mcp:'.length) : null,
    agentName: verdict.agent,
    detectReason: verdict.reason,
    network: ours.network,
    asset: ours.asset,
    amountAtomic: tag.amount,
    payer: settled.payer ?? verified.payer ?? null,
    txSignature: settled.transaction,
    originStatus: origin.status,
    latencyMs: Date.now() - started,
  };
  console.log(`settled tx=${event.txSignature} network=${event.network} amount=${tag.amount}`);
  req.waitUntil(
    gw.ledger.record(event).catch((e: unknown) => console.error('ledger write failed', String(e))),
  );

  const headers = new Headers(origin.headers);
  headers.set(x402Headers.PAYMENT_RESPONSE, paymentResponse);
  headers.delete('content-length'); // recomputed from the buffered body
  return new Response(content, { status: origin.status, statusText: origin.statusText, headers });
}
