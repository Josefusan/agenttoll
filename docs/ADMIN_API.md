# Admin API

The gateway serves the founder dashboard from a second listener, `admin_listen` (default
`127.0.0.1:8403`). It is off unless `AGENTTOLL_ADMIN_TOKEN` is set to at least 24 characters.
Every request needs `Authorization: Bearer <token>`; `/admin/events` also accepts `?token=`
because browser `EventSource` cannot set headers. Keep the token server-side (the dashboard's
Next.js route handlers proxy it).

## `GET /admin/stats`

```json
{ "totals": { "revenue_atomic": 6000, "payments": 3, "unique_agents": 2, "unbilled_agent_requests": 41 },
  "by_route":   [{ "route": "GET /api/quote", "revenue_atomic": 4000, "payments": 2 }],
  "by_agent":   [{ "agent": "ClaudeBot", "revenue_atomic": 4000, "payments": 2 }],
  "by_network": [{ "network": "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", "revenue_atomic": 6000, "payments": 3 }],
  "unbilled":   [{ "agent": "GPTBot", "reason": "ua:GPTBot", "requests": 30 }],
  "recent":     [RevenueEvent] }
```

Groups are the top 20 by revenue (or requests); `recent` is the newest 50 payments.
`unbilled` counts agent and bot requests that were not charged (free routes, heuristic
verdicts, search bots). Human requests are never logged.

## `GET /admin/events`

`text/event-stream`. One `event: revenue` per recorded payment, `data:` = RevenueEvent JSON.
Comment heartbeats every 15 s. A slow reader skips missed events; re-read `/admin/stats`.

## RevenueEvent

| Field | Type | Notes |
|---|---|---|
| `ts` | int | Unix milliseconds |
| `route` | string | Route pattern that matched (`GET /api/*`) or `mcp:<tool>` |
| `mcp_tool` | string or null | Tool name for MCP calls |
| `agent_name` | string or null | Declared or detected agent |
| `detect_reason` | string | Detector rule, e.g. `ua:ClaudeBot`, `payment-header`, `mcp-endpoint` |
| `network` | string | CAIP-2 |
| `asset` | string | USDC mint or contract |
| `amount_atomic` | int | 6-decimal USDC units (2000 = $0.002) |
| `payer` | string or null | Payer address from the facilitator |
| `tx_signature` | string | Chain signature; `SIMULATED-*` or `unconfirmed:*` otherwise |
| `origin_status` | int | HTTP status from the origin |
| `latency_ms` | int | Gateway time for the paid request |
| `simulated` | bool | Settled by the local simulated facilitator: no chain, no money, no explorer link |
| `status` | string | `settled`, `pending` (`settlement_pending`, confirming) or `unconfirmed` (settle timed out after serving; no explorer link) |
