# pay-mcp: an x402 wallet with hard spend caps, for any MCP client

`pay-mcp` is the buyer side of AgentToll. It is a stdio MCP server that gives Claude Desktop,
Claude Code, or any other MCP client a USDC wallet that can pay x402 v2 paywalls, with caps the
agent cannot talk its way past. Humans browse the same URLs free; the agent pays per request.

- Solana devnet USDC first (`PAY_MCP_NETWORK=solana`, the default), Base Sepolia as the backup rail.
- Caps are checked **before** anything is signed: `BUYER_MAX_USD_PER_CALL` (default $0.01),
  `BUYER_MAX_USD_PER_DAY` (default $0.25), and the `max_usd` the caller passes. The lowest wins.
- Only USDC on an explicit allowlist is ever paid: Solana devnet and Base Sepolia by default,
  mainnet only with `PAY_MCP_ALLOW_MAINNET=1`. A swapped mint, a wrapped token or an unknown
  network is refused before the cap check.
- Spend is persisted in `~/.agenttoll/spend.json` under a lock file shared by every pay-mcp
  process on the machine. A payment is reserved against the daily cap before it is signed and
  finalized after the seller answers, so two processes cannot both pass the cap.
- Keys never leave the process: nothing logs or returns them. A key file readable by other users
  gets a warning on stderr and in `spend_status`.
- Works with any x402 v2 seller, not only AgentToll. Built on `@x402/fetch`, `@x402/svm`,
  `@x402/evm`, `@x402/core` 2.28 and `@modelcontextprotocol/sdk`.

## Tools

| Tool | What it does | Money moves? |
|---|---|---|
| `get_quote(url)` | Fetch as an agent; if the server answers 402, decode `PAYMENT-REQUIRED` and return the price in USD per network, `payTo`, description | No |
| `pay_and_fetch(url, max_usd?, method?, body?)` | Pay the x402 quote within caps, return the body (truncated at 16 KB), the settlement tx, network and explorer link | Yes, within caps |
| `call_paid_tool(server_url, tool, arguments, max_usd?)` | Call a tool on a remote MCP server over Streamable HTTP and pay for it. Handles both styles: HTTP 402 on the JSON-RPC POST (an AgentToll gateway in front of any MCP server) and the MCP-native challenge (`isError` result with `PaymentRequired`, retried with `_meta["x402/payment"]`, receipt in `_meta["x402/payment-response"]`) | Yes, within caps |
| `spend_status()` | Today's spend, caps, remaining, wallet addresses, last 10 payments | No |

Refusals (above a cap, asset or network not on the allowlist, bad URL, zero amount) happen
before signing and say so: `Refused before signing (no money moved, nothing counted against
caps): ...`.

A rejection after the signed payment was sent is different: the seller now holds a signed bearer
payment it could still settle, so the amount stays counted against the daily cap as
`rejected_after_send` and shows up in `spend_status.reconcile` until you check it. The same goes
for a paid request that fails in flight or comes back without a receipt (`unknown`). A dishonest
seller therefore cannot drain more than `BUYER_MAX_USD_PER_DAY` by rejecting and settling anyway.

Everything the seller wrote (bodies, descriptions, error strings, tool output) comes back inside
an `untrusted_content` field with a note that it is third-party data, not instructions. The paid
retry never follows redirects: a 3xx is reported and the payment is not re-sent.

A receipt whose transaction id starts with `SIMULATED` is flagged `simulated: true`, gets no
explorer link, and says plainly that nothing moved on chain.

## Install

```bash
cd demo/pay-mcp
npm install
npm run build        # -> dist/index.js
npm test             # vitest: cap math, quote decoding, spend persistence, MCP-native parsing, refusals
```

Create a devnet wallet and fund it with devnet USDC (the ATA is created on first receipt; the
buyer needs a little devnet SOL too, see the faucet links):

```bash
cargo run -p agenttoll-buyer -- --new-solana-keypair ./buyer.keypair.json   # prints the address
# USDC: https://faucet.circle.com   SOL: https://faucet.solana.com
```

`*.keypair.json` is gitignored. Never commit it.

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `BUYER_SOLANA_KEYPAIR` | (none) | Path to a `solana-keygen` JSON byte-array file |
| `BUYER_EVM_PRIVATE_KEY` | (none) | Optional `0x...` key for Base Sepolia |
| `PAY_MCP_NETWORK` | `solana` | Preferred rail when a seller offers both: `solana` or `base` |
| `SOLANA_RPC_URL` | `https://api.devnet.solana.com` | RPC used to build the transfer |
| `BUYER_MAX_USD_PER_CALL` | `0.01` | Hard cap per payment |
| `BUYER_MAX_USD_PER_DAY` | `0.25` | Hard cap per UTC day (reserved payments count) |
| `PAY_MCP_ALLOW_MAINNET` | unset | `1` adds Solana mainnet and Base USDC to the allowlist |
| `PAY_MCP_SPEND_FILE` | `~/.agenttoll/spend.json` | Where spend is persisted |
| `PAY_MCP_MAX_BODY_BYTES` | `16384` | Response bodies longer than this are truncated |

## Claude Desktop

`claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/`, Windows:
`%APPDATA%\Claude\`). Use absolute paths.

```json
{
  "mcpServers": {
    "agenttoll-pay": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/agenttoll/demo/pay-mcp/dist/index.js"],
      "env": {
        "BUYER_SOLANA_KEYPAIR": "/ABSOLUTE/PATH/buyer.keypair.json",
        "PAY_MCP_NETWORK": "solana",
        "BUYER_MAX_USD_PER_CALL": "0.01",
        "BUYER_MAX_USD_PER_DAY": "0.25"
      }
    }
  }
}
```

Restart Claude Desktop; the four tools appear under the tools icon.

## Claude Code

```bash
claude mcp add agenttoll-pay \
  -e BUYER_SOLANA_KEYPAIR=/ABSOLUTE/PATH/buyer.keypair.json \
  -e PAY_MCP_NETWORK=solana \
  -e BUYER_MAX_USD_PER_CALL=0.01 \
  -e BUYER_MAX_USD_PER_DAY=0.25 \
  -- node /ABSOLUTE/PATH/agenttoll/demo/pay-mcp/dist/index.js
```

Or commit a project `.mcp.json` next to your code (same shape as the Desktop config, under
`mcpServers`) so every contributor's Claude Code picks it up.

## Any other MCP client

Spawn `node dist/index.js` over stdio with the env above. `scripts/smoke.mjs` is a tiny client
that does exactly that and walks all four tools against a gateway (`GW=http://127.0.0.1:8402
BUYER_SOLANA_KEYPAIR=... npm run smoke`). The MCP Inspector works too:

```bash
npx @modelcontextprotocol/inspector --cli -e BUYER_SOLANA_KEYPAIR=./buyer.keypair.json \
  node dist/index.js --method tools/call --tool-name get_quote --tool-arg url=http://localhost:8402/api/quote
```

## 60-second demo script

Setup, off camera: gateway on `:8402` in front of the demo origin, dashboard open, funded devnet
buyer configured in Claude Desktop.

1. **(0:00)** Browser: open `http://localhost:8402/api/quote`. The JSON loads. Say: "A human sees
   this for free."
2. **(0:10)** `curl -A GPTBot http://localhost:8402/api/quote` in a terminal. `402 Payment
   Required`. Say: "An agent gets a price instead."
3. **(0:20)** Claude Desktop prompt: *"Use get_quote on http://localhost:8402/api/quote and tell
   me what it costs."* Claude answers: $0.002 on Solana devnet, pay-to address shown. Say: "No
   money moved yet."
4. **(0:30)** Prompt: *"Pay for it with pay_and_fetch, max 1 cent, and tell me the price in the
   data and the transaction link."* Claude pays, quotes the data, and gives the
   `explorer.solana.com/tx/...?cluster=devnet` link. Click it.
5. **(0:45)** Dashboard ticks: one settlement, $0.002, agent `AgentToll-Buyer`. Prompt: *"How much have
   you spent today?"* `spend_status` answers with today's total and what is left under the caps.
6. **(0:55)** Prompt: *"Call generate_report on http://localhost:8402/mcp."* Claude refuses:
   "$0.05 is above BUYER_MAX_USD_PER_CALL ($0.01); not paid." Say: "The caps are the point.
   It is Claude's wallet, but it is your budget."

## Design notes

- Money is `bigint` atomic USDC (6 decimals) end to end. The only float is formatting a
  human-typed `max_usd` to six decimals before parsing.
- The signer is handed a `PaymentRequired` whose `accepts` holds only the option pay-mcp chose, so
  the SDK cannot pick a different network or amount than the one that passed the caps. The SDK
  client is registered for the exact allowlisted CAIP-2 networks, never `solana:*` / `eip155:*`.
- Ledger order: allowlist, then reserve under the lock (cap check + write a `pending` row), then
  sign, then send, then finalize the row (`settled`, `simulated`, `unknown`,
  `rejected_after_send`). Only a signing failure releases a reservation, because nothing left the
  process. Every status except a released one counts toward the day.
- The lock is an `O_EXCL` create of `spend.json.lock` with jittered retries; a lock older than
  30 s is treated as stale and swept. Tested with two child processes hammering one file.
- The gateway's detector already lists `AgentToll-Buyer` as a self-declared agent, so pay-mcp
  sends `User-Agent: AgentToll-Buyer/pay-mcp <version>` and `X-Agent-Name: pay-mcp`; nothing in
  the gateway had to change.
