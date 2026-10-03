// Test support: mock origin, mock facilitator (Node http servers on 127.0.0.1), the Worker
// under wrangler's local runtime, and the config text both editions are tested with.

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { createTestHarness } from 'wrangler';

export const WORKER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_ROOT = path.resolve(WORKER_DIR, '../..');

export const CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
export const CLAUDEBOT = 'Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)';
export const GPTBOT =
  'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)';
export const SOLANA_DEVNET = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'; // KB-SOL-01
export const BASE_SEPOLIA = 'eip155:84532'; // KB-BASE-01

function listen(server: http.Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

function sendJson(res: http.ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
}

export interface OriginState {
  /** Like Express `compression()` / nginx gzip: compress JSON when the request allows gzip. */
  compressWhenAllowed: boolean;
  /** `Accept-Encoding` the /mcp endpoint last received. */
  lastAcceptEncoding: string | undefined;
}

export interface MockOrigin {
  url: string;
  state: OriginState;
  hits: () => number;
  /** Last JSON-RPC body the /mcp endpoint received. */
  mcpSeen: () => Record<string, unknown> | undefined;
  close: () => Promise<void>;
}

type Json = Record<string, unknown>;

/**
 * Minimal MCP origin, the same one the Rust e2e tests use: answers tools/list and tools/call;
 * `broken_tool` / `*_broken` fail with `isError`, `sse_*` answer over SSE after a notification,
 * `gzip_*` answer gzip-compressed, `wrong_id` answers another id.
 */
function mcpOrigin(body: Json, req: http.IncomingMessage, res: http.ServerResponse, state: OriginState): void {
  const id = body.id ?? null;
  const method = body.method;
  const params = body.params as Json | undefined;
  const tool = typeof params?.name === 'string' ? params.name : '';
  let result: unknown;
  if (method === 'tools/list') {
    result = {
      tools: [
        { name: 'search_docs', description: 'Search the docs.' },
        { name: 'ping', description: 'Free.' },
      ],
    };
  } else if (method === 'tools/call' && (tool === 'broken_tool' || tool.endsWith('_broken'))) {
    result = { isError: true, content: [{ type: 'text', text: 'tool crashed' }] };
  } else if (method === 'tools/call') {
    result = { content: [{ type: 'text', text: `${tool} ok` }] };
  } else {
    result = {};
  }
  // `wrong_id` answers another request's id, so nothing proves the paid call succeeded.
  const message = JSON.stringify({ jsonrpc: '2.0', id: tool === 'wrong_id' ? 12345 : id, result });
  if (tool.startsWith('sse_')) {
    const note = JSON.stringify({ jsonrpc: '2.0', method: 'notifications/message', params: { level: 'info', data: 'working' } });
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(`event: message\ndata: ${note}\n\nevent: message\ndata: ${message}\n\n`);
    return;
  }
  const allowsGzip = (req.headers['accept-encoding'] ?? '').includes('gzip');
  if (tool.startsWith('gzip_') || (state.compressWhenAllowed && allowsGzip)) {
    res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' });
    res.end(zlib.gzipSync(Buffer.from(message, 'utf8')));
    return;
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(message);
}

/** The origin behind the paywall: the same routes the Rust e2e tests use. */
export async function startOrigin(): Promise<MockOrigin> {
  let hits = 0;
  let mcpSeen: Json | undefined;
  const state: OriginState = { compressWhenAllowed: false, lastAcceptEncoding: undefined };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://origin');
    const p = url.pathname;
    if (req.method === 'GET' && p === '/') return res.end('home');
    if (req.method === 'GET' && p === '/api/quote') {
      hits += 1;
      return sendJson(res, 200, { price: 142.0, headers: req.headers });
    }
    if (req.method === 'GET' && p === '/api/other') return sendJson(res, 200, { other: true });
    if (req.method === 'GET' && p === '/echo') return sendJson(res, 200, req.headers);
    if (req.method === 'GET' && p === '/api/fail') {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('origin down');
    }
    if (req.method === 'GET' && p.startsWith('/blog/')) return res.end('post');
    if (p === '/mcp' || p.toLowerCase().startsWith('/mcp')) {
      if (req.method === 'POST') {
        state.lastAcceptEncoding = req.headers['accept-encoding'];
        const body = await readBody(req);
        let parsed: unknown;
        try {
          parsed = JSON.parse(body);
        } catch {
          res.writeHead(400);
          return res.end('bad json');
        }
        if (Array.isArray(parsed) || typeof parsed !== 'object' || parsed === null) {
          // Batches are echoed; the tests only price them, never pay them.
          res.writeHead(200, { 'content-type': 'application/json' });
          return res.end(body);
        }
        mcpSeen = parsed as Json;
        return mcpOrigin(parsed as Json, req, res, state);
      }
      return res.end('sse');
    }
    res.writeHead(404);
    res.end('not found');
  });
  const url = await listen(server);
  return { url, state, hits: () => hits, mcpSeen: () => mcpSeen, close: () => closeServer(server) };
}

export interface FacilitatorState {
  rejectVerify: boolean;
  failSettle: boolean;
  /** Answer /settle after 2 s, longer than the settle budget in the test config (500 ms). */
  slowSettle: boolean;
  /** Answer /settle with `settlement_pending` and a transaction id (KB-X402-06). */
  pendingSettle: boolean;
  /** Send 200 + the start of a JSON body on /settle (or /verify), then never finish. */
  stallSettle: boolean;
  stallVerify: boolean;
  verifyCalls: number;
  settleCalls: number;
  lastSettle: Record<string, unknown> | undefined;
}

export interface MockFacilitator {
  url: string;
  state: FacilitatorState;
  close: () => Promise<void>;
}

/** A facilitator whose answers each test controls (KB-X402-06 shapes). */
export async function startFacilitator(): Promise<MockFacilitator> {
  const state: FacilitatorState = {
    rejectVerify: false,
    failSettle: false,
    slowSettle: false,
    pendingSettle: false,
    stallSettle: false,
    stallVerify: false,
    verifyCalls: 0,
    settleCalls: 0,
    lastSettle: undefined,
  };
  const server = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/supported') {
      return sendJson(res, 200, {
        kinds: [
          { x402Version: 1, scheme: 'exact', network: 'solana-devnet', extra: { feePayer: 'WrongVersion' } },
          { x402Version: 2, scheme: 'exact', network: SOLANA_DEVNET, extra: { feePayer: 'FacilitatorFeePayer111' } },
        ],
        extensions: [],
        signers: {},
      });
    }
    const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
    if (body.x402Version !== 2) return sendJson(res, 400, { error: 'x402Version must be 2' });
    const stall = () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{"success":');
      // never ends; closeAllConnections() tears it down in close()
    };
    if (req.method === 'POST' && req.url === '/verify') {
      state.verifyCalls += 1;
      if (state.stallVerify) return stall();
      if (state.rejectVerify) {
        // Facilitators may reject with a 4xx that still carries a well-formed body.
        return sendJson(res, 400, { isValid: false, invalidReason: 'insufficient_funds' });
      }
      return sendJson(res, 200, { isValid: true, payer: 'BuyerWallet111' });
    }
    if (req.method === 'POST' && req.url === '/settle') {
      state.settleCalls += 1;
      state.lastSettle = body;
      const network = (body.paymentRequirements as Record<string, unknown>).network;
      if (state.stallSettle) return stall();
      if (state.slowSettle) await new Promise((r) => setTimeout(r, 2_000));
      if (state.failSettle) {
        return sendJson(res, 200, { success: false, transaction: '', network, errorReason: 'transaction_failed' });
      }
      if (state.pendingSettle) {
        return sendJson(res, 200, {
          success: false,
          transaction: `5igPending${state.settleCalls}`,
          network,
          errorReason: 'settlement_pending',
        });
      }
      return sendJson(res, 200, {
        success: true,
        transaction: `5igSettled${state.settleCalls}`,
        network,
        payer: 'BuyerWallet111',
        amount: '2000',
      });
    }
    res.writeHead(404);
    res.end();
  });
  const url = await listen(server);
  return { url, state, close: () => closeServer(server) };
}

export interface ConfigOptions {
  pinFeePayer: boolean;
  /** `mcp.challenge`; the default (omitted) is `mcp-native`. */
  mcpChallenge?: 'mcp-native' | 'http-402';
}

/**
 * The config under test. `${VAR}` placeholders are filled by each runtime (the Worker from
 * its vars, the Rust gateway from its process environment), so one text serves both. The
 * settle budget is 500 ms so a slow facilitator can be simulated quickly.
 */
export function configYaml(opts: ConfigOptions): string {
  const pin = opts.pinFeePayer ? '    fee_payer: PinnedFeePayer111\n' : '';
  const challenge = opts.mcpChallenge ? `  challenge: ${opts.mcpChallenge}\n` : '';
  return `origin: "\${AGENTTOLL_ORIGIN}"
listen: "\${AGENTTOLL_LISTEN}"
admin_listen: "\${AGENTTOLL_ADMIN_LISTEN}"
networks:
  solana:
    network: "${SOLANA_DEVNET}"
    asset: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
    pay_to: "MerchantPayTo111"
    facilitator: "\${AGENTTOLL_FACILITATOR}"
${pin}  base:
    network: "${BASE_SEPOLIA}"
    asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
    pay_to: "0x0000000000000000000000000000000000000001"
    facilitator: "\${AGENTTOLL_FACILITATOR}"
routes:
  - match: "GET /api/quote"
    price_usd: "0.002"
    description: "Live price quote"
  - match: "GET /api/*"
    price_usd: "0.002"
  - match: "/blog/*"
    price_usd: "0.003"
  - match: "/*"
    price_usd: "0"
mcp:
  endpoint: /mcp
  advertise_prices: true
${challenge}  tools:
    search_docs: "0.005"
    generate_report: "0.05"
    broken_tool: "0.005"
    sse_ok: "0.005"
    sse_broken: "0.005"
    gzip_ok: "0.005"
    gzip_broken: "0.005"
    wrong_id: "0.005"
ledger:
  url: "sqlite::memory:"
timeouts:
  verify_ms: 500
  settle_ms: 500
`;
}

export interface Worker {
  url: string;
  close: () => Promise<void>;
}

/** Boots the Worker in wrangler's local runtime (workerd + local D1) with test vars. */
export async function startWorker(yaml: string, vars: Record<string, string>): Promise<Worker> {
  const server = createTestHarness({
    root: WORKER_DIR,
    workers: [
      {
        configPath: './wrangler.toml',
        vars: { AGENTTOLL_CONFIG: yaml, AGENTTOLL_DEBUG: '1', ...vars },
      },
    ],
  });
  const { url } = await server.listen();
  return { url: url.toString().replace(/\/$/, ''), close: () => server.close() };
}

/** GET like the Rust harness: browser UAs get the headers a real navigation carries. */
export function get(base: string, path: string, ua: string, extra: Record<string, string> = {}): Promise<Response> {
  const headers: Record<string, string> = { 'user-agent': ua, ...extra };
  if (ua.startsWith('Mozilla/5.0 (Mac')) {
    headers['accept-language'] ??= 'en-US';
    headers['sec-fetch-mode'] ??= 'navigate';
  }
  return fetch(`${base}${path}`, { headers, redirect: 'manual' });
}

export function mcp(base: string, body: string, path = '/mcp', extra: Record<string, string> = {}): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...extra },
    body,
  });
}

export function decodeHeader(res: Response, name: string): Record<string, unknown> {
  const header = res.headers.get(name);
  if (header === null) throw new Error(`${name} header missing (status ${res.status})`);
  return JSON.parse(Buffer.from(header, 'base64').toString('utf8')) as Record<string, unknown>;
}

export function encodeHeader(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
}

export const challenge = (res: Response) => decodeHeader(res, 'payment-required');

/** A payment header whose `x402Version` is spelled `2.0` on the wire (parses to 2). */
export function payFor20(payment: string): string {
  const text = Buffer.from(payment, 'base64').toString('utf8');
  if (!text.startsWith('{"x402Version":2,')) throw new Error(`unexpected payment text: ${text.slice(0, 40)}`);
  return Buffer.from(text.replace('{"x402Version":2,', '{"x402Version":2.0,'), 'utf8').toString('base64');
}

/** A fresh signed-transaction stand-in, so each payment is distinct for the replay guard. */
export const signedTx = () => Buffer.from(`partially-signed-${crypto.randomUUID()}`).toString('base64');

/**
 * Fetches the quote for `path` and builds a payment header answering it on `network`. The
 * payment echoes the quoted `resource`, like the Rust harness's `pay_for`.
 */
export async function payFor(
  base: string,
  path: string,
  network: string,
  tamper: (accepted: Record<string, unknown>) => void = () => {},
): Promise<string> {
  const res = await get(base, path, CLAUDEBOT);
  if (res.status !== 402) throw new Error(`expected 402 quote, got ${res.status}`);
  const quote = challenge(res);
  const accepts = quote.accepts as Record<string, unknown>[];
  const accepted = structuredClone(accepts.find((a) => a.network === network));
  if (!accepted) throw new Error(`quote has no ${network}`);
  tamper(accepted);
  return encodeHeader({
    x402Version: 2,
    resource: quote.resource,
    accepted,
    payload: { transaction: signedTx() },
  });
}

export const toolCall = (tool: string, id: unknown = 9): Record<string, unknown> => ({
  jsonrpc: '2.0',
  id,
  method: 'tools/call',
  params: { name: tool, arguments: {} },
});

/**
 * MCP-native flow (KB-X402-05): call the tool unpaid, read the challenge from the tool
 * result's `structuredContent`, and build the PaymentPayload answering it on Solana devnet.
 */
export async function mcpQuote(base: string, tool: string): Promise<{ required: Record<string, unknown>; payment: Record<string, unknown> }> {
  const res = await mcp(base, JSON.stringify(toolCall(tool)));
  const body = (await res.json()) as { result: { isError?: boolean; structuredContent: Record<string, unknown> } };
  if (res.status !== 200 || body.result?.isError !== true) {
    throw new Error(`expected an MCP-native challenge, got ${res.status} ${JSON.stringify(body)}`);
  }
  const required = body.result.structuredContent;
  const accepted = (required.accepts as Record<string, unknown>[]).find((a) => a.network === SOLANA_DEVNET);
  return {
    required,
    payment: { x402Version: 2, resource: required.resource, accepted, payload: { transaction: signedTx() } },
  };
}

/** Quotes `tool`, then retries it with the payment in `params._meta["x402/payment"]`. */
export async function payTool(base: string, tool: string, extra: Record<string, string> = {}): Promise<Response> {
  const { payment } = await mcpQuote(base, tool);
  const call = toolCall(tool);
  (call.params as Record<string, unknown>)._meta = { 'x402/payment': payment };
  return mcp(base, JSON.stringify(call), '/mcp', extra);
}
