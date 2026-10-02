# AgentToll: what we are doing and how we win

## What we are doing (one paragraph)
We are building **AgentToll**, an open-source drop-in proxy that lets any founder charge AI agents per API or MCP request in USDC via x402, while humans keep using the site free. It runs as a Rust binary or a Cloudflare Worker, prices are set per route or per MCP tool in one YAML file, payments settle on Solana (primary) and Base (secondary) straight into the founder's wallet, and a live dashboard shows agent revenue. The hackathon demo: Claude hits a paywalled endpoint, pays $0.002 in USDC on Solana devnet, gets the data, and the payment appears on the dashboard with its on-chain signature. Entry: Colosseum Crypto World's Fair, deadline **Mon Oct 12, 2026** (final submission opens Oct 6, 04:00 PDT).

## Where we stand (Oct 2)
- Colosseum Project details: all answered and saved (status: Complete). Website left blank until the demo is deployed.
- GitHub: https://github.com/Josefusan/agenttoll (public) with README, ARCHITECTURE, AGENTS, knowledge base, roadmap, decisions, submission doc, 6 subagents, 13 skills, the skill import script, and the Opus 5.5 kickoff prompt.
- Still open on Colosseum: Media and code (repo link, videos, logo), Team profile.

## How judging works (KB-HACK-01)
- Colosseum judges score **product quality** and **innovation potential**; track judges (Solana, Base) add ecosystem feedback.
- Prizes: $30K grand prize, 20 × $15K runner-ups, Solana track 10 × $10K, plus accelerator ($250K pre-seed) consideration.
- Winners look like startups, not hacks: a working demo, a clear buyer, a reason it wins now, a path to users.

## The winning thesis
1. **A demo nobody can argue with.** Live, on-chain, under 3 minutes: human sees normal site → Claude pays two-tenths of a cent → data returns → dashboard ticks → click the Solana Explorer signature. Real transaction, no mocks.
2. **A buyer who exists today.** Founders, API/data sellers, MCP server authors, publishers, and agencies whose pages agents already crawl. We are our own first customer: Website Factory pages run AgentToll.
3. **Why now, with receipts.** x402 v2 SDKs are stable; Solana leads weekly x402 volume; PayAI shipped Solana batch settlement Sep 30; Cloudflare announced a gateway but it is waitlist-only and Cloudflare-locked. We are the open, self-hosted, multi-chain, non-custodial version.
4. **Solana-first, Base-second.** Qualifies for two tracks while keeping one story: earnings end up in one Solana account.
5. **Distribution baked in.** Website Factory ships sites to real businesses; each one can earn from agent traffic from day one. That is the accelerator answer to "how do you get users?"

## Differentiators to say out loud
| Them | Us |
|---|---|
| Cloudflare Monetization Gateway: waitlist, Cloudflare only | Open source, any host, one binary or Worker |
| Per-request x402 demos: single route, hardcoded | Per-route and per-MCP-tool pricing in YAML, hot reload |
| Charges everyone | Humans pass free; agent detection with Web Bot Auth + UA + MCP route |
| Settle first | Settle only after origin 2xx: agents never pay for errors |
| Custodial or one chain | Non-custodial, Solana + Base, one spendable account |
| No visibility | Live revenue dashboard + "agent traffic you are not billing yet" |

## Execution plan (see ROADMAP.md for acceptance per day)
- D1 Sat Oct 3: core (config, detector, pricer) + tests.
- D2 Sun Oct 4: gateway pass-through + 402 on Solana devnet.
- D3 Mon Oct 5: verify → forward → settle; ledger; buyer CLI pays. **First real tx = first proof post.**
- D4 Tue Oct 6: dashboard + SSE. Submission window opens.
- D5 Wed Oct 7: MCP per-tool pricing; Claude pays on camera.
- D6 Thu Oct 8: Base Sepolia rail; Worker edition.
- D7 Fri Oct 9: deploy in front of a Website Factory page; README GIF.
- D8 Sat Oct 10: demo video + pitch video.
- D9 Sun Oct 11: critic sweep, fill Media/Team, final checklist.
- D10 Mon Oct 12: buffer; Joseph submits.
Cut order if behind: Worker → Base → MCP pricing. Never cut: human pass-through, Solana pay path, dashboard, Claude demo.

## Distribution while building (hackathon-distribution skill)
- One proof post per day on X and LinkedIn with a real artifact (curl 402, tx signature, dashboard screenshot, Claude clip).
- Colosseum build log entry each time a slice ships.
- D7 launch thread: problem → 30 s clip → 3-bullet how → repo → ask.
- Drop the demo in Solana and x402 dev communities once it works. Agents draft; Joseph posts.

## Video plan
- **Demo video (≤ 3 min):** script in COLOSSEUM_SUBMISSION.md. Record at 1080p, dashboard and Claude side by side, Explorer click at the end.
- **Pitch video (≤ 3 min):** problem (agents read, founders pay) → demo clip → market timing → Website Factory distribution → what the accelerator money builds (hosted AgentToll, batch settlement, more chains).

## Skills we use and why
| Skill | Role in winning |
|---|---|
| x402-protocol | Correct headers, payloads, verify/settle order: the demo must not break on camera |
| agenttoll-proxy-rust | Fast, single-binary gateway: product quality |
| agenttoll-worker-edge | Shows it runs anywhere, including Cloudflare |
| solana-usdc-settlement | Real devnet USDC settlement and explorer proof: Solana track |
| agent-detection | Humans never see a paywall: the core promise |
| paid-mcp-tools | Per-MCP-tool pricing: the innovation hook for the agent economy |
| revenue-dashboard | Founders see money arrive: the "aha" shot in the video |
| claude-buyer-demo | Claude paying with spend caps: the headline demo |
| critic-gate | Builder never approves own work: fewer demo-day bugs |
| colosseum-submission | Every field, limit and checklist item handled |
| hackathon-distribution | Visibility with judges and the ecosystem during the build |
| skillbox-router / skills-library | Routes each task to the right skill (from Skillbox) |
| Imported: distribution-first-strategy, platform-growth-playbooks, brand-voice-and-authentic-ai-writing, taste-over-slop (distribution-playbook) | Launch method and judge-facing copy quality |
| Imported: hormozi-pitch, offer-stack-builder, founder-content-engine, typesafe-ai (Skillbox) | Pitch framing for the video and accelerator; typed AI decisions |

## Risks and mitigations
| Risk | Mitigation |
|---|---|
| Facilitator down or devnet flaky during recording | Self-hosted Kora facilitator as backup; record early (D5) and re-record later |
| x402 SDK API drift | KB VERIFY tags; agents read current docs before coding |
| Agent detection false positive on a human | Default agents-only, bias to human, 20+ test cases |
| Scope creep | ROADMAP cut list; critic-gate blocks off-slice work |
| Claims in the form go stale | Re-check "why now" numbers on submit day |

## Joseph's to-do list
1. Create two devnet wallets (payTo + buyer), fund the buyer at faucet.circle.com, put pubkeys in `.env`.
2. Start the Opus 5.5 session with `prompts/opus-5.5-kickoff.md`.
3. Approve and post daily proof posts.
4. Record videos D8; fill Media/Team D9; submit D10.
