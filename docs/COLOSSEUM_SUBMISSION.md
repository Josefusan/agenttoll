# Colosseum submission: AgentToll

Hackathon: Crypto World's Fair (Colosseum). Deadline 2026-10-12. Final submission opens 2026-10-06 04:00 PDT.
Project page: https://colosseum.com/arena/projects/agenttoll-1

These are the answers saved in the Colosseum project editor on 2026-10-02 (Project details: Complete). Edit here first, then paste.

## Project details

**Project name** (public)
AgentToll

**Brief description** (public, 411/500)
AgentToll is a drop-in paywall proxy that lets any founder charge AI agents per API or MCP request in USDC via x402, while humans keep using the site for free. Point your domain or base URL at the proxy, set per-route or per-tool prices, and agents pay per call with no API keys, signups or invoices. Earnings settle into one spendable stablecoin account. Agents already use your product; now you can bill them.

**Project website** (public)
_Left blank on purpose. Add the deployed demo URL after D7._

**What are you building, and who is it for?** (935/1000)
AgentToll is a drop-in reverse proxy that turns AI agent traffic into revenue. It sits in front of any website, API or MCP server. Humans pass through free and untouched. Agents, crawlers and MCP clients get an HTTP 402 with an x402 price quote, pay per request in USDC, and receive the response in the same round trip: no API keys, signups, invoices or Stripe accounts.

Founders point a domain or base URL at AgentToll (a Rust binary or a Cloudflare Worker), set prices per route or per MCP tool in one YAML file, and watch a live dashboard of agent revenue by route, agent and chain. Earnings settle on-chain to one stablecoin account they control.

It is for indie founders, API and data providers, MCP server authors, publishers and agencies like our own Website Factory, whose landing pages already get crawled by AI agents and earn nothing from it. Demo: Claude hits a paywalled endpoint, pays $0.002 in USDC, and gets the data.

**Why did you decide to build this, and why build it now?** (873/1000)
We run Website Factory, an AI landing-page service. The sites we ship are read constantly by GPTBot, ClaudeBot and agent browsers. That traffic costs bandwidth, gives nothing back, and the only options were to block it or eat it. x402 gives a third option: let agents pay.

Now is the moment because the pieces just landed. x402 v2 is stable with official TypeScript and Rust SDKs, Solana has taken the top spot in weekly x402 volume, PayAI shipped batch settlement on Solana this week, and agents like Claude can already hold wallets and pay through MCP. Cloudflare announced an x402 monetization gateway, but it is waitlist-only and tied to its network. Founders need something open-source they can self-host in five minutes on any stack, multi-chain, with revenue landing in a wallet they own. Every month without it, agent traffic grows and founders capture none of it.

**What technologies are you using or integrating with?** (498/500)
Rust proxy (axum, hyper, x402-rs: x402-axum, x402-chain-solana) plus a Cloudflare Worker build (Hono, @x402/hono, @x402/core, @x402/svm, @x402/evm). x402 v2 exact scheme, USDC on Solana and Base, PayAI/CDP facilitators, Kora gasless fees, Circle CCTP. Web Bot Auth for agent detection. Dashboard: Next.js, Tailwind, shadcn/ui, Supabase, SSE. Demo buyer: Claude with an x402 MCP pay tool and spend caps. Dev/AI tools: Claude Code, Claude Opus subagents, Skillbox, Docker, GitHub Actions, Solana CLI.

**Which chains does your product use?**
Solana, Base

**How does your product use these chains?** (462/500)
Solana is the primary settlement rail: agents pay per request in USDC (SPL) using the x402 exact scheme, verified and settled through a Solana facilitator, with Kora sponsoring fees so agents only hold USDC. Earnings land in one Solana USDC account the founder controls, and every settlement signature is shown on the dashboard. Base is the second rail for EVM-native agents (EIP-3009 USDC); Base earnings can be swept to the same Solana account via Circle CCTP.

**Category** (public)
Developer Infrastructure

**Mobile-focused dApp?**
No

## Location and contact

**Where is your team primarily based?** United States
**Team Telegram contact:** @jdev_1

## Notes for judges

**Did anyone not listed on the team do meaningful work?** (265/600)
No. AgentToll is built by Joseph Clark (Mises) as a solo builder. I used AI coding agents (Claude Code / Claude Opus with specialist subagents) and open-source libraries, including the x402 reference SDKs (coinbase/x402) and x402-rs, which are credited in the repo.

**Anything else judges should know?** (418/500)
AgentToll is open source and self-hostable: one binary or Worker, one YAML price file, no custody, and funds go straight to the founder's wallet. The demo is built to run end to end on Solana devnet and show the real settlement signature on screen. We will dogfood it on Website Factory client sites so every page we ship can earn from agent traffic, which gives us a built-in first distribution channel of real sites.

---

## Media and code (to fill by D9)
- [ ] GitHub repo: https://github.com/Josefusan/agenttoll (public)
- [ ] Demo video (≤ 3 min), script below
- [ ] Pitch video (≤ 3 min): problem, demo clip, market, Website Factory distribution, ask
- [ ] Logo / cover image
- [ ] Project website: deployed demo URL

## Team (to fill by D9)
- [ ] Joseph Clark profile complete (bio, GitHub, X, LinkedIn linkedin.com/in/josephc9)

## Demo video script (≤ 3 min)

| Time | Shot | Voice-over |
|---|---|---|
| 0:00–0:15 | Server log scrolling with GPTBot/ClaudeBot hits on a Website Factory site | "AI agents read your site all day. You pay the bandwidth. They pay nothing." |
| 0:15–0:35 | `agenttoll.yaml`, 6 lines of prices; `docker compose up` | "AgentToll is a drop-in proxy. Point your domain at it and set prices per route or per MCP tool." |
| 0:35–0:50 | Browser opens the page: normal site | "Humans see nothing new. No wallet, no paywall." |
| 0:50–1:40 | Claude Desktop: "Get me today's quote from demo.agenttoll…". Tool call `pay_and_fetch`, 402 shown, pays $0.002, returns data | "Claude hits the endpoint, gets a 402 with an x402 price, pays two-tenths of a cent in USDC on Solana, and gets the data. No API key, no signup." |
| 1:40–2:10 | Dashboard: live event pops, revenue ticks up, by-agent chart, click tx signature to Solana Explorer | "Every payment settles on-chain straight to the founder's wallet. Here is the signature." |
| 2:10–2:35 | MCP tool pricing + Base rail + Worker edition, quick cuts | "Price MCP tools individually. Accept Solana or Base. Run as a Rust binary or a Cloudflare Worker." |
| 2:35–3:00 | Website Factory pages list | "We ship sites for businesses through Website Factory. Every page we ship can now earn from agent traffic. AgentToll: agents already use your product. Now you can bill them." |

## Pre-submit checklist
- [ ] Repo public, README has GIF, quick start works on a clean machine
- [ ] Demo runs end to end on devnet; tx signature visible
- [ ] No keys or `.env` in git history
- [ ] Every claim in the form is true on submit day (update "Why now" numbers if newer data exists)
- [ ] Videos uploaded and linked
- [ ] Joseph clicks Submit
