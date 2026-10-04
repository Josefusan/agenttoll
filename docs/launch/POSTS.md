# Build-in-public posts

Every post below is a DRAFT and needs Joseph's approval before it goes anywhere. Joseph posts; agents never post, DM or reply.

Rules (from `skills/hackathon-distribution` and the imported voice skills): one idea per post, a real artifact attached, specific numbers, no hype words, no thread-bait, no em dashes. Every claim must be true on the day it is posted. Tag @x402, @solana, PayAI or Colosseum only when the post is about their tech.

Artifacts live in `docs/assets/` and are captured from the same session as the demo video:

| File | What it shows |
|---|---|
| `payment-required.png` | Terminal: browser UA gets 200, `ClaudeBot` UA gets `402 Payment Required` with the `payment-required` header and `x-agenttoll-verdict: ua:ClaudeBot` |
| `terminal-demo.png` | `bash scripts/demo-local.sh` output, steps 1 to 8 |
| `dashboard-1440.png` | Founder dashboard at 1440 px: revenue, by route, by agent, by network, unbilled agent traffic |
| `live-feed.gif` | A settlement row animating into the live feed |

Payment wording depends on the demo variant. If the screenshot or clip shows a simulated settlement, the post must say so in the first two lines and must not use "on-chain", "settled" or "transaction". If Joseph funds devnet wallets and records variant A, replace the bracketed B lines with the A lines.

Posting order follows the milestones. Do not post a milestone before its artifact exists.

---

## 1. Gateway answers 402 (artifact: `payment-required.png`)

### X (DRAFT)

Same URL, two callers.

Browser: 200, the page.
ClaudeBot: 402 Payment Required, with an x402 v2 quote in the header: $0.002 in USDC on Solana devnet, pay-to address included.

Humans never see a paywall. Agents get a price. One YAML file.

Rust gateway, 90 tests. Repo link in the next post.

### LinkedIn (DRAFT)

Agents read the sites we ship all day. The founder pays for it.

This week I started AgentToll, an open-source proxy you put in front of a site, API or MCP server. A person gets the page as before. A self-declared AI agent gets HTTP 402 with an x402 quote in the header: two tenths of a cent in USDC, the network, the address to pay.

Rules I decided before writing code:
- Default mode charges only self-declared or verified agents. A curl command or a headless browser is logged, never billed.
- A spoofed bot user agent only earns a price quote. Nobody can turn it into a free pass.
- Paths are canonicalized before pricing, so /api/%71uote cannot slip past a priced route.

Screenshot: the same URL answered twice. Built for the Colosseum Crypto World's Fair, Solana track.

---

## 2. Claude pays through MCP (artifact: `terminal-demo.png`, plus a short screen recording of Claude Desktop if available)

### X (DRAFT)

Claude just paid for an API call by itself.

pay-mcp gives Claude a USDC wallet with hard caps: $0.01 per call, $0.25 per day, USDC only, allowlisted networks only. It refuses before signing anything above the cap.

Prompt: "pay for it, max 1 cent". It did, got the data, reported what it paid.

[B: Settlement in this recording is simulated by the facilitator that ships with the repo. No funds moved.]
[A: Settled on Solana devnet, explorer link in the screenshot.]

### LinkedIn (DRAFT)

The part of agent payments nobody shows: the caps.

pay-mcp is an MCP server that gives Claude Desktop or Claude Code a USDC wallet for x402 paywalls. The interesting code is the refusals, not the payments:

- The cap check runs before anything is signed. A $0.05 tool against a $0.01 per-call cap gets "Refused before signing (no money moved, nothing counted against caps)".
- Only USDC on an explicit allowlist is ever paid. A swapped mint or an unknown network is refused before the cap check.
- Every signed payment that leaves the process counts against the daily cap, even if the seller rejects it afterwards. A dishonest seller cannot drain more than the day's budget.
- Spend is persisted under a lock file, so two Claude windows cannot both pass the cap.

Four tools: get_quote, pay_and_fetch, call_paid_tool, spend_status. 69 tests.

[B: The recording uses the simulated facilitator from the repo; settlements are labelled simulated and nothing moved on chain.]
[A: Settled on Solana devnet; the explorer link is in the clip.]

---

## 3. Founder dashboard (artifacts: `dashboard-1440.png`, `live-feed.gif`)

### X (DRAFT)

The founder side of AgentToll: a dashboard that shows what agents paid, by route, by agent, by network, and the agent traffic you are not billing yet.

New settlements arrive over SSE and render in under a second.

[B: Rows in this capture are labelled Simulated. Demo facilitator, no funds.]
[A: Devnet settlements; each row links to Solana Explorer.]

### LinkedIn (DRAFT)

If agents pay you two tenths of a cent at a time, you need to see it or it is not real to you.

The AgentToll dashboard reads the gateway's admin API (bearer token, separate listener, off unless the token is set) and shows:

- Revenue, and how much of it is simulated or unconfirmed, so the spendable number is never inflated
- By route, by agent, by network
- A live feed over SSE; a new settlement renders within one frame
- "Agent traffic you are not billing yet": every agent request that hit a free route, grouped by agent, with the reason it was not charged

The dashboard has no login of its own and binds to localhost by default. That is a deliberate limit for a hackathon build, and it is written down in the README.

[B: Every row in this screenshot is labelled Simulated. The stack ran against the repo's demo facilitator; no funds moved.]
[A: Devnet settlements with explorer links.]

---

## 4. Worker edition parity (artifact: a capture of `npm run test:parity` finishing green; file it as `terminal-demo.png` if no separate capture is taken, and say so in the post)

### X (DRAFT)

AgentToll now runs as a Cloudflare Worker too.

Nothing was ported. The Rust core (detection, pricing, path canonicalization, MCP inspection, discovery) compiles to WebAssembly and the Worker calls it. 21 parity tests run both editions on one config and assert byte-identical 402 quotes.

70 Worker tests total.

### LinkedIn (DRAFT)

One source of truth or two bugs.

The AgentToll gateway is Rust. Some people will only deploy to Cloudflare. The usual answer is a TypeScript port, and then the two drift.

Instead the pure core is compiled to WebAssembly through a thin facade and the Worker's TypeScript is only the IO shell, file for file mirroring the Rust gateway. A parity suite starts the Rust binary and the Worker on the same config and the same mock facilitator and asserts that the decoded and raw PAYMENT-REQUIRED headers, the 402 bodies, the MCP-native challenge, the discovery document and the refusal reasons are equal.

Known gaps are listed in the Worker README: the replay guard is per isolate, no admin API or SSE feed yet, and it is not deployed anywhere because that needs a Cloudflare account and Joseph's sign-off.

---

## 5. Launch thread (artifacts: 30 s clip from the demo video, `dashboard-1440.png`)

Post when the demo video exists. Structure: problem, 30 s clip, three bullets, repo, ask.

### X thread (DRAFT)

1/ AI agents read your site, your API, your MCP server all day. You pay for it. They pay nothing. The only options were block or absorb.

AgentToll is a third option: an open-source proxy that charges agents per request in USDC and keeps people free.

2/ [30 s clip]
A person loads the page free. Claude gets a 402, pays $0.002 within caps its owner set, gets the data, and the founder's dashboard ticks.

[B: Settlement in this clip is simulated by the facilitator that ships with the repo. No funds moved. The label is in the frame.]
[A: Settled on Solana devnet. The explorer link is in the clip.]

3/ How it works, three things:
- One YAML file: a price per route, a price per MCP tool, your payout address. Unmatched routes are free.
- Settle only after your origin succeeds. Agents never pay for a 500, and paid content is released only after settlement.
- Non-custodial. Funds go straight to the pay_to you choose. AgentToll holds no keys and no money.

4/ Runs as a Rust binary or a Cloudflare Worker (same core, compiled to WASM, parity-tested). x402 v2 over HTTP and the MCP-native transport. Solana devnet first, Base Sepolia second.

Repo: github.com/Josefusan/agenttoll
One command, no wallet needed: bash scripts/demo-local.sh

5/ Ask: put it in front of something agents already read and tell me what breaks. Issues and PRs open. If you run an MCP server and want per-tool prices, I want to hear from you.

Built solo with AI coding agents and an adversarial critic agent on every PR, for the Colosseum Crypto World's Fair (Solana track).

### LinkedIn (DRAFT)

The sites we ship through Website Factory get read by AI agents all day. The owner pays for the bandwidth and the content. The agents pay nothing.

So I built AgentToll for the Colosseum Crypto World's Fair. It is an open-source proxy you put in front of a site, API or MCP server. People keep browsing free. AI agents get an HTTP 402 with a price and pay per request in USDC over x402.

What is in the repo today:
- Rust gateway: per-route and per-MCP-tool pricing in one YAML file, x402 v2 over HTTP and the MCP-native transport, settlement only after the origin succeeds, replay guard, discovery document at /.well-known/agenttoll.json
- pay-mcp: a wallet for Claude with hard per-call and per-day caps
- A founder dashboard with a live settlement feed and a report of agent traffic you are not billing yet
- A Cloudflare Worker edition sharing the Rust core via WASM, parity-tested
- One command to run the whole stack with no wallet: bash scripts/demo-local.sh

What is not in it: a mainnet deployment, a funded wallet, customers. It is devnet and testnet only, and the one-command demo settles through a simulated facilitator that labels every payment as simulated.

[Clip. B: label in frame, simulated settlement, no funds moved. A: devnet settlement with explorer link.]

Repo: github.com/Josefusan/agenttoll. If you run an API or an MCP server that agents already call, I would like to know what price you would set.

---

## Colosseum build log entries (one per shipped slice, short, factual)

- D1: `agenttoll-core`: config, detector (36 cases), pricer, MCP body inspection. 29 tests.
- D2: Gateway pass-through and x402 v2 402 challenge. Fee payer read live from the facilitator's `/supported`.
- D3: verify, forward, settle. SQLite ledger. Buyer CLI pays x402 URLs on Solana devnet or Base Sepolia.
- D4: Admin API + SSE, founder dashboard, MCP-native x402, per-tool pricing, price advertising in `tools/list`, discovery document, simulated facilitator and one-command demo.
- D5: pay-mcp, Claude's wallet with hard caps. 69 tests.
- D6: Cloudflare Worker edition sharing the core via WASM. 70 tests, 21 parity.
- D7: Release branch, Docker stack, README. Critic review on every PR.
