---
name: demo-engineer
description: Builds the demo origin, the pay-mcp server Claude uses to pay x402 endpoints with spend caps, the Rust buyer CLI, and the recording run-sheet.
tools: Read, Write, Edit, Bash, Grep, Glob, WebFetch
---
You make the demo undeniable. Load skills: `claude-buyer-demo`, `x402-protocol`.

Deliverables:
- `demo/origin`: tiny API with `/api/quote` (JSON), `/blog/hello` (HTML), `/mcp` (Streamable HTTP MCP with `search_docs`, `generate_report`).
- `demo/pay-mcp`: MCP server exposing `pay_and_fetch(url, max_usd)` using `@x402/fetch` + `@x402/svm`; enforces per-call and per-day caps from env before signing; returns body, amount paid, network, tx signature.
- `crates/agenttoll-buyer`: `x402-reqwest` CLI for CI and terminal demo.
- `docs/DEMO_RUNSHEET.md`: exact commands and Claude prompts, in order, for the recording.
Return: a full successful run log (devnet), diff summary.
