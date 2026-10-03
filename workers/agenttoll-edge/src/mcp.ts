// MCP-native x402 transport (KB-X402-05): the payment travels in `params._meta["x402/payment"]`
// of a single `tools/call`, and a tool result with `isError: true` is a failure even on HTTP
// 200. Mirrors the MCP helpers of crates/agenttoll-gateway/src/{lib,pay}.rs one for one.

import { parsePaymentJson } from './x402';

export const MCP_PAYMENT_META = 'x402/payment';
export const MCP_RESPONSE_META = 'x402/payment-response';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
const encoder = new TextEncoder();

/** Request bodies are parsed with the payment reviver so `x402Version` keeps its wire text. */
function parseJson(bytes: Uint8Array): unknown | undefined {
  try {
    return parsePaymentJson(utf8.decode(bytes));
  } catch {
    return undefined;
  }
}

function parseText(text: string): unknown | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export interface McpPayment {
  /** The PaymentPayload found in `_meta`. */
  payload: unknown;
  /** The JSON-RPC request id (`null` when the call has none). */
  id: unknown;
  /** The body with the payment removed: the origin never sees payment material. */
  stripped: Uint8Array;
}

/** For a single MCP `tools/call` carrying `params._meta["x402/payment"]`. */
export function extractMcpPayment(body: Uint8Array): McpPayment | undefined {
  const msg = parseJson(body);
  if (!isRecord(msg) || msg.method !== 'tools/call') return undefined;
  const params = msg.params;
  if (!isRecord(params)) return undefined;
  const meta = params._meta;
  if (!isRecord(meta) || !(MCP_PAYMENT_META in meta)) return undefined;
  const payload = meta[MCP_PAYMENT_META];
  delete meta[MCP_PAYMENT_META];
  if (Object.keys(meta).length === 0) delete params._meta;
  return { payload, id: msg.id ?? null, stripped: encoder.encode(JSON.stringify(msg)) };
}

function messagesOf(value: unknown): unknown[] | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value : [value];
}

/**
 * The ids of every `tools/call` in an MCP body (`null` for a call without one, which can
 * never be matched to a response and so is never settled).
 */
export function toolCallIds(body: Uint8Array): unknown[] {
  const messages = messagesOf(parseJson(body)) ?? [];
  // Duplicate ids make responses ambiguous (a `ping` result could answer a paid call), so
  // such a batch is never settled.
  const ids = messages
    .filter((m): m is Record<string, unknown> => isRecord(m) && 'method' in m && 'id' in m)
    .map((m) => idKey(m.id));
  if (new Set(ids).size !== ids.length) return [null];
  return messages
    .filter((m): m is Record<string, unknown> => isRecord(m) && m.method === 'tools/call')
    .map((m) => m.id ?? null);
}

/** The JSON-RPC id of a body that is exactly one `tools/call`; `undefined` otherwise. */
export function singleToolCallId(body: Uint8Array): unknown | undefined {
  const msg = parseJson(body);
  if (!isRecord(msg) || msg.method !== 'tools/call') return undefined;
  return msg.id ?? null;
}

export function isToolsList(body: Uint8Array): boolean {
  const msg = parseJson(body);
  return isRecord(msg) && msg.method === 'tools/list';
}

/**
 * True only when an MCP origin answered every paid call in the request with a successful
 * result: a response with the call's `id`, no `error`, and no `result.isError`. Reads a JSON
 * body, or every event of an SSE body (servers may send notifications before the result).
 * Anything it cannot read (compressed, truncated, not JSON-RPC) counts as a failure: when in
 * doubt the buyer is not charged.
 */
export function mcpSucceeded(headers: Headers, content: Uint8Array, callIds: unknown[]): boolean {
  const messages = mcpMessages(headers, content);
  if (messages === undefined || callIds.length === 0) return false;
  return callIds.every((id) =>
    messages.some(
      (m) =>
        responseTo(m, id) && !('error' in m) && 'result' in m && !(isRecord(m.result) && m.result.isError === true),
    ),
  );
}

/**
 * True when the body is readable and every paid call got an explicit failure (JSON-RPC
 * `error` or `result.isError`): the only unsettled MCP content that may be returned.
 */
export function mcpFailedExplicitly(headers: Headers, content: Uint8Array, callIds: unknown[]): boolean {
  const messages = mcpMessages(headers, content);
  if (messages === undefined || callIds.length === 0) return false;
  return callIds.every((id) =>
    messages.some((m) => responseTo(m, id) && ('error' in m || (isRecord(m.result) && m.result.isError === true))),
  );
}

/**
 * Identity of a JSON-RPC id under the same rule `responseTo` uses: numbers by value (`9` and
 * `9.0` are one id; JSON numbers are f64 here as in the Rust gateway), everything else by
 * JSON text.
 */
function idKey(id: unknown): string {
  return typeof id === 'number' ? `n:${id}` : `j:${JSON.stringify(id)}`;
}

/**
 * JSON-RPC messages in an origin response, or `undefined` if the body cannot be judged (not
 * UTF-8, not JSON). Intentional difference from the Rust gateway: workerd adds its own
 * `Accept-Encoding` to every subrequest and transparently decodes the answer (keeping the
 * `Content-Encoding` header), so the bytes judged here are always the decoded ones; Rust
 * never sees compressed bytes it could read and refuses any `Content-Encoding`. Both editions
 * never serve unverifiable content unpaid.
 */
function mcpMessages(headers: Headers, content: Uint8Array): Record<string, unknown>[] | undefined {
  let text: string;
  try {
    text = utf8.decode(content);
  } catch {
    return undefined;
  }
  const isSse = (headers.get('content-type') ?? '').startsWith('text/event-stream');
  const messages = isSse ? sseMessages(text) : messagesOf(parseText(text));
  return messages?.filter(isRecord);
}

/**
 * A response (not a request or notification) answering request `id`. Numeric ids compare by
 * value, because servers in other languages may echo `9.0` as `9`. Object ids compare by
 * JSON text, so a reordered object id does not match (the safe side: not settled).
 */
function responseTo(message: Record<string, unknown>, id: unknown): boolean {
  if (id === null || 'method' in message || !('id' in message)) return false;
  if (typeof message.id === 'number' && typeof id === 'number') return message.id === id;
  return JSON.stringify(message.id) === JSON.stringify(id);
}

/** JSON-RPC messages carried by an SSE body: one per event, multi-line `data:` joined. */
export function sseMessages(text: string): unknown[] {
  const out: unknown[] = [];
  let data = '';
  for (const line of [...text.split(/\r?\n/), '']) {
    if (line === '') {
      if (data !== '') {
        const parsed = parseText(data);
        if (Array.isArray(parsed)) out.push(...parsed);
        else if (parsed !== undefined) out.push(parsed);
        data = '';
      }
    } else if (line.startsWith('data:')) {
      let d = line.slice('data:'.length);
      if (d.startsWith(' ')) d = d.slice(1);
      data = data === '' ? d : `${data}\n${d}`;
    }
  }
  return out;
}

/** Inserts the settlement response at `result._meta["x402/payment-response"]`. */
export function attachMcpReceipt(content: Uint8Array, receipt: unknown): Uint8Array | undefined {
  const msg = parseJson(content);
  if (!isRecord(msg) || !isRecord(msg.result)) return undefined;
  const result = msg.result;
  result._meta ??= {};
  if (!isRecord(result._meta)) return undefined;
  result._meta[MCP_RESPONSE_META] = receipt;
  return encoder.encode(JSON.stringify(msg));
}
