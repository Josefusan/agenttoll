// Drives pay-mcp over stdio the way Claude Desktop would, and prints each tool result.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const gw = process.env.GW ?? "http://127.0.0.1:18402";
const client = new Client({ name: "driver", version: "0" });
await client.connect(new StdioClientTransport({ command: "node", args: ["dist/index.js"], env: process.env, stderr: "inherit" }));

const tools = await client.listTools();
console.log("TOOLS:", tools.tools.map((t) => t.name).join(", "));

async function call(name, args) {
  const t0 = Date.now();
  const r = await client.callTool({ name, arguments: args });
  console.log(`\n### ${name} ${JSON.stringify(args)} (${Date.now() - t0} ms) isError=${r.isError === true}`);
  console.log(r.content[0]?.text);
  return r;
}

await call("get_quote", { url: `${gw}/api/quote` });
await call("get_quote", { url: `${gw}/` });
await call("get_quote", { url: "ftp://example.com/x" });
await call("pay_and_fetch", { url: `${gw}/api/quote`, max_usd: 0.001 });
await call("pay_and_fetch", { url: `${gw}/api/quote`, max_usd: 0.01 });
await call("call_paid_tool", { server_url: `${gw}/mcp`, tool: "ping_free", arguments: {} });
await call("call_paid_tool", { server_url: `${gw}/mcp`, tool: "search_docs", arguments: { query: "pricing" }, max_usd: 0.01 });
await call("call_paid_tool", { server_url: `${gw}/mcp`, tool: "generate_report", arguments: {}, max_usd: 0.01 });
await call("spend_status", {});
await client.close();
