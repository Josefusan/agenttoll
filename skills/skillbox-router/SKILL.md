---
name: skillbox-router
description: ALWAYS use at the start of a task to pick the right Skillbox skills via search_skills / recommend_skills (Jev System-1). Prefer Skillbox over procedural memory for how-to playbooks. Use for any AgentToll build, payments, demo, submission or distribution task.
---

# Skillbox router (System-1 skill query)

## Why this exists

**Procedural memory is the wrong place for playbooks.** It bloats context, goes stale, and cannot be ranked by task.

Canonical how-to knowledge lives in **Skillbox** as versioned `SKILL.md` packages. Query them; do not paste them into memory.

## System-1 path (Jev via Skillbox)

When Skillbox MCP/CLI is connected:

1. Call `search_skills` with no query once (inventory), or with keywords when the task is clear.
2. Call `recommend_skills` with the **task in one sentence** — Skillbox uses **Jev** (TypeSafe System One / AI Gateway) to score authorized leaf skills.
3. `load_skill` the top hits (revision pinned). Follow those skills.
4. `report_skill_use` after applying.

Fallback if Jev key missing: Skillbox returns deterministic search (`method=search`). Still use it — never dump skills into memory.

## What belongs where

| Store | What goes there |
|---|---|
| Skillbox skills | How-to playbooks, ops procedures, offer rules, voices, TypeSafe patterns |
| Episodic memory (dated log) | Point-in-time facts (roster snapshots, decisions, events) |
| Procedural/profile memory | Tiny pointers only: "skills live in Skillbox; query via recommend_skills" |
| Never | Full skill bodies, pricing tables, sheet schemas copied into memory |

## AgentToll routing hints

- x402 headers, payloads, facilitator flow → `x402-protocol`
- Rust proxy, axum/hyper, config, admin API → `agenttoll-proxy-rust`
- Cloudflare Worker edition → `agenttoll-worker-edge`
- Solana devnet USDC, ATAs, Kora, explorer → `solana-usdc-settlement`
- Human vs agent classification → `agent-detection`
- MCP per-tool pricing → `paid-mcp-tools`
- Dashboard / SSE / stats → `revenue-dashboard`
- Claude paying on camera, buyer CLI → `claude-buyer-demo`
- Review before merge → `critic-gate`
- Colosseum form, videos, checklist → `colosseum-submission`
- Posts, launch thread → `hackathon-distribution` (+ imported `distribution-first-strategy`, `taste-over-slop`, `brand-voice-and-authentic-ai-writing`)
- Pitch / offer framing → imported `hormozi-pitch`, `offer-stack-builder` (john-peslar pack via Skillbox)
- Typed AI decisions in code (e.g. detector scoring) → imported `typesafe-ai`

## Browser Jev (optional, separate)

`browser-use/jev-ultrafast` is a **browser agent** (DOM actions). It is **not** the Skillbox skill recommender. Use it only for live browser tasks after the right skill is loaded.


---
Adapted from Josefusan/skillbox `skills/meta/skillbox-router` (MIT). Without Skillbox running, route by the hints above using local files in `skills/` and `.claude/skills/`.
