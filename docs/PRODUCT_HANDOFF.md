# Product handoff — AgentToll

**Written 2026-10-06, the day the Colosseum submission went in.** This is the document for the next
person or agent: what exists, what is *not* true yet, and the shortest order to turn a hackathon build
into a marketed product. `docs/ROADMAP.md` is the hackathon roadmap (D0–D10, finished); this is what
comes after it.

---

## 1. What exists today

| Piece | State |
|---|---|
| Repo | `github.com/Josefusan/agenttoll` — public, MIT, `main` at `31d4792` |
| Rust gateway | proxy + x402 v2 challenge/verify/settle, header hygiene, streaming; `:8402`, admin `:8403` |
| `agenttoll-core` | detector, pricer, mcp, money, path — no I/O crates, also compiles to `wasm32` |
| Cloudflare Worker edition | same contract at the edge, D1, 21 parity tests against the Rust gateway. **Not deployed** |
| Dashboard | Next.js, live settlement feed, "agent traffic you are not billing yet". No login |
| `pay-mcp` | wallet for Claude with hard per-call and per-day caps |
| Buyer CLI | `agenttoll-buyer`, speaks real x402 |
| Live demo | dashboard `commonwealth-dam-wheat-constructed.trycloudflare.com`, gateway `years-cow-stations-dubai.trycloudflare.com` — **Cloudflare quick tunnels, they rotate** |
| Evals / tests | 119/119 black-box evals; Rust 93; pay-mcp 69; Worker 70; dashboard 9 + typecheck/lint/build |
| Gates | `evals/judge/system1.py` must stay 6/6 before any judge-facing change; `scripts/build-submission-page.py` |
| Films | three, uploaded unlisted (pitch 2:36, demo 2:51, 90s) |
| Launch copy | `docs/launch/POSTS.md` — X thread + LinkedIn, real links in place, all under limits |

## 2. What is NOT true yet — never claim otherwise

- **No real settlement has ever happened.** Every payment anywhere in this repo is SIMULATED, produced
  by `demo/mock-facilitator`, with ids beginning `SIMULATED-`. The real devnet path is built and wired
  (`demo/real-pay.yaml`, PayAI facilitator) but the wallets are unfunded — buyer and `payTo` both hold
  **zero USDC and have no token account at all**, and `scripts/real-payment-preflight.sh` returns
  `NOT READY`.
- No mainnet, no customers, no revenue, no pilot, no hosted edition, no billing.
- The Worker edition is written and tested but not deployed.
- Web Bot Auth signature verification is a hook, not an implementation.
- Repo social preview image is unset; release `v0.1.0-colosseum` is still a **draft**.
- The five "do not claim" terms to keep avoiding: Supabase, shadcn/ui, Kora, Circle CCTP, x402-axum,
  Hono, Web Bot Auth verification, a live Worker, customers, revenue.

## 3. Shortest path to a real product, in order

1. **Make one real settlement happen.** Fund both devnet wallets at `faucet.circle.com`; run
   `scripts/real-payment-preflight.sh` until it prints `READY`; then run the buyer against a gateway
   built with `demo/real-pay.yaml` (spare ports 4300/8702/8703). Keep the Solana Explorer link. This
   single step converts the entire project from "simulated" to "works", and it is the gate on every
   claim in the README and every sales conversation.
2. **Get a stable hostname.** Replace the quick tunnels with a named Cloudflare tunnel — no sudo
   needed, method in `docs/launch/STABLE_URL.md`. Until this is done, every published demo link
   eventually 404s, and you cannot put a URL on a landing page or in an invoice.
3. **Dogfood behind one real site.** Put the gateway in front of one Website Factory page with `pay_to`
   set to that client's own address, and let it run a week. The `request_log` then produces the two
   numbers that sell this product: agent requests seen, and revenue left on the table.
4. **Publish the release and set the social preview** (`Settings → General → Social preview` →
   `brand/banner.png`).
5. **Only then build the paid edition** — flat tier plus a fee on settled volume billed off-chain, with
   off-ramp payouts to the founder's own account (`docs/PAYOUTS.md`).

## 4. Go to market

**Who buys it** (from the submission answer): indie founders, API and data providers, MCP server
authors, publishers, and agencies like Website Factory whose pages agents already crawl.

**Positioning.** Cloudflare announced an x402 monetization gateway in July 2026 — waitlist-only, for
Cloudflare customers. AgentToll is the open, self-hostable, multi-chain, non-custodial version. Lead
with honesty: devnet/testnet, labelled simulated payments, no revenue claimed. That framing is an asset
with technical buyers, and it is already baked into every doc and film.

**Demand signals to cite:** Cloudflare's waitlist (2026-07-01); ~$3.3M USDC settled through x402 on
Solana in a single week; PayAI batch settlement public preview (2026-09-30); Coinbase's Payments MCP
paying x402 on Solana. All in `docs/KNOWLEDGE_BASE.md` as `KB-MKT-01`, `KB-SOL-03`, `KB-PAY-06`.

**Business model (plan, not built):** open-source core free and non-custodial; hosted edition with a
flat tier plus a fee on settled volume; payout destinations through off-ramp partners into the
founder's own account; an agency bundle for Website Factory sites; a pro dashboard for sellers at
volume.

**Distribution, ready to fire:** `docs/launch/POSTS.md` holds a six-post X thread and a LinkedIn post
with the real film links already in place, each verified under 280 where it matters. Three films are
uploaded unlisted. Screenshots and a README GIF exist. What is missing is only a decision to post.

**Channels:** the repo itself and its README; the x402 and Solana developer communities; MCP server
authors; build-in-public posts; and Website Factory's existing client base as the first design
partners.

## 5. Operations — where everything lives

- **Code:** `~/Hackathons/AgentToll*` (main worktree plus branch worktrees).
- **Runtime state:** `~/agenttoll/` — `data/` (ledger + logs), `scratch/`, `vo/`, and `config/`
  (`agenttoll-buyer.json`, `agenttoll-payto.json`, `agenttoll-live.env`, all mode 600).
- **VPS layout:** read `~/FOLDER_STRUCTURE.md` and `~/AGENT_CONTEXT.md` first — they are authoritative
  and include the old-to-new path map from the 2026-10-06 reorg.
- **pm2:** six `at-*` services (`at-origin`, `at-facilitator`, `at-gateway`, `at-dashboard`,
  `at-tunnel-gw`, `at-tunnel-dash`) defined in `deploy/pm2.config.cjs`. Logs in
  `~/agenttoll/data/logs/`. Two compatibility symlinks (`~/agenttoll-data`, `~/agenttoll-live.env`)
  can be dropped once `at-*` are recreated from the updated config.
- **Reports and audits:** `~/ops/audits/vps-audit/` (the war room of 2026-10-06 is in
  `warroom-20261006/`).

## 6. Rules that must not break

- Never claim a real settlement until one exists, and never label a simulated payment as anything else.
- `system1.py` must stay 6/6 — it enforces form limits, test counts, forbidden claims, simulated
  labels, no on-chain/simulated confusion, and no secrets.
- Money path invariants: integers only; settle only after the origin returns 2xx; idempotent ledger
  keyed on the transaction signature; never charge on a 500.
- Do not restart `at-tunnel-*` while published links are in use — the hostname rotates and the links die.
- The reorg guardrail: crontab and pm2 use absolute paths. Renaming a venture folder means updating
  cron, the ecosystem files and `pm2 save`.

## 7. Open decisions

- Publish `v0.1.0-colosseum`, or leave it a draft?
- Named tunnel now, or wait until there is a landing page worth pointing it at?
- Should this handoff stay in a public repo, or move somewhere private before it grows a revenue plan?
- Once real revenue exists, does the honesty-forward framing stay, or does it shift to
  "cheapest x402 rail for agents"?

## First three things

1. Fund the two devnet wallets and make the first real settlement.
2. Put the gateway behind one real Website Factory page and start collecting `request_log` numbers.
3. Publish the release, set the social preview, and post the launch thread that is already written.
