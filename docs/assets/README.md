# Demo assets

Real captures of the AgentToll stack running locally on 2026-10-03: the gateway in front of `demo/origin`, settling through the **SIMULATED** facilitator (`demo/mock-facilitator`), with the revenue dashboard reading the admin API. Nothing is staged, mocked in the UI, or edited after capture. The terminal images are renderings of real command output (the text was placed in an HTML page styled like a terminal and screenshotted, because the demo runs on a headless server).

**Honesty note: every payment in these captures is a simulated settlement (no funds).** Transaction ids start with `SIMULATED-`, the dashboard tags each row `Simulated`, and "Spendable USDC" reads $0.00 because simulated revenue never touches a chain. The network shown is Solana devnet and `payTo` is a throwaway demo keypair. Do not read any of this as an on-chain payment.

| File | Size | What it shows |
|---|---|---|
| `live-feed.gif` | 3.6 MB, 1200x760, 12 fps, 11.5 s | The dashboard's **Live settlements** feed while the buyer CLI pays `GET /api/quote` five times. New rows animate in at the top with a `SIMU…` id, the `Solana devnet` and `Simulated` badges, and the "N of N simulated" counter climbs from 13 to 18. The right column is the "Agent traffic you are not billing yet" panel fed by GPTBot, ClaudeBot and PerplexityBot requests on free pages. |
| `claude-pays-transcript.md` | text | Headless Claude CLI (`sonnet`) using pay-mcp against the simulated stack, 2026-10-04: pays `/api/quote`, is refused on `generate_report` ($0.05 over the $0.01 cap), pays `search_docs`. Made by `scripts/claude-pays-demo.sh`. Every tx id is `SIMULATED-`. |
| `claude-pays-dashboard.png` | 1440 CSS px at 2x, full page | The dashboard right after that run: 2 of 2 simulated settlements, `GET /api/quote` and `mcp:search_docs`, agent `AgentToll-Buyer`, Live pill on. Captured with playwright-core driving `/usr/bin/google-chrome` against `next dev` on port 23402. |
| `dashboard-1440.png` | 1.0 MB, 2880x3508 (1440 CSS px at 2x), full page | The whole revenue dashboard after the traffic run: KPIs (revenue $0.035, 13 paid requests, 92 unbilled agent requests), revenue over time, by network, by route (`GET /api/quote`, `mcp:search_docs`), by agent, live settlements (13 of 13 simulated), unbilled agents, and Cash out showing $0.00 spendable because all revenue is simulated. |
| `dashboard-390.png` | 0.9 MB, 780x8190 (390 CSS px at 2x), full page | The same dashboard at phone width. Everything stacks to one column; the badges and simulated labels stay visible. |
| `terminal-demo.png` | 0.5 MB | The stdout of `scripts/demo-local.sh`: a human gets `HTTP 200`, GPTBot gets `402 Payment Required` with `x-agenttoll-verdict: ua:GPTBot`, the price list at `/.well-known/agenttoll.json`, the buyer CLI paying $0.002 with `tx: SIMULATED-…`, the MCP-native x402 challenge (`isError: True, price: 5000 atomic USDC`), `tools/list` with per-tool prices, and the founder's ledger. The final "Stack is running" line was dropped because it prints the admin token. |
| `payment-required.png` | 0.3 MB | A live `402` for `GET /api/quote` with the GPTBot user agent: the raw headers, then the `payment-required` header base64-decoded and pretty-printed (x402 v2, `scheme: exact`, `amount: 2000` atomic USDC, Solana devnet, `payTo`, `maxTimeoutSeconds: 60`, `feePayer`). |

## How they were produced

All commands ran on the VPS from a checkout of this repo (`~/Hackathons/AgentToll-assets`), with `PATH` including `~/.local/bin` (node 26, pnpm 12) and `~/.cargo/bin`.

1. Stack and dashboard (fixed ports 4000 origin, 4020 simulated facilitator, 8402 gateway, 8403 admin, 3123 dashboard):

   ```bash
   KEEP=1 bash scripts/demo-local.sh            # prints the admin token; its stdout is terminal-demo.png
   cd apps/dashboard && pnpm install --frozen-lockfile && pnpm build
   AGENTTOLL_ADMIN_URL=http://127.0.0.1:8403 AGENTTOLL_ADMIN_TOKEN=<token> pnpm exec next start -H 127.0.0.1 -p 3123
   ```

2. Traffic, about a minute, six rounds of:

   ```bash
   BUYER_SOLANA_KEYPAIR=.demo/buyer.json ./target/debug/agenttoll-buyer http://127.0.0.1:8402/api/quote
   # GPTBot, ClaudeBot, PerplexityBot user agents on / /about /blog (free, logged as unbilled) and on /api/quote (402)
   curl -s -o /dev/null -A "Mozilla/5.0 (compatible; GPTBot/1.2)" http://127.0.0.1:8402/
   # every second round: MCP tool payments through pay-mcp
   cd demo/pay-mcp && npm ci && npm run build && \
     GW=http://127.0.0.1:8402 BUYER_SOLANA_KEYPAIR=../../.demo/buyer.json PAY_MCP_SPEND_FILE=/tmp/assets-spend.json node scripts/smoke.mjs
   ```

3. Captures with Playwright 1.63 (Chromium 1243) from a small Node script, `deviceScaleFactor: 2`:
   - `dashboard-1440.png`, `dashboard-390.png`: `page.goto('http://127.0.0.1:3123/')`, wait for the feed pill to read "Live" and the chart to render, `page.screenshot({ fullPage: true })` at viewports 1440x900 and 390x844.
   - `live-feed.gif`: a 1200x760 context with `recordVideo`, scrolled to the Live settlements card, while the script ran the buyer CLI five times 1.7 s apart. The webm segment with the payments was converted with

     ```bash
     ffmpeg -ss 20 -t 11.5 -i live-feed.webm \
       -vf "fps=12,scale=1200:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=72:stats_mode=diff[p];[s1][p]paletteuse=dither=none:diff_mode=rectangle" \
       live-feed.gif
     ```

   - `terminal-demo.png`: the ANSI stdout of `scripts/demo-local.sh` converted to HTML (cyan step headers, `SIMULATED` highlighted), rendered in a dark terminal-styled page, element screenshot.
   - `payment-required.png`: `fetch('http://127.0.0.1:8402/api/quote', { headers: { 'user-agent': 'Mozilla/5.0 (compatible; GPTBot/1.2)' } })`, `Buffer.from(header, 'base64')`, `JSON.stringify(json, null, 2)`, rendered the same way. The equivalent shell is `curl -si -A "Mozilla/5.0 (compatible; GPTBot/1.2)" http://127.0.0.1:8402/api/quote | grep -i ^payment-required | cut -d' ' -f2 | base64 -d | jq .`

4. Teardown: the stack, dashboard and traffic processes were killed and ports 4000, 4020, 8402, 8403 and 3123 left free.
