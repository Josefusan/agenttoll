# Decisions log

| Date | Decision | Why | Alternatives considered |
|---|---|---|---|
| 2026-10-02 | Rust gateway is the primary build; Cloudflare Worker is a second edition | Performance, single binary, Website Factory VPS hosting; Worker covers Cloudflare users | Worker-only (locks to Cloudflare), Node proxy (slower, less differentiated) |
| 2026-10-02 | Solana primary, Base secondary | Colosseum Solana track; Solana leads weekly x402 volume (KB-MKT-01); Base has mature EVM x402 tooling | Solana only, Base only |
| 2026-10-02 | Default detection mode `agents-only` | Humans must never see a paywall; spoofed bot UAs only get a price quote | Charge all requests |
| 2026-10-02 | Settle only after origin 2xx | Agents should not pay for errors; builds trust | Settle before forwarding |
| 2026-10-02 | Non-custodial: funds go straight to founder `payTo` | No money-transmitter risk; simpler trust story | Pooled account with payouts |
| 2026-10-02 | Gateway calls the facilitator `/verify` + `/settle` directly with hand-rolled v2 serde types; `x402-axum` is not used in the gateway | `x402-axum` dynamic pricing sees only headers + URI, not method or body, so it cannot price MCP `tools/call` (KB-X402-03). x402-types v2 response types lag the spec (`settlement_pending`, `amount`, `extensions`). The surface is ~6 structs + 3 HTTP calls | (a) x402-axum layers per route; (b) depend on x402-types for request structs only, still open if hand-rolled structs drift |
| 2026-10-02 | Canonical x402 spec source is x402-foundation/x402 | coinbase/x402 README declares itself a development fork of the foundation repo | Keep citing coinbase/x402 |
| 2026-10-02 | Pricer canonicalizes paths (percent-decode, collapse `//`, resolve `..`, drop trailing `/`) before matching | Otherwise `/api/%71uote` falls through a priced route into the free `/*` catch-all | Match raw paths |
| 2026-10-02 | Malformed MCP bodies are rejected (400), not forwarded free | An origin with a lenient JSON parser could run a paid tool the pricer could not see | Forward free and let the origin error |
| 2026-10-02 | Heuristic agent verdicts (curl, headless, missing browser headers) are logged but never charged in `agents-only` mode | Bias to human; only self-declared or verified agents pay. Heuristics feed the "traffic you are not billing yet" report | Charge heuristics at low confidence |
| 2026-10-02 | Prices are quoted decimal strings in YAML (`"0.002"`); bare numbers are rejected | YAML numbers parse as floats; the money path is integer-only (KB-AMT-01) | Accept floats and round |
| 2026-10-02 | Route globs match case-insensitively; normalizer also drops `?query`, `;params` and reads `\` as `/` | Critic D1 risks 1-3: Express/IIS route case-insensitively and servlet containers ignore `;params`, so `/API/quote` or `/api/quote;x=1` would otherwise price cheaper. Over-pricing is harmless because settlement follows origin 2xx | Case-sensitive raw match |
| 2026-10-02 | Gateway sends the origin its own Host by default (`preserve_host: false`); client Host goes in `X-Forwarded-Host` | Hosted origins (Vercel, Netlify) route by Host; D7 deploys in front of one | Preserve Host by default (skill text) |
| 2026-10-02 | Solana `feePayer` is read from the facilitator's `/supported` at startup, overridable per network with `fee_payer` | It differs per facilitator (KB-X402-04); hardcoding breaks when switching facilitators | Hardcode PayAI's fee payer |
| 2026-10-02 | Until D3, a request carrying `PAYMENT-SIGNATURE` on a priced route gets 402 with an explicit error and is never forwarded; v1 `X-PAYMENT` gets a v2-only error | Never forward an unverified payment to the origin | Forward and trust the header |
