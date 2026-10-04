# Roadmap to 2026-10-12

Each day ends with a runnable demo of everything built so far. Status column is updated by the orchestrator.

| Day | Date | Slice | Owner | Acceptance | Status |
|---|---|---|---|---|---|
| D0 | Fri Oct 2 | Repo, docs, skills, agent org, Colosseum details | Joseph + Claude | Project details marked Complete on Colosseum | done |
| D1 | Sat Oct 3 | Cargo workspace; `agenttoll-core` (config, detector, pricer) with unit tests; demo origin | proxy-engineer | `cargo test` green; 20+ detector cases incl. browsers and bots | done (29 tests, 37 detector cases) |
| D2 | Sun Oct 4 | Gateway pass-through + 402 challenge on Solana devnet; `PAYMENT-REQUIRED` encoding | proxy + payments | `curl -A ClaudeBot` gets 402 with valid base64 PaymentRequired; browser UA gets 200 | done (live vs PayAI devnet /supported; critic FAIL → /MCP case fix → re-review) |
| D3 | Mon Oct 5 | Verify → forward → settle; ledger; buyer CLI pays devnet USDC | payments + demo | `agenttoll-buyer` prints data + tx sig; row in `revenue_events`; explorer link resolves | built + tested vs mocks (57 tests); live run reaches PayAI devnet /verify (unfunded key rejected in simulation as expected). Waiting on a funded buyer for the first real tx |
| D4 | Tue Oct 6 | Admin API + SSE; dashboard v1 (totals, by route, by agent, live feed). **Submission opens 04:00 PDT** | dashboard | Event shows on dashboard < 1 s after settle | admin API + SSE + unbilled log done (feat/d4-admin); dashboard done (feat/d4-dashboard, SSE→DOM 22 ms) |
| D5 | Wed Oct 7 | MCP per-tool pricing; `pay-mcp` server (`pay_and_fetch` with caps); Claude pays on camera | proxy + demo | Claude Desktop/Code: ask a question, tool pays $0.002, answer uses the data | gateway side done: MCP-native x402, per-tool pricing, price advertising, discovery (feat/d4-admin); pay-mcp in feat/d5-pay-mcp |
| D6 | Thu Oct 8 | Base Sepolia rail; Worker edition (Hono) parity for HTTP routes | payments + proxy | Same buyer flow works on Base; Worker returns identical 402 | |
| D7 | Fri Oct 9 | Docker compose; deploy in front of one Website Factory page; README GIF | proxy + launch | Public URL: human sees page, agent gets 402 | |
| D8 | Sat Oct 10 | Demo video (≤ 3 min) + pitch video; build-in-public posts drafted | launch | Video uploaded unlisted; Joseph approves posts | |
| D9 | Sun Oct 11 | Critic sweep, security pass, fill Media and code + Team on Colosseum | critic + Joseph | Checklist in COLOSSEUM_SUBMISSION.md all green | |
| D10 | Mon Oct 12 | Buffer. Joseph submits. | Joseph | Submitted | |

## Stretch (only if D0–D7 are green)
- CCTP sweep of Base earnings to Solana.
- PayAI batch-settlement mode (mainnet only, KB-SOL-03).
- "Agent traffic you are not billing yet" report from `request_log`.
- `npx agenttoll init` one-command setup.

## Cut list (if behind)
Cut in this order: Worker edition → Base rail → MCP per-tool pricing. Never cut: human pass-through, Solana pay path, dashboard live feed, Claude demo.
