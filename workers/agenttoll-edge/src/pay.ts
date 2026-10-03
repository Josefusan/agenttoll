// The paid path: verify → forward → settle (ARCHITECTURE.md §1.1, §1.4), for both payment
// transports: the HTTP `PAYMENT-SIGNATURE` header (KB-X402-01) and the MCP-native
// `params._meta["x402/payment"]` (KB-X402-05). Mirrors crates/agenttoll-gateway/src/pay.rs
// step for step.
//
// Money rules enforced here:
// - The facilitator is sent *our* quote, never the requirements the client echoes back.
// - The origin is reached only after /verify says the payment is valid.
// - /settle runs only after the origin succeeds; agents never pay for errors. For MCP a
//   JSON-RPC error or a tool result with `isError: true` is a failure even on HTTP 200.
// - The origin's content is released only after settlement succeeds. If /settle fails in
//   transit (timeout) the outcome is unknown: the content is served, the payment stays
//   claimed, and the ledger records it as `unconfirmed`, so a buyer is never charged without
//   service and the founder never loses the trace (x402-protocol skill).
// - A payment is bound to the resource it was quoted for, and accepted once per 120 s window
//   (KB-X402-07 replay guard).

import { canonical_json } from './core/agenttoll_core.js';
import * as facilitator from './facilitator';
import { challenge, jsonrpcError, mcpChallenge, text, type Gateway, type Incoming, type Verdict } from './gateway';
import type { RevenueEvent, SettleStatus } from './ledger';
import { attachMcpReceipt, mcpSucceeded } from './mcp';
import { forward } from './proxy';
import { X402_VERSION, encodeHeader, headers as x402Headers, parseRequirements, requirements, type PriceTag, type QuoteNetwork } from './x402';

/** Paid responses are buffered so content is withheld if settlement fails. */
export const PAID_RESPONSE_LIMIT = 16 * 1024 * 1024;
/** Ledger prefix for a payment whose settlement outcome is unknown. */
export const UNCONFIRMED_PREFIX = 'unconfirmed:';
export const SIMULATED_PREFIX = 'SIMULATED-';

/** How the payment arrived, and therefore how refusals and receipts go back. */
export type Transport =
  /** `PAYMENT-SIGNATURE` header; challenges are HTTP 402. */
  | { kind: 'http' }
  /** `params._meta["x402/payment"]` on a single `tools/call`; challenges are JSON-RPC tool
   * results with `isError: true`. `id` is the JSON-RPC request id. */
  | { kind: 'mcp'; id: unknown };

export interface PaidRequest {
  inc: Incoming;
  /** The body to forward (an MCP body already has its payment removed). */
  body: BodyInit | null;
  /** Client headers that no longer describe the forwarded body. */
  dropHeaders: string[];
  tag: PriceTag;
  verdict: Verdict;
  /** The decoded PaymentPayload. */
  payload: unknown;
  transport: Transport;
  /** For MCP calls, the ids of the paid `tools/call`s; each must get a successful result
   * before the payment settles. `undefined` for plain HTTP routes. */
  mcpCallIds: unknown[] | undefined;
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

/** Stable short id for a payment whose settlement signature is unknown. */
async function shortHash(key: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return [...new Uint8Array(digest).subarray(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function handlePaid(gw: Gateway, req: PaidRequest): Promise<Response> {
  const started = Date.now();
  const { inc, body, tag, verdict, payload, transport, mcpCallIds, networks } = req;
  const refuse = (error: string) =>
    transport.kind === 'http'
      ? challenge(gw, networks, inc, tag, verdict, error)
      : mcpChallenge(gw, networks, inc, tag, verdict, error, transport.id);
  const malformed = (error: string) =>
    transport.kind === 'http' ? text(400, error) : jsonrpcError(200, transport.id, -32602, error);

  // 1. Shape. Malformed is a client error (400 on HTTP, -32602 on MCP).
  if (!isRecord(payload) || payload.x402Version !== X402_VERSION) {
    return refuse('only x402Version 2 payments are accepted');
  }
  const accepted = parseRequirements(payload.accepted);
  if (!accepted) return malformed('payment has no valid `accepted` requirements');
  // The signed part identifies the payment; header encodings of it may vary.
  if (!('payload' in payload)) return malformed('payment has no `payload`');
  const replayKey = canonical_json(JSON.stringify(payload.payload));

  // 2. The payment must answer the quote we would issue for this exact request.
  const network = networks.find((n) => n.config.network === accepted.network);
  if (!network) return refuse('payment network is not offered for this resource');
  const ours = requirements(network, tag);
  const matches =
    accepted.scheme === ours.scheme &&
    accepted.amount === ours.amount &&
    accepted.asset === ours.asset &&
    accepted.payTo === ours.payTo;
  if (!matches) return refuse("payment does not match this resource's price quote");
  // A payment names the resource it was quoted for; it cannot be spent on another one.
  const quotedUrl = isRecord(payload.resource) ? payload.resource.url : undefined;
  if (typeof quotedUrl === 'string' && quotedUrl !== gw.resourceUrl(inc, tag)) {
    return refuse('payment was made for a different resource');
  }

  // 3. Replay guard.
  if (!gw.replay.claim(replayKey)) return refuse('duplicate_settlement');
  const facilitatorUrl = network.config.facilitator;

  // 4. Verify before the origin sees anything.
  let verified: facilitator.VerifyResponse;
  try {
    verified = await facilitator.verify(facilitatorUrl, payload, ours, gw.timeouts.verifyMs);
  } catch (e) {
    gw.replay.release(replayKey);
    console.warn('facilitator verify failed', String(e));
    return text(502, 'payment facilitator unavailable');
  }
  if (!verified.isValid) {
    gw.replay.release(replayKey);
    return refuse(verified.invalidReason ?? 'payment is invalid');
  }

  // 5. Forward, telling the origin who paid.
  const gatewayHeaders: Record<string, string> = { 'x-agenttoll-paid': '1' };
  if (verdict.agent) gatewayHeaders['x-agenttoll-agent'] = verdict.agent;
  if (verified.payer) gatewayHeaders['x-agenttoll-payer'] = verified.payer;
  // Paid MCP responses are inspected before settling, so ask for them uncompressed.
  const dropHeaders = mcpCallIds === undefined ? req.dropHeaders : [...req.dropHeaders, 'accept-encoding'];
  const origin = await forward(
    inc.request,
    inc.rawPathAndQuery,
    body,
    { origin: gw.origin, preserveHost: gw.preserveHost, peer: inc.peer, proto: inc.proto, dropHeaders },
    gatewayHeaders,
  );
  const content = await readLimited(origin.body, PAID_RESPONSE_LIMIT);
  if (content === undefined) {
    gw.replay.release(replayKey);
    return text(502, 'origin response too large or interrupted; payment not settled');
  }
  const contentType = origin.headers.get('content-type') ?? '';
  const failed =
    !(origin.status >= 200 && origin.status < 300) ||
    (mcpCallIds !== undefined && !mcpSucceeded(origin.headers, content, mcpCallIds));
  if (failed) {
    // Not settled, so the payment was not consumed: let the agent retry it.
    gw.replay.release(replayKey);
    console.log(`origin answered ${origin.status}; payment not settled`);
    return new Response(content, { status: origin.status, statusText: origin.statusText, headers: origin.headers });
  }

  // 6. Settle. Content is released only on success, or when the outcome is unknown.
  const record = (txSignature: string, status: SettleStatus, payer: string | undefined): RevenueEvent => ({
    ts: Date.now(),
    route: tag.resource,
    mcpTool: tag.resource.startsWith('mcp:') ? tag.resource.slice('mcp:'.length) : null,
    agentName: verdict.agent,
    detectReason: verdict.reason,
    network: ours.network,
    asset: ours.asset,
    amountAtomic: tag.amount,
    payer: payer ?? verified.payer ?? null,
    txSignature,
    originStatus: origin.status,
    latencyMs: Date.now() - started,
    status,
  });
  let event: RevenueEvent;
  let receipt: Record<string, unknown> | undefined;
  try {
    const { parsed: settled, raw } = await facilitator.settle(facilitatorUrl, payload, ours, gw.timeouts.settleMs);
    if (!facilitator.isSettled(settled)) {
      const res = refuse(settled.errorReason ?? 'settlement failed');
      res.headers.set(x402Headers.PAYMENT_RESPONSE, encodeHeader(raw));
      return res;
    }
    event = record(settled.transaction, settled.success ? 'settled' : 'pending', settled.payer);
    receipt = raw;
  } catch (e) {
    // Keep the replay claim: this payment may have been consumed.
    console.error('settle outcome unknown; serving content, recording as unconfirmed', String(e));
    event = record(`${UNCONFIRMED_PREFIX}${await shortHash(replayKey)}`, 'unconfirmed', undefined);
  }

  // 7. Record and publish. A ledger failure must not take back content that was paid for.
  console.log(
    `payment recorded tx=${event.txSignature} network=${event.network} amount=${tag.amount} status=${event.status} simulated=${event.txSignature.startsWith(SIMULATED_PREFIX)}`,
  );
  req.waitUntil(gw.ledger.record(event).catch((e: unknown) => console.error('ledger write failed', String(e))));

  // 8. Release the content with the receipt: always as a header, and for MCP-native also
  //    inside the JSON-RPC result where MCP clients look for it.
  const released =
    transport.kind === 'mcp' && receipt !== undefined && contentType.startsWith('application/json')
      ? (attachMcpReceipt(content, receipt) ?? content)
      : content;
  const headers = new Headers(origin.headers);
  if (receipt !== undefined) headers.set(x402Headers.PAYMENT_RESPONSE, encodeHeader(receipt));
  headers.delete('content-length'); // recomputed from the buffered body
  return new Response(released, { status: origin.status, statusText: origin.statusText, headers });
}
