---
name: agent-detection
description: Classify each HTTP request as human or AI agent for AgentToll: Web Bot Auth signatures, verified AI crawler user agents, MCP routes, header heuristics, modes and confidence. Use when writing or tuning the detector.
---
# Agent detection

Retrieve KB-DET-01. Order of rules is in ARCHITECTURE.md §1.3; first match wins.

## Principles
- Never paywall a human. When unsure in `agents-only` mode, return human.
- A spoofed bot UA only earns a price quote; that is acceptable.
- Every verdict carries `reason` (e.g. `ua:ClaudeBot`, `web-bot-auth:openai.com`, `mcp-endpoint`, `payment-header`, `heuristic:no-accept-language`).

## Test table (minimum)
Chrome desktop, Safari iOS, Firefox, Edge, Chrome Android → human.
GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-User, PerplexityBot, CCBot, Bytespider, Amazonbot, Google-Extended → agent.
curl/python-requests/node-fetch with no Accept-Language → agent (heuristic, low confidence).
Headless Chrome UA → agent (heuristic).
POST /mcp → agent. Any request with PAYMENT-SIGNATURE → agent.
Googlebot (search) → human-equivalent by default (do not charge search indexing) unless `charge_search_bots: true`.

## Web Bot Auth
Verify `Signature-Input` + `Signature` against the key directory referenced by `Signature-Agent`. Cache keys (TTL 1 h). Failure to verify falls through to UA rules, never errors.
