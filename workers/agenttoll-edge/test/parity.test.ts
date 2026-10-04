// Parity: the Rust gateway (cargo run -p agenttoll-gateway) and the Worker (wrangler's local
// runtime) get the same config and the same mock facilitator; their decoded PAYMENT-REQUIRED
// must be equal, and so must the 402 bodies, MCP-native challenges, discovery JSON, advertised
// tools/list, verdict headers, refusal reasons and settle decisions.
// resource.url may differ only by host (each edition quotes the host it was reached on).

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  CLAUDEBOT,
  GPTBOT,
  REPO_ROOT,
  SOLANA_DEVNET,
  challenge,
  configYaml,
  encodeHeader,
  get,
  mcp,
  mcpQuote,
  payFor,
  payFor20,
  payTool,
  signedTx,
  startFacilitator,
  startOrigin,
  startWorker,
  toolCall,
  type MockFacilitator,
  type MockOrigin,
  type Worker,
} from './mocks';

const haveCargo = spawnSync('cargo', ['--version'], { stdio: 'ignore' }).status === 0;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });
}

async function waitFor(url: string, deadlineMs: number): Promise<void> {
  const until = Date.now() + deadlineMs;
  while (Date.now() < until) {
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error(`${url} did not come up`);
}

let origin: MockOrigin;
let fac: MockFacilitator;
let worker: Worker;
let gateway: ChildProcess | undefined;
let gatewayLog = '';
let R: string; // Rust gateway base URL
let W: string; // Worker base URL
let tmpDir: string;

describe.skipIf(!haveCargo)('Rust gateway vs Worker parity', () => {
  beforeAll(async () => {
    const build = spawnSync('cargo', ['build', '-q', '-p', 'agenttoll-gateway'], {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      timeout: 590_000,
    });
    if (build.status !== 0) throw new Error('cargo build -p agenttoll-gateway failed');

    [origin, fac] = await Promise.all([startOrigin(), startFacilitator()]);
    const yaml = configYaml({ pinFeePayer: false });
    const [port, admin] = [await freePort(), await freePort()];
    const vars = {
      AGENTTOLL_ORIGIN: origin.url,
      AGENTTOLL_FACILITATOR: fac.url,
      AGENTTOLL_LISTEN: `127.0.0.1:${port}`,
      AGENTTOLL_ADMIN_LISTEN: `127.0.0.1:${admin}`,
    };

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenttoll-parity-'));
    const configPath = path.join(tmpDir, 'agenttoll.yaml');
    fs.writeFileSync(configPath, yaml);
    gateway = spawn(path.join(REPO_ROOT, 'target/debug/agenttoll-gateway'), ['--config', configPath], {
      cwd: tmpDir,
      env: { ...process.env, ...vars, RUST_LOG: 'warn' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    gateway.stdout?.on('data', (d: Buffer) => (gatewayLog += d.toString()));
    gateway.stderr?.on('data', (d: Buffer) => (gatewayLog += d.toString()));
    R = `http://127.0.0.1:${port}`;

    worker = await startWorker(yaml, vars);
    W = worker.url;
    await waitFor(`${R}/`, 20_000);
  });

  afterAll(async () => {
    gateway?.kill('SIGKILL');
    await Promise.all([worker?.close(), origin?.close(), fac?.close()]);
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    if (gatewayLog.trim()) console.log(`[rust gateway]\n${gatewayLog}`);
  });

  interface Case {
    name: string;
    path: string;
    ua?: string;
    headers?: Record<string, string>;
    method?: 'GET' | 'POST';
    body?: string;
  }

  const cases: Case[] = [
    { name: 'ClaudeBot quote with query', path: '/api/quote?symbol=SOL', ua: CLAUDEBOT },
    { name: 'GPTBot deep api route', path: '/api/v1/deep/path', ua: GPTBOT },
    { name: 'percent-encoded path trick', path: '/api/%71uote', ua: CLAUDEBOT },
    { name: 'double slash and trailing slash', path: '/api//quote/', ua: CLAUDEBOT },
    { name: 'blog route, any method', path: '/blog/hello-world', ua: GPTBOT },
    { name: 'v1 X-PAYMENT refusal', path: '/api/quote', ua: CLAUDEBOT, headers: { 'x-payment': 'e30=' } },
    {
      name: 'wrong x402Version refusal',
      path: '/api/quote',
      ua: CLAUDEBOT,
      headers: { 'payment-signature': 'eyJmYWtlIjp0cnVlfQ==' },
    },
    {
      name: 'MCP batch',
      path: '/MCP',
      method: 'POST',
      body: '[{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_docs"}},{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"generate_report"}},{"jsonrpc":"2.0","id":3,"method":"ping"}]',
    },
  ];

  function send(base: string, c: Case): Promise<Response> {
    if (c.method === 'POST') {
      return fetch(`${base}${c.path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(c.headers ?? {}) },
        body: c.body,
      });
    }
    return get(base, c.path, c.ua ?? CLAUDEBOT, c.headers);
  }

  /** Replaces the quoted host with a placeholder so both editions can be compared. */
  const dehost = (text: string, base: string) => text.split(base.replace(/^http:\/\//, '')).join('HOST');
  const rehost = (text: string) => text.split(R.replace(/^http:\/\//, '')).join(W.replace(/^http:\/\//, ''));

  /** Both editions' PAYMENT-REQUIRED headers decode to the same JSON, byte for byte. */
  function expectSameChallengeHeader(r: Response, w: Response): void {
    const rJson = Buffer.from(r.headers.get('payment-required')!, 'base64').toString('utf8');
    const wJson = Buffer.from(w.headers.get('payment-required')!, 'base64').toString('utf8');
    // Byte-identical JSON (field order included) once the host is masked.
    expect(dehost(wJson, W)).toBe(dehost(rJson, R));
    expect(JSON.parse(wJson)).toEqual(JSON.parse(rehost(rJson)));
  }

  test.each(cases)('$name', async (c) => {
    const [r, w] = await Promise.all([send(R, c), send(W, c)]);
    expect(w.status).toBe(r.status);
    expect(r.status).toBe(402);
    expect(w.headers.get('x-agenttoll-verdict')).toBe(r.headers.get('x-agenttoll-verdict'));
    expect(w.headers.get('content-type')).toBe(r.headers.get('content-type'));
    expectSameChallengeHeader(r, w);
    // Same JSON in the body as in the header, on both.
    expect(dehost(await w.text(), W)).toBe(dehost(await r.text(), R));
  });

  test('MCP-native challenge body is identical', async () => {
    const body = JSON.stringify(toolCall('search_docs', 3));
    const [r, w] = await Promise.all([mcp(R, body), mcp(W, body)]);
    expect([r.status, w.status]).toEqual([200, 200]);
    expect(w.headers.get('x-agenttoll-verdict')).toBe(r.headers.get('x-agenttoll-verdict'));
    expect(w.headers.get('content-type')).toBe(r.headers.get('content-type'));
    expectSameChallengeHeader(r, w);
    const [rBody, wBody] = [await r.text(), await w.text()];
    expect(JSON.parse(wBody)).toEqual(JSON.parse(rehost(rBody)));
    expect(dehost(wBody, W), 'byte-identical JSON-RPC result').toBe(dehost(rBody, R));
    const parsed = JSON.parse(wBody) as { result: { isError: boolean; structuredContent: { resource: { url: string } } } };
    expect(parsed.result.isError).toBe(true);
    expect(parsed.result.structuredContent.resource.url).toMatch(/\/mcp#mcp:search_docs$/);
  });

  test('discovery JSON is identical', async () => {
    const [r, w] = await Promise.all([fetch(`${R}/.well-known/agenttoll.json`), fetch(`${W}/.well-known/agenttoll.json`)]);
    expect([r.status, w.status]).toEqual([200, 200]);
    expect(w.headers.get('content-type')).toBe(r.headers.get('content-type'));
    const [rBody, wBody] = [await r.text(), await w.text()];
    expect(wBody).toBe(rBody);
    expect((JSON.parse(wBody) as { mcp: { tools: Record<string, string> } }).mcp.tools.search_docs).toBe('0.005');
  });

  test('advertised tools/list is identical', async () => {
    const body = '{"jsonrpc":"2.0","id":1,"method":"tools/list"}';
    const [r, w] = await Promise.all([mcp(R, body), mcp(W, body)]);
    expect([r.status, w.status]).toEqual([200, 200]);
    const [rBody, wBody] = [await r.text(), await w.text()];
    expect(JSON.parse(wBody)).toEqual(JSON.parse(rBody));
    expect(wBody).toContain('$0.005 USDC per call');
  });

  test('tampered payment is refused identically before verify', async () => {
    const quote = challenge(await get(R, '/api/quote', CLAUDEBOT));
    const accepted = structuredClone((quote.accepts as Record<string, unknown>[]).find((a) => a.network === SOLANA_DEVNET)!);
    accepted.amount = '1';
    const payment = encodeHeader({ x402Version: 2, accepted, payload: { transaction: 'cGFydGlhbGx5LXNpZ25lZA==' } });
    const before = fac.state.verifyCalls;
    const [r, w] = await Promise.all([
      get(R, '/api/quote', CLAUDEBOT, { 'payment-signature': payment }),
      get(W, '/api/quote', CLAUDEBOT, { 'payment-signature': payment }),
    ]);
    expect([r.status, w.status]).toEqual([402, 402]);
    expect(challenge(w).error).toBe(challenge(r).error);
    expect(challenge(r).error).toBe("payment does not match this resource's price quote");
    expect(fac.state.verifyCalls).toBe(before);
  });

  test('a payment for another resource is refused identically', async () => {
    const before = fac.state.verifyCalls;
    const errors: string[] = [];
    for (const base of [R, W]) {
      const payment = await payFor(base, '/api/quote', SOLANA_DEVNET);
      const res = await get(base, '/api/other', CLAUDEBOT, { 'payment-signature': payment });
      expect(res.status).toBe(402);
      errors.push(String(challenge(res).error));
    }
    expect(errors).toEqual(['payment was made for a different resource', 'payment was made for a different resource']);
    expect(fac.state.verifyCalls).toBe(before);
  });

  test('an MCP payment for another tool is refused identically', async () => {
    const before = fac.state.verifyCalls;
    const bodies: string[] = [];
    for (const base of [R, W]) {
      const { payment } = await mcpQuote(base, 'search_docs');
      const other = toolCall('broken_tool', 10);
      (other.params as Record<string, unknown>)._meta = { 'x402/payment': payment };
      const res = await mcp(base, JSON.stringify(other));
      expect(res.status).toBe(200);
      bodies.push(dehost(await res.text(), base));
    }
    expect(bodies[1]).toBe(bodies[0]);
    const parsed = JSON.parse(bodies[0]!) as { result: { isError: boolean; structuredContent: { error: string } } };
    expect(parsed.result.isError).toBe(true);
    expect(parsed.result.structuredContent.error).toBe('payment was made for a different resource');
    expect(fac.state.verifyCalls).toBe(before);
  });

  test('a re-encoded payment is a replay on both', async () => {
    for (const base of [R, W]) {
      const payment = await payFor(base, '/api/quote', SOLANA_DEVNET);
      const settleBefore = fac.state.settleCalls;
      expect((await get(base, '/api/quote', CLAUDEBOT, { 'payment-signature': payment })).status).toBe(200);
      expect(fac.state.settleCalls).toBe(settleBefore + 1);
      const decoded = JSON.parse(Buffer.from(payment, 'base64').toString('utf8')) as Record<string, unknown>;
      const pretty = Buffer.from(JSON.stringify(decoded, null, 2), 'utf8').toString('base64');
      expect(pretty).not.toBe(payment);
      const replay = await get(base, '/api/quote', CLAUDEBOT, { 'payment-signature': pretty });
      expect(replay.status, base).toBe(402);
      expect(challenge(replay).error).toBe('duplicate_settlement');
      expect(fac.state.settleCalls).toBe(settleBefore + 1);
    }
  });

  const editions = [
    ['rust', () => R],
    ['worker', () => W],
  ] as const;

  test('settle decisions agree for SSE, wrong-id and plain MCP results', async () => {
    // tool -> [HTTP status, /settle calls]. Unverifiable 2xx results are withheld (502).
    const expected: Record<string, [number, number]> = {
      sse_broken: [200, 0],
      sse_ok: [200, 1],
      wrong_id: [502, 0],
      search_docs: [200, 1],
      broken_tool: [200, 0],
    };
    for (const [tool, [status, settles]] of Object.entries(expected)) {
      for (const [name, base] of editions) {
        const before = fac.state.settleCalls;
        const res = await payTool(base(), tool);
        expect(res.status, `${name} ${tool}`).toBe(status);
        expect(fac.state.settleCalls - before, `${name} ${tool} settle count`).toBe(settles);
        expect(res.headers.has('payment-response'), `${name} ${tool} receipt`).toBe(settles === 1);
        if (status === 502) expect(await res.text(), `${name} ${tool} leaked`).not.toContain(' ok');
      }
    }
  });

  test('explicitly compressed results: documented difference, never served unpaid', async () => {
    // Rust strips Accept-Encoding and cannot judge a body that still arrives compressed, so it
    // withholds it (502, not settled). workerd decodes the body before the Worker sees it, so
    // the Worker judges the decoded bytes: a success settles, an explicit failure is returned
    // unpaid. Neither edition ever serves content it could not verify without settling.
    const expected: Record<string, Record<string, [number, number]>> = {
      gzip_ok: { rust: [502, 0], worker: [200, 1] },
      gzip_broken: { rust: [502, 0], worker: [200, 0] },
    };
    for (const [tool, byEdition] of Object.entries(expected)) {
      for (const [name, base] of editions) {
        const [status, settles] = byEdition[name]!;
        const before = fac.state.settleCalls;
        const res = await payTool(base(), tool);
        expect(res.status, `${name} ${tool}`).toBe(status);
        expect(fac.state.settleCalls - before, `${name} ${tool} settle count`).toBe(settles);
        const body = await res.text();
        if (status === 502) expect(body, `${name} ${tool} leaked`).not.toContain(' ok');
        if (status === 200 && settles === 0) expect(body).toContain('"isError":true');
      }
    }
  });

  test('a compressing origin is settled and served on both', async () => {
    // The origin gzips whenever the request allows it. Rust strips Accept-Encoding and gets
    // identity; workerd adds its own Accept-Encoding, gets gzip and decodes it. Same outcome.
    origin.state.compressWhenAllowed = true;
    try {
      for (const [name, base] of editions) {
        const before = fac.state.settleCalls;
        const res = await payTool(base(), 'search_docs');
        expect(res.status, name).toBe(200);
        expect(fac.state.settleCalls - before, `${name} settle count`).toBe(1);
        expect(await res.text(), name).toContain('search_docs ok');
      }
    } finally {
      origin.state.compressWhenAllowed = false;
    }
  });

  test('x402Version 2.0 is refused identically', async () => {
    const before = fac.state.verifyCalls;
    for (const [name, base] of editions) {
      const payment = payFor20(await payFor(base(), '/api/quote', SOLANA_DEVNET));
      const res = await get(base(), '/api/quote', CLAUDEBOT, { 'payment-signature': payment });
      expect(res.status, name).toBe(402);
      expect(challenge(res).error, name).toBe('only x402Version 2 payments are accepted');
    }
    expect(fac.state.verifyCalls).toBe(before);
  });

  test('float ids settle and duplicate-id batches never do, on both', async () => {
    for (const [name, base] of editions) {
      const { payment } = await mcpQuote(base(), 'search_docs');
      const before = fac.state.settleCalls;
      const body = `{"jsonrpc":"2.0","id":9.0,"method":"tools/call","params":{"name":"search_docs","_meta":{"x402/payment":${JSON.stringify(payment)}}}}`;
      const res = await mcp(base(), body);
      expect(res.status, `${name} float id`).toBe(200);
      expect(fac.state.settleCalls - before, `${name} float id settle count`).toBe(1);

      const batch = '[{"jsonrpc":"2.0","id":1,"method":"ping"},{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_docs"}}]';
      const quote = await mcp(base(), batch);
      expect(quote.status, `${name} duplicate-id quote`).toBe(402);
      const pr = challenge(quote);
      const accepted = (pr.accepts as Record<string, unknown>[]).find((a) => a.network === SOLANA_DEVNET);
      const header = encodeHeader({ x402Version: 2, resource: pr.resource, accepted, payload: { transaction: signedTx() } });
      const dup = await mcp(base(), batch, '/mcp', { 'payment-signature': header });
      expect(dup.status, `${name} duplicate ids`).toBe(502);
      expect(fac.state.settleCalls - before, `${name} duplicate ids settle count`).toBe(1);
    }
  });

  test('humans and free routes pass through on both', async () => {
    for (const [p, ua] of [
      ['/', CLAUDEBOT],
      ['/api/quote', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15'],
      ['/api/quote', 'curl/8.9.1'],
    ] as const) {
      const [r, w] = await Promise.all([get(R, p, ua), get(W, p, ua)]);
      expect([r.status, w.status], `${ua} ${p}`).toEqual([200, 200]);
      expect(w.headers.get('payment-required')).toBeNull();
    }
  });
});
