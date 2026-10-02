# AgentToll dashboard

Founder-facing revenue view for an AgentToll gateway: how much agents paid, which agents, which routes, which chain, the latest settlements with explorer links, and the agent traffic you are not billing yet.

Next.js (App Router) + TypeScript strict + Tailwind v4 + Recharts. Read-only against the gateway admin API.

## How it connects

The browser never sees the admin token. It talks to two Next route handlers that add the bearer token server-side:

| Browser | Next route handler | Gateway |
|---|---|---|
| `GET /api/stats` | proxies | `GET /admin/stats` |
| `EventSource('/api/events')` | streams bytes through | `GET /admin/events` (SSE, `event: revenue`) |

Configure with env (copy `.env.example` to `.env.local`):

```
AGENTTOLL_ADMIN_URL=http://127.0.0.1:8403     # gateway admin_listen
AGENTTOLL_ADMIN_TOKEN=...                     # same value the gateway was started with
```

## Security: no auth of its own

The dashboard has no login. Anyone who can reach it sees your revenue and can hold open the SSE stream. `pnpm start` therefore binds to `127.0.0.1` by default (`next start -H 127.0.0.1`), and `pnpm dev` should stay on localhost too. Reach it over an SSH tunnel (`ssh -L 3000:127.0.0.1:3000 host`) or put it behind your own auth proxy. Never expose it on a public interface.

## Mode 1: against the real gateway

```bash
export PATH=$HOME/.local/bin:$PATH            # node + pnpm on the VPS
cd apps/dashboard
pnpm install
cp .env.example .env.local                    # set AGENTTOLL_ADMIN_URL + AGENTTOLL_ADMIN_TOKEN
pnpm dev                                      # http://localhost:3000
```

Then pay a route (`cargo run -p agenttoll-buyer -- http://localhost:8402/api/quote`) and watch the row animate in.

## Mode 2: without a gateway (fixture)

`scripts/fixture-gateway.mjs` implements the admin API contract with clearly sample data and emits a new simulated settlement every 3.5 s. Every fixture event is `simulated: true` (and labelled as such in the UI), and the seed includes one `pending` and one `unconfirmed` row.

```bash
pnpm fixture                                  # 127.0.0.1:8403, token "fixture-token"
# in a second shell
AGENTTOLL_ADMIN_URL=http://127.0.0.1:8403 AGENTTOLL_ADMIN_TOKEN=fixture-token pnpm dev
```

Flags: `--empty` (zero payments, shows the empty state), `--quiet` (seed only, no live events), `--mixed` (dev only: adds FAKE `simulated: false` rows with made-up signatures so the spendable path is exercised; their explorer links resolve to nothing, so never record a demo against `--mixed`). Env: `PORT`, `HOST`, `TOKEN`, `INTERVAL_MS`, `SEED` (simulated rows to seed, default 40), `MIXED_REAL` (fake real rows under `--mixed`, default 6), `LEGACY_TOTALS=1` (omit the two spendable fields to test the "Unavailable" path). `recent` is capped at the newest 50, like the gateway.

Spendable repro from the critic gate: `SEED=162 MIXED_REAL=1 pnpm fixture --mixed --quiet` must show Spendable = the one real payment, not the simulated pile.

## Checks

```bash
pnpm typecheck && pnpm lint && pnpm build
```

## What the UI promises

- Amounts are atomic USDC integers in code; dollars appear only at render (`atomicToUsd`).
- `simulated: true` rows (or a `SIMULATED-` signature) wear a Simulated badge and never get an explorer link. The hero tile says how much of the total is simulated.
- Cash out shows spendable USDC = `totals.revenue_atomic - totals.simulated_atomic - totals.unconfirmed_atomic`, straight from the gateway. If a gateway predates those two fields the card says "Unavailable" instead of guessing from `recent`. The live SSE merge advances the same three totals.
- `status: pending | unconfirmed` rows get a badge; `unconfirmed` rows (`tx_signature` starts with `unconfirmed:`) have no explorer link.
- Explorer links: Solana devnet (`solana:EtWT…`) and mainnet (`solana:5eykt…`), Base Sepolia (`eip155:84532`) and Base (`eip155:8453`).
- New settlements render within one SSE frame (well under 1 s) and animate in; `prefers-reduced-motion` turns the animation into a static highlight.
- Works at 390 px wide; dark, teal accent `#22A6AD`.
