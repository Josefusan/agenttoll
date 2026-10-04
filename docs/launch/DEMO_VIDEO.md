# Demo video script (3:00 max)

Status: DRAFT for Joseph to record. Nothing in this script may be said on camera unless it is true on the day of recording.

Order follows the ranking in `docs/USE_CASES.md`: Claude paying through `pay-mcp` with the dashboard ticking comes first, per-tool MCP pricing second, Website Factory is the closing line. Cases 6 and 7 (pipelines, licensed crawlers) are not in this video.

## Pick the payment variant before recording

Every payment shot has two versions. Record the whole video in one variant; do not mix them.

| | Variant A: real devnet | Variant B: simulated |
|---|---|---|
| Precondition | Two devnet wallets funded with devnet USDC at faucet.circle.com (buyer and `pay_to`); gateway started with `agenttoll.example.yaml` (PayAI facilitator); `AGENTTOLL_SOLANA_PAYTO` set to the funded `pay_to` | None. `KEEP=1 bash scripts/demo-local.sh` starts origin, simulated facilitator, gateway and writes the admin token to `.demo/admin-token` |
| Proof on screen | Click the `explorer.solana.com/tx/<sig>?cluster=devnet` link; the USDC transfer to `pay_to` is visible | The dashboard row wears the Simulated badge, Claude's reply says `simulated: true`, and a label is burned into the frame: `simulated settlement, no funds moved` |
| Words allowed | "settled on Solana devnet", "here is the transaction" | "simulated", "nothing moved on chain". Never "on-chain", "settled", "live", "real" |

As of 2026-10-03 no wallet is funded, so B is the default. Joseph decides whether to fund devnet wallets before recording (decision 1 in the hand-back report).

## Setup before pressing record

1. Terminal: dark theme, font 18 pt or larger, window 960 px wide. Browser: 1440 px wide for the dashboard, zoom 110 percent. Record at 1920 x 1080, 30 fps. Mic on, room quiet.
2. Start the stack.
   - B: `STACK_ONLY=1 bash scripts/demo-local.sh` in the repo root. It starts origin, simulated facilitator and gateway with an empty ledger (it deletes `.demo/agenttoll-demo.db` first) and writes the admin token to `.demo/admin-token` (mode 600; it is not printed). Never `cat` that file on camera. `KEEP=1` instead runs the scripted walkthrough first and leaves the ledger non-empty. Other ports: `GATEWAY_PORT`, `ADMIN_PORT`, `ORIGIN_PORT`, `FACILITATOR_PORT`.
   - A: run origin and gateway by hand with `agenttoll.example.yaml`, `AGENTTOLL_SOLANA_PAYTO=<funded pay_to>`, `AGENTTOLL_ADMIN_TOKEN=<24+ chars>`.
3. Dashboard: `cd apps/dashboard && AGENTTOLL_ADMIN_URL=http://127.0.0.1:8403 AGENTTOLL_ADMIN_TOKEN=$(cat ../../.demo/admin-token) pnpm dev`, open `http://localhost:3000`. It should read "No agent payments yet" or show only earlier rows. With `STACK_ONLY=1` the ledger starts empty.
4. pay-mcp through the headless Claude CLI, the path that has been run end to end (`bash scripts/claude-pays-demo.sh`, transcript in `docs/assets/claude-pays-transcript.md`). Write an MCP config like the one at the top of that transcript, with `BUYER_SOLANA_KEYPAIR` pointing at `.demo/buyer.json` (B) or the funded buyer keypair (A), `BUYER_MAX_USD_PER_CALL=0.01` and `BUYER_MAX_USD_PER_DAY=0.25`, and run each prompt as `claude -p "<prompt>" --model sonnet --mcp-config mcp.json --strict-mcp-config --tools "" --allowedTools "mcp__agenttoll-pay" < /dev/null`. **Claude Desktop is an unrehearsed alternative.** It has not been run against this stack. If Joseph prefers it, set it up per `demo/pay-mcp/README.md`, run the full script once before recording, and expect different wording and timing.
5. Delete `~/.agenttoll/spend.json` so `spend_status` starts the day at zero.
6. Never on screen: the admin token, any keypair file contents, `.env`, the dashboard URL bar if it contains a token.
7. Do a full dry run once. If a shot fails, restart the stack and re-run from shot 1; do not splice around a failure.

## Variant B proof run (2026-10-04, real output)

`bash scripts/claude-pays-demo.sh` drives the headless Claude CLI (`claude -p --model sonnet`, pay-mcp as its only tool, caps $0.01 per call and $0.25 per day) against the simulated stack through three prompts. The full tool-call transcript is `docs/assets/claude-pays-transcript.md` and the dashboard after it is `docs/assets/claude-pays-dashboard.png`. Each run took 6.5 to 8.3 s. Use the transcript to check that what Claude says on camera is what pay-mcp returns:

| Prompt | pay-mcp result | Claude says |
|---|---|---|
| get quote, then pay `/api/quote` | `get_quote`: 402, `usd 0.002`, Solana devnet. `pay_and_fetch`: `paid: true`, `tx SIMULATED-...`, `simulated: true` | price $0.002, under both caps, payment simulated, no funds moved |
| `generate_report` with up to 10 cents | `refused:per_call`: `Refused before signing (no money moved, nothing counted against caps): quote $0.05 is above BUYER_MAX_USD_PER_CALL ($0.01); not paid` | the wallet refused, its own cap beats the 10 cents I offered, I did not work around it |
| `search_docs` with query "x402" | `paid: true`, `payment_transport: mcp-native`, `tx SIMULATED-...`; text `3 results for "x402": install, configure, pricing.` | paid $0.005, simulated, $0.007 spent today |

The dashboard rows read `+$0.002 AgentToll-Buyer GET /api/quote` and `+$0.005 AgentToll-Buyer mcp search_docs`, both with Solana devnet and Simulated badges, and the by-route card shows two lines. The agent name is `AgentToll-Buyer` because pay-mcp sends that user agent, not `pay-mcp`. Claude's wording differs on every run; only the tool results are deterministic apart from the SIMULATED ids and the SOL/USD price.

Timing check for the 3:00 budget: the three Claude prompts take under 10 s each of tool time. On camera, add typing and reading time. The shot windows below leave 18 to 35 s per Claude prompt, which is enough for a pasted prompt and a read-through of the answer. The shot list records the Claude shots in the terminal with the CLI. If Joseph switches to Claude Desktop, re-time every Claude shot against a rehearsal first.

## Shot list

Voiceover is written to be read at a normal pace (about 2.5 words per second). On-screen text is a lower-third unless noted.

| Time | Shot | On-screen text | Voiceover | Commands and URLs |
|---|---|---|---|---|
| 0:00 to 0:12 | Split screen. Left: browser loads the JSON. Right: terminal, the same URL as ClaudeBot returns 402 (local stack on 127.0.0.1, not the public URL: Cloudflare 403s ClaudeBot on a quick tunnel). | `Same URL. People: free. Agents: $0.002.` | "This is the same URL twice. A person gets the data for free. An AI agent gets a 402 with a price: two tenths of a cent, in USDC." | Browser: `http://127.0.0.1:8402/api/quote` (shows `"symbol":"SOL/USD"`, `"paid":false`). Terminal: `curl -s -D - -o /dev/null -A "Mozilla/5.0 (compatible; ClaudeBot/1.0)" http://127.0.0.1:8402/api/quote \| cut -c1-90` (shows `HTTP/1.1 402 Payment Required`, `payment-required: ...`, `x-agenttoll-verdict: ua:ClaudeBot`) |
| 0:12 to 0:30 | Terminal, `claude -p` (headless CLI, the path proven on 2026-10-04), full width. Prompt typed live. Claude calls `get_quote` and answers with the price, network and pay-to address. | `pay-mcp: a wallet for Claude with hard caps. get_quote moves no money.` | "Claude has a wallet through pay-mcp, an MCP server with caps the agent cannot talk its way past. First it asks the price. Nothing is signed yet." | Prompt: `Use get_quote on http://127.0.0.1:8402/api/quote and tell me what it costs.` |
| 0:30 to 1:05 | PAYMENT SHOT 1. Claude CLI terminal left, dashboard right. Prompt typed live. Claude calls `pay_and_fetch`, reports the SOL/USD price from the body, `paid_usd 0.002`, the network and the transaction. The dashboard row animates in: `+$0.002`, agent `AgentToll-Buyer`, route `GET /api/quote`, Solana devnet. | A: `Settled on Solana devnet. Funds went straight to the founder's address.` B (whole shot, top right, never removed): `SIMULATED settlement, no funds moved` | A: "Claude pays, gets the data, and the founder's dashboard ticks within a second. Here is the transaction on Solana Explorer. The USDC went straight to the founder's own address. AgentToll never held it." B: "Claude pays, gets the data, and the founder's dashboard ticks within a second. This recording runs against the simulated facilitator that ships with the repo: the row is labelled simulated and nothing moved on chain. With a funded devnet wallet the same shot ends on Solana Explorer." | Prompt: A: `Pay for it with pay_and_fetch, max 1 cent. Tell me the SOL price in the data and link the transaction.` B: `Pay for it with pay_and_fetch, max 1 cent. Tell me the SOL price in the data, the receipt, and whether the payment was simulated.` A only: click the `https://explorer.solana.com/tx/<sig>?cluster=devnet` link in Claude's reply, hold 4 s on the transfer. B: hover the Simulated badge on the dashboard row so its tooltip ("No on-chain transaction exists") is visible for 2 s. |
| 1:05 to 1:25 | Claude CLI terminal. Two prompts. First, Claude refuses a $0.05 tool before signing. Second, `spend_status` shows today's spend and the caps. | `Refused before signing. Caps: $0.01 per call, $0.25 per day.` | "The caps are the point. A five-cent tool is over the per-call cap, so pay-mcp refuses before anything is signed and nothing counts against the budget. It is Claude's wallet, but it is your money." | Prompt 1: `Use call_paid_tool to run generate_report on http://127.0.0.1:8402/mcp.` (expect `Refused before signing (no money moved, nothing counted against caps)`). Prompt 2: `How much have you spent today and what is left under the caps?` |
| 1:25 to 1:45 | Terminal, full width. `tools/list` on the gateway shows each tool's price in its description. | `MCP servers sell per tool. initialize and tools/list stay free.` | "The same gateway sits in front of an MCP server. tools/list is free and carries each tool's price, so an agent can plan its spend before it calls anything." | `curl -s http://127.0.0.1:8402/mcp -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \| python3 -m json.tool` (descriptions read `Search Acme's documentation. (Paid tool: $0.005 USDC per call via x402.)`, `Generate a market report. (Paid tool: $0.05 USDC per call via x402.)`, `A free tool.`) |
| 1:45 to 2:15 | PAYMENT SHOT 2. Claude CLI terminal left, dashboard right. Claude calls `call_paid_tool` for `search_docs`, gets the result, reports `paid_usd 0.005`. A second dashboard row appears: route `mcp:search_docs`, $0.005. The by-route breakdown now shows two lines. | A: `MCP-native x402: challenge and receipt travel inside the tool call.` B: keep `SIMULATED settlement, no funds moved` on screen for the whole shot. | "An unpaid tool call gets the x402 MCP-native challenge: a tool result, not an HTTP status, so MCP clients that never see status codes can still pay. The retry carries the payment in the call's metadata, the receipt comes back the same way, and the tool shows up on the dashboard as its own line." A adds: "Here is that settlement." B adds: "Labelled simulated, like the first one." | Prompt: `Use call_paid_tool to run search_docs on http://127.0.0.1:8402/mcp with query "x402". Tell me the result and what you paid.` (result text: `3 results for "x402": install, configure, pricing.`). A only: 2 s on the explorer link. |
| 2:15 to 2:27 | Terminal shows the discovery document (no editor view). | Three lines, one after another: `Settle only after the origin succeeds.` `Content released only after settlement.` `Funds go to your pay_to. AgentToll holds nothing.` | "One YAML file: a price per route, a price per tool, and your own address. An agent never pays for an error, and content is released only after settlement." | Terminal (optionally `head -20 demo/agenttoll.demo.yaml` first for B, `agenttoll.example.yaml` for A): `curl -s http://127.0.0.1:8402/.well-known/agenttoll.json \| python3 -m json.tool \| head -24` |
| 2:27 to 2:40 | Terminal. `python3 evals/run.py` runs the black-box eval suite and prints the final line. | `119 cases. All simulated. All pass.` | "The repo grades itself. One command runs 119 cases against the real binaries in about two and a half seconds: people free, agents quoted, every payment simulated. All 119 pass." | Pre-run `cargo build --release -p agenttoll-gateway -p agenttoll-demo-origin -p agenttoll-buyer -p agenttoll-mock-facilitator` so only the run is on camera, then `python3 evals/run.py`. Read the pass count and the run time from the terminal on the day; the 119 and the 2.5 s come from the 2026-10-04 run in `evals/results/latest.md` and must be re-checked before recording. The suite does not cover Web Bot Auth, the Worker, the dashboard or pay-mcp: do not say it does. |
| 2:40 to 2:50 | Terminal. The Worker parity tests finish green. | `Rust binary or Cloudflare Worker. One core, byte-identical quotes.` | "It runs as a Rust binary or a Cloudflare Worker, and parity tests prove both return byte-identical quotes." | Pre-recorded: `cd workers/agenttoll-edge && npm run test:parity`, cut to the final summary lines. Do not claim a deployed Worker; none exists. |
| 2:50 to 3:00 | Website Factory: the agency page, then a grid of client landing pages. Hold the last frame with the repo URL. | `Agents already use your product. Now you can bill them.` and `github.com/Josefusan/agenttoll` | "We ship landing pages through Website Factory, and every page can run AgentToll. Agents already use your product. Now you can bill them." | Static frames; no live site claims. If no client page runs AgentToll on recording day, say "can run", never "runs". |

Total: 3:00, which is the limit, so aim for a 2:50 cut. If the recording runs long, cut the eval shot (2:27 to 2:40) before touching shots 3, 4 or 6; never cut those.

## Optional insert (8 s, only if there is slack)

After shot 1, decode the price for the camera:

```bash
curl -s -D - -o /dev/null -A "Mozilla/5.0 (compatible; GPTBot/1.2)" http://127.0.0.1:8402/api/quote \
  | grep -i '^payment-required' | cut -d' ' -f2 | tr -d '\r' | base64 -d | python3 -m json.tool
```

Shows `"amount": "2000"` (atomic USDC = $0.002), `"network": "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"`, the `payTo` address and `"scheme": "exact"`. Voiceover: "The quote is x402 version 2: amount, asset, network, who to pay."

## Words that must not appear in variant B

on-chain, settled, live, real payment, transaction link, explorer, mainnet, revenue earned. Use: simulated, labelled, nothing moved, demo facilitator.

## Words that must not appear in either variant

customers, users (as a count), revenue (as a number), "production", "mainnet ready", any named off-ramp provider (say "off-ramp partners"), any number not in `docs/KNOWLEDGE_BASE.md`.

## After recording

- Export at 1080p. Upload unlisted. Put the link in `docs/COLOSSEUM_SUBMISSION.md` under Media and code.
- Cut a 30 s clip from shots 3 and 6 for the launch thread (`docs/launch/POSTS.md`). In variant B the clip keeps the simulated label in frame for its full length.
- Capture the stills listed in `docs/launch/POSTS.md` (`docs/assets/dashboard-1440.png`, `live-feed.gif`, `terminal-demo.png`, `payment-required.png`) from the same session so the artifacts match the video.
