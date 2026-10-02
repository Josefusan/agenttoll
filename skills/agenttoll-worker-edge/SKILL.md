---
name: agenttoll-worker-edge
description: How to build the Cloudflare Worker edition of AgentToll with Hono and @x402/hono, matching the Rust gateway's contract. Use when working in workers/agenttoll-edge.
---
# AgentToll Worker edition

- Stack: Hono, `@x402/hono`, `@x402/core`, `@x402/svm`, `@x402/evm`, D1 for ledger, Durable Object or `waitUntil` for settle-after-response bookkeeping.
- Config: same YAML compiled to JSON at build time (`wrangler.toml` vars for payTo, facilitator).
- Detection: port `agenttoll-core` detector rules to TS; share the test table as `fixtures/detector-cases.json` used by both Rust and TS tests.
- Contract parity: identical PAYMENT-REQUIRED for the same config (snapshot test against the Rust output).
- Forward with `fetch(originUrl, request)`; never cache paid responses at the edge for other payers.
- Deploy: `wrangler deploy`; route on a test subdomain only until Joseph approves.
