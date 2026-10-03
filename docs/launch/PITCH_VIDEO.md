# Pitch video script (3:00 max)

Status: DRAFT for Joseph to record. Joseph on camera for the open and the close; slides or screen capture in between. Every number carries its knowledge-base id; re-check each one on the day of recording and again on submit day (`docs/KNOWLEDGE_BASE.md`).

Rules for this script: no customers, no revenue, no quotes, no metrics that are not in the KB. Anything about money AgentToll might earn is labelled "plan". The payment clip inherits the variant chosen for the demo video (A real devnet, B simulated); in B the `simulated settlement, no funds moved` label stays in frame for the full clip.

## Structure

| Time | Section | Format |
|---|---|---|
| 0:00 to 0:20 | Problem | Joseph on camera |
| 0:20 to 0:50 | Demo clip | 30 s cut from the demo video, shots 3 and 6 |
| 0:50 to 1:20 | Why now | Slide, four lines, sources on screen |
| 1:20 to 1:45 | Who buys | Slide, four buyers |
| 1:45 to 2:05 | Distribution | Slide: Website Factory |
| 2:05 to 2:30 | Business model (plan) | Slide, four lines, labelled PLAN |
| 2:30 to 2:50 | What the accelerator money builds | Slide, four lines |
| 2:50 to 3:00 | Close and ask | Joseph on camera |

## Script

### 0:00 to 0:20. Problem (Joseph on camera)

On-screen text: `Agents read. Founders pay.`

"I run Website Factory. We ship landing pages for small businesses. Look at the server logs of any site we have shipped and you see GPTBot, ClaudeBot, Perplexity, agent browsers, all day. The founder pays for the bandwidth and the content. The agents pay nothing. Until now the choices were block them or absorb it. AgentToll adds a third: let them pay."

### 0:20 to 0:50. Demo clip

Use the 30 s clip cut from the demo video (shot 3, then shot 6). No new voiceover; keep the demo's own lines. Lower third for the whole clip:

- Variant A: `Solana devnet. $0.002 per request. Settled to the founder's own address.`
- Variant B: `SIMULATED settlement, no funds moved. Demo facilitator from the repo.`

If the clip has to be silent, one line of voiceover: "A person gets the page free. Claude gets a 402, pays two tenths of a cent in USDC inside caps the owner set, gets the data, and the dashboard ticks. Then the same thing for a single MCP tool at its own price."

### 0:50 to 1:20. Why now (slide, sources printed on the slide)

On-screen, four lines with the source under each:

1. `Solana took the top spot for x402 agent payments: about $3.3M USDC settled in one week.` (KB-MKT-01, solanacompass.com)
2. `PayAI opened x402 batch settlement on Solana in public preview on 2026-09-30.` (KB-SOL-03)
3. `Cloudflare opened a waitlist for an x402 Monetization Gateway on 2026-07-01, for Cloudflare customers only.` (KB-MKT-01)
4. `Coinbase's own Payments MCP already pays x402 on Solana, so agent wallets exist today.` (KB-PAY-06)

Voiceover: "Why now. The rails just landed. x402 version two is specified with HTTP and MCP transports and the Rust crates are at 2.0.2. Solana took the top spot for x402 agent payments with about three point three million dollars of USDC settled in one week. PayAI opened batch settlement on Solana this week, which is the path for sub-cent traffic at volume. Cloudflare announced a monetization gateway in July, but it is waitlist-only and tied to their network. And agents can already hold wallets: Coinbase's Payments MCP pays x402 on Solana today. The demand signal is public. The open, self-hosted, non-custodial version was not built. So we built it."

### 1:20 to 1:45. Who buys (slide)

On-screen, four rows:

| Buyer | What they get |
|---|---|
| API or data founder | A price per call any agent can pay in seconds, no signup, no key issuing |
| Publisher or docs site | Agents pay to read, people read free, plus a report of the agent traffic they are not billing yet |
| MCP server author | A price per tool; `initialize` and `tools/list` stay free |
| Agency | Agent revenue as a line item on every client site, funds to the client's own address |

Voiceover: "Who buys. Four kinds of seller whose product agents already use. An API founder who cannot bill two tenths of a cent through a card processor and cannot issue an API key to an agent that found the endpoint ten seconds ago. A publisher who wants people reading free and bots paying per page. An MCP server author who pays for compute while agents call tools for nothing. And agencies like ours. None of them need a billing system, a signup flow or a card processor account. They need one YAML file and an address."

Honesty note for Joseph: these are buyer types, not customers. Do not say "our customers" or name anyone.

### 1:45 to 2:05. Distribution (slide: Website Factory)

On-screen: `Website Factory ships the sites. AgentToll rides along.` Under it: `Gateway on the agency VPS or the Worker edition, in front of the client's Vercel origin. pay_to = the client's address.`

Voiceover: "Distribution is built in. Website Factory already ships sites to real businesses. We run the gateway for them, point the domain at it, set pay_to to the client's own address, and hand them the dashboard. The client never runs a binary and never touches crypto they did not ask for. That is our path to the first hundred sites, and the first hundred sites are where the pricing data comes from."

Honesty note: as of 2026-10-03 no client site runs AgentToll. Say "we run" only if a deployment exists on recording day; otherwise say "we will run".

### 2:05 to 2:30. Business model (slide, header reads PLAN, no revenue yet)

On-screen, labelled `PLAN. Open-source core stays free. No take rate in the gateway.`:

1. `Hosted AgentToll: we run gateway and dashboard; flat monthly tier plus a fee on settled volume, billed off-chain. pay_to stays the founder's.`
2. `Payout destinations: the founder's own off-ramp account as pay_to, with a threshold sweeper.`
3. `Agency bundle: AgentToll on every Website Factory site, dashboard per client, line item on the retainer.`
4. `Pro dashboard: multi-site, exports, alerts, the unbilled-traffic report.`

Voiceover: "How we make money, and I will label this a plan because there is no revenue yet. The core is MIT and non-custodial, so it stays free. We charge for convenience and scale, never by standing between the seller and their funds. A hosted edition for founders who will not run a binary. Payout destinations so earnings land as dollars through off-ramp partners, always in the founder's own account. The agency bundle. And a pro dashboard for publishers and MCP authors with real volume."

### 2:30 to 2:50. What the accelerator money builds (slide)

On-screen, four lines:

1. `Hosted AgentToll: multi-tenant gateway, Postgres ledger, one dashboard per site.`
2. `Batch settlement: x402 payment channels on Solana mainnet for sub-cent, high-frequency traffic.`
3. `Off-ramp partners: payout destinations created in the founder's own account, non-custodial, operated by Clark Technology Ventures.`
4. `More chains: the gateway has no chain-specific money logic, the facilitator does the chain work.`

Voiceover: "What the money builds. Hosted AgentToll, so a founder gets a URL instead of a Docker file. Batch settlement on Solana mainnet, using the payment channels PayAI just opened, so a thousand two-tenths-of-a-cent reads settle as one claim. Off-ramp partners, so revenue becomes dollars without AgentToll ever holding funds. And more chains, which is cheap for us because the facilitator does the chain work and the gateway only enforces the rules."

### 2:50 to 3:00. Close and ask (Joseph on camera)

On-screen: `github.com/Josefusan/agenttoll` and `Agents already use your product. Now you can bill them.`

"Everything you saw is open source and runs with one command, no wallet needed. The repo is linked. Put it in front of something agents already read and tell us what breaks. Agents already use your product. Now you can bill them."

## Production notes

- Record Joseph's two camera sections first, in one sitting, so the open and close match.
- Slides: dark background, teal accent `#22A6AD` (the dashboard's accent), one idea per slide, sources in a smaller line under each claim. No stock imagery.
- Export at 1080p. Upload unlisted. Link it in `docs/COLOSSEUM_SUBMISSION.md`.
- Numbers to re-check before recording and again on submit day: the $3.3M weekly figure (KB-MKT-01), the PayAI date (KB-SOL-03), the Cloudflare waitlist date (KB-MKT-01), the x402-rs crate version 2.0.2 (KB-X402-03).
