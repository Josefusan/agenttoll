# Colosseum submission: AgentToll

Hackathon: Crypto World's Fair (Colosseum). Hard deadline 2026-10-12 11:59pm PT (Official Rules section 5). The earlier note "submission opens 2026-10-06 04:00 PDT" is not on any public Colosseum page; check it in the dashboard. Requirements matrix: `docs/COLOSSEUM_REQUIREMENTS.md`. Click-by-click: `docs/SUBMIT_DAY.md`.
Project page: https://colosseum.com/arena/projects/agenttoll-1

The answers below were first saved in the Colosseum editor on 2026-10-02 (Project details: Complete) and refreshed on 2026-10-03 to match what is actually built on `feat/d7-release` (PR #9). Edit here first, then paste. Re-count characters with the script at the bottom before pasting; limits are the ones the editor shows.

Only Joseph submits. Nothing here is pasted or submitted by an agent.

## Project details

**Project name** (public)
AgentToll

**Brief description** (public, limit 500)
AgentToll is an open-source paywall proxy that charges AI agents per request while people browse free. Put it in front of a site, API or MCP server, set a price per route or per MCP tool in one YAML file, and agents pay per call in USDC over x402 on Solana (Base as a second rail). No API keys, signups or invoices. Settlement happens only after your origin succeeds, and funds go straight to the wallet you name; AgentToll never holds them. Agents already use your product. Now you can bill them.

**Project website** (public)
<LIVE_GATEWAY_URL>

Placeholder. The deploy lane replaces it with the public gateway URL. If no working public URL exists on submit day, leave this field empty. Never paste the placeholder into the form.

**What are you building, and who is it for?** (limit 1000)
AgentToll is a reverse proxy that turns AI agent traffic into revenue. It sits in front of any website, API or MCP server. People pass through free and untouched. Agents, crawlers and MCP clients get an HTTP 402 with an x402 v2 quote, pay per request in USDC, and get the response in the same round trip. No API keys, signups or invoices.

Built: a Rust gateway (per-route and per-MCP-tool prices in one YAML file, x402 v2 over HTTP and the MCP-native transport, settlement only after the origin succeeds, replay guard, discovery at /.well-known/agenttoll.json), a founder dashboard with a live feed and a report of agent traffic you are not billing yet, pay-mcp (a wallet for Claude with hard per-call and per-day caps), a buyer CLI, a Cloudflare Worker edition sharing the Rust core via WASM with parity tests, and a one-command demo.

For indie founders, API and data providers, MCP server authors, publishers, and agencies like our own Website Factory, whose pages agents crawl for free.

**Why did you decide to build this, and why build it now?** (limit 1000)
We run Website Factory, an AI landing-page service. The sites we ship are read by crawlers such as GPTBot and ClaudeBot, and by agent browsers. That traffic costs bandwidth, gives nothing back, and the only options were to block it or eat it. x402 gives a third option: let agents pay.

Now is the moment because the pieces just landed. x402 v2 has HTTP and MCP transports and TypeScript and Rust SDKs. Solana took the top spot for x402 agent payments, with about $3.3M USDC settled in one week. PayAI opened Solana batch settlement in public preview on Sep 30, 2026, a mainnet path for sub-cent traffic. Agents already hold wallets: Coinbase's own Payments MCP pays x402 on Solana. Cloudflare announced an x402 monetization gateway in July, but it is waitlist-only and tied to its network. Founders need something open-source they can self-host on any stack, multi-chain, with revenue landing in a wallet they own. Every month without it, agent traffic grows and founders capture none of it.

**What technologies are you using or integrating with?** (limit 500)
Rust gateway: axum, hyper, reqwest, rusqlite (SQLite ledger), hand-written x402 v2 types, direct facilitator calls. Buyer CLI: x402-reqwest, x402-chain-solana, x402-chain-eip155 (x402-rs 2.0.2). pay-mcp: @modelcontextprotocol/sdk, @x402/fetch, @x402/svm, @x402/evm, @x402/core. Worker edition: Cloudflare Workers, wasm-bindgen, D1. Dashboard: Next.js, Tailwind v4, Recharts, SSE. Facilitators: PayAI (Solana devnet), x402.org (Base Sepolia). Dev: Claude Code subagents and a critic agent, Docker.

**Which chains does your product use?**
Solana, Base

**How does your product use these chains?** (limit 500)
Solana is the primary rail: agents pay per request in USDC (SPL) with the x402 v2 exact scheme, verified and settled through a facilitator whose fee payer sponsors the fee, so agents only hold USDC. Earnings land in one Solana USDC account the seller controls. Real settlement signatures link to Solana Explorer from the dashboard; simulated payments are labelled. Base (Sepolia today) is the second rail for EVM agents, paying USDC via EIP-3009 under the same rules. Devnet and testnet only so far.

**Category** (public)
Developer Infrastructure

**Mobile-focused dApp?**
No

## Location and contact

**Where is your team primarily based?** United States
**Team Telegram contact:** @jdev_1

## Notes for judges

**Did anyone not listed on the team do meaningful work?** (limit 600)
No. AgentToll is built by Joseph Clark as a solo builder. I used AI coding agents (Claude Code with specialist subagents, plus an independent adversarial critic agent that reviews every pull request before it is merged) and open-source libraries, including the x402 specifications and SDKs (x402-foundation/x402) and x402-rs, which are credited in the repo.

**Anything else judges should know?** (limit 500)
Open source (MIT), self-hostable, non-custodial. Honest status: devnet and testnet only. The one-command demo settles through a simulated facilitator and labels every payment simulated. The real devnet path (PayAI facilitator, Circle devnet USDC) reaches the facilitator, but no wallet is funded yet. Tests: 90 Rust, 69 pay-mcp, 70 Worker (21 parity). First commit 2026-10-02; Website Factory is a separate, earlier product. Next: dogfood on Website Factory client sites.

**Go-to-market, demand validation and distribution plan** (the FAQ lists this as a required item; check the field name and limit in the editor, draft is under 1000 characters)
Demand signal: Cloudflare opened a waitlist for an x402 monetization gateway on 2026-07-01, for Cloudflare customers only. AgentToll is the open, self-hosted version. Not validated yet: no customers, no revenue, no pilot.

Distribution: Website Factory ships landing pages to small businesses. The plan is to run the gateway in front of those sites with pay_to set to the client's own address (plan, not live). Next: MCP server authors and API sellers through the repo, the x402 and Solana developer communities, and a daily proof post from the build log.

Business model (plan): the open-source core stays free and non-custodial. A hosted edition (flat tier plus a fee on settled volume, billed off-chain), payout destinations through off-ramp partners in the founder's own account, an agency bundle for Website Factory sites, and a pro dashboard for sellers with real volume.

---

## What is built and what is not (truth table for every answer above)

| Claim in the form | Status on 2026-10-04 | Where |
|---|---|---|
| Humans free, self-declared agents get 402 with an x402 v2 quote | Built, tested | `crates/agenttoll-gateway`, `crates/agenttoll-core` |
| Per-route and per-MCP-tool prices in one YAML file | Built | `agenttoll.example.yaml`, `demo/agenttoll.demo.yaml` |
| Verify, forward, settle; settle only after origin 2xx; content released only after settlement | Built, tested against mocks; reaches PayAI devnet `/verify` live (rejected only because the key is unfunded) | `crates/agenttoll-gateway/src/pay.rs`, `docs/DECISIONS.md` |
| MCP-native x402 challenge, per-tool settlement rules, price advertising in `tools/list` | Built | gateway `lib.rs`, `pay.rs` |
| Discovery document `/.well-known/agenttoll.json` | Built (AgentToll's own format) | gateway |
| Replay guard, quote matching, resource and tool binding | Built | `pay.rs` |
| Admin API + SSE, founder dashboard, live feed, unbilled-traffic report, cash-out panel | Built | `docs/ADMIN_API.md`, `apps/dashboard` |
| pay-mcp with hard caps, USDC allowlist, locked spend ledger | Built, 69 tests | `demo/pay-mcp` |
| Buyer CLI, Solana devnet and Base Sepolia | Built | `crates/agenttoll-buyer` |
| Cloudflare Worker edition, WASM core, parity tests | Built, 70 tests, 21 parity. Not deployed (no Cloudflare account) | `workers/agenttoll-edge` |
| Simulated facilitator and one-command demo | Built | `demo/mock-facilitator`, `scripts/demo-local.sh` |
| Docker stack | Built | `docker-compose.yml`, `Dockerfile`, `deploy/` |
| A real devnet settlement with an explorer link | Not yet: no wallet is funded as of 2026-10-04 | README "Real devnet payments" |
| Base Sepolia exercised with funds | Not yet: configured and mock-tested only | `agenttoll.example.yaml` |
| Web Bot Auth signature verification | Not built: detector hook exists, gateway passes `None` | `crates/agenttoll-core/src/detector.rs` |
| Public deployment in front of a Website Factory page | Not yet | ROADMAP D7 |
| Mainnet | Not attempted; needs Joseph's approval | `ARCHITECTURE.md` §2.1 |
| Off-ramp or neobank integration | Not built by decision; `pay_to` is the payout destination | `docs/PAYOUTS.md` |

Do not claim in any field: Supabase, shadcn/ui, Kora, Circle CCTP, x402-axum, Hono, Web Bot Auth verification, a live Worker, customers, revenue. The 2026-10-02 answers listed several of these as technologies; the refreshed answers above remove them.

## Media and code (fill by D9)

- [ ] GitHub repo: https://github.com/Josefusan/agenttoll (public). Confirm the release branch is merged to `main` or that the README on `main` points at the release branch before submitting.
- [ ] Demo video (3:00 max), unlisted link. Script: `docs/launch/DEMO_VIDEO.md`. Variant A (real devnet) or B (simulated) chosen and consistent throughout.
- [ ] Pitch video (Colosseum asks for two to three minutes; aim for 2:30 to 2:50), unlisted link. Script: `docs/launch/PITCH_VIDEO.md`.
- [ ] Logo: `brand/logo-square.png`. Cover: `brand/banner.png`.
- [ ] Project website: only if a public demo URL exists.
- [ ] Screenshots (if the form takes them): `docs/assets/dashboard-1440.png`, `payment-required.png`, `terminal-demo.png`.

## Team (fill by D9)

- [ ] Joseph Clark profile complete: bio (one line, no titles invented), GitHub `Josefusan`, X handle, LinkedIn `linkedin.com/in/josephc9`.
- [ ] Team Telegram `@jdev_1` still reachable.

## Video scripts

Moved to `docs/launch/DEMO_VIDEO.md` and `docs/launch/PITCH_VIDEO.md`. Judge questions and answers: `docs/launch/JUDGE_FAQ.md`. Build-in-public drafts: `docs/launch/POSTS.md`.

## Pre-submit checklist (Joseph, submit day)

Why-now numbers, re-checked against the live sources the same day:
- [ ] $3.3M USDC in one week on Solana (KB-MKT-01, solanacompass.com). If a newer figure exists, update the form and the KB together.
- [ ] PayAI batch settlement public preview date 2026-09-30 (KB-SOL-03).
- [ ] Cloudflare Monetization Gateway waitlist 2026-07-01, Cloudflare customers only (KB-MKT-01). If it has launched publicly, rewrite the sentence.
- [ ] x402-rs crates at 2.0.2 (KB-X402-03). Update the version if bumped.
- [ ] Coinbase Payments MCP lists Solana (KB-PAY-06).

Repo:
- [ ] Repo is public and `main` holds the release (or the README on `main` links the release branch).
- [ ] `bash scripts/demo-local.sh` runs on a clean machine with Rust 1.93+ and Python 3.
- [ ] No keys, keypair files, `.env` or admin tokens in git history (`git log -p --all -S 'BUYER_SOLANA_KEYPAIR=' | head`, and check `.demo/` is ignored).
- [ ] README test counts match `cargo test`, `npm test` in `demo/pay-mcp` and `workers/agenttoll-edge`.

Videos:
- [ ] Both videos uploaded unlisted, links pasted in Media and code. Pitch video 2:00 to 3:00, demo video 3:00 or shorter.
- [ ] Variant B videos show the `simulated settlement, no funds moved` label on every payment shot and never say on-chain.
- [ ] Variant A videos show the Solana Explorer page with `cluster=devnet`.

Form:
- [ ] Every answer re-counted with the script below and under its limit.
- [ ] Every claim in every field is true on submit day (use the truth table above).
- [ ] Media and code and Team sections complete.
- [ ] Project website blank or a working URL.
- [ ] Joseph clicks Submit.

## Character counter

Run from the repo root after editing this file. It prints each answer's length against its limit.

```bash
python3 - <<'PY'
import re
text = open("docs/COLOSSEUM_SUBMISSION.md", encoding="utf-8").read()
for m in re.finditer(r"\*\*([^*\n]+)\*\* \((?:public, )?limit (\d+)\)\n(.*?)(?=\n\n\*\*|\n## )", text, re.S):
    name, limit, body = m.group(1), int(m.group(2)), m.group(3).strip()
    flag = "OK " if len(body) <= limit else "OVER"
    print(f"{flag} {len(body):4d}/{limit}  {name}")
PY
```
