# AGENTS.md: start here

You are working on **AgentToll**, an x402 paywall proxy that charges AI agents per request in USDC (Solana first, Base second) while humans browse free. Hackathon deadline: **2026-10-12** (Colosseum Crypto World's Fair).

## Read in this order
1. `prompts/opus-5.5-kickoff.md`: mission, acceptance criteria, operating loop (orchestrator reads this fully).
2. `ARCHITECTURE.md`: runtime design (Part 1) and agent org (Part 2).
3. `docs/ROADMAP.md`: what is due today.
4. `docs/KNOWLEDGE_BASE.md`: facts. Retrieve by chunk ID; never guess protocol details.
5. `skills/README.md`: which skill to load for which task.

## Hard rules
- Devnet/testnet only. Mainnet, real spend, public posts and the final Colosseum submit need Joseph's explicit approval.
- No secrets in git. `.env` is gitignored; ship `.env.example`.
- Every change: one vertical slice, tests, critic-gate PASS, then merge.
- Record decisions in `docs/DECISIONS.md`.
- Cite KB chunk IDs (e.g. `// KB-X402-01`) where protocol constants are used.

## Commands (once scaffolded)
```bash
cargo test --workspace
cargo run -p agenttoll-gateway -- --config agenttoll.yaml
cargo run -p agenttoll-buyer -- http://localhost:8402/api/quote
pnpm --dir apps/dashboard dev
docker compose up
```

## Skills
Project skills are in `skills/`. Install them for Claude Code with:
```bash
bash scripts/import-skills.sh   # links skills/ into .claude/skills and pulls external packs
```
