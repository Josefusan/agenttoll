# AgentToll

**Charge AI agents per request. Keep humans free.**

AgentToll is a drop-in paywall proxy that lets any founder charge AI agents per API or MCP request in USDC via [x402](https://github.com/coinbase/x402), while humans keep using the site for free. Point your domain or base URL at the proxy, set per-route or per-tool prices, and agents pay per call with no API keys, signups or invoices. Earnings settle into one spendable stablecoin account.

> Agents already use your product. Now you can bill them.

Built for the [Colosseum Crypto World's Fair](https://colosseum.com/worldsfair) hackathon (Sep 14 – Oct 12, 2026). Tracks: **Solana** (primary), **Base**.

---

## The 30-second demo

```
Claude ──GET /api/quote──▶ AgentToll ──▶ 402 Payment Required (PAYMENT-REQUIRED: $0.002 USDC on Solana)
Claude ──signs USDC transfer via x402 MCP pay tool (cap: $0.01/call, $0.25/day)
Claude ──GET /api/quote + PAYMENT-SIGNATURE──▶ AgentToll ──verify/settle (facilitator)──▶ origin
Claude ◀── 200 + data + PAYMENT-RESPONSE (Solana tx signature)
Dashboard ◀── SSE: +$0.002 · ClaudeBot · /api/quote · solana-devnet · <sig>
```

A human opening the same URL in a browser gets the normal page. No wallet, no prompt.

## How it works

| Piece | What it does |
|---|---|
| **Gateway** (`crates/agenttoll-gateway`, Rust) | Reverse proxy. Classifies each request (human / agent / MCP), applies the price table, returns x402 `402` challenges, verifies and settles payments through a facilitator, forwards paid requests to the origin, emits a revenue event. |
| **Edge build** (`workers/agenttoll-edge`, Cloudflare Worker) | Same contract on Hono + `@x402/hono` for founders already on Cloudflare. |
| **Price file** (`agenttoll.yaml`) | Per-route and per-MCP-tool prices, chains, `payTo` accounts, free paths, detection mode. |
| **Dashboard** (`apps/dashboard`, Next.js) | Live agent revenue: totals, by route, by agent, by chain, recent settlements with explorer links. |
| **Demo buyer** (`demo/`) | Claude with an x402 payment MCP tool and spend caps, plus a Rust `x402-reqwest` client for CI. |

Full design: [ARCHITECTURE.md](ARCHITECTURE.md).

## Quick start (target UX)

```bash
# 1. Configure
cp agenttoll.example.yaml agenttoll.yaml   # set origin, payTo, prices

# 2. Run the gateway in front of your origin
cargo run -p agenttoll-gateway -- --config agenttoll.yaml   # listens on :8402

# 3. Try it as an agent (devnet USDC)
curl -i -A "ClaudeBot/1.0" http://localhost:8402/api/quote   # -> 402 + PAYMENT-REQUIRED
cargo run -p agenttoll-buyer -- http://localhost:8402/api/quote  # pays, prints data + tx sig

# 4. Watch revenue
pnpm --dir apps/dashboard dev   # http://localhost:3000
```

## Price file

```yaml
origin: https://example.com
listen: 0.0.0.0:8402
detection: agents-only        # agents-only | all-requests | off
facilitator:
  solana: https://facilitator.payai.network
  base: https://x402.org/facilitator   # testnet; CDP for mainnet
accounts:
  solana: <YOUR_SOLANA_USDC_OWNER_PUBKEY>
  base: "0xYourBaseAddress"
routes:
  - match: "GET /api/quote"
    price_usd: "0.002"
  - match: "GET /blog/*"
    price_usd: "0.001"
  - match: "/*"
    price_usd: "0"            # everything else free
mcp:
  endpoint: /mcp
  tools:
    search_docs: "0.005"
    generate_report: "0.05"
```

## Repo map

| Path | Purpose |
|---|---|
| [`AGENTS.md`](AGENTS.md) | Entry point for any coding agent working on this repo |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | System architecture + the build-agent org |
| [`prompts/opus-5.5-kickoff.md`](prompts/opus-5.5-kickoff.md) | RAG-optimized prompt to start the Opus 5.5 orchestrator |
| [`docs/KNOWLEDGE_BASE.md`](docs/KNOWLEDGE_BASE.md) | Chunked, cited facts on x402, Solana, facilitators (retrieval corpus) |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Day-by-day plan to the Oct 12 deadline |
| [`docs/COLOSSEUM_SUBMISSION.md`](docs/COLOSSEUM_SUBMISSION.md) | Form answers, video script, submission checklist |
| [`.claude/agents/`](.claude/agents) | Subagent definitions (proxy, payments, dashboard, demo, critic, launch) |
| [`skills/`](skills) | Project skills (x402, proxy, Solana settlement, detection, MCP pricing, dashboard, demo, critic gate, submission, distribution) |
| [`scripts/import-skills.sh`](scripts/import-skills.sh) | Pulls external/private skill packs (Skillbox, distribution-playbook) into `.claude/skills/` |

## Status

Hackathon build in progress. See [docs/ROADMAP.md](docs/ROADMAP.md).

## Credits

x402 protocol and SDKs: [coinbase/x402](https://github.com/coinbase/x402). Rust x402: [x402-rs](https://github.com/x402-rs/x402-rs). Skill library pattern: [Skillbox](https://github.com/kitze/skillbox) (MIT).

## License

MIT. Built by Joseph Clark ([@Josefusan](https://github.com/Josefusan)).
