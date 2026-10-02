// Parity: the Rust gateway (cargo run -p agenttoll-gateway) and the Worker (wrangler's local
// runtime) get the same config and the same mock facilitator; their decoded PAYMENT-REQUIRED
// must be equal, and so must the 402 bodies, verdict headers and refusal reasons.
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
  startFacilitator,
  startOrigin,
  startWorker,
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
      name: 'MCP single tool',
      path: '/mcp',
      method: 'POST',
      body: '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"search_docs"}}',
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

  test.each(cases)('$name', async (c) => {
    const [r, w] = await Promise.all([send(R, c), send(W, c)]);
    expect(w.status).toBe(r.status);
    expect(r.status).toBe(402);
    expect(w.headers.get('x-agenttoll-verdict')).toBe(r.headers.get('x-agenttoll-verdict'));
    expect(w.headers.get('content-type')).toBe(r.headers.get('content-type'));

    const rHeader = r.headers.get('payment-required')!;
    const wHeader = w.headers.get('payment-required')!;
    const rJson = Buffer.from(rHeader, 'base64').toString('utf8');
    const wJson = Buffer.from(wHeader, 'base64').toString('utf8');
    // Byte-identical JSON (field order included) once the host is masked.
    expect(dehost(wJson, W)).toBe(dehost(rJson, R));
    expect(JSON.parse(wJson)).toEqual(
      JSON.parse(rJson.split(R.replace(/^http:\/\//, '')).join(W.replace(/^http:\/\//, ''))),
    );
    // Same JSON in the body as in the header, on both.
    expect(dehost(await w.text(), W)).toBe(dehost(await r.text(), R));
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
