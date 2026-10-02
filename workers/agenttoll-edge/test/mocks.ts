// Test support: mock origin, mock facilitator (Node http servers on 127.0.0.1), the Worker
// under wrangler's local runtime, and the config text both editions are tested with.

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

export interface MockOrigin {
  url: string;
  hits: () => number;
  close: () => Promise<void>;
}

/** The origin behind the paywall: the same routes the Rust e2e tests use. */
export async function startOrigin(): Promise<MockOrigin> {
  let hits = 0;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://origin');
    const p = url.pathname;
    if (req.method === 'GET' && p === '/') return res.end('home');
    if (req.method === 'GET' && p === '/api/quote') {
      hits += 1;
      return sendJson(res, 200, { price: 142.0, headers: req.headers });
    }
    if (req.method === 'GET' && p === '/echo') return sendJson(res, 200, req.headers);
    if (req.method === 'GET' && p === '/api/fail') {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('origin down');
    }
    if (req.method === 'GET' && p.startsWith('/blog/')) return res.end('post');
    if (p === '/mcp' || p.toLowerCase().startsWith('/mcp')) {
      if (req.method === 'POST') {
        const body = await readBody(req);
        res.writeHead(200, { 'content-type': req.headers['content-type'] ?? 'application/json' });
        return res.end(body);
      }
      return res.end('sse');
    }
    res.writeHead(404);
    res.end('not found');
  });
  const url = await listen(server);
  return { url, hits: () => hits, close: () => closeServer(server) };
}

export interface FacilitatorState {
  rejectVerify: boolean;
  failSettle: boolean;
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
    if (req.method === 'POST' && req.url === '/verify') {
      state.verifyCalls += 1;
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
      if (state.failSettle) {
        return sendJson(res, 200, { success: false, transaction: '', network, errorReason: 'transaction_failed' });
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

/**
 * The config under test. `${VAR}` placeholders are filled by each runtime (the Worker from
 * its vars, the Rust gateway from its process environment), so one text serves both.
 */
export function configYaml(opts: { pinFeePayer: boolean }): string {
  const pin = opts.pinFeePayer ? '    fee_payer: PinnedFeePayer111\n' : '';
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
  tools:
    search_docs: "0.005"
    generate_report: "0.05"
ledger:
  url: "sqlite::memory:"
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

export function mcp(base: string, body: string, path = '/mcp'): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
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

/**
 * Fetches the quote for `path` and builds a payment header answering it on `network`. The
 * payload carries a fresh nonce so each payment is distinct for the replay guard.
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
    accepted,
    payload: { transaction: Buffer.from(`partially-signed-${crypto.randomUUID()}`).toString('base64') },
  });
}
