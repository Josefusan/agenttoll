// Drives the real pay-mcp server (demo/pay-mcp/dist) over stdio, the way Claude Code does,
// against the film stack, and saves every tool call and result. Same caps as
// scripts/claude-pays-demo.sh: $0.01 per call, $0.25 per day. The calls mirror the three
// Claude runs in docs/assets/claude-pays-transcript.md: quote + pay, a refused $0.05 tool,
// a paid MCP tool. No LLM is involved: this is the wallet's own behaviour.
//   node video/captures/tools/pay_mcp_driver.mjs <out.json>
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const PAY = join(REPO, "demo/pay-mcp");
const req = createRequire(join(PAY, "package.json"));
const imp = async (s) => import(pathToFileURL(req.resolve(s)).href);
const { Client } = await imp("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = await imp("@modelcontextprotocol/sdk/client/stdio.js");

const GW = "http://127.0.0.1:8502";
const out = process.argv[2];
const work = mkdtempSync(join(tmpdir(), "paymcp-"));
chmodSync(work, 0o700);
const spend = join(work, "spend.json");
const env = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  BUYER_SOLANA_KEYPAIR: join(REPO, ".demo/buyer.json"),
  PAY_MCP_NETWORK: "solana",
  BUYER_MAX_USD_PER_CALL: "0.01",
  BUYER_MAX_USD_PER_DAY: "0.25",
  PAY_MCP_SPEND_FILE: spend,
};
const redact = (s) =>
  s.split(spend).join("$SPEND_FILE").split(env.BUYER_SOLANA_KEYPAIR).join("$KEYPAIR").split(work).join("$WORKDIR").split(REPO).join("$REPO").split(homedir()).join("$HOME");

const client = new Client({ name: "film-capture-driver", version: "0" });
await client.connect(new StdioClientTransport({ command: "node", args: [join(PAY, "dist/index.js")], env, stderr: "pipe" }));
const listed = await client.listTools();
const calls = [];
async function call(name, args, why) {
  const t0 = Date.now();
  const started = new Date().toISOString();
  const r = await client.callTool({ name, arguments: args });
  const text = redact(r.content?.[0]?.text ?? "");
  let parsed = null;
  try { parsed = JSON.parse(text); } catch {}
  calls.push({ why, tool: name, arguments: args, started_utc: started, duration_ms: Date.now() - t0, isError: r.isError === true, result_text: text, result_json: parsed });
  console.log(`${name} ${JSON.stringify(args)} isError=${r.isError === true} (${Date.now() - t0} ms)`);
}

await call("get_quote", { url: `${GW}/api/quote` }, "Run 1: read the price before paying");
await call("spend_status", {}, "Run 1: check caps and today's spend");
await call("pay_and_fetch", { url: `${GW}/api/quote`, max_usd: 0.002 }, "Run 1: pay $0.002 and fetch (SIMULATED settlement)");
await call("call_paid_tool", { server_url: `${GW}/mcp`, tool: "generate_report", max_usd: 0.1 }, "Run 2: a $0.05 tool against a $0.01 per-call cap: refused before signing");
await call("spend_status", {}, "Run 2: the refusal counted nothing");
await call("call_paid_tool", { server_url: `${GW}/mcp`, tool: "search_docs", arguments: { query: "x402" } }, "Run 3: pay $0.005 for an MCP tool (MCP-native x402, SIMULATED)");
await call("spend_status", {}, "Run 3: today's total");
await client.close();
rmSync(work, { recursive: true, force: true });

writeFileSync(out, JSON.stringify({
  what: "Real pay-mcp tool calls over stdio against the film stack (SIMULATED facilitator). Driven by a script, not by an LLM; the Claude-driven runs are in docs/assets/claude-pays-transcript.md.",
  command: "node video/captures/tools/pay_mcp_driver.mjs video/captures/terminal/pay-mcp-session.json",
  pay_mcp: "demo/pay-mcp/dist/index.js (npm run build in demo/pay-mcp)",
  env: { PAY_MCP_NETWORK: "solana", BUYER_MAX_USD_PER_CALL: "0.01", BUYER_MAX_USD_PER_DAY: "0.25", BUYER_SOLANA_KEYPAIR: "$KEYPAIR (.demo/buyer.json, throwaway, unfunded)", PAY_MCP_SPEND_FILE: "$SPEND_FILE (temp dir, deleted)" },
  redactions: ["spend file -> $SPEND_FILE", "keypair path -> $KEYPAIR", "temp dir -> $WORKDIR", "repo root -> $REPO", "home -> $HOME"],
  pay_mcp_tools: listed.tools.map((t) => ({ name: t.name, description: t.description })),
  calls,
}, null, 2) + "\n");
console.log(`wrote ${out}`);
