---
name: claude-buyer-demo
description: Build and run the on-camera demo where Claude pays an x402 endpoint through an MCP tool with spend caps, plus the Rust buyer CLI. Use for demo/pay-mcp, agenttoll-buyer and the recording run-sheet.
---
# Claude buyer demo

Retrieve KB-DEMO-01, KB-X402-02, KB-SOL-01.

## pay-mcp server (TypeScript, stdio)
- Tool `pay_and_fetch({ url, max_usd? })`:
  1. GET url. If not 402, return body.
  2. Decode PAYMENT-REQUIRED; pick Solana devnet entry (fallback Base Sepolia).
  3. Enforce caps: `amount <= min(max_usd, BUYER_MAX_USD_PER_CALL)` and daily total `<= BUYER_MAX_USD_PER_DAY` (persist in a local JSON file).
  4. Sign with `@x402/fetch` + `@x402/svm` using `BUYER_SOLANA_KEYPAIR`; retry; return `{ status, body, paid_usd, network, tx_signature, explorer_url }`.
- Tool `wallet_status()` → balance, spent today, caps.
- Register in Claude Desktop/Code via `.mcp.json` example in `demo/pay-mcp/README.md`.

## Recording run-sheet essentials
- Pre-flight: buyer has ≥ 1 devnet USDC; payTo ATA exists; dashboard open; gateway logs visible.
- Prompt to Claude: "Use pay_and_fetch to get the latest quote from <url>. Tell me what you paid and link the transaction."
- Show: browser (human, no paywall) → Claude call → dashboard tick → Explorer page.
