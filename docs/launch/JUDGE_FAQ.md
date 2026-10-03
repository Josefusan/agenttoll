# Judge FAQ

Ten questions a Colosseum or Solana track judge is likely to ask, with the answers as they are true on 2026-10-03. Each answer points at the code or document that backs it. If anything changes before submission, update the answer, not the tone.

## 1. How do you know a payment is good before you serve the content?

Verify, forward, settle, in that order, with the gateway's own quote as the reference. The client's echoed `accepted` must match the gateway's quote on scheme, amount, asset and `payTo`, or the request is refused before `/verify` is even called. The facilitator verifies the signed payment. Only then does the gateway forward to the origin. Paid responses are buffered (16 MiB cap) and released only after `/settle` succeeds, so an agent cannot keep content the facilitator rejected. A replay guard keys on the canonical JSON of the signed payload and holds it for 120 s, so a re-encoded header is still a replay. A payment that names a `resource.url` is bound to that resource; MCP quotes put the tool in the URL fragment (`/mcp#mcp:search_docs`) so a payment for one tool cannot buy another at the same price. Source: `docs/DECISIONS.md`, `crates/agenttoll-gateway/src/pay.rs`, tests in `crates/agenttoll-gateway/tests/`.

## 2. Cloudflare announced an x402 monetization gateway. Why does this exist?

Cloudflare's gateway opened a waitlist on 2026-07-01 and is for Cloudflare customers only (KB-MKT-01). That is the demand signal. AgentToll is the open, self-hosted version: MIT, one Rust binary or a Cloudflare Worker, any host, prices per route and per MCP tool in one YAML file, non-custodial, Solana first with Base as a second rail, a founder dashboard, and a report of the agent traffic you are not billing yet. We also ship a Worker edition, so a Cloudflare customer can run AgentToll at the edge without waiting for a waitlist. We have not used Cloudflare's product; we only know what is public.

## 3. Who holds the money?

Nobody but the seller. Every settlement is a USDC transfer from the agent to the `pay_to` address in the seller's config. AgentToll holds no keys and no funds, and the open-source gateway charges no take rate. Turning USDC into dollars happens downstream of `pay_to`, in an account the founder opens with an off-ramp partner in their own name; that is documented, not built (`docs/PAYOUTS.md`). If we later run a hosted edition, the operating entity is Clark Technology Ventures, and any fee is billed off-chain so the on-chain path stays agent to seller.

## 4. What happens when something fails?

- Origin returns non-2xx: no settlement, the agent is not charged, the payment claim is released so an honest retry works.
- MCP tool returns a JSON-RPC error or `isError: true`: no settlement, even though MCP errors arrive as HTTP 200.
- Facilitator rejects the payment: the agent gets 402, not the content.
- `/settle` times out after the origin already succeeded: the content is served and the payment is recorded as `unconfirmed`, because the payment may have landed and withholding would charge without service. The dashboard excludes `unconfirmed` from the spendable total.
- A paid MCP result the gateway cannot verify (compressed body, unmatched or duplicate ids): 502, content withheld, nothing settled. Unverifiable output is never given away free.
- Malformed MCP body: 400, never forwarded, so a lenient origin cannot run a paid tool the pricer did not see.

Source: `docs/DECISIONS.md` entries dated 2026-10-02 and 2026-10-03; mirrored in the Worker's `test/edge.test.ts`.

## 5. How does an agent find out what things cost?

Four ways. `GET /.well-known/agenttoll.json` lists every route, tool, price, network and payment transport (AgentToll's own format; no x402 discovery standard was verified). An unpaid request gets a 402 whose `PAYMENT-REQUIRED` header is the x402 v2 quote. With `mcp.advertise_prices: true`, `tools/list` appends the price to each tool's description ("Paid tool: $0.005 USDC per call via x402."). And `pay-mcp` has `get_quote`, which reads the 402 and reports the price without paying.

## 6. Is this ready for mainnet?

No, and the submission says so. Everything runs on Solana devnet and Base Sepolia. Switching is a config change (mainnet CAIP-2 ids, USDC mints and a mainnet facilitator), and `pay-mcp` refuses mainnet unless `PAY_MCP_ALLOW_MAINNET=1`, but we have not run it there. Before mainnet we would want: a security review of the gateway, the Worker's replay guard moved to a Durable Object (it is per isolate today), a Postgres ledger for hosted mode, an operations budget for a facilitator, and Joseph's explicit approval, which the architecture doc requires for any mainnet change.

## 7. What exactly is simulated in the demo?

The settlement. The one-command demo (`bash scripts/demo-local.sh`) runs a simulated facilitator from `demo/mock-facilitator`. It answers `/verify` and `/settle` like a real one but touches no chain; every settlement id starts with `SIMULATED-`, and the gateway, dashboard, buyer CLI and `pay-mcp` all label it as simulated and show no explorer link. Everything else is real: detection, pricing, the x402 v2 headers and payloads, the MCP-native challenge, the ledger, the SSE feed, the caps. As of 2026-10-03 no devnet wallet is funded, so the recorded demo may show simulated settlements; the video says so on screen. The real devnet path (PayAI facilitator, Circle devnet USDC faucet) is documented in the README and the code reaches PayAI's `/verify` today; it was rejected only because the key was unfunded.

## 8. How do you tell humans from agents, and can a human ever be charged by mistake?

Default mode is `agents-only`, biased to human. Only self-declared or verified agents pay: a request carrying `PAYMENT-SIGNATURE`, a request to the MCP endpoint, or a known AI crawler user agent (`GPTBot`, `ClaudeBot`, `PerplexityBot` and the rest of the list in KB-DET-01). Heuristic verdicts (curl, headless browsers, missing browser headers) are logged but never charged; they feed the "not billing yet" report. A human in a normal browser is never flagged, and the detector has 36 test cases covering browsers and bots. Spoofing a bot user agent only earns you a price quote. Web Bot Auth (signed requests) has a hook in the detector but the gateway does not verify signatures yet; that is on the list. Sellers who want to charge everyone can set `detection: all-requests`.

## 9. Why Solana first, and what does Base add?

Solana leads x402 agent payments by volume (about $3.3M USDC settled in one week, KB-MKT-01), has a mainnet path for sub-cent batch settlement through PayAI's payment channels (public preview 2026-09-30, KB-SOL-03), and the facilitator sponsors the network fee so an agent only needs USDC. Base is the second network block in the same config: Base Sepolia USDC with the x402.org testnet facilitator, EIP-3009 payloads, supported by the buyer CLI and `pay-mcp`. The gateway has no chain-specific money logic; the facilitator does the chain work, so adding a rail is a config block plus facilitator support. The Base rail is configured and tested against mocks; it has not been exercised with a funded wallet.

## 10. What is the business, and who pays you?

Today nobody. There is no revenue and there are no customers. The open-source core stays free and non-custodial by design. The plan, labelled as a plan everywhere it appears: a hosted edition (we run gateway and dashboard; flat tier plus a fee on settled volume, billed off-chain, `pay_to` stays the founder's), payout destinations through off-ramp partners in the founder's own account, an agency bundle on every Website Factory site, and a pro dashboard for sellers with real volume. Website Factory is the path to the first users: we already ship landing pages to small businesses and can run the gateway for them. Source: `docs/USE_CASES.md`, "Who pays us later".

## If asked: who built this?

Joseph Clark, solo, with AI coding agents (Claude Code with specialist subagents). Each slice is a separate pull request reviewed by an independent adversarial critic agent before it is merged into the release branch; several of the rules in question 4 came out of those reviews. Open-source dependencies are credited in the README: the x402 specs and SDKs, x402-rs, and the Skillbox skill-library pattern.
