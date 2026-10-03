// Per-isolate gateway state: the WASM core (parsed config + pricer), quote networks with
// their fee payers, the replay guard, the ledger. Mirrors `Gateway` in
// crates/agenttoll-gateway/src/lib.rs, plus its challenge, discovery and resource-URL helpers.

import wasmModule from './core/agenttoll_core_bg.wasm';
import { Core, initSync } from './core/agenttoll_core.js';
import bundledConfig from '../agenttoll.edge.yaml';
import { feePayer } from './facilitator';
import { Ledger } from './ledger';
import { ReplayGuard } from './replay';
import {
  encodeHeader,
  headers as x402Headers,
  paymentRequired,
  quoteNetwork,
  type NetworkConfig,
  type PaymentRequired,
  type PriceTag,
  type QuoteNetwork,
} from './x402';

/** Machine-readable price list for agents planning spend. AgentToll's own format. */
export const DISCOVERY_PATH = '/.well-known/agenttoll.json';

export interface Env {
  /** Full YAML config text; overrides the bundled agenttoll.edge.yaml. */
  AGENTTOLL_CONFIG?: string;
  /** "1" enables GET /.agenttoll/ledger (tests and local debugging only). */
  AGENTTOLL_DEBUG?: string;
  LEDGER?: D1Database;
  [key: string]: unknown;
}

export interface Verdict {
  kind: 'human' | 'agent' | 'search-bot';
  agent: string | null;
  confidence: number;
  reason: string;
}

/** The `mcp` config section as `Core.mcp_json()` reports it. Prices are USD strings. */
export interface McpConfig {
  endpoint: string;
  defaultToolPriceUsd: string;
  tools: Record<string, string>;
  advertisePrices: boolean;
  /** How an unpaid single `tools/call` is challenged (KB-X402-05). */
  challenge: 'mcp-native' | 'http-402';
}

/** Facilitator call budgets (`timeouts.verify_ms` / `timeouts.settle_ms`). */
export interface Timeouts {
  verifyMs: number;
  settleMs: number;
}

/** The parts of a request every stage needs. `rawPathAndQuery` is taken from the request
 * line, not re-serialized, so `resource.url` matches the Rust gateway byte for byte. */
export interface Incoming {
  request: Request;
  rawPathAndQuery: string;
  path: string;
  peer: string | null;
  proto: string;
}

export class Gateway {
  readonly replay = new ReplayGuard();
  readonly ledger: Ledger;
  readonly origin: string;
  readonly preserveHost: boolean;
  readonly publicUrl: string | undefined;
  readonly timeouts: Timeouts;
  readonly mcp: McpConfig | undefined;
  private readonly networkConfigs: NetworkConfig[];
  private networks: Promise<QuoteNetwork[]> | undefined;

  constructor(
    readonly core: Core,
    env: Env,
  ) {
    this.ledger = new Ledger(env.LEDGER);
    this.origin = core.origin();
    this.preserveHost = core.preserve_host();
    this.publicUrl = core.public_url();
    this.timeouts = JSON.parse(core.timeouts_json()) as Timeouts;
    const mcp = core.mcp_json();
    this.mcp = mcp === undefined ? undefined : (JSON.parse(mcp) as McpConfig);
    this.networkConfigs = JSON.parse(core.networks_json()) as NetworkConfig[];
  }

  /**
   * Quote networks with each Solana fee payer resolved from its facilitator's /supported
   * unless the config pins one (KB-X402-07). Resolved once per isolate; a failure is not
   * cached so the next priced request retries.
   */
  quoteNetworks(): Promise<QuoteNetwork[]> {
    this.networks ??= Promise.all(
      this.networkConfigs.map(async (n) => {
        let payer = n.feePayer ?? undefined;
        if (!payer && n.network.startsWith('solana:')) {
          payer = await feePayer(n.facilitator, n.network);
        }
        return quoteNetwork(n, payer);
      }),
    ).catch((e: unknown) => {
      this.networks = undefined;
      throw e;
    });
    return this.networks;
  }

  /**
   * The URL a quote is for. MCP tools share one endpoint, so the tool goes in the fragment:
   * a payment echoing `resource` is then bound to that tool, not just to `/mcp`.
   */
  resourceUrl(inc: Incoming, tag: PriceTag): string {
    const base = this.baseResourceUrl(inc);
    return tag.resource.startsWith('mcp:') ? `${base}#${tag.resource}` : base;
  }

  private baseResourceUrl(inc: Incoming): string {
    if (this.publicUrl !== undefined) {
      return `${this.publicUrl.replace(/\/+$/, '')}${inc.rawPathAndQuery}`;
    }
    const host = inc.request.headers.get('host') ?? 'localhost';
    return `http://${host}${inc.rawPathAndQuery}`;
  }
}

let wasmReady = false;
let cached: { key: string; gateway: Gateway } | undefined;

/** String-valued vars, the environment `${VAR}` placeholders expand from. */
function stringVars(env: Env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

/** The gateway for this isolate, rebuilt only when the config or vars change. */
export function gatewayFor(env: Env): Gateway {
  if (!wasmReady) {
    initSync({ module: wasmModule });
    wasmReady = true;
  }
  const yaml = env.AGENTTOLL_CONFIG ?? bundledConfig;
  const vars = stringVars(env);
  const key = JSON.stringify([yaml, Object.keys(vars).sort().map((k) => [k, vars[k]])]);
  if (cached?.key !== key) {
    cached?.gateway.core.free();
    const core = new Core(yaml, JSON.stringify(vars));
    cached = { key, gateway: new Gateway(core, env) };
  }
  return cached.gateway;
}

export function text(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

export function json(status: number, value: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', ...extra },
  });
}

/** A JSON-RPC error envelope; MCP transport errors ride on HTTP 200 like the Rust gateway's. */
export function jsonrpcError(status: number, id: unknown, code: number, message: string): Response {
  return json(status, { jsonrpc: '2.0', id, error: { code, message } });
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Object keys sorted recursively, which is how the Rust gateway's `json!` bodies serialize
 * (serde_json maps are BTreeMaps). Lets the MCP-native challenge match byte for byte.
 */
export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, sortKeysDeep(value[k])]),
    );
  }
  return value;
}

function challengeHeaders(required: PaymentRequired, verdict: Verdict): Record<string, string> {
  const extra: Record<string, string> = {
    [x402Headers.PAYMENT_REQUIRED]: encodeHeader(required),
  };
  // Header values must be visible ASCII; reasons always are, but never let one break a 402.
  if (/^[\x20-\x7e]*$/.test(verdict.reason)) extra['x-agenttoll-verdict'] = verdict.reason;
  return extra;
}

/** The 402: PAYMENT-REQUIRED header, the same JSON in the body, and the verdict. */
export function challenge(
  gw: Gateway,
  networks: QuoteNetwork[],
  inc: Incoming,
  tag: PriceTag,
  verdict: Verdict,
  error: string,
): Response {
  const required = paymentRequired(networks, tag, gw.resourceUrl(inc, tag), error);
  return json(402, required, challengeHeaders(required, verdict));
}

/**
 * MCP-native challenge (KB-X402-05): a JSON-RPC tool result with `isError: true` carrying
 * PaymentRequired in `structuredContent` and as JSON text in `content[0]`, on HTTP 200, with
 * the same PAYMENT-REQUIRED header as the 402.
 */
export function mcpChallenge(
  gw: Gateway,
  networks: QuoteNetwork[],
  inc: Incoming,
  tag: PriceTag,
  verdict: Verdict,
  error: string,
  id: unknown,
): Response {
  const required = paymentRequired(networks, tag, gw.resourceUrl(inc, tag), error);
  const body = {
    jsonrpc: '2.0',
    id,
    result: {
      isError: true,
      structuredContent: required,
      content: [{ type: 'text', text: JSON.stringify(required) }],
    },
  };
  return json(200, sortKeysDeep(body), challengeHeaders(required, verdict));
}

/** `GET /.well-known/agenttoll.json`: every price and payment option, built by the core. */
export function discovery(gw: Gateway): Response {
  return new Response(gw.core.discovery_json(), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
