---
name: revenue-dashboard
description: Design and build the AgentToll revenue dashboard: admin API contract, SSE live feed, KPIs, charts, empty states, demo seed data. Use when working in apps/dashboard or the gateway admin endpoints.
---
# Revenue dashboard

## Admin API (gateway, bound to localhost or behind auth token)
- `GET /admin/stats?range=24h|7d|30d` → `{ total_atomic, payments, unique_agents, by_route[], by_agent[], by_network[], unbilled_agent_requests }`
- `GET /admin/settlements?limit=50` → recent rows with explorer URLs
- `GET /admin/events` → SSE, event `settlement` with the ledger row JSON
- Auth: `Authorization: Bearer $AGENTTOLL_ADMIN_TOKEN`

## Screen (single page)
1. KPI row: Revenue today, Paid requests, Unique agents, Unbilled agent requests (upsell).
2. Revenue over time (area), by agent (bar), by route (table), by network (two-segment bar).
3. Live feed: amount, agent, route, network badge, time-ago, signature link. New rows animate in.

## Rules
- Format USD from atomic integers only in UI.
- Empty states that explain how to send the first paid request (show the curl).
- `pnpm seed` posts fake events to a dev-only endpoint for screenshots; never on in production.
