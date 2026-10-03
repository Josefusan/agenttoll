# AgentToll edge edition (Cloudflare Worker)

The same x402 v2 paywall as `crates/agenttoll-gateway`, running on a Cloudflare Worker: humans
browse free, AI agents pay USDC per request (Solana devnet primary, Base Sepolia backup).
It proves "runs anywhere, including the edge": for the same config it returns byte-identical
`PAYMENT-REQUIRED` challenges, and `test/parity.test.ts` asserts that against the Rust gateway.

## One source of truth

Detection, pricing, path canonicalization, MCP body inspection, config parsing, the discovery
document, `tools/list` price advertising and the canonical replay key are not ported:
`crates/agenttoll-core` (pure Rust, no IO) is compiled to WASM through the thin
`crates/agenttoll-core-wasm` facade (wasm-bindgen) and called from TypeScript. Only the IO
shell is TypeScript, mirroring the gateway file for file:

| Worker file | Rust counterpart |
|---|---|
| `src/gateway.ts` | `agenttoll-gateway/src/lib.rs` (state, HTTP 402 and MCP-native challenges, resource URL, discovery) |
| `src/mcp.ts` | the MCP helpers of `lib.rs` + `pay.rs` (payment in `_meta`, call ids, SSE/JSON success check, receipt) |
| `src/x402.ts` | `agenttoll-gateway/src/x402.rs` (wire types, header encoding) |
| `src/pay.ts` | `agenttoll-gateway/src/pay.rs` (verify → forward → settle, both transports, unconfirmed/pending) |
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
retryable, settle failure withholds content, replay refused, D1 row written. D4 semantics:
settle timeout serves the content and records `status = unconfirmed` (`tx_signature`
`unconfirmed:<hash>`, payment stays claimed), `settlement_pending` records `pending`, a payment
is bound to its `resource.url` (MCP quotes carry `#mcp:<tool>`), a re-encoded header is still a
replay (key = canonical JSON of the signed `payload`), MCP-native challenge on a single
`tools/call` (HTTP 200 tool result with `isError`, `structuredContent`, `PAYMENT-REQUIRED`;
`mcp.challenge: http-402` keeps the 402), payment in `params._meta["x402/payment"]` stripped
before the origin and receipted in `result._meta["x402/payment-response"]`, no settlement for a
JSON-RPC error, `isError`, an SSE error after a notification or a compressed body, and
unsettled 2xx content is returned only when every paid call provably failed; anything
unverifiable (compressed, wrong or duplicate ids) is a 502 with the content withheld, while a
float id echoed as an integer still settles. `Accept-Encoding` is dropped on paid MCP
forwards; `tools/list` price advertising and `GET /.well-known/agenttoll.json`.
`test/parity.test.ts` runs the Rust gateway and the Worker on one config and one mock
facilitator and asserts the decoded and the raw `PAYMENT-REQUIRED` JSON, 402 bodies, the
MCP-native challenge body (byte-identical, host masked), the discovery JSON, the advertised
`tools/list`, verdict headers, refusal reasons (tampered quote, other resource, other tool,
re-encoded replay) and settle decisions (facilitator `/settle` counts for SSE error/success,
gzip and plain tool results) are equal. Everything started is killed in `afterAll`.

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
- **No unbilled-traffic log.** The Rust gateway writes uncharged agent requests to
  `request_log` for the "not billing yet" report; the Worker only logs them to the console.
- **Compressed origin bodies.** workerd decodes `Content-Encoding` transparently but keeps the
  header, so a compressed paid MCP result is never settled and is withheld with a 502 (same
  decision as Rust, which cannot read it at all) — superseded: see "Compressed MCP results".
- **Compressed MCP results (intentional difference).** workerd adds its own `Accept-Encoding`
  to every subrequest and transparently decodes the answer, keeping the `Content-Encoding`
  header, so a compressing origin (Express `compression()`, nginx gzip) always answers
  compressed and the Worker always judges decoded bytes: a compressed success settles and is
  served, a compressed explicit failure is returned unpaid. Rust strips `Accept-Encoding`, never
  sees readable compressed bytes, and withholds (502) anything with `Content-Encoding`. Both
  editions never serve unverifiable content unpaid. Released paid responses drop
  `Content-Encoding` and `Content-Length` so the decoded bytes are labelled correctly.
  workerd also gzips any response to a client that accepts gzip (the tests send
  `Accept-Encoding: identity` to read the Worker's own headers).
- **Timeouts.** `/verify` and `/settle` deadlines cover the request and the body read (a
  facilitator that sends headers then stalls is a timeout: verify → 502 and the payment is
  released, settle → content served and `unconfirmed`). Paid origin requests have a 30 s total
  budget (Rust: 30 s read-inactivity); free traffic streams without a limit.
- **`GET /.agenttoll/ledger` is never for production.** It exists only while
  `AGENTTOLL_DEBUG=1` (tests and local debugging) and is unauthenticated; never set that var on
  a deployed Worker.
- **Migrations vs the lazy schema.** `migrations/0001` + `0002` are the source of truth for a
  deployed D1 (`wrangler d1 migrations apply` before the first request). The Worker also
  creates 0001's table and adds 0002's column lazily, checking `PRAGMA table_info` first so it
  never hits a duplicate column; a database upgraded lazily before `0002` was applied needs
  that migration marked applied, since SQLite has no conditional `ALTER TABLE`.
- **`unconfirmed:<hash>`** uses SHA-256 (first 16 hex) where Rust uses `DefaultHasher`; the id
  only needs to be stable within one edition.
- Not used: Hono and `@x402/hono`. The handler is one `fetch`, and `@x402/hono` prices from
  the route, not the request body, so it cannot price MCP `tools/call` (DECISIONS.md).
