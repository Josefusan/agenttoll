# Judge interview prep (15-minute Colosseum Zoom)

For Joseph. This is the shortlist interview (`KB-HACK-01`: "Shortlist gets a 15-minute Zoom
interview"). Use the opening, the live demo and the cheat sheet as-is; the 25 answers are the
short version of what is already written down in the repo.

Honesty rules for this interview: nothing here claims a settlement that has not happened. There are
no customers and no revenue yet. Every payment in the live demo is **SIMULATED** on Solana devnet and
no funds moved; say "off-ramp partners", never name a specific one. If a number is not in this file,
it is in `docs/KNOWLEDGE_BASE.md` with a `KB-*` id, or it is real test output.

---

## 0. The 60-second opening (say this, word for word)

Built from `docs/launch/PITCH_VIDEO.md`.

> I run Website Factory. We ship landing pages for small businesses, and the server logs of every site
> we ship are full of GPTBot, ClaudeBot, Perplexity and agent browsers, all day. The founder pays for
> the bandwidth and the content; the agents pay nothing. Until now the choices were to block them or
> absorb it. AgentToll adds a third: let them pay.
>
> It is an open-source proxy you put in front of a site, an API or an MCP server. You set a price per
> route, or a price per MCP tool, in one YAML file. A person gets the page free, exactly as before. An
> AI agent gets an HTTP 402 with an x402 quote, pays two-tenths of a cent in USDC on Solana, and gets
> the data in the same round trip. No API keys, no signups, no invoices. The money goes straight to an
> address you control; AgentToll holds no keys and no funds.
>
> Solana took the top spot for x402 agent payments, about three point three million dollars of USDC
> settled in one week, and PayAI opened batch settlement on Solana on September 30th. The rails just
> landed. The open, self-hosted, non-custodial version had not been built, so we built it. Everything
> is devnet and testnet today, and the payments in the demo are simulated.

## 1. The 3-minute live demo

Set up before the call: a terminal with the two URLs from `~/Hackathons/AgentToll-LIVE.txt` exported
(`GW` = gateway, `DASH` = dashboard), and a browser on the dashboard. The quick-tunnel URLs change on
restart, so re-read `AgentToll-LIVE.txt` five minutes before the call.

> **Cloudflare note:** on the public quick tunnels the edge answers `ClaudeBot`/`GPTBot` with its own
> 403. Always use `Claude-User/1.0` for the agent call, or demo the fallback below.

Paste in order.

```bash
GW=https://<gateway-from-AgentToll-LIVE.txt>
DASH=https://<dashboard-from-AgentToll-LIVE.txt>

# 1. A human gets the page. ~120 ms. Say: "a person sees a normal site."
curl -s -o /dev/null -w 'human: %{http_code}\n' -A 'Mozilla/5.0 Chrome/141' $GW/api/quote

# 2. The same URL, as an agent: 402 with the price. Say: "the same URL asks an agent to pay."
curl -s -D - -o /dev/null -A 'Claude-User/1.0' $GW/api/quote | grep -iE '^HTTP|^payment-required'

# 3. What the agent just received (decoded). Say: "it is an x402 v2 quote: Solana devnet,
#    2000 atomic USDC, which is $0.002, and the address to pay."
curl -s -D - -o /dev/null -A 'Claude-User/1.0' $GW/api/quote \
  | grep -i '^payment-required' | cut -d' ' -f2 | base64 -d | python3 -m json.tool

# 4. The price list an agent reads first. Say: "agents can read every price before spending."
curl -s $GW/.well-known/agenttoll.json

# 5. Open the dashboard. Say: "and the founder sees it arrive."
open $DASH   # or paste it in the browser: revenue, by route, by agent, the live feed,
             # and 'agent traffic you are not billing yet'
```

What to say while it loads, and what to point at:

- Step 2 is the whole product. Humans free, agents quoted.
- Step 4 is the MCP half: `tools/list` shows each tool's price; `initialize` and `tools/list` are free.
- On the dashboard, point at the **Simulated** badges on the live feed and the **"Includes $X
  simulated"** line under Revenue, then at **"Agent traffic you are not billing yet"**. Say plainly:
  "every row here is simulated on Solana devnet; no funds moved, and there is no explorer link."

**Fallback if a tunnel is down (say it, do not stall):** run the whole stack locally and walk the same
eight steps:

```bash
bash scripts/demo-local.sh   # builds once (~590 crates), then walks: human 200, GPTBot 402,
                             # price list, buyer pays $0.002 (SIMULATED), MCP challenge,
                             # tools/list prices, unbilled traffic, ledger
```
Requires a Rust toolchain and Python 3; no wallet, no keys. Ports 8402/8403/4000/4020.

## 2. Twenty-five questions and short answers

1. **What is AgentToll in one sentence?** An open-source paywall proxy that charges AI agents per
   request in USDC over x402 while humans keep browsing free. (`README.md`; `KB-X402-01`.)
2. **Who pays, and who stays free?** Default mode is `agents-only`, biased to human: only
   self-declared agents (AI crawler user agents, MCP clients, anyone presenting a payment) are
   charged. A person in a browser is never flagged. (`KB-DET-01`; `README.md`, "Money rules".)
3. **How do you know a payment is good before you serve the content?** Verify, forward, settle. The
   echoed `accepted` must match the gateway's own quote; only after `/verify` does it forward; paid
   content is buffered and released only after `/settle` succeeds. (`JUDGE_FAQ.md` Q1;
   `crates/agenttoll-gateway/src/pay.rs`.)
4. **Why not Cloudflare pay-per-crawl, or Coinbase's own x402 tooling?** Cloudflare's gateway opened
   a waitlist on 2026-07-01 and is for Cloudflare customers only; that is the demand signal, and
   AgentToll is the open, self-hosted version that runs on any host. Coinbase's Payments MCP is a
   buyer wallet, not a seller-side paywall; it can pay any AgentToll gateway with no AgentToll-
   specific work. (`KB-MKT-01`; `KB-PAY-06`.)
5. **Custody: who holds the money?** Nobody but the seller. Each settlement is a USDC transfer from
   the agent to the `pay_to` address in the seller's config. AgentToll holds no keys and no funds, and
   the gateway charges no take rate. (`README.md`, "Money rules"; `KB-PAY-07`.)
6. **Replay and double-spend?** A replay guard keys on the canonical JSON of the signed payload for
   120 s, so a re-encoded header is still a replay; quotes are matched on scheme, amount, asset and
   `payTo`; MCP quotes bind the tool in the URL fragment. (`KB-X402-07`; `JUDGE_FAQ.md` Q1.)
7. **Fake user agents and bot spoofing?** UA-only detection is spoofable, so a spoofer who claims to
   be a bot only earns a price quote; it cannot turn into a free pass, and heuristics like curl or a
   headless browser are logged, never billed. Cryptographic Web Bot Auth is a hook in the detector,
   not built yet. (`KB-DET-01`.)
8. **Why Solana, and why x402 now?** Solana leads x402 agent payments (about $3.3M USDC in one week),
   the facilitator sponsors the fee so an agent needs only USDC, and PayAI opened Solana batch
   settlement in public preview on 2026-09-30 for sub-cent volume. x402 v2 has HTTP and MCP
   transports and stable SDKs. (`KB-MKT-01`; `KB-SOL-03`; `KB-X402-06`.)
9. **What does Base add?** A second rail for EVM agents: Base Sepolia USDC via EIP-3009 with the
   x402.org testnet facilitator, supported by the buyer CLI and `pay-mcp`. The gateway has no
   chain-specific money logic, so a rail is a config block. (`KB-BASE-01`; `JUDGE_FAQ.md` Q9.)
10. **The business model?** A plan, not revenue: the open-source core stays free and non-custodial; a
    hosted edition (flat tier plus a fee on settled volume, billed off-chain, `pay_to` stays the
    founder's); payout destinations through off-ramp partners in the founder's own account; an agency
    bundle on Website Factory sites; a pro dashboard for sellers with real volume. (`JUDGE_FAQ.md`
    Q10; `docs/USE_CASES.md`, "Who pays us later (plan, not traction)".)
11. **Go-to-market and first users?** Website Factory already ships landing pages to small businesses,
    so the plan is to run the gateway in front of those sites with `pay_to` set to the client's own
    address (plan, not live). Then MCP server authors and API sellers through the repo and the x402
    and Solana developer communities. (`docs/USE_CASES.md`; `docs/WIN_PLAN.md`.)
12. **What is simulated versus real today?** Only the settlement is simulated: the one-command demo
    runs a facilitator from `demo/mock-facilitator`, every id starts with `SIMULATED-`, and no
    explorer link is shown. Everything else is real: detection, pricing, the x402 v2 headers and
    payloads, the MCP-native challenge, the ledger, the SSE feed, the caps. (`JUDGE_FAQ.md` Q7.)
13. **Why is there no funded settlement yet?** No devnet wallet is funded, so the recorded clips show
    simulated settlements and say so on screen. Both real facilitators were reached and rejected our
    unfunded wallets as expected — PayAI on Solana devnet (`invalid_exact_svm_transaction_simulation_failed`)
    and x402.org on Base Sepolia (`invalid_exact_evm_insufficient_balance`) — and the raw record is in
    `docs/assets/real-facilitator-handshake.md`. One funded devnet payment is the only step left, and
    `scripts/real-payment-preflight.sh` confirms readiness first.
14. **What happens after the hackathon?** First, fund the devnet wallets and make the first real
    settlement. Then a security review of the gateway, move the Worker's replay guard into a Durable
    Object, a Postgres ledger for hosted mode, and payout destinations. Mainnet needs Joseph's
    explicit approval. (`JUDGE_FAQ.md` Q6; `docs/ROADMAP.md`.)
15. **How does an agent find out what things cost?** Four ways: discovery at
    `/.well-known/agenttoll.json`; the 402 `PAYMENT-REQUIRED` header; `tools/list` with prices when
    `mcp.advertise_prices` is on; and `pay-mcp`'s `get_quote`, which reads the 402 without paying.
    (`JUDGE_FAQ.md` Q5.)
16. **What happens when something fails?** Origin non-2xx: no settlement, claim released for an honest
    retry. MCP tool error: no settlement. Facilitator rejects: the agent gets 402, not the content.
    `/settle` times out after the origin answered: content served, payment marked `unconfirmed` and
    excluded from the spendable total. (`JUDGE_FAQ.md` Q4.)
17. **Is this mainnet-ready?** No, and the submission says so. Switching is a config change, and
    `pay-mcp` refuses mainnet unless explicitly enabled, but it has not been run there.
    (`JUDGE_FAQ.md` Q6.)
18. **Can a human ever be charged by mistake?** No. Only agent signals are priced; heuristic verdicts
    (curl, headless browser, missing browser headers) are logged and never charged. The detector has a
    37-case table test. (`KB-DET-01`.)
19. **Is it open source, and under what license?** MIT, public on GitHub.
    (`github.com/Josefusan/agenttoll`; `LICENSE`.)
20. **How is this different from a normal paywall or API keys?** No signup, no key issuing, no
    invoice: an agent that finds the endpoint ten seconds ago can still pay, because the 402 carries
    the price and the address and settlement happens in the same round trip. (`README.md`.)
21. **What is the tech stack?** A Rust gateway (axum, hyper, reqwest, rusqlite ledger, hand-written
    x402 v2 types), a Next.js dashboard, `pay-mcp` on the official MCP SDK, a Cloudflare Worker
    edition sharing the Rust core as WebAssembly behind parity tests, and the x402-rs crates 2.0.2 in
    the buyer. (`docs/COLOSSEUM_SUBMISSION.md`; `KB-X402-03`.)
22. **How does the Worker edition relate to the gateway?** The same pure core compiles to WebAssembly,
    so detection and pricing are identical; 21 parity tests assert byte-identical 402 quotes between
    the Rust gateway and the Worker. It is built and parity-tested, but not deployed anywhere — that
    needs a Cloudflare account and sign-off. (`README.md`; `workers/agenttoll-edge`.)
23. **How does MCP pricing work?** The gateway prices at the HTTP layer: it inspects the JSON-RPC body,
    prices `tools/call` by tool name, and returns a 402 for unpaid calls. `initialize` and
    `tools/list` stay free. The MCP-native transport returns the challenge inside a tool result
    (`isError: true`) and the receipt in the tool result metadata. (`KB-X402-05`.)
24. **How does a seller actually get dollars out?** Earnings land in the `pay_to` address they choose,
    which can already be an off-ramp deposit address in their own name; a founder-run sweeper can move
    the balance on a threshold. No bank integration ships today. (`KB-PAY-07`; `docs/PAYOUTS.md`.)
25. **Who built it, and how much is AI?** Joseph Clark, solo, with AI coding agents (Claude Code with
    specialist subagents) and an independent adversarial critic agent that reviews every pull request
    before merge. Open-source dependencies are credited in the README: the x402 specs and SDKs,
    x402-rs, and the Skillbox skill-library pattern. (`README.md`, "Credits"; `JUDGE_FAQ.md`.)

Also be ready for: *traction?* — none, honestly: no customers and no revenue yet. *What is the ask?* —
the accelerator builds hosted AgentToll, batch settlement, off-ramp payout destinations and more
chains (`docs/launch/PITCH_VIDEO.md`, "What the accelerator money builds").

## 3. Don't say (with the honest alternative)

| Don't say | Say instead |
|---|---|
| "It settled on-chain" / "real transaction" | "The demo settlement is simulated on Solana devnet; no funds moved. The first real settlement needs a funded devnet wallet." |
| "Click the Solana Explorer link" (for the demo) | "Simulated rows have no explorer link; the real-facilitator rejection record is in `docs/assets/real-facilitator-handshake.md`." |
| Don't say "our customers" or "our users" | "The buyers we are built for — Website Factory clients are the first target, as a plan." |
| "Revenue" | "No revenue yet; this is a plan." |
| "It's mainnet-ready" | "Devnet and testnet only; mainnet is a config change we have not run." |
| "We built Web Bot Auth" | "Web Bot Auth is a hook in the detector; signature verification is not built yet." |
| "It's deployed on Cloudflare" | "The Worker edition is built and parity-tested; the live demo is a Rust gateway." |
| "We integrate with Bridge" (or any named off-ramp) | "Payout destinations through off-ramp partners, in the founder's own account." |
| "It works with Stripe / Coinbase / a neobank today" | "Not built; documented as the payout pattern only." |
| "It's enterprise-grade / battle-tested" | "A hackathon build with 93 Rust tests, 69 pay-mcp, 70 Worker (21 parity) and 119/119 evals." |

## 4. Cheat sheet (numbers and links)

**The one number:** the live quote is `2000` atomic USDC = `$0.002` (`KB-AMT-01`).

**Products and rails**
- Solana devnet: `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`; USDC `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` (`KB-SOL-01`).
- Base Sepolia: `eip155:84532`; USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e` (`KB-BASE-01`).
- Facilitators: PayAI `https://facilitator.payai.network` (Solana devnet, feePayer `2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4`), x402.org `https://x402.org/facilitator` (Base Sepolia) (`KB-X402-04`).
- x402-rs crates at 2.0.2 (`KB-X402-03`).

**Tests (real output, 2026-10-04)**
- Rust 93 · pay-mcp 69 · Worker 70 (21 parity) · evals 119/119 · System-1 6/6.

**Market (cite exactly)**
- Solana about $3.3M USDC of x402 agent payments settled in one week (`KB-MKT-01`, solanacompass.com).
- PayAI Solana batch settlement public preview 2026-09-30, mainnet only (`KB-SOL-03`).
- Cloudflare Monetization Gateway waitlist opened 2026-07-01, Cloudflare customers only (`KB-MKT-01`).
- Coinbase Payments MCP already pays x402 on Solana (`KB-PAY-06`).

**Links**
- Repo: `github.com/Josefusan/agenttoll` · Live demo: `~/Hackathons/AgentToll-LIVE.txt` (quick tunnel; re-read before the call).
- One-command demo: `bash scripts/demo-local.sh` (SIMULATED settlement, no funds moved) · Payment readiness: `scripts/real-payment-preflight.sh`.
- The 10 judge questions in long form: `docs/launch/JUDGE_FAQ.md` · Pitch script: `docs/launch/PITCH_VIDEO.md`.
- Rejection record (the "real protocol, unfunded wallet" proof): `docs/assets/real-facilitator-handshake.md`.
