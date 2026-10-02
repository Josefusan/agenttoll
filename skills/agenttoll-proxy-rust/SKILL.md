---
name: agenttoll-proxy-rust
description: How to build the AgentToll reverse proxy in Rust with axum, hyper and tower: workspace layout, streaming forward, header hygiene, config hot reload, admin API, tests. Use when writing or changing crates/agenttoll-core or crates/agenttoll-gateway.
---
# AgentToll Rust gateway

## Layout
- `crates/agenttoll-core`: `config.rs` (serde YAML + env expansion), `detector.rs`, `pricer.rs` (globset, first match wins), `mcp.rs`, `money.rs` (atomic amounts). Pure, fully unit-tested.
- `crates/agenttoll-gateway`: `main.rs` (clap), `proxy.rs` (hyper client, streaming), `x402.rs` (challenge, verify, settle), `ledger.rs` (sqlx), `admin.rs` (stats + SSE), `reload.rs` (notify + ArcSwap config).

## Dependencies (check latest versions)
axum, hyper, hyper-util, tower, tower-http (trace, timeout), tokio, reqwest (facilitator calls), serde, serde_yaml, serde_json, base64, globset, sqlx (sqlite, postgres), arc-swap, notify, tracing, clap, thiserror. x402: `x402-rs` family (KB-X402-03).

## Proxy rules
- Human verdict or price 0 → forward immediately, stream both ways.
- Remove hop-by-hop headers; set `X-Forwarded-For/Proto/Host`; keep original `Host` unless `preserve_host: false`.
- Strip `PAYMENT-SIGNATURE` before origin; add `X-AgentToll-Paid`, `X-AgentToll-Agent`.
- Pass through 3xx, cookies, compression untouched.
- MCP POST: buffer up to 1 MiB, inspect, replay.
- Timeouts: origin 30 s, facilitator verify 2 s, settle 10 s.

## Tests
- Unit: detector table (≥ 20 cases), pricer globs, money conversions, config env expansion.
- Integration: spin up demo origin + mock facilitator (wiremock) + gateway on random ports; assert human 200, agent 402, paid 200 with PAYMENT-RESPONSE, origin 500 → no settle.
- Bench: human path p50 with `criterion` or a simple loop of 1,000 requests.
