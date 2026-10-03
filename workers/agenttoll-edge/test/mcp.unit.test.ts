// Unit tests for the MCP helpers, the same cases as the Rust `pay.rs` unit tests for
// `tool_call_ids`, `mcp_succeeded` and `mcp_failed_explicitly`.

import { describe, expect, test } from 'vitest';
import { mcpFailedExplicitly, mcpSucceeded, toolCallIds } from '../src/mcp';
import { isX402V2, parsePaymentJson } from '../src/x402';

const bytes = (s: string) => new TextEncoder().encode(s);
const json = (extra: Record<string, string> = {}) => new Headers({ 'content-type': 'application/json', ...extra });

describe('toolCallIds', () => {
  test('collects ids; a call without one is null', () => {
    expect(toolCallIds(bytes('{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"a"}}'))).toEqual([3]);
    const batch = '[{"jsonrpc":"2.0","id":1,"method":"ping"},{"jsonrpc":"2.0","method":"tools/call","params":{"name":"a"}}]';
    expect(toolCallIds(bytes(batch))).toEqual([null]);
  });

  test('duplicate request ids compare by value and never settle', () => {
    const byValue = '[{"jsonrpc":"2.0","id":9,"method":"ping"},{"jsonrpc":"2.0","id":9.0,"method":"tools/call","params":{"name":"a"}}]';
    expect(toolCallIds(bytes(byValue)), '9 and 9.0 are the same id').toEqual([null]);
    const big = '[{"jsonrpc":"2.0","id":9007199254740992,"method":"ping"},{"jsonrpc":"2.0","id":9007199254740993,"method":"tools/call","params":{"name":"a"}}]';
    expect(toolCallIds(bytes(big)), 'ids equal as f64 collide').toEqual([null]);
    const distinct = '[{"jsonrpc":"2.0","id":1,"method":"ping"},{"jsonrpc":"2.0","id":"1","method":"tools/call","params":{"name":"a"}}]';
    expect(toolCallIds(bytes(distinct)), 'number 1 and string "1" differ').toEqual(['1']);
  });
});

describe('mcpSucceeded / mcpFailedExplicitly', () => {
  const ok = bytes('{"jsonrpc":"2.0","id":9,"result":{"content":[]}}');
  const err = bytes('{"jsonrpc":"2.0","id":9,"result":{"isError":true}}');

  test('numeric ids match by value, strings do not', () => {
    expect(mcpSucceeded(json(), ok, [9.0])).toBe(true);
    expect(mcpSucceeded(json(), bytes('{"jsonrpc":"2.0","id":"9","result":{}}'), [9])).toBe(false);
    expect(mcpFailedExplicitly(json(), err, [9])).toBe(true);
    expect(mcpFailedExplicitly(json(), ok, [9]), 'success is not a failure').toBe(false);
    expect(mcpFailedExplicitly(json(), bytes('{"jsonrpc":"2.0","id":"9","result":{"isError":true}}'), [9]), 'unmatched').toBe(false);
  });

  test('a request is not a response; null ids and unreadable bodies never match', () => {
    expect(mcpSucceeded(json(), bytes('{"jsonrpc":"2.0","id":9,"method":"tools/call","result":{}}'), [9])).toBe(false);
    expect(mcpSucceeded(json(), bytes('{"jsonrpc":"2.0","id":null,"result":{}}'), [null])).toBe(false);
    expect(mcpSucceeded(json(), bytes('not json'), [9])).toBe(false);
    expect(mcpFailedExplicitly(json(), bytes('not json'), [9])).toBe(false);
    expect(mcpSucceeded(json(), ok, [])).toBe(false);
  });

  test('decoded bytes are judged even when workerd kept a Content-Encoding header', () => {
    // Intentional difference from Rust, which never sees decoded compressed bodies.
    expect(mcpSucceeded(json({ 'content-encoding': 'gzip' }), ok, [9])).toBe(true);
    expect(mcpFailedExplicitly(json({ 'content-encoding': 'gzip' }), err, [9])).toBe(true);
  });

  test('SSE: every event is read and multi-line data is joined', () => {
    const sse = new Headers({ 'content-type': 'text/event-stream' });
    const note = 'event: message\ndata: {"jsonrpc":"2.0","method":"notifications/message","params":{}}\n\n';
    expect(mcpSucceeded(sse, bytes(`${note}event: message\ndata: {"jsonrpc":"2.0","id":9,"result":{"isError":true}}\n\n`), [9])).toBe(false);
    expect(mcpSucceeded(sse, bytes(`${note}data: {"jsonrpc":"2.0","id":9,\ndata: "result":{"content":[]}}\n\n`), [9])).toBe(true);
    expect(mcpSucceeded(sse, bytes(note), [9])).toBe(false);
  });
});

describe('x402Version on the wire', () => {
  test('only the integer 2 is accepted, like Rust as_u64() == Some(2)', () => {
    const v2 = parsePaymentJson('{"x402Version":2,"accepted":{"x402Version":2.0}}') as Record<string, unknown>;
    expect(isX402V2(v2)).toBe(true);
    expect(isX402V2(parsePaymentJson('{"x402Version":2.0}') as Record<string, unknown>)).toBe(false);
    expect(isX402V2(parsePaymentJson('{"x402Version":2e0}') as Record<string, unknown>)).toBe(false);
    expect(isX402V2(parsePaymentJson('{"x402Version":"2"}') as Record<string, unknown>)).toBe(false);
    expect(isX402V2(parsePaymentJson('{"x402Version":1}') as Record<string, unknown>)).toBe(false);
  });
});
