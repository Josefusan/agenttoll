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
| KB-PAY-01 | Bridge (Stripe) liquidation addresses |
| KB-PAY-02 | Stripe financial account, stablecoin balance |
| KB-PAY-03 | Coinbase Business |
| KB-PAY-04 | Squads Altitude and Coinflow |
| KB-PAY-05 | Kast, Circle Mint, Mercury |
| KB-PAY-06 | Buyer-side wallet funding |
| KB-PAY-07 | Payout destination pattern (design note) |

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
- Contest period: 6:00am PT 2026-09-14 to 11:59pm PT 2026-10-12. Winners announced by 2026-12-05 (Official Rules s5).
- "Final submission opens 2026-10-06 04:00 PDT" is UNVERIFIED. It is not on any public page checked on 2026-10-04. The project editor needs Joseph's login.
- Tracks: Solana $100K (10 products), Tempo $100K (10), Hyperliquid $100K (10), Zcash $100K (10), Ethereum L1 $25K (5), Base $25K (5), Arbitrum $25K (5), Robinhood Chain $25K (5). A track is defined only as "products that integrate with" the chain (s14). Track prizes are on top of the main awards.
- Main awards: Grand $30K, Public Goods $5K, University $5K, next 20 standout teams $15K each, paid in CASH stablecoin. Page headline: $840,000 in prizes and $2.5M in seed funding. Accelerator: $250K pre-seed, 12 weeks in San Francisco.
- Judging criteria (Rules s8, listed in this order): Functionality and code quality; Potential impact (TAM); Novelty; UX (blockchain used for good downstream UX); Open-source and composability; Business plan. The FAQ adds founder-market fit, insight, product and execution, market size, founder communication, viability and traction.
- Submission items (FAQ): name and brief description; chains and tools; teammates and backgrounds; location; logo or graphic; GitHub link (open source encouraged, private allowed with access for hackathon@colosseum.com); a two-to-three-minute presentation video; a product-demo video of no more than three minutes; go-to-market, demand validation and distribution plan.
- Eligibility: 18 or older, not in an excluded country (s3). "New startups that haven't raised significant outside capital" (FAQ). Pre-existing code allowed if disclosed in the form. Only work inside the contest period is judged. One team per person, one submission per team (s7).
- Repo review looks for significant work during the hackathon, done by the team and not a third party (FAQ). No language or code-quality checks.
- Weekly one-minute update videos are recommended, not required. Shortlist gets a 15-minute Zoom interview.
- Sources: https://colosseum.com/worldsfair ; https://colosseum.com/legal/Crypto%20World's%20Fair%20Hackathon%20Rules.pdf ; https://colosseum.com/hackathon (FAQs).
- checked: 2026-10-04. Full matrix: `docs/COLOSSEUM_REQUIREMENTS.md`.

### KB-AMT-01: Amount math
- USDC has 6 decimals on Solana and Base. `atomic = round(usd * 1_000_000)`.
- $0.002 (0.2 cents) = `2000`. $0.001 = `1000`. $0.05 = `50000`.
- Store atomic integers; format USD only in the UI.

### KB-PAY-01: Bridge (Stripe) liquidation addresses
- A liquidation address is "a permanent payment route which ties a blockchain address to either a fiat or blockchain address"; when USDC arrives, Bridge "drains" it to the configured destination. Real-time rails (wire, SEPA, blockchains) send instantly; batch rails (ACH) are queued and processed daily.
- API: `POST /v0/customers/{customer_id}/liquidation_addresses`. `chain` enum includes `solana`, `base`, `ethereum`, `polygon`, `tempo`, `evm` (any supported EVM chain, beta 2026-09-15). `currency` includes `usdc`, `usdt`, `pyusd`, `eurc`. `destination_payment_rail` includes `ach`, `ach_same_day`, `ach_push`, `wire`, `sepa`, `spei`, `pix`, `faster_payments`, `swift`, plus chains. `custom_developer_fee_percent` is optional; blank means 0.0; developer fees pay out monthly on the 5th in USD.
- Supported stablecoins on Solana include USDC, USDT, PYUSD, EURC; on Base USDC, EURC (payment-routes page).
- Customers "represent end users of your platform" and must reach `kyc_status: approved` and accept Bridge's ToS. Business customers go through KYB. Developer onboarding terms for a solo founder: UNVERIFIED.
- Sandbox: `https://api.sandbox.bridge.xyz`, keys prefixed `sk-test`, `POST /v0/customers/{id}/simulate_kyc_approval`, fake liquidation addresses and transfers. "There is no real money movement in Sandbox", "There is no testnet support in Sandbox", "Sandbox wallets don't interact with the blockchain and use fake addresses."
- Bridge's own fee is not on the pages checked. Third-party coverage reports 0.25% orchestration / 0.50% virtual accounts: UNVERIFIED. Per-drain minimums exist ("Transaction Minimums" referenced) but values not captured: UNVERIFIED and critical for $0.002 payments.
- AgentToll relevance: first candidate for a native "payout destination" after the hackathon. Not demoable on devnet.
- checked: 2026-10-02. Sources: https://apidocs.bridge.xyz/get-started/guides/move-money/offramp_liquidation, https://apidocs.bridge.xyz/api-reference/liquidation-addresses/create-a-liquidation-address, https://apidocs.bridge.xyz/get-started/introduction/what-we-support/payment-routes, https://apidocs.bridge.xyz/platform/orchestration/fees-and-mins/devfees, https://apidocs.bridge.xyz/platform/customers/overview, https://apidocs.bridge.xyz/get-started/introduction/quick-start/setting-up-sandbox, https://apidocs.bridge.xyz/changelog/changelog

### KB-PAY-02: Stripe financial account, stablecoin balance
- A Stripe financial account can hold a USDC (or OUSD) stablecoin balance alongside USD, EUR, GBP. "Bridge custodies USDC and OUSD." No monthly fees or minimums for a financial account.
- Add funds from a crypto wallet: "You generate a deposit address for one blockchain network, then send funds to it." Supported networks for USDC: Arbitrum, Avalanche C-Chain, Base, Ethereum, Optimism, Polygon, Solana, Stellar; Tempo uses USDC.e. The same networks apply to funding and payouts.
- Payout from a stablecoin balance to a bank account: USD via ACH or wire; EUR via SEPA; MXN via SPEI; others in private preview. Stripe converts at payout time. Stablecoin payouts are public preview in the US, private preview elsewhere.
- Availability: USDC on financial accounts is GA for US legal entities (also for US entities with international representatives, and international entities in eligible countries, as USDC-only). Stablecoin balances are public preview in the US.
- Fiat transfers to your own linked bank in the same currency are free, 1 to 2 business days. Stablecoin payout fees: not stated on pages checked, UNVERIFIED. Whether the crypto deposit address is permanent/reusable and API-exposed: UNVERIFIED. Test mode for stablecoin balances: UNVERIFIED.
- checked: 2026-10-02. Sources: https://docs.stripe.com/treasury/store-funds, https://docs.stripe.com/treasury/add-funds, https://docs.stripe.com/treasury/transfer-send, https://docs.stripe.com/treasury/stablecoins, https://docs.stripe.com/treasury

### KB-PAY-03: Coinbase Business
- Launch coverage (2025-10-16, Yahoo Finance): Coinbase Business offers global USDC payouts, payment links, 4.1% APY on USDC, no network fees on Base, QuickBooks/Xero/CoinTracker integrations, a Payment Links API "upcoming"; "in alpha for early U.S. customers"; Coinbase Commerce to merge into it with fiat cash-out.
- Search summaries of Coinbase help pages (direct fetch returned 403): eligibility limited to US and Singapore C-corps and LLCs with KYB; USDC balances can be cashed out to a linked business bank account by ACH or wire; Coinbase credits USDC received on Solana and Base (and Ethereum, Arbitrum, Avalanche, Polygon, Optimism). Treat all of these as UNVERIFIED until read on coinbase.com.
- Not demoable on devnet. Custodial.
- checked: 2026-10-02. Sources: https://finance.yahoo.com/news/coinbase-launches-global-usdc-payouts-173521425.html, https://help.coinbase.com/en/coinbase/other-topics/business/business-overview (403), https://help.coinbase.com/en/coinbase/trading-and-funding/sending-or-receiving-cryptocurrency/assets-on-multiple-networks (403), https://help.coinbase.com/en/transitioning-from-coinbase-commerce-to-coinbase-business (403)

### KB-PAY-04: Squads Altitude and Coinflow
- Altitude (altitude.xyz, by Squads): "a self-custodial digital asset account" with "USD and EUR accounts, payments, FX, cards, and bill pay from 150+ countries." "Squads does not take custody of customer funds. Stablecoin balances are held in self-custodial wallets controlled by the customer through cryptographic keys." Bank connectivity (ACH, SEPA, Wire, SWIFT) via third-party partners. "Zero onramp and offramp fees." Requires identity verification, KYB, sanctions screening; eligible businesses in supported jurisdictions. Accepted chains/stablecoins and API: not stated, UNVERIFIED.
- Squads raised $18M led by Solana Ventures to scale Altitude (The Block, 2026-04-29).
- Coinflow is Squads' listed on/off-ramp partner (docs.squads.so). Coinflow payouts convert USDC to fiat over ACH, same-day ACH, SEPA, RTP, Pix and others; off-ramps listed for Solana, Ethereum, Polygon, Near; KYC handled inside its withdraw component; a testnet USDC faucet exists in its API reference. Merchant onboarding and fees: UNVERIFIED.
- AgentToll relevance: Altitude is the most on-brand `pay_to` destination for a Solana-track story if the account is a founder-controlled Solana address (UNVERIFIED). Coinflow is a building block for a future sweep-and-cash-out job.
- checked: 2026-10-02. Sources: https://altitude.xyz/, https://www.theblock.co/post/399386/solana-ventures-squads-funding-stablecoin-altitude, https://docs.squads.so/main/getting-started/on-and-off-ramp/sphere, https://docs.coinflow.cash/guides/payouts/implementation-methods/coinflow-withdraw-component, https://docs.coinflow.cash/api-reference/api-reference/faucet

### KB-PAY-05: Kast, Circle Mint, Mercury
- Kast: consumer stablecoin account. "Your USD account number and ACH details activate the moment you're verified"; EU IBAN. "KAST supports USDT, USDC, PYUSD and RLUSD ... across chains including Ethereum, Solana, Polygon, Arbitrum and TRON." Base not listed. Fee page returned 403; third parties report 0% stablecoin deposit fee and a business tier "launching in 2026": UNVERIFIED.
- Circle Mint: "for institutional customers minting USDC, EURC, and cirBTC"; "not available to individuals"; redeem USDC to a bank wire. Supported chains include Solana (`SOL`) and Base (`BASE`). Not a fit for an indie founder.
- Mercury: US business banking, fiat only, does not hold digital assets (third-party reviews; Mercury's own page not checked, UNVERIFIED). Useful as the bank account behind Bridge, Stripe or Coinbase payouts.
- checked: 2026-10-02. Sources: https://www.kast.xyz/en/global-accounts, https://concierge.kast.xyz/hc/en-us/articles/9850062738703-What-Are-the-Fees-and-Conditions-for-KAST-Cards-and-Accounts (403), https://www.circle.com/circle-mint, https://developers.circle.com/circle-mint/references/supported-chains-and-currencies, https://fitsmallbusiness.com/best-crypto-friendly-business-banks/

### KB-PAY-06: Buyer-side wallet funding
- Coinbase Payments MCP ("Agentic Wallet MCP"): `npx @coinbase/payments-mcp`. "Combines wallets, onramps, and payments via x402 into a single solution for agentic commerce." Tools: check balance, get wallet address, open wallet UI, discover x402 services, make automatic payments. "Payments are supported on Base, Polygon, and Solana." Funding: "Use Coinbase Onramp to add USDC." User-set spending limits (max per call, max per session). Testnet support not mentioned.
- Coinbase Onramp: "Converts fiat currency into crypto and sends to any wallet address." Payment methods: debit cards, credit cards (non-US), Apple Pay, Google Pay, ACH (US). Solana and Base listed. Sandbox with test card 4242... reported by search; the sandbox page returned 404 for us: UNVERIFIED.
- CDP agentic wallets (search summary of docs.cdp.coinbase.com changelog): client-side x402 spend controls (per-payment caps, rolling limits, network/asset/payee allowlists), `account.signX402Payment()`. UNVERIFIED pending a direct read.
- Devnet: Circle faucet (KB-SOL-01) funds the AgentToll demo buyer. PayAI channels (KB-SOL-03) are mainnet only.
- AgentToll relevance: Coinbase's own agent wallet already pays x402 on Solana, so any AgentToll gateway is payable by it without AgentToll-specific work; our `pay-mcp` exists for the devnet demo and for spend caps in Claude.
- checked: 2026-10-02. Sources: https://docs.cdp.coinbase.com/payments-mcp/welcome, https://docs.cdp.coinbase.com/agentic-wallet/mcp/welcome, https://docs.cdp.coinbase.com/onramp/introduction/welcome, https://docs.cdp.coinbase.com/get-started/changelog

### KB-PAY-07: Payout destination pattern (design note)
- Every bank-touching option in KB-PAY-01..05 requires KYC or KYB and runs on mainnet only. Bridge's sandbox has no testnet and fake addresses. Therefore no bank integration can appear in a devnet demo.
- x402 settles one on-chain transfer per request (KB-X402-07). Off-ramps have per-transaction minimums and exchanges may ignore dust, so $0.002 deposits are the wrong input for a bank rail.
- Pattern: `pay_to` = an address the founder controls (self-custody wallet or self-custodial business account); a founder-run sweeper moves the balance to an off-ramp address (Bridge liquidation address, Stripe deposit address, exchange deposit) on a threshold. AgentToll never holds funds. `pay_to` may also be set directly to an off-ramp address once its minimums are confirmed.
- Decision 2026-10-02: no live neobank integration during the hackathon; document the pattern (docs/PAYOUTS.md), add a read-only "Cash out" panel to the dashboard if time allows, put native payout destinations on the roadmap.
- Source: docs/PAYOUTS.md (this repo), KB-PAY-01..06.
