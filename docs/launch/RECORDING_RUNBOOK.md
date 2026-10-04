# Recording runbook: 3:00 demo video, variant B (simulated)

For Joseph to record himself. Variant B only: the SIMULATED facilitator ships with the repo, every
payment on screen is labelled simulated, nothing moved on chain, and no explorer link appears.
Everything below runs on your own machine. This file is the shot-by-shot operator list behind
`docs/launch/DEMO_VIDEO.md`; read that first for the full script and the words to avoid.

Ports: on a clean machine the defaults are gateway 8402, admin 8403, origin 4000, simulated
facilitator 4020, dashboard 3000. This runbook was rehearsed on the VPS on 2026-10-04, where the
live demo already holds those ports, so the captured output below uses `GATEWAY_PORT=19402`,
`ADMIN_PORT=19403`, `ORIGIN_PORT=19400`, `FACILITATOR_PORT=19420` and dashboard `--port 3500`.
If your ports are free, drop the `*_PORT` overrides and keep the same commands. The commands are
identical apart from the port numbers.

## Before you press record

1. Terminal dark theme, font 18 pt+, 960 px wide. Browser 1440 px wide, zoom 110%. Record 1920x1080
   at 30 fps. Mic on, room quiet.
2. Start the stack (this runs the eight-step walkthrough, then leaves the SIMULATED stack running):

   ```bash
   KEEP=1 bash scripts/demo-local.sh
   ```

   The walkthrough prints a simulated payment (step 4) and then waits. The admin token is written to
   `.demo/admin-token` (mode 600) and is never printed. Never `cat` that file on camera. If you want
   an empty ledger for the simulated payment shots, run `STACK_ONLY=1 bash scripts/demo-local.sh`
   instead, then run the walkthrough steps you want on camera by hand.

3. Start the dashboard on localhost. Do **not** open the tunnel: Cloudflare buffers the SSE stream,
   so the live feed lags. Localhost is direct:

   ```bash
   cd apps/dashboard
   AGENTTOLL_ADMIN_URL=http://127.0.0.1:8403 \
   AGENTTOLL_ADMIN_TOKEN=$(cat ../../.demo/admin-token) pnpm dev
   # open http://localhost:3000  (VPS rehearsal used --port 3500)
   ```

4. Delete the pay-mcp spend ledger so `spend_status` starts the day at zero:

   ```bash
   rm -f ~/.agenttoll/spend.json
   ```

5. Never on screen: the admin token, any keypair file contents, `.env`, or a URL bar carrying a token.
6. Do a full dry run. If a shot fails, restart the stack and re-run from shot 1; do not splice around
   a failure.

## Real captured output

Captured on the VPS, 2026-10-04, `feat/d9-away`, with the port overrides above. The simulated
policy: every payment is labelled simulated and no funds moved.

### Shot 1 (0:00-0:12) - same URL, twice

Browser: `http://127.0.0.1:8402/api/quote` shows the free JSON (`"symbol":"SOL/USD"`, `"paid":false`).
Terminal, the same URL as an agent (use the local stack, not the public tunnel: Cloudflare 403s
ClaudeBot on a quick tunnel):

```bash
curl -s -D - -o /dev/null -A "Mozilla/5.0 (compatible; ClaudeBot/1.0)" http://127.0.0.1:8402/api/quote | cut -c1-90
```

Real output (VPS, port 19402):

```
HTTP/1.1 402 Payment Required
content-type: application/json
payment-required: eyJ4NDAyVmVyc2lvbiI6MiwiZXJyb3IiOiJQQVlNRU5ULVNJR05BVFVSRSBoZWFkZXIgaXMg
x-agenttoll-verdict: ua:ClaudeBot
content-length: 450
date: Sun, 04 Oct 2026 15:16:12 GMT
```

On-screen label: `Same URL. People: free. Agents: $0.002.`
Narration: "This is the same URL twice. A person gets the data for free. An AI agent gets a 402 with
a price: two tenths of a cent, in USDC."

### Shot 2 (0:12-0:30) - get_quote, nothing signed

Use the headless Claude CLI with pay-mcp as its only tool (the path proven in
`docs/assets/claude-pays-transcript.md`; `bash scripts/claude-pays-demo.sh` drives it). Prompt:

```
Use get_quote on http://127.0.0.1:8402/api/quote and tell me what it costs.
```

Equivalent pay-mcp result, driven directly over stdio with `node scripts/smoke.mjs` (real output,
VPS), shows the quote and `"payable": true` with no payment:

```
### get_quote {"url":"http://127.0.0.1:19402/api/quote"} (96 ms) isError=false
    "network_name": "Solana devnet",
    "usd": "0.002",
    "amount_atomic": "2000",
    "maxTimeoutSeconds": 60,
    "payable": true,
```

On-screen label: `pay-mcp: a wallet for Claude with hard caps. get_quote moves no money.`
Narration: "Claude has a wallet through pay-mcp, an MCP server with caps the agent cannot talk its
way past. First it asks the price. Nothing is signed yet."

### Shot 3 (0:30-1:05) - payment shot 1, the buyer pays

Either the Claude CLI `pay_and_fetch` prompt (variant B wording in `DEMO_VIDEO.md`), or the buyer
CLI directly. The buyer CLI, exactly the command the walkthrough runs:

```bash
BUYER_SOLANA_KEYPAIR=.demo/buyer.json target/debug/agenttoll-buyer http://127.0.0.1:8402/api/quote
```

Real output (VPS, port 19402):

```
buyer 2nZEVN5mbixXjLgLPo5BSqSXy4GqbrrDSk518e1F7kSm on Solana devnet
status: 200 OK
body:   {"agent":"AgentToll-Buyer","as_of":1791126972,"paid":true,"price":143.72,"symbol":"SOL/USD"}
paid:   true on solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1
tx:     SIMULATED-b602b637da2442ef2f02158c
note:   SIMULATED settlement from a local test facilitator; nothing went on chain
```

The dashboard row reads `+$0.002  AgentToll-Buyer  GET /api/quote  Solana devnet  Simulated`.
On-screen label (burned in, never removed): `SIMULATED settlement, no funds moved`.
Narration (variant B): "Claude pays, gets the data, and the founder's dashboard ticks within a
second. This recording runs against the simulated facilitator that ships with the repo: the row is
labelled simulated and nothing moved on chain. With a funded devnet wallet the same shot ends on
Solana Explorer." Hover the Simulated badge so its tooltip ("No on-chain transaction exists") is
visible for 2 s.

### Shot 4 (1:05-1:25) - the caps refuse before signing

pay-mcp with the same caps ($0.01/call, $0.25/day). The over-cap refusal, driven over stdio:

```bash
cd demo/pay-mcp
GW=http://127.0.0.1:8402 BUYER_SOLANA_KEYPAIR=../../.demo/buyer.json \
BUYER_MAX_USD_PER_CALL=0.01 BUYER_MAX_USD_PER_DAY=0.25 \
PAY_MCP_SPEND_FILE=/tmp/spend.json node scripts/smoke.mjs
```

The `generate_report` tool is $0.05, above the $0.01 per-call cap. Real output (VPS):

```
### call_paid_tool {"server_url":"http://127.0.0.1:19402/mcp","tool":"generate_report","arguments":{},"max_usd":0.01} (39 ms) isError=true
{
  "error": "refused:per_call",
  "message": "Refused before signing (no money moved, nothing counted against caps): quote $0.05 is above BUYER_MAX_USD_PER_CALL ($0.01); not paid"
}
```

Then `spend_status` (real output, VPS):

```
"caps": { "per_call_usd": "0.01", "per_day_usd": "0.25" },
"today": { "spent_usd": "0.007", "remaining_usd": "0.243", "day_utc": "2026-10-04" }
```

On-screen label: `Refused before signing. Caps: $0.01 per call, $0.25 per day.`
Narration: "The caps are the point. A five-cent tool is over the per-call cap, so pay-mcp refuses
before anything is signed and nothing counts against the budget. It is Claude's wallet, but it is
your money."

### Shot 5 (1:25-1:45) - the price list

```bash
curl -s http://127.0.0.1:8402/mcp -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | python3 -m json.tool
```

Real output (VPS, port 19402), the descriptions carry the prices:

```
"description": "Search Acme's documentation. (Paid tool: $0.005 USDC per call via x402.)",
"name": "search_docs"
"description": "Generate a market report. (Paid tool: $0.05 USDC per call via x402.)",
"name": "generate_report"
```

On-screen label: `MCP servers sell per tool. initialize and tools/list stay free.`
Narration: "The same gateway sits in front of an MCP server. tools/list is free and carries each
tool's price, so an agent can plan its spend before it calls anything."

### Shot 6 (1:45-2:15) - payment shot 2, MCP-native

Claude CLI prompt (variant B) `call_paid_tool` for `search_docs`, or the raw challenge:

```bash
curl -s http://127.0.0.1:8402/mcp -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_docs","arguments":{"query":"x402"}}}'
```

Real output (VPS), the unpaid challenge is an MCP tool result, price 5000 atomic = $0.005:

```
isError: True | price: 5000 atomic USDC
```

After the paid retry the smoke driver reported, real output (VPS):

```
### call_paid_tool {... "tool":"search_docs","arguments":{"query":"pricing"},"max_usd":0.01} (110 ms) isError=false
  "paid": true,
  "text": "3 results for \"pricing\": install, configure, pricing.",
  "payment_transport": "mcp-native",
```

Dashboard row: `+$0.005  AgentToll-Buyer  mcp search_docs  Solana devnet  Simulated`; the by-route
card shows two lines. Keep `SIMULATED settlement, no funds moved` on screen for the whole shot.
Narration (variant B): "An unpaid tool call gets the x402 MCP-native challenge: a tool result, not an
HTTP status, so MCP clients that never see status codes can still pay. The retry carries the payment
in the call's metadata, the receipt comes back the same way, and the tool shows up on the dashboard
as its own line. Labelled simulated, like the first one."

### Shot 7 (2:15-2:27) - discovery document

```bash
curl -s http://127.0.0.1:8402/.well-known/agenttoll.json | python3 -m json.tool | head -24
```

Real output (VPS, port 19402):

```
{
    "agenttoll": "0.1.0",
    "detection": "agents-only",
    "mcp": {
        "defaultToolPriceUsd": "0",
        "endpoint": "/mcp",
        "paymentTransports": [ "http-402", "mcp-native" ],
        "tools": { "generate_report": "0.05", "search_docs": "0.005" }
    },
    "networks": [
        {
            "asset": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
            "network": "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
            "payTo": "DzsCScZvxaCUdMGyvYyo8Z9JUvJAjpk8J3QCb27McT6Q",
            "scheme": "exact"
        }
    ],
```

On-screen label (three lines): `Settle only after the origin succeeds.` / `Content released only
after settlement.` / `Funds go to your pay_to. AgentToll holds nothing.`
Narration: "One YAML file: a price per route, a price per tool, and your own address. An agent never
pays for an error, and content is released only after settlement."

### Shot 8 (2:27-2:40) - the repo grades itself

Not run in this rehearsal (it belongs to the step-7 regression); time it on the day. Pre-build so
only the run is on camera, then run:

```bash
cargo build --release -p agenttoll-gateway -p agenttoll-demo-origin -p agenttoll-buyer -p agenttoll-mock-facilitator
python3 evals/run.py
```

Expected last line per `evals/results/latest.md`: `119 cases. All simulated. All pass.` Read the
count and run time from the terminal on the day; the 119 and the ~2.5 s come from the 2026-10-04 run
and must be re-checked before recording. The suite does not cover Web Bot Auth, the Worker, the
dashboard or pay-mcp: do not say it does.

### Shot 9 (2:40-2:50) - Worker parity

Not run in this rehearsal. Pre-record, cut to the summary lines:

```bash
cd workers/agenttoll-edge && npm run test:parity
```

Expected: 21 parity tests green (both editions answer byte-identical quotes in their simulated
payments). Do not claim a deployed Worker; none exists.

### Shot 10 (2:50-3:00) - Website Factory

Static frames only. If no client page runs AgentToll on recording day, say "can run", never "runs".

## Words that must not appear in variant B

on-chain, settled, live, real payment, transaction link, explorer, mainnet, revenue earned. Use:
simulated, labelled, nothing moved, demo facilitator.
