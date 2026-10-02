# AgentToll edge edition (Cloudflare Worker)

The same x402 v2 paywall as `crates/agenttoll-gateway`, running on a Cloudflare Worker: humans
browse free, AI agents pay USDC per request (Solana devnet primary, Base Sepolia backup).
It proves "runs anywhere, including the edge": for the same config it returns byte-identical
`PAYMENT-REQUIRED` challenges, and `test/parity.test.ts` asserts that against the Rust gateway.

## One source of truth

Detection, pricing, path canonicalization, MCP body inspection and config parsing are not
ported: `crates/agenttoll-core` (pure Rust, no IO) is compiled to WASM through the thin
`crates/agenttoll-core-wasm` facade (wasm-bindgen) and called from TypeScript. Only the IO
shell is TypeScript, mirroring the gateway file for file:

| Worker file | Rust counterpart |
|---|---|
| `src/gateway.ts` | `agenttoll-gateway/src/lib.rs` (state, challenge, resource URL) |
| `src/x402.ts` | `agenttoll-gateway/src/x402.rs` (wire types, header encoding) |
| `src/pay.ts` | `agenttoll-gateway/src/pay.rs` (verify → forward → settle) |
| `src/facilitator.ts` | `agenttoll-gateway/src/{facilitator,supported}.rs` |
| `src/proxy.ts` | `agenttoll-gateway/src/proxy.rs` (header hygiene, streaming) |
| `src/replay.ts` | `ReplayGuard` in `pay.rs` |
| `src/ledger.ts` + `migrations/` | `agenttoll-gateway/src/ledger.rs` (D1 instead of SQLite) |
| `src/core/` (built) | `agenttoll-core` via `agenttoll-core-wasm` |

## Run

```bash
export PATH=$HOME/.local/bin:$HOME/.cargo/bin:$PATH   # node, cargo, wasm-pack
rustup target add wasm32-unknown-unknown               # once
cd workers/agenttoll-edge
npm install
npm run build:wasm        # builds src/core/ from crates/agenttoll-core-wasm (gitignored)
cp .dev.vars.example .dev.vars && $EDITOR .dev.vars    # origin + payTo wallets
npm run dev               # wrangler dev --local on http://localhost:8787
```

Config is `agenttoll.edge.yaml` (same schema as the repo's `agenttoll.example.yaml`; `listen` and
`admin_listen` are ignored). `${VAR}` placeholders come from `[vars]`, `.dev.vars` or secrets;
`AGENTTOLL_CONFIG` (the YAML text as a var) replaces the bundled file. Deploy is
`wrangler deploy` after `wrangler d1 create agenttoll-ledger` and pasting the id into
`wrangler.toml`; not done in this lane (no Cloudflare account, and nothing goes live without
Joseph's approval).

## Tests

```bash
npm test                  # unit + e2e in wrangler's local runtime + parity vs the Rust gateway
npm run test:parity       # parity only (builds and spawns cargo's agenttoll-gateway)
npm run typecheck
cargo test -p agenttoll-core-wasm   # the facade's native unit tests
```

`test/edge.test.ts` mirrors `crates/agenttoll-gateway/tests/{gateway,payments}.rs`: human 200,
ClaudeBot 402 with a decodable header and the same JSON body, fee payer read from the
facilitator's `/supported`, path tricks priced, MCP per tool and per batch, malformed MCP 400
and oversized 413, tampered quote refused before `/verify`, origin 500 never settled and
retryable, settle failure withholds content, replay refused, D1 row written.
`test/parity.test.ts` runs the Rust gateway and the Worker on one config and one mock
facilitator and asserts the decoded and the raw `PAYMENT-REQUIRED` JSON, bodies, verdict
headers and refusal reasons are equal (host masked). Everything started is killed in `afterAll`.

## Gaps vs the Rust gateway

- **Replay guard is per isolate.** Cloudflare runs many isolates; a replay landing elsewhere is
  caught only by the facilitator's nonce rules. KV is eventually consistent and would not
  close this; a Durable Object would (follow-up).
- **`preserve_host` cannot be honored.** A Worker cannot set `Host` on an outbound fetch; the
  client host always travels in `X-Forwarded-Host`.
- **`Connection`-listed hop-by-hop names** are consumed by workerd before the Worker runs, so
  only the fixed hop-by-hop list is stripped.
- **No admin API / SSE feed.** The ledger is D1 (`revenue_events`, same columns as
  ARCHITECTURE.md §1.6); the dashboard would read D1 directly. `GET /.agenttoll/ledger` exists
  only when `AGENTTOLL_DEBUG=1`.
- **Fee payer is resolved lazily** on the first priced request (per isolate) instead of at
  startup; if `/supported` fails the request gets 502 and the next one retries.
- Not used: Hono and `@x402/hono`. The handler is one `fetch`, and `@x402/hono` prices from
  the route, not the request body, so it cannot price MCP `tools/call` (DECISIONS.md).
