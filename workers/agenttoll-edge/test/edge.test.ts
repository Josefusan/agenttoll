// End to end against the Worker in wrangler's local runtime: mock origin + mock facilitator.
// Mirrors crates/agenttoll-gateway/tests/{gateway,payments}.rs case for case.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import {
  BASE_SEPOLIA,
  CHROME,
  CLAUDEBOT,
  SOLANA_DEVNET,
  challenge,
  configYaml,
  decodeHeader,
  encodeHeader,
  get,
  mcp,
  payFor,
  startFacilitator,
  startOrigin,
  startWorker,
  type MockFacilitator,
  type MockOrigin,
  type Worker,
} from './mocks';

let origin: MockOrigin;
let fac: MockFacilitator;
let worker: Worker;
let W: string;

/** Counters are cumulative across tests; each test reads deltas from here. */
let base = { verify: 0, hits: 0, settle: 0, rows: 0 };

const calls = () => [
  fac.state.verifyCalls - base.verify,
  origin.hits() - base.hits,
  fac.state.settleCalls - base.settle,
];

async function ledgerRows(): Promise<Record<string, unknown>[]> {
  const res = await fetch(`${W}/.agenttoll/ledger`);
  return (await res.json()) as Record<string, unknown>[];
}

beforeAll(async () => {
  [origin, fac] = await Promise.all([startOrigin(), startFacilitator()]);
  worker = await startWorker(configYaml({ pinFeePayer: false }), {
    AGENTTOLL_ORIGIN: origin.url,
    AGENTTOLL_FACILITATOR: fac.url,
    AGENTTOLL_LISTEN: '127.0.0.1:0',
    AGENTTOLL_ADMIN_LISTEN: '127.0.0.1:0',
  });
  W = worker.url;
});

afterAll(async () => {
  await Promise.all([worker?.close(), origin?.close(), fac?.close()]);
});

beforeEach(async () => {
  fac.state.rejectVerify = false;
  fac.state.failSettle = false;
  base = {
    verify: fac.state.verifyCalls,
    hits: origin.hits(),
    settle: fac.state.settleCalls,
    rows: (await ledgerRows()).length,
  };
});

describe('challenge (D2 contract)', () => {
  test('human gets the page free', async () => {
    const res = await get(W, '/api/quote', CHROME);
    expect(res.status).toBe(200);
    expect(res.headers.get('payment-required')).toBeNull();
    const body = (await res.json()) as { price: number };
    expect(body.price).toBe(142);
    expect(calls()).toEqual([0, 1, 0]);
  });

  test('agent gets a valid 402 and never reaches the origin', async () => {
    const res = await get(W, '/api/quote?symbol=SOL', CLAUDEBOT);
    expect(res.status).toBe(402);
    expect(res.headers.get('x-agenttoll-verdict')).toBe('ua:ClaudeBot');
    expect(res.headers.get('content-type')).toBe('application/json');
    const pr = challenge(res);
    expect(pr.x402Version).toBe(2);
    const resource = pr.resource as { url: string; description?: string };
    expect(resource.url.endsWith('/api/quote?symbol=SOL')).toBe(true);
    expect(resource.description).toBe('Live price quote');
    const accepts = pr.accepts as Record<string, unknown>[];
    expect(accepts).toHaveLength(2);

    const baseNet = accepts.find((a) => a.network === BASE_SEPOLIA)!;
    expect((baseNet.extra as Record<string, unknown>).name).toBe('USDC');
    const sol = accepts.find((a) => a.network === SOLANA_DEVNET)!;
    expect(sol.scheme).toBe('exact');
    expect(sol.amount).toBe('2000'); // $0.002, KB-AMT-01
    expect(sol.asset).toBe('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
    expect(sol.payTo).toBe('MerchantPayTo111');
    expect(sol.maxTimeoutSeconds).toBe(60);
    // Read from the facilitator's /supported, not hardcoded (KB-X402-07).
    expect((sol.extra as Record<string, unknown>).feePayer).toBe('FacilitatorFeePayer111');

    // The JSON body carries the same challenge for clients that read bodies.
    expect(await res.json()).toEqual(pr);
    expect(calls()).toEqual([0, 0, 0]);
  });

  test('agents pass free routes and heuristic agents are not charged', async () => {
    expect((await get(W, '/', CLAUDEBOT)).status).toBe(200);
    expect((await get(W, '/api/quote', 'curl/8.9.1')).status).toBe(200);
    expect(calls()).toEqual([0, 1, 0]);
  });

  test('path tricks still pay', async () => {
    for (const path of ['/api/%71uote', '/api//quote', '/api/quote/', '/API/Quote', '/api/quote;x=1']) {
      expect((await get(W, path, CLAUDEBOT)).status, path).toBe(402);
    }
    expect(calls()).toEqual([0, 0, 0]);
  });

  test('unverified payment is refused, not forwarded', async () => {
    for (const [header, error] of [
      ['payment-signature', 'only x402Version 2'],
      ['x-payment', 'v1 X-PAYMENT is not supported'],
    ] as const) {
      const res = await get(W, '/api/quote', CLAUDEBOT, { [header]: 'eyJmYWtlIjp0cnVlfQ==' });
      expect(res.status, header).toBe(402);
      expect(String(challenge(res).error), header).toContain(error);
    }
    // A browser that attaches a payment header is an agent trying to pay: same refusal.
    const res = await get(W, '/api/quote', CHROME, { 'payment-signature': 'e30=' });
    expect(res.status).toBe(402);
    expect(calls()).toEqual([0, 0, 0]);
  });

  test('origin never sees spoofed or payment headers', async () => {
    const res = await get(W, '/echo', CHROME, {
      'x-agenttoll-paid': '1',
      'payment-signature': 'e30=',
      connection: 'x-hop',
      'x-hop': '1',
    });
    expect(res.status).toBe(200);
    const seen = (await res.json()) as Record<string, string>;
    for (const gone of ['x-agenttoll-paid', 'payment-signature']) {
      expect(seen[gone], `origin saw ${gone}`).toBeUndefined();
    }
    // `x-hop` is listed in the client's `Connection`, which workerd consumes before the Worker
    // runs, so it cannot be stripped here (the Rust gateway strips it); the origin instead
    // sees workerd's own `connection: keep-alive`. Hop-by-hop stripping is covered by
    // test/proxy.unit.test.ts against the hygiene function itself.
    expect(seen['x-forwarded-for']).toBeDefined();
    expect(seen['x-forwarded-host']?.startsWith('127.0.0.1:') || seen['x-forwarded-host']?.startsWith('localhost:')).toBe(true);
  });
});

describe('MCP per-tool pricing', () => {
  test('tools priced per call, discovery free', async () => {
    const list = await mcp(W, '{"jsonrpc":"2.0","id":1,"method":"tools/list"}');
    expect(list.status).toBe(200);
    expect(await list.text()).toContain('tools/list'); // body replayed to origin intact

    const freeTool = await mcp(W, '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"ping_free"}}');
    expect(freeTool.status).toBe(200);

    for (const path of ['/MCP', '/Mcp/']) {
      const res = await mcp(W, '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"search_docs"}}', path);
      expect(res.status, `${path} must be priced like /mcp`).toBe(402);
    }

    const paid = await mcp(W, '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"search_docs"}}');
    expect(paid.status).toBe(402);
    expect(paid.headers.get('x-agenttoll-verdict')).toBe('mcp-endpoint');
    const pr = challenge(paid);
    expect((pr.accepts as Record<string, unknown>[])[0]!.amount).toBe('5000');
    expect((pr.resource as { description?: string }).description).toBe('mcp:search_docs');

    const batch = await mcp(
      W,
      '[{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_docs"}},{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"generate_report"}}]',
    );
    expect(batch.status).toBe(402);
    expect((challenge(batch).accepts as Record<string, unknown>[])[0]!.amount).toBe('55000');
  });

  test('GET on the MCP endpoint is never charged', async () => {
    expect((await get(W, '/mcp', CHROME)).status).toBe(200);
    expect((await get(W, '/mcp', CLAUDEBOT)).status).toBe(200);
  });

  test('malformed and oversized MCP bodies are rejected', async () => {
    const bad = await mcp(W, '{not json');
    expect(bad.status).toBe(400);
    const err = (await bad.json()) as { error: { code: number; message: string } };
    expect(err.error.code).toBe(-32700);
    expect(err.error.message).toBe('MCP body is not valid JSON');
    const notRpc = await mcp(W, '[]');
    expect(notRpc.status).toBe(400);
    const big = `{"jsonrpc":"2.0","id":1,"method":"tools/list","pad":"${'x'.repeat(1024 * 1024)}"}`;
    expect((await mcp(W, big)).status).toBe(413);
  });
});

describe('paid path (D3 money rules)', () => {
  test('paid request is verified, forwarded, settled and recorded', async () => {
    const payment = await payFor(W, '/api/quote', SOLANA_DEVNET);
    const res = await get(W, '/api/quote', CLAUDEBOT, { 'payment-signature': payment });
    expect(res.status).toBe(200);
    const receipt = decodeHeader(res, 'payment-response');
    expect(receipt.success).toBe(true);
    expect(String(receipt.transaction)).toMatch(/^5igSettled\d+$/);
    expect(receipt.amount, 'facilitator fields pass through verbatim').toBe('2000');

    const body = (await res.json()) as { price: number; headers: Record<string, string> };
    expect(body.price).toBe(142);
    expect(body.headers['x-agenttoll-paid']).toBe('1');
    expect(body.headers['x-agenttoll-agent']).toBe('ClaudeBot');
    expect(body.headers['x-agenttoll-payer']).toBe('BuyerWallet111');
    expect(body.headers['payment-signature']).toBeUndefined();
    expect(calls()).toEqual([1, 1, 1]);

    // The facilitator settled against our quote.
    const settled = fac.state.lastSettle!.paymentRequirements as Record<string, unknown>;
    expect(settled.payTo).toBe('MerchantPayTo111');
    expect(settled.amount).toBe('2000');
    expect((settled.extra as Record<string, unknown>).feePayer).toBe('FacilitatorFeePayer111');

    // D1 ledger row (ARCHITECTURE.md §1.6). The write is deferred with waitUntil; poll briefly.
    let rows = await ledgerRows();
    for (let i = 0; i < 20 && rows.length === base.rows; i++) {
      await new Promise((r) => setTimeout(r, 50));
      rows = await ledgerRows();
    }
    expect(rows.length).toBe(base.rows + 1);
    const row = rows.at(-1)!;
    expect(row.amount_atomic).toBe(2000);
    expect(row.network).toBe(SOLANA_DEVNET);
    expect(row.tx_signature).toBe(receipt.transaction);
    expect(row.agent_name).toBe('ClaudeBot');
    expect(row.route).toBe('GET /api/quote');
    expect(row.origin_status).toBe(200);
  });

  test('Base Sepolia payment works too', async () => {
    const payment = await payFor(W, '/api/quote', BASE_SEPOLIA);
    const res = await get(W, '/api/quote', CLAUDEBOT, { 'payment-signature': payment });
    expect(res.status).toBe(200);
    const settled = fac.state.lastSettle!.paymentRequirements as Record<string, unknown>;
    expect(settled.network).toBe(BASE_SEPOLIA);
    expect((settled.extra as Record<string, unknown>).name).toBe('USDC');
  });

  test('origin error is never settled and the payment can be retried', async () => {
    const payment = await payFor(W, '/api/fail', SOLANA_DEVNET);
    const res = await get(W, '/api/fail', CLAUDEBOT, { 'payment-signature': payment });
    expect(res.status, 'origin status passes through').toBe(500);
    expect(fac.state.settleCalls - base.settle).toBe(0);
    expect((await ledgerRows()).length).toBe(base.rows);

    // Not consumed, so the same payment is not a replay.
    expect((await get(W, '/api/fail', CLAUDEBOT, { 'payment-signature': payment })).status).toBe(500);
    expect(fac.state.verifyCalls - base.verify).toBe(2);
  });

  test('invalid payment never reaches the origin', async () => {
    fac.state.rejectVerify = true;
    const payment = await payFor(W, '/api/quote', SOLANA_DEVNET);
    const res = await get(W, '/api/quote', CLAUDEBOT, { 'payment-signature': payment });
    expect(res.status).toBe(402);
    expect(challenge(res).error).toBe('insufficient_funds');
    expect(calls()).toEqual([1, 0, 0]);
  });

  test('tampered quotes are refused before verify', async () => {
    const tampers: [string, string][] = [
      ['amount', '1'], // cheaper than quoted
      ['payTo', 'AttackerWallet'], // pay yourself
      ['asset', 'FakeMint'], // worthless token
      ['network', 'solana:mainnet'], // a network we did not offer
    ];
    for (const [field, value] of tampers) {
      const payment = await payFor(W, '/api/quote', SOLANA_DEVNET, (a) => {
        a[field] = value;
      });
      const res = await get(W, '/api/quote', CLAUDEBOT, { 'payment-signature': payment });
      expect(res.status, field).toBe(402);
    }
    expect(calls()).toEqual([0, 0, 0]);
  });

  test('replayed payment is refused', async () => {
    const payment = await payFor(W, '/api/quote', SOLANA_DEVNET);
    expect((await get(W, '/api/quote', CLAUDEBOT, { 'payment-signature': payment })).status).toBe(200);
    const replay = await get(W, '/api/quote', CLAUDEBOT, { 'payment-signature': payment });
    expect(replay.status).toBe(402);
    expect(challenge(replay).error).toBe('duplicate_settlement');
    expect(calls()).toEqual([1, 1, 1]);
  });

  test('failed settlement withholds the content', async () => {
    fac.state.failSettle = true;
    const payment = await payFor(W, '/api/quote', SOLANA_DEVNET);
    const res = await get(W, '/api/quote', CLAUDEBOT, { 'payment-signature': payment });
    expect(res.status).toBe(402);
    expect(decodeHeader(res, 'payment-response').success).toBe(false);
    const body = await res.text();
    expect(body, `origin content leaked: ${body}`).not.toContain('142');
    expect((await ledgerRows()).length).toBe(base.rows);
  });

  test('malformed payment headers are client errors', async () => {
    expect((await get(W, '/api/quote', CLAUDEBOT, { 'payment-signature': '%%%not-base64' })).status).toBe(400);
    const noAccepted = encodeHeader({ x402Version: 2, payload: {} });
    expect((await get(W, '/api/quote', CLAUDEBOT, { 'payment-signature': noAccepted })).status).toBe(400);
    expect(calls()).toEqual([0, 0, 0]);
  });
});
