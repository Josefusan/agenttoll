#!/usr/bin/env node
// pay-mcp: an x402 wallet with hard spend caps, exposed to any MCP client over stdio.
// stdout is the MCP channel; every log line goes to stderr.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { capsFromEnv } from "./caps.js";
import { AGENT_HEADERS, VERSION } from "./identity.js";
import { type Atomic, atomicToUsd, usdToAtomic } from "./money.js";
import { callPaidTool } from "./paidMcp.js";
import { getQuote, payAndFetch, type PayerDeps, PayRefused, PaymentRejected } from "./payer.js";
import { defaultSpendPath, SpendLedger } from "./spend.js";
import { loadWallet, preferredNamespace, type Wallet } from "./wallet.js";

const env = process.env;
const caps = capsFromEnv(env);
const ledger = new SpendLedger(defaultSpendPath(env));

let walletPromise: Promise<Wallet> | undefined;
const wallet = (): Promise<Wallet> => {
  walletPromise ??= loadWallet(env).catch((err: Error) => {
    walletPromise = undefined;
    throw err;
  });
  return walletPromise;
};

const deps: PayerDeps = {
  fetch: globalThis.fetch,
  wallet,
  ledger,
  caps,
  headers: AGENT_HEADERS,
  maxBodyBytes: Number.parseInt(env.PAY_MCP_MAX_BODY_BYTES ?? "16384", 10),
};

// Payments are serialized so two concurrent tool calls cannot both pass the daily cap check.
let chain: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
}

const maxUsdSchema = z
  .union([z.number(), z.string()])
  .optional()
  .describe("Your ceiling for this one payment in USD, e.g. 0.01. The lower of this and BUYER_MAX_USD_PER_CALL wins.");

function parseMaxUsd(v: number | string | undefined): Atomic | undefined {
  return v === undefined ? undefined : usdToAtomic(v);
}

type ToolResult = { content: { type: "text"; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };

function ok(data: Record<string, unknown>): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: data };
}

function fail(err: unknown): ToolResult {
  let kind = "error";
  let message = err instanceof Error ? err.message : String(err);
  if (err instanceof PayRefused) {
    kind = `refused:${err.code}`;
    message = `Refused before signing (no money moved, nothing counted against caps): ${err.message}`;
  } else if (err instanceof PaymentRejected) {
    kind = "rejected";
  }
  const data = { error: kind, message };
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: data, isError: true };
}

const server = new McpServer({ name: "agenttoll-pay-mcp", version: VERSION });

server.registerTool(
  "get_quote",
  {
    title: "Get x402 price quote",
    description:
      "Fetch a URL as an AI agent WITHOUT paying. If the server answers 402 (x402 v2), decode PAYMENT-REQUIRED and return the price in USD per network, the payTo address and the description. No money moves. Use this before pay_and_fetch when you want to know the price first.",
    inputSchema: { url: z.string().describe("http(s) URL to price") },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ url }) => {
    try {
      return ok({ ...(await getQuote(deps, url)) });
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "pay_and_fetch",
  {
    title: "Pay an x402 URL and fetch it",
    description:
      "Fetch a URL and, if it answers 402 (x402 v2), pay the quote in USDC within caps and return the response body plus a receipt: amount, network, settlement transaction and a block-explorer link. Caps are enforced BEFORE anything is signed: BUYER_MAX_USD_PER_CALL, BUYER_MAX_USD_PER_DAY and your own max_usd (the lowest wins). Prefers the configured network (PAY_MCP_NETWORK, default Solana devnet) and falls back to any rail the wallet has a key for. If the receipt says simulated, no money moved.",
    inputSchema: {
      url: z.string().describe("http(s) URL behind an x402 paywall"),
      max_usd: maxUsdSchema,
      method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).optional().describe("HTTP method, default GET"),
      body: z.string().optional().describe("Request body for POST/PUT/PATCH"),
      content_type: z.string().optional().describe("Content-Type for the body, default application/json"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  async ({ url, max_usd, method, body, content_type }) =>
    serialized(async () => {
      try {
        const args: Parameters<typeof payAndFetch>[1] = { url };
        const maxUsd = parseMaxUsd(max_usd);
        if (maxUsd !== undefined) args.maxUsd = maxUsd;
        if (method) args.method = method;
        if (body !== undefined) args.body = body;
        if (content_type) args.contentType = content_type;
        return ok({ ...(await payAndFetch(deps, args)) });
      } catch (err) {
        return fail(err);
      }
    }),
);

server.registerTool(
  "call_paid_tool",
  {
    title: "Call a paid tool on a remote MCP server",
    description:
      "Call one tool on a remote MCP server (Streamable HTTP) and pay for it with x402 within caps. Handles both payment styles: an HTTP 402 on the JSON-RPC POST (e.g. an AgentToll gateway in front of the server) and the MCP-native challenge (tool result isError with PaymentRequired; retried with _meta[\"x402/payment\"]). Returns the tool's content and a receipt with the settlement transaction. Same caps as pay_and_fetch, enforced before signing.",
    inputSchema: {
      server_url: z.string().describe("The MCP server's Streamable HTTP endpoint, e.g. https://host/mcp"),
      tool: z.string().describe("Tool name to call"),
      arguments: z.record(z.string(), z.unknown()).optional().describe("Tool arguments (object)"),
      max_usd: maxUsdSchema,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  async ({ server_url, tool, arguments: toolArgs, max_usd }) =>
    serialized(async () => {
      try {
        const args: Parameters<typeof callPaidTool>[1] = { serverUrl: server_url, tool, arguments: toolArgs ?? {} };
        const maxUsd = parseMaxUsd(max_usd);
        if (maxUsd !== undefined) args.maxUsd = maxUsd;
        return ok({ ...(await callPaidTool(deps, args)) });
      } catch (err) {
        return fail(err);
      }
    }),
);

server.registerTool(
  "spend_status",
  {
    title: "Wallet and spend status",
    description: "Today's spend (UTC day), the caps, what is left, the wallet addresses and the last 10 payments. Never includes keys.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => {
    try {
      const spent = await ledger.spentToday();
      const remaining = caps.perDay > spent ? caps.perDay - spent : 0n;
      let addresses: Wallet["addresses"] | { error: string } = {};
      try {
        addresses = (await wallet()).addresses;
      } catch (err) {
        addresses = { error: (err as Error).message };
      }
      return ok({
        version: VERSION,
        preferred_network: preferredNamespace(env) === "solana" ? "solana" : "base",
        caps: { per_call_usd: atomicToUsd(caps.perCall), per_day_usd: atomicToUsd(caps.perDay) },
        today: { spent_usd: atomicToUsd(spent), remaining_usd: atomicToUsd(remaining), day_utc: new Date().toISOString().slice(0, 10) },
        wallet: addresses,
        spend_file: ledger.file,
        last_payments: (await ledger.last(10)).map((p) => ({ ...p, usd: atomicToUsd(BigInt(p.amount_atomic)) })),
      });
    } catch (err) {
      return fail(err);
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`pay-mcp ${VERSION} ready: caps $${atomicToUsd(caps.perCall)}/call, $${atomicToUsd(caps.perDay)}/day, ledger ${ledger.file}`);
