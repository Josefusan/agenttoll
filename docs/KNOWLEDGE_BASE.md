---
title: AgentToll knowledge base
purpose: Retrieval corpus for build agents. One fact cluster per chunk. Cite chunk IDs in code comments, PRs and DECISIONS.md.
updated: 2026-10-02 (VERIFY chunks checked upstream the same day)
rules:
  - Chunks marked VERIFY must be checked against the linked source before code depends on them. After checking, remove the VERIFY tag and add "verified: <date>".
  - Never invent addresses, mints, URLs or header names. If it is not here and not in an upstream spec, look it up and add a chunk.
---

# AgentToll knowledge base

## Index

| ID | Topic |
|---|---|
| KB-X402-01 | x402 v2 headers and flow |
| KB-X402-02 | x402 TypeScript packages |
| KB-X402-03 | x402 Rust crates (x402-rs) |
| KB-X402-04 | Facilitators |
| KB-X402-05 | MCP and x402 |
| KB-X402-06 | x402 v2 JSON shapes and facilitator API |
| KB-X402-07 | Solana exact scheme (SVM) rules |
| KB-SOL-01 | Solana network IDs and USDC mints |
| KB-SOL-02 | Kora gasless fee payment |
| KB-SOL-03 | PayAI batch settlement (payment channels) |
| KB-BASE-01 | Base network IDs and USDC |
| KB-DET-01 | Web Bot Auth and AI crawler user agents |
| KB-MKT-01 | Market timing and competitors |
| KB-DEMO-01 | Prior art: Claude paying an x402 paywall |
| KB-HACK-01 | Colosseum Crypto World's Fair facts |
| KB-AMT-01 | Amount math |

---

### KB-X402-01: x402 v2 headers and flow
- Server answers an unpaid request with HTTP `402` and header `PAYMENT-REQUIRED` = base64-encoded `PaymentRequired` JSON (accepted schemes, networks, asset, amount, `payTo`).
- Client retries with header `PAYMENT-SIGNATURE` = base64-encoded `PaymentPayload`.
- Server returns header `PAYMENT-RESPONSE` = base64-encoded settlement response JSON.
- v1 used `X-PAYMENT` / `X-PAYMENT-RESPONSE` and a JSON 402 body. Support v2 first; accept v1 only if trivial with the SDK.
- Scheme for fixed price per call: `exact`.
- Status mapping: 402 = payment required or failed (also sent with `PAYMENT-RESPONSE` when settle fails), 400 = malformed payload, 500 = server error.
- `EXTENSION-RESPONSES` (base64 JSON) is facilitator → resource server only. Never forward it to buyers.
- Canonical repo moved: coinbase/x402 is now a development fork of **x402-foundation/x402**. Use the foundation `specs/`.
- verified: 2026-10-02. Source: https://github.com/x402-foundation/x402/tree/main/specs/transports-v2/http.md

### KB-X402-02: x402 TypeScript packages
- `@x402/core`, `@x402/evm`, `@x402/svm`, `@x402/stellar`, `@x402/fetch`, `@x402/axios`, `@x402/express`, `@x402/hono`, `@x402/next`, `@x402/fastify`, `@x402/paywall`, `@x402/extensions`.
- Worker edition uses `@x402/hono` + `@x402/svm` + `@x402/evm`. Buyer MCP tool uses `@x402/fetch`.
- PayAI batch settlement requires `@x402/core` and `@x402/svm` >= 2.28.0 (see KB-SOL-03).
- Source: https://github.com/coinbase/x402

### KB-X402-03: x402 Rust crates (x402-rs)
- Versions (crates.io, verified: 2026-10-02): `x402-axum`, `x402-reqwest`, `x402-types`, `x402-chain-solana`, `x402-chain-eip155`, `x402-facilitator-local` all **2.0.2**; edition 2024, MSRV 1.93.
- `x402-axum`: axum middleware that protects routes with price tags.
- `x402-reqwest`: client that pays transparently.
- `x402-chain-solana`: Solana support. EVM via EIP-155 types. Supports x402 v1 and v2.
- Facilitator: `x402-facilitator-local`, Docker image on GHCR; hosted at https://facilitator.x402.rs/
- Pattern (from README, adapt to current API):
  ```rust
  let x402 = X402Middleware::new("https://facilitator.example");
  let app = Router::new().route("/paid", get(handler).layer(
      x402.with_price_tag(V2Eip155Exact::price_tag(address!("0x..."), USDC::base_sepolia().amount(10u64)))));
  ```
- Dynamic pricing EXISTS but is body-blind: `X402Middleware::with_dynamic_price(|headers, uri, base_url| async {..})` (`x402-axum/src/layer.rs`). No method, body or state, so it cannot price MCP `tools/call`. Decision 2026-10-02: the gateway calls the facilitator directly (see DECISIONS.md).
- Reusable: `x402_types::proto::v2::{PaymentRequired, PaymentRequirements, PaymentPayload, ResourceInfo}`; `x402_axum::facilitator_client::FacilitatorClient`. Caveat: v2 `SettleResponse`/`VerifyResponse` in x402-types are v1 aliases that drop `amount`/`extensions` and the `settlement_pending` code.
- Buyer: `x402-reqwest` + `x402_chain_solana::V2SolanaExactClient::new(keypair, RpcClient)` (feature `client`).
- Source: https://github.com/x402-rs/x402-rs, https://docs.rs/x402-axum, https://docs.rs/x402-chain-solana

### KB-X402-04: Facilitators
- Facilitator endpoints: `/verify`, `/settle` (and `/supported`). The resource server never needs chain RPC for the exact scheme if the facilitator settles.
- Options:
  - x402.org facilitator (Coinbase, testnets only): `https://x402.org/facilitator`
  - Coinbase CDP facilitator (mainnet, API key)
  - PayAI facilitator (Solana + EVM, mainnet + devnet): `https://facilitator.payai.network`
  - x402-rs hosted facilitator: `https://facilitator.x402.rs/`
  - Self-hosted: x402-rs Docker, or Solana's Kora-based facilitator guide (KB-SOL-02)
- Pick per chain in `agenttoll.yaml`. Demo default: Solana devnet via PayAI or self-hosted Kora facilitator.
- Live `GET /supported` (verified: 2026-10-02): all three list v2 `exact` on `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` and `eip155:84532`. No API key needed on testnets.

  | Facilitator | Solana devnet `feePayer` (from `kinds[].extra.feePayer`) |
  |---|---|
  | facilitator.payai.network | `2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4` (also returns `recentBlockhash`) |
  | x402.org/facilitator | `CKPKJWNdJEqa81x7CkZ14BVPiY6y16Sxs7owznqtWYp5` |
  | facilitator.x402.rs | `C7ckEzH4varMpBQsaD9bJZSCnWVyk4zAKYA85spuuNbR` |

  Read `feePayer` from `/supported` at startup; do not hardcode it.
- Sources: https://stablecoininsider.org/how-to-choose-an-x402-facilitator-for-usdc/, https://solana.com/developers/guides/getstarted/build-a-x402-facilitator

### KB-X402-05: MCP and x402
- MCP Streamable HTTP is JSON-RPC over HTTP POST. A paid tool call is `{"method":"tools/call","params":{"name":"<tool>",...}}`.
- AgentToll prices at the HTTP layer: inspect the POST body, price by tool name, return 402 for unpaid `tools/call`. Keep `initialize`, `notifications/*`, `tools/list` free.
- MCP-native transport EXISTS (`specs/transports-v2/mcp.md`, verified: 2026-10-02):
  - Challenge: tool result `isError: true` with `PaymentRequired` in `structuredContent` and as a JSON string in `content[0].text`.
  - Payment: client retries `tools/call` with `params._meta["x402/payment"]` = PaymentPayload **object** (not base64).
  - Receipt: `result._meta["x402/payment-response"]` = SettlementResponse.
  - If settlement fails after the tool ran, the tool content must not be returned.
- AgentToll plan: HTTP 402 path first (works with any x402 HTTP client); MCP-native path as the D5 innovation hook.
- Source: https://github.com/coinbase/x402/tree/main/specs, https://modelcontextprotocol.io

### KB-X402-06: x402 v2 JSON shapes and facilitator API
- `PaymentRequired`: `{x402Version: 2, error?, resource: {url, description?, mimeType?, serviceName?, tags?, iconUrl?}, accepts: [PaymentRequirements], extensions?}`.
- `PaymentRequirements`: `{scheme, network, amount, asset, payTo, maxTimeoutSeconds, extra}`. The field is **`amount`** (string, atomic); `maxAmountRequired` is v1 only. Reserved `extra` keys: `assetTransferMethod`, `paymentFlow` (`authorization` default = verify → resource → settle; `upfront`; `escrow`).
- `PaymentPayload`: `{x402Version: 2, resource?, accepted: PaymentRequirements, payload: {...}, extensions?}`. SVM payload `{transaction: <base64 partially signed versioned tx>}`; EVM payload `{signature, authorization: {from,to,value,validAfter,validBefore,nonce}}`.
- `SettlementResponse`: `{success, transaction, network, payer?, errorReason?, amount?, extensions?}`. `transaction` is the base58 signature on Solana, `""` if not broadcast. `settlement_pending` is non-terminal and requires a non-empty `transaction`.
- Facilitator: `POST /verify` and `POST /settle` take `{x402Version: 2, paymentPayload, paymentRequirements}`. `/verify` → `{isValid, invalidReason?, payer?}` (read-only). `/settle` → SettlementResponse. `GET /supported` → `{kinds: [{x402Version, scheme, network, extra?}], extensions, signers}`.
- verified: 2026-10-02. Sources: https://github.com/x402-foundation/x402/tree/main/specs/x402-specification-v2.md, https://github.com/x402-foundation/x402/tree/main/specs/transports-v2/http.md

### KB-X402-07: Solana exact scheme (SVM) rules
- `extra`: `{feePayer (REQUIRED), memo? (≤ 256 B), recentBlockhash?, lastValidBlockHeight?}`. `feePayer` may equal `payTo`.
- Client tx: 3–6 instructions in order: SetComputeUnitLimit, SetComputeUnitPrice (≤ 5 µlamports/CU in the reference impl), SPL `TransferChecked` payer ATA → ATA(payTo, asset) for exactly `amount`, optional Lighthouse, and a **required Memo** (`extra.memo` or a ≥ 16-byte hex nonce).
- Fee payer must not appear in any instruction's accounts. Client signs as transfer authority only; the facilitator co-signs at `/settle`.
- The destination ATA must already exist on devnet. Create it before the demo.
- Blockhash expires in ~60–90 s: prefer verify → forward → settle with short origin timeouts, or `upfront` for slow handlers.
- Replay guard: keep a 120 s in-memory cache keyed on the payload and reject duplicates with `duplicate_settlement`. **Implement in the gateway.**
- verified: 2026-10-02. Source: https://github.com/x402-foundation/x402/tree/main/specs/schemes/exact/scheme_exact_svm.md

### KB-SOL-01: Solana network IDs and USDC mints
- CAIP-2 Solana mainnet: `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`
- CAIP-2 Solana devnet: `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`
- USDC mint mainnet: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
- USDC mint devnet (Circle): `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`
- Devnet USDC faucet: https://faucet.circle.com
- Payment lands in the `payTo` owner's associated token account (ATA) for the mint. Ensure the ATA exists before the demo.
- Explorer links: `https://explorer.solana.com/tx/<sig>?cluster=devnet`
- verified: 2026-10-02. Sources: x402 v2 spec §11.1; https://developers.circle.com/stablecoins/usdc-contract-addresses

### KB-SOL-02: Kora gasless fee payment
- Kora is a Solana fee-relayer: it pays SOL fees so agents only need USDC. Solana's official guide builds an x402 facilitator on Kora.
- Use when self-hosting the Solana facilitator for the demo.
- Source: https://solana.com/developers/guides/getstarted/build-a-x402-facilitator

### KB-SOL-03: PayAI batch settlement (payment channels)
- Public preview launched 2026-09-30. Buyer funds a channel once (0.01–100 USDC); merchant accumulates signed vouchers; a claim job sweeps totals on-chain.
- Modes: client-signed vouchers or server-mode delegation. Buyer can withdraw unclaimed balance after a 15 min – 24 h grace period. PayAI sponsors channel setup and fees.
- Requires `@x402/core` + `@x402/svm` 2.28.0 and durable storage (Redis or Postgres). USDC on Solana mainnet only; 1,000 sponsored channel cap; max 4 channels per claim tx.
- Program: `CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX` (Solana Foundation payment-channels).
- AgentToll relevance: stretch goal "batch mode" for sub-cent, high-frequency agent traffic. Not demo-critical (mainnet only).
- Source: https://solanacompass.com/news/payai-launches-x402-batch-settlement-on-solana-in-public-preview-bundling-usdc-micropayments-into-channel-claims

### KB-BASE-01: Base network IDs and USDC
- CAIP-2 Base mainnet: `eip155:8453`. Base Sepolia: `eip155:84532`.
- USDC Base mainnet: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`.
- USDC Base Sepolia: `0x036CbD53842c5426634e7929541eC2318f3dCF7e` (verified: 2026-10-02, Circle docs). EVM `extra`: `{"name":"USDC","version":"2"}`
- EVM exact scheme uses EIP-3009 `transferWithAuthorization` (gasless for payer; facilitator submits).
- Source: https://dev.to/revnuvo/how-we-built-x402-v2-paid-apis-on-cloudflare-workers-3-settled-transactions-real-usdc-zero-auth-20c5

### KB-DET-01: Web Bot Auth and AI crawler user agents
- Web Bot Auth: bots sign requests with HTTP Message Signatures (RFC 9421). Headers: `Signature`, `Signature-Input`, `Signature-Agent` (points to the bot's key directory). Cryptographic, unlike spoofable UAs. Current draft: `draft-ietf-webbotauth-httpsig-protocol-00` (2026-09-01). Params: `tag="web-bot-auth"`, `created`, `expires` (≤ 24 h), `keyid` (JWK SHA-256 thumbprint), `alg`. Key directory: `/.well-known/http-message-signatures-directory`. verified: 2026-10-02 from the datatracker summary; read the raw draft before implementing verification.
- UA strings to treat as agents: `GPTBot`, `OAI-SearchBot`, `ChatGPT-User`, `ClaudeBot`, `Claude-User`, `Claude-SearchBot`, `PerplexityBot`, `Perplexity-User`, `Google-Extended`, `CCBot`, `Bytespider`, `Amazonbot`, `Applebot-Extended`, `meta-externalagent`.
- UA-only detection is spoofable; a spoofer who claims to be a bot just gets a price quote, so false positives cost humans nothing only if browsers are never flagged. Bias toward "human" when unsure in `agents-only` mode.
- Sources: https://suganthan.com/blog/x402-pay-per-crawl/, https://zenn.dev/jphfa/articles/x402-ai-crawler-monetization?locale=en

### KB-MKT-01: Market timing and competitors
- Solana took the top spot for x402 agent payments with about $3.3M USDC settled in one week (Solana Compass). Source: https://solanacompass.com/news/solana-claims-top-spot-on-x402-as-ai-agents-settle-33m-usdc-in-a-single-week
- Cloudflare Monetization Gateway: x402 pay-per-request for pages, APIs, datasets and MCP tools at Cloudflare's edge; waitlist opened 2026-07-01; Cloudflare customers only. Source: https://www.explainx.ai/blog/cloudflare-monetization-gateway-x402-mcp-api-micropayments-2026
- AgentToll's wedge vs Cloudflare: open source, self-hosted, any host (Vercel, VPS, Fly, Cloudflare), Solana-first multi-chain, non-custodial, per-MCP-tool pricing, founder-facing revenue dashboard, built-in Website Factory distribution.
- Other prior art: Cloudflare Worker x402 demos (codemonkeycxy/x402-paywall-demo), Hono AI-crawler paywalls.

### KB-DEMO-01: Prior art: Claude paying an x402 paywall
- A blog demo had Claude Code pay x402 pages using a hook: on 402, a script fetched the offer, checked caps ($0.05/call, $0.25/day), paid testnet USDC on Base Sepolia via x402.org facilitator, returned content to Claude.
- AgentToll demo upgrades this: MCP tool `pay_and_fetch` (works in Claude Desktop, Claude Code, any MCP client), Solana devnet first, settlement signature visible on the dashboard.
- Source: https://suganthan.com/blog/x402-pay-per-crawl/

### KB-HACK-01: Colosseum Crypto World's Fair
- Dates: 2026-09-14 to 2026-10-12. Final submission opens 2026-10-06 04:00 PDT.
- Tracks: Solana, Ethereum, Hyperliquid, Base, Tempo, Arbitrum, Zcash, Robinhood Chain. Solana pool $100K (10 × $10K).
- Grand prize $30K; 20 runner-ups × $15K; $5K Public Good and University prizes. Accelerator: $250K pre-seed, $2.5M total.
- Judged on product quality and innovation potential, plus track judges.
- Source: https://colosseum.com/worldsfair

### KB-AMT-01: Amount math
- USDC has 6 decimals on Solana and Base. `atomic = round(usd * 1_000_000)`.
- $0.002 (0.2 cents) = `2000`. $0.001 = `1000`. $0.05 = `50000`.
- Store atomic integers; format USD only in the UI.
