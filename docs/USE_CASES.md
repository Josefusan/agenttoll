# Use cases: who buys AgentToll, who pays through it, and what we can prove

Three kinds of actor touch AgentToll: people who sell (founders, publishers, agencies, MCP authors), agents that buy (Claude and other MCP clients, pipelines, crawlers), and MCP servers that sell per tool. This file lists seven concrete cases, the exact AgentToll flow for each, why x402 and USDC on Solana fit better than the alternative, and what we can show on camera.

Rules for this document: config snippets use the real `agenttoll.yaml` schema (see `agenttoll.example.yaml`). Numbers in "Why now" come from `docs/KNOWLEDGE_BASE.md` only. There are no customers, quotes or revenue figures here because there are none yet; "Proof" means what the demo can show, not traction.

## Summary

| # | Actor | Case | AgentToll piece | Price in demo |
|---|---|---|---|---|
| 1 | Seller: API founder | Pay-per-call public API without API keys | Gateway, `detection: all-requests` | $0.002 per `GET /api/quote` |
| 2 | Seller: publisher or docs site | Agents pay to read, humans read free | Gateway, `detection: agents-only` | $0.001 per `GET /blog/*` |
| 3 | Seller: agency (Website Factory) | Every client site earns from agent traffic | Gateway or Worker in front of Vercel | $0.001 per agent page read |
| 4 | Seller: MCP server author | Per-tool prices, discovery free | Gateway `mcp` block | $0.005 `search_docs`, $0.05 `generate_report` |
| 5 | Buyer: Claude | Claude pays within caps the user sets | `pay-mcp` (`pay_and_fetch`, `wallet_status`) | Cap $0.01 per call, $0.25 per day |
| 6 | Buyer: autonomous pipeline | A research job pays many endpoints, keeps receipts | `agenttoll-buyer` CLI (`x402-reqwest`) | Whatever the 402 quotes |
| 7 | Buyer: licensed crawler | Pay per page instead of being blocked | Gateway, Web Bot Auth detection | $0.001 per page |

## A. People selling

### 1. API founder: a public API with a price instead of a key

Who: a solo founder or small team with a useful JSON endpoint (prices, weather, parsed filings, geocoding). Today they run a signup, issue API keys, meter usage, chase invoices or run Stripe metered billing. Agents cannot sign up.

Job to be done: get paid per call by anyone, including an agent that discovered the endpoint ten seconds ago, without an account system.

Flow:
1. Run `agenttoll-gateway` in front of the origin with `detection: all-requests` so every caller pays, human or agent.
2. Price per route. Unpaid request gets `402` with `PAYMENT-REQUIRED`; paid request is verified, forwarded, settled only after the origin returns 2xx, and answered with `PAYMENT-RESPONSE` carrying the Solana signature.

```yaml
origin: http://localhost:4000
detection: all-requests
networks:
  solana:
    network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"
    asset: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
    pay_to: "${AGENTTOLL_SOLANA_PAYTO}"
    facilitator: "https://facilitator.payai.network"
routes:
  - match: "GET /api/quote"
    price_usd: "0.002"
  - match: "GET /api/*"
    price_usd: "0.001"
  - match: "/*"
    price_usd: "0"
```

Why x402 and USDC on Solana beat the alternatives here: Stripe cannot bill $0.002 (card fees are larger than the price); API keys need a signup an agent cannot complete; subscriptions make a one-off call impossible. x402 prices the single call, settles in seconds, and the money is already in the founder's account (KB-X402-01, KB-X402-07). Agents never pay for a 500 because settlement follows origin 2xx (DECISIONS.md).

Proof we can show: `curl -i http://localhost:8402/api/quote` returns 402 with the decoded quote; `agenttoll-buyer http://localhost:8402/api/quote` prints the body and the devnet signature; the explorer link resolves.

### 2. Publisher or docs site: agents pay to read, humans read free

Who: a blog, documentation site, newsletter archive or niche database whose server logs are full of GPTBot, ClaudeBot and Perplexity hits. The only options so far were block or absorb.

Job to be done: keep the site open to people, charge the bots a fraction of a cent per page, and see how much agent traffic there is.

Flow:
1. `detection: agents-only` (the default). The detector flags `PAYMENT-SIGNATURE`, MCP paths, valid Web Bot Auth signatures and the known crawler UA list as agents; everything else is human and passes untouched (ARCHITECTURE.md §1.3, KB-DET-01).
2. Heuristic verdicts (curl, headless) are logged, never charged, and feed the dashboard's "agent traffic you are not billing yet" count.

```yaml
detection: agents-only
routes:
  - match: "GET /blog/*"
    price_usd: "0.001"
  - match: "GET /docs/*"
    price_usd: "0.001"
  - match: "/*"
    price_usd: "0"
```

Why x402 fits: a paywall for humans costs readers and SEO; a robots.txt block loses the agent audience entirely. Pricing only verified agents keeps both. USDC on Solana makes a $0.001 page viable; a card rail does not.

Proof: open the page in a browser, normal site; `curl -A "ClaudeBot/1.0"` on the same URL, 402 (on localhost; through a trycloudflare quick tunnel use `-A 'Claude-User/1.0'`, see `deploy/README.md`); the dashboard shows the unbilled count climbing from a real crawler log replay.

### 3. Agency: every Website Factory client site earns from agent traffic

Who: Website Factory (our own agency) ships landing pages for small businesses on Vercel. The agency can offer "agent revenue" as a line item and run the gateway for the client.

Job to be done: zero-touch for the client. The agency points the domain at AgentToll, sets `pay_to` to the client's wallet (or the agency's, with a split agreed off-chain), and the client sees a dashboard.

Flow:
1. Deploy the gateway on the agency VPS (or the Worker edition on Cloudflare) in front of the Vercel origin with `preserve_host: false` so Vercel routes by the gateway's Host and the client's Host travels in `X-Forwarded-Host` (DECISIONS.md).
2. Per-client `agenttoll.yaml` with that client's `pay_to`. Non-custodial: the agency never touches the money.

```yaml
origin: https://client-site.vercel.app
public_url: https://client-site.com
preserve_host: false
detection: agents-only
networks:
  solana:
    pay_to: "${CLIENT_SOLANA_PAYTO}"
routes:
  - match: "GET /*"
    price_usd: "0.001"
```

Why x402 fits: an agency cannot open a Stripe account per client for sub-cent revenue; it can hand each client a wallet address. Cash-out options for the client are in `docs/PAYOUTS.md`.

Proof: D7 deliverable. A public client URL where a browser gets the page and an agent gets a 402; the dashboard for that site.

### 4. MCP server author: per-tool prices, discovery stays free

Who: a developer who published an MCP server (docs search, report generation, data enrichment) over Streamable HTTP. Agents call it for free today; the author pays for the compute and any upstream API.

Job to be done: charge per `tools/call`, by tool, while `initialize`, `tools/list` and notifications stay free so agents can still discover the server.

Flow:
1. Set `mcp.endpoint`. The gateway inspects POST bodies, prices `tools/call` by `params.name`, sums batched calls, rejects malformed bodies with 400 instead of forwarding them free (DECISIONS.md), and returns 402 for unpaid priced calls (KB-X402-05).
2. Paid tool content is buffered and released only after `/settle` succeeds, per the x402 MCP transport rule.

```yaml
mcp:
  endpoint: /mcp
  default_tool_price_usd: "0"
  tools:
    search_docs: "0.005"
    generate_report: "0.05"
```

Why x402 fits: there is no API key field in an MCP tool call, and no subscription model for a tool another agent calls twice. Per-tool pricing in one YAML block is the unit of value the agent economy already uses.

Proof: D5 deliverable. Claude Desktop lists the tools, calls `search_docs`, pays $0.005, gets the result; `generate_report` costs $0.05 and shows up as its own row on the dashboard.

## B. Agents buying

### 5. Claude with a capped wallet (`pay-mcp`)

Who: a Claude Desktop or Claude Code user who wants Claude to fetch paid data without handing it an open wallet.

Job to be done: let Claude pay small amounts on its own, inside caps the human set once.

Flow:
1. Install `demo/pay-mcp` via `.mcp.json`. Tools: `pay_and_fetch({ url, max_usd? })` and `wallet_status()`.
2. On 402, the tool decodes `PAYMENT-REQUIRED`, picks the Solana devnet entry (Base Sepolia fallback), checks `amount <= min(max_usd, BUYER_MAX_USD_PER_CALL)` and the daily total against `BUYER_MAX_USD_PER_DAY`, signs with `BUYER_SOLANA_KEYPAIR`, retries, and returns `{ status, body, paid_usd, network, tx_signature, explorer_url }` (skills/claude-buyer-demo).

Prompt used in the demo: "Use pay_and_fetch to get the latest quote from <url>. Tell me what you paid and link the transaction." (Variant B, simulated: the receipt id starts with `SIMULATED-`, there is no transaction to link, and the answer says so. The explorer link exists only for a real devnet settlement.)

Why x402 fits: the agent needs no account at the seller; the human controls spend with two environment variables; every payment is a signed, inspectable receipt. Coinbase's own Payments MCP already pays x402 on Solana (KB-PAY-06), so this is the direction agent wallets are going, not a one-off.

Proof: the headline demo shot. Claude asks, pays $0.002, answers with the data and the receipt, and the dashboard ticks within a second. Until a devnet wallet is funded the payment is simulated and the receipt is a `SIMULATED-` id; the explorer link appears only for a real settlement.

### 6. Autonomous research pipeline with receipts

Who: a team running a scheduled agent job (market scan, competitor monitoring, dataset refresh) that pulls from many small paid endpoints.

Job to be done: pay per call across many sellers with one wallet, no key vault, and an audit trail of what was bought.

Flow:
1. Use `agenttoll-buyer` (Rust, `x402-reqwest` + `x402-chain-solana`) or any x402 v2 client in the job. One keypair, funded to a budget. The buyer identifies itself honestly as `AgentToll-Buyer/<ver>` and is quoted a price (DECISIONS.md).
2. Every response carries `PAYMENT-RESPONSE` with the signature. Store it next to the data; that is the receipt.

Why x402 fits: one wallet replaces N API keys and N invoices; a budget is a balance; the cost of each result is on-chain and unambiguous. On the seller side, AgentToll's "settle after 2xx" rule means the pipeline never pays for a failed call.

Proof: a CI job (the one-end-to-end devnet test behind a secret, ARCHITECTURE.md §1.8) that pays three endpoints and prints three signatures.

### 7. Licensed crawler: pay per page instead of being blocked

Who: an operator of a search or training crawler who would rather pay a known price than negotiate licenses site by site or get blocked. This is a hypothesis about a buyer type, not a conversation we have had.

Job to be done: identify itself cryptographically, get a price, pay, crawl.

Flow:
1. The crawler signs requests with Web Bot Auth (`Signature`, `Signature-Input`, `Signature-Agent`, KB-DET-01). The detector names the agent from its key directory, so the dashboard attributes revenue to it.
2. Unpaid pages return 402 with the per-page price; the crawler's x402 client pays and continues.

Why x402 fits: a per-page price is simpler than a license negotiation, and the site owner gets paid even by crawlers they have never heard of. Spoofed UAs only earn a price quote, never a free pass, so the scheme does not depend on trust.

Proof: replay a signed request against the gateway; show the named agent on the dashboard. The crawler-side willingness to pay is unproven and should be stated as such.

## C. MCP servers selling (beyond case 4)

- MCP-native x402 transport (KB-X402-05): the challenge is a tool result with `isError: true` and `PaymentRequired` in `structuredContent`; the client retries with `params._meta["x402/payment"]`; the receipt comes back in `result._meta["x402/payment-response"]`. AgentToll's HTTP 402 path works with any x402 HTTP client today; the MCP-native path is the D5 innovation hook so that MCP clients that never see HTTP status codes can still pay.
- Discovery: with `mcp.advertise_prices: true` the gateway appends "$0.005 per call via x402" to tool descriptions in `tools/list` so an agent can plan spend before calling (skills/paid-mcp-tools). Planned, not built.
- Agent to agent: an agent that wraps its own capabilities as an MCP server behind AgentToll becomes a seller to other agents with no extra code. The same `mcp.tools` block applies.

## Why now (numbers from the KB only)

- Solana took the top spot for x402 agent payments with about $3.3M USDC settled in one week (KB-MKT-01).
- PayAI launched x402 batch settlement on Solana in public preview on 2026-09-30, so sub-cent, high-frequency traffic has a settlement path on mainnet (KB-SOL-03).
- x402 v2 is specified by the x402 Foundation with HTTP and MCP transports; the Rust crates are at 2.0.2 and the TypeScript packages cover Hono, Express, Next and fetch (KB-X402-01, KB-X402-02, KB-X402-03, KB-X402-05).
- Cloudflare opened a waitlist for an x402 Monetization Gateway on 2026-07-01, for Cloudflare customers only (KB-MKT-01). The demand signal is public; the open, self-hosted, non-custodial version is not built yet.
- Agent wallets exist and pay on Solana: Coinbase's Payments MCP lists Base, Polygon and Solana and funds through Coinbase Onramp (KB-PAY-06).
- Sellers can get to dollars: Bridge liquidation addresses accept USDC on Solana and Base and drain to ACH, wire or SEPA; Stripe financial accounts hold USDC received on Solana and Base (KB-PAY-01, KB-PAY-02). Neither is demoable on devnet, which is why the hackathon ships the pattern, not the integration (KB-PAY-07).
- Colosseum judges score product quality and innovation potential, and the accelerator wants a buyer, a reason now, and a path to users (KB-HACK-01). Cases 1 to 4 are the buyers; this section is the reason now; Website Factory (case 3) is the path to users.

## Who pays us later (plan, not traction)

AgentToll is MIT and self-hosted, and the money path is non-custodial, so the open-source core is free by design. Revenue, if it comes, is from convenience and scale, not from standing between the seller and their funds.

| Line | What it is | Who buys | Pricing idea | Status |
|---|---|---|---|---|
| Hosted AgentToll | We run the gateway and dashboard; founder gives us an origin and a `pay_to` | Founders who will not run a binary | Flat monthly tier plus a take rate on settled volume, charged separately; `pay_to` stays the founder's address | Plan |
| Payout destinations | One-click Bridge liquidation address or Stripe deposit address as `pay_to`, created in the founder's own KYB'd account; threshold sweeper | Founders who want dollars, not USDC | Bridge's `custom_developer_fee_percent` is a real mechanism for a per-drain fee if we ever act as the developer of record (KB-PAY-01); otherwise part of the hosted tier | Plan; two UNVERIFIED items in PAYOUTS.md §6 |
| Agency bundle | AgentToll pre-installed on every Website Factory site, dashboard per client | Website Factory clients, then other agencies | Line item on the site retainer | Plan; D7 dogfood |
| Pro dashboard | Multi-site, exports, alerts, team seats, "unbilled agent traffic" reports | Publishers and MCP authors with real volume | Monthly subscription | Plan |

No take rate is charged in the open-source gateway. Any hosted take rate would be billed off-chain to the founder, so the on-chain path stays `agent -> pay_to`.

## Which two cases the demo video should feature

1. **Case 5 buying from case 1 or 2: Claude pays $0.002 through `pay-mcp` and the dashboard ticks.** It is the full loop in one shot: human sees a normal page, Claude hits 402, pays within its caps, gets data, and the receipt shows (simulated today; the explorer link resolves only for a real devnet settlement). It is the Solana-track proof and the "nobody can argue with this" demo in WIN_PLAN.md.
2. **Case 4: per-tool MCP pricing.** `search_docs` at $0.005 and `generate_report` at $0.05 appear as separate rows while `tools/list` stays free. This is the innovation hook judges will not have seen in single-route x402 demos, and it is the clearest version of "MCP servers can sell."

Case 3 (Website Factory) stays as the closing shot, as the current script already has it: it answers "path to users" in ten seconds. Cases 6 and 7 belong in the README and the pitch video, not the demo.
