#!/usr/bin/env node
// Fixture gateway: implements the AgentToll admin API contract with SAMPLE data so the
// dashboard can be developed without a running gateway. Every event it emits is
// `simulated: true`; nothing here ever touches a chain.
//
//   node scripts/fixture-gateway.mjs            # 127.0.0.1:8403, token "fixture-token"
//   PORT=18403 TOKEN=abc node scripts/fixture-gateway.mjs
//   node scripts/fixture-gateway.mjs --empty    # zero payments, for the empty state
//   node scripts/fixture-gateway.mjs --quiet    # no live events after the seed
//   node scripts/fixture-gateway.mjs --mixed    # also FAKE non-simulated rows (fake signatures) to exercise spendable
//   SEED=162 MIXED_REAL=1 ... --mixed --quiet   # exact seed sizes, e.g. the critic repro
//
// DEV ONLY. --mixed rows carry simulated:false with made-up signatures; their explorer
// links resolve to nothing. Never point a demo recording at --mixed.

import { createServer } from "node:http";
import { randomBytes } from "node:crypto";

const PORT = Number(process.env.PORT ?? 8403);
const HOST = process.env.HOST ?? "127.0.0.1";
const TOKEN = process.env.TOKEN ?? "fixture-token";
const EMPTY = process.argv.includes("--empty");
const QUIET = process.argv.includes("--quiet");
const MIXED = process.argv.includes("--mixed");
const SEED = Number(process.env.SEED ?? 40);
const MIXED_REAL = Number(process.env.MIXED_REAL ?? (MIXED ? 6 : 0));
const RECENT_CAP = 50; // contract: /admin/stats.recent is the newest 50
const LEGACY_TOTALS = process.env.LEGACY_TOTALS === "1"; // pretend to be a gateway without simulated_atomic/unconfirmed_atomic
const INTERVAL_MS = Number(process.env.INTERVAL_MS ?? 3500);

const SOLANA_DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const BASE_SEPOLIA = "eip155:84532";
const USDC_SOL_DEVNET = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

// Sample price table (atomic USDC, 6 decimals): 2000 = $0.002
const ROUTES = [
  { route: "GET /api/quote", price: 2000, weight: 5 },
  { route: "GET /api/filings/latest", price: 5000, weight: 3 },
  { route: "GET /api/insiders", price: 3000, weight: 2 },
  { route: "POST /mcp", price: 2000, weight: 3, tools: ["get_quote", "search_filings"] },
];
const AGENTS = [
  { name: "ClaudeBot", reason: "ua:ClaudeBot", weight: 5 },
  { name: "GPTBot", reason: "ua:GPTBot", weight: 3 },
  { name: "PerplexityBot", reason: "ua:PerplexityBot", weight: 2 },
  { name: "x402-reqwest", reason: "header:payment-signature", weight: 2 },
  { name: null, reason: "header:x-agent-wallet", weight: 1 },
];
const NETWORKS = [
  { network: SOLANA_DEVNET, asset: USDC_SOL_DEVNET, weight: 7 },
  { network: BASE_SEPOLIA, asset: USDC_BASE_SEPOLIA, weight: 3 },
];

const UNBILLED = EMPTY
  ? []
  : [
      { agent: "GPTBot", reason: "ua:GPTBot", requests: 30 },
      { agent: "Bytespider", reason: "ua:Bytespider", requests: 8 },
      { agent: "Unknown agent", reason: "header:x-agent-wallet", requests: 3 },
    ];

const state = { events: [], subscribers: new Set() };

function pick(list) {
  const total = list.reduce((s, x) => s + x.weight, 0);
  let r = Math.random() * total;
  for (const x of list) {
    r -= x.weight;
    if (r <= 0) return x;
  }
  return list[list.length - 1];
}

function fakeSig(network) {
  if (network.startsWith("eip155:")) return `0x${randomBytes(32).toString("hex")}`;
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  return Array.from(randomBytes(88), (b) => alphabet[b % alphabet.length]).join("");
}

function fakePayer(network) {
  if (network.startsWith("eip155:")) return `0x${randomBytes(20).toString("hex")}`;
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  return Array.from(randomBytes(44), (b) => alphabet[b % alphabet.length]).join("");
}

function makeEvent(ts, overrides = {}) {
  const route = pick(ROUTES);
  const agent = pick(AGENTS);
  const net = pick(NETWORKS);
  const status = overrides.status ?? "settled";
  const simulated = overrides.simulated ?? true;
  const sig = simulated ? `SIMULATED-${fakeSig(net.network).slice(0, 32)}` : fakeSig(net.network);
  return {
    ts,
    route: route.route,
    mcp_tool: route.tools ? route.tools[Math.floor(Math.random() * route.tools.length)] : null,
    agent_name: agent.name,
    detect_reason: agent.reason,
    network: net.network,
    asset: net.asset,
    amount_atomic: route.price,
    payer: fakePayer(net.network),
    tx_signature: status === "unconfirmed" ? `unconfirmed:${sig}` : sig,
    origin_status: 200,
    latency_ms: 40 + Math.floor(Math.random() * 180),
    simulated, // true unless --mixed asked for fake "real" rows
    status,
    ...overrides,
  };
}

function seed() {
  if (EMPTY) return;
  const now = Date.now();
  // SEED simulated settlements spread over the last 50 minutes, denser toward now.
  for (let i = SEED; i >= 1; i--) {
    const back = Math.pow(i / SEED, 1.6) * 50 * 60_000;
    state.events.push(makeEvent(now - back - Math.floor(Math.random() * 20_000)));
  }
  // Contract: at least one pending and one unconfirmed sample row (both simulated).
  state.events.push(makeEvent(now - 95_000, { status: "unconfirmed" }));
  state.events.push(makeEvent(now - 20_000, { status: "pending" }));
  // --mixed: MIXED_REAL fake non-simulated rows, the first of them unconfirmed when there are 3+.
  for (let i = 0; i < MIXED_REAL; i++) {
    const status = MIXED_REAL >= 3 && i === 0 ? "unconfirmed" : "settled";
    state.events.push(makeEvent(now - 10_000 - i * 7_000, { simulated: false, status }));
  }
  state.events.sort((a, b) => a.ts - b.ts);
}

function stats() {
  const by = (keyFn) => {
    const m = new Map();
    for (const e of state.events) {
      const k = keyFn(e);
      const cur = m.get(k) ?? { revenue_atomic: 0, payments: 0 };
      cur.revenue_atomic += e.amount_atomic;
      cur.payments += 1;
      m.set(k, cur);
    }
    return [...m.entries()].sort((a, b) => b[1].revenue_atomic - a[1].revenue_atomic);
  };
  const agentName = (e) => e.agent_name ?? "Unknown agent";
  const sum = (pred) => state.events.filter(pred).reduce((s, e) => s + e.amount_atomic, 0);
  return {
    totals: {
      revenue_atomic: sum(() => true),
      payments: state.events.length,
      unique_agents: new Set(state.events.map(agentName)).size,
      unbilled_agent_requests: UNBILLED.reduce((s, u) => s + u.requests, 0),
      ...(LEGACY_TOTALS
        ? {}
        : {
            simulated_atomic: sum((e) => e.simulated),
            unconfirmed_atomic: sum((e) => !e.simulated && e.status === "unconfirmed"),
          }),
    },
    by_route: by((e) => e.route).map(([route, v]) => ({ route, ...v })),
    by_agent: by(agentName).map(([agent, v]) => ({ agent, ...v })),
    by_network: by((e) => e.network).map(([network, v]) => ({ network, ...v })),
    unbilled: UNBILLED,
    recent: state.events.slice(-RECENT_CAP).reverse(),
  };
}

function authorized(req, url) {
  const header = req.headers.authorization ?? "";
  return header === `Bearer ${TOKEN}` || url.searchParams.get("token") === TOKEN;
}

function broadcast(ev) {
  const frame = `event: revenue\ndata: ${JSON.stringify(ev)}\n\n`;
  for (const res of state.subscribers) res.write(frame);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (!authorized(req, url)) {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "unauthorized" }));
    return;
  }
  if (url.pathname === "/admin/stats") {
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(stats()));
    return;
  }
  if (url.pathname === "/admin/events") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    res.write(": fixture gateway, all events simulated\n\n");
    state.subscribers.add(res);
    const hb = setInterval(() => res.write(": heartbeat\n\n"), 15_000);
    req.on("close", () => {
      clearInterval(hb);
      state.subscribers.delete(res);
    });
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not_found" }));
});

seed();
server.listen(PORT, HOST, () => {
  const real = state.events.filter((e) => !e.simulated).length;
  console.log(
    `[fixture-gateway] http://${HOST}:${PORT}  token=${TOKEN}  seeded=${state.events.length} events (${real === 0 ? "all simulated" : `${real} FAKE non-simulated, dev only`})`,
  );
  if (!QUIET && !EMPTY) {
    setInterval(() => {
      // Mostly settled; now and then a pending or unconfirmed row so the badges stay visible.
      const roll = Math.random();
      const status = roll < 0.08 ? "pending" : roll < 0.12 ? "unconfirmed" : "settled";
      const simulated = MIXED ? Math.random() < 0.7 : true;
      const ev = makeEvent(Date.now(), { status, simulated });
      state.events.push(ev);
      broadcast(ev);
      console.log(`[fixture-gateway] revenue +${ev.amount_atomic} ${ev.agent_name ?? "unknown"} ${ev.route} ${ev.network.split(":")[0]}`);
    }, INTERVAL_MS);
  }
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    for (const res of state.subscribers) res.end();
    server.close(() => process.exit(0));
  });
}
