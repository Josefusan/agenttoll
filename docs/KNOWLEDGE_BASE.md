---
title: AgentToll knowledge base
purpose: Retrieval corpus for build agents. One fact cluster per chunk. Cite chunk IDs in code comments, PRs and DECISIONS.md.
updated: 2026-10-02
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
- Source: https://github.com/coinbase/x402 (README, `specs/`)

### KB-X402-02: x402 TypeScript packages
- `@x402/core`, `@x402/evm`, `@x402/svm`, `@x402/stellar`, `@x402/fetch`, `@x402/axios`, `@x402/express`, `@x402/hono`, `@x402/next`, `@x402/fastify`, `@x402/paywall`, `@x402/extensions`.
- Worker edition uses `@x402/hono` + `@x402/svm` + `@x402/evm`. Buyer MCP tool uses `@x402/fetch`.
- PayAI batch settlement requires `@x402/core` and `@x402/svm` >= 2.28.0 (see KB-SOL-03).
- Source: https://github.com/coinbase/x402

### KB-X402-03: x402 Rust crates (x402-rs)
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
- For a reverse proxy with dynamic per-route prices, the gateway may need to call the facilitator directly (verify/settle) rather than static `with_price_tag` layers. Check whether `x402-axum` exposes dynamic pricing; if not, use its types + facilitator client.
- Source: https://github.com/x402-rs/x402-rs, https://docs.rs/x402-axum, https://docs.rs/x402-chain-solana

### KB-X402-04: Facilitators
- Facilitator endpoints: `/verify`, `/settle` (and `/supported`). The resource server never needs chain RPC for the exact scheme if the facilitator settles.
- Options:
  - x402.org facilitator (Coinbase, testnet): `https://x402.org/facilitator` VERIFY
  - Coinbase CDP facilitator (mainnet, API key)
  - PayAI facilitator (Solana + EVM): `https://facilitator.payai.network` VERIFY
  - x402-rs hosted facilitator: `https://facilitator.x402.rs/`
  - Self-hosted: x402-rs Docker, or Solana's Kora-based facilitator guide (KB-SOL-02)
- Pick per chain in `agenttoll.yaml`. Demo default: Solana devnet via PayAI or self-hosted Kora facilitator.
- Sources: https://stablecoininsider.org/how-to-choose-an-x402-facilitator-for-usdc/, https://solana.com/developers/guides/getstarted/build-a-x402-facilitator

### KB-X402-05: MCP and x402
- MCP Streamable HTTP is JSON-RPC over HTTP POST. A paid tool call is `{"method":"tools/call","params":{"name":"<tool>",...}}`.
- AgentToll prices at the HTTP layer: inspect the POST body, price by tool name, return 402 for unpaid `tools/call`. Keep `initialize`, `notifications/*`, `tools/list` free.
- The x402 repo has transport specs that may define MCP-native payment metadata. VERIFY: look in `coinbase/x402/specs` for an MCP transport and support it if present.
- Source: https://github.com/coinbase/x402/tree/main/specs, https://modelcontextprotocol.io

### KB-SOL-01: Solana network IDs and USDC mints
- CAIP-2 Solana mainnet: `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` VERIFY
- CAIP-2 Solana devnet: `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` VERIFY
- USDC mint mainnet: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
- USDC mint devnet (Circle): `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` VERIFY
- Devnet USDC faucet: https://faucet.circle.com
- Payment lands in the `payTo` owner's associated token account (ATA) for the mint. Ensure the ATA exists before the demo.
- Explorer links: `https://explorer.solana.com/tx/<sig>?cluster=devnet`

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
- USDC Base Sepolia: `0x036CbD53842c5426634e7929541eC2318f3dCF7e` VERIFY
- EVM exact scheme uses EIP-3009 `transferWithAuthorization` (gasless for payer; facilitator submits).
- Source: https://dev.to/revnuvo/how-we-built-x402-v2-paid-apis-on-cloudflare-workers-3-settled-transactions-real-usdc-zero-auth-20c5

### KB-DET-01: Web Bot Auth and AI crawler user agents
- Web Bot Auth: bots sign requests with HTTP Message Signatures (RFC 9421). Headers: `Signature`, `Signature-Input`, `Signature-Agent` (points to the bot's key directory). Cryptographic, unlike spoofable UAs. VERIFY current draft name and header set.
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
