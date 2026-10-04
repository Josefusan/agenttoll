#!/usr/bin/env bash
# Claude pays (simulated money). Runs the headless Claude CLI with pay-mcp as its only tool
# against a stack that is already running, then writes the full transcript as markdown.
#   STACK_ONLY=1 bash scripts/demo-local.sh        # shell 1: the SIMULATED stack, empty ledger
#   bash scripts/claude-pays-demo.sh               # shell 2: Claude pays, hits the cap, then pays for an MCP tool
# Env (defaults in brackets): GATEWAY_PORT [8402]  BUYER_SOLANA_KEYPAIR [.demo/buyer.json]
#   CLAUDE_MODEL [sonnet]  OUT [docs/assets/claude-pays-transcript.md]
# Needs: node, python3, the claude CLI logged in, and `npm install && npm run build` in demo/pay-mcp.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GATEWAY_PORT="${GATEWAY_PORT:-8402}"
GW="http://127.0.0.1:$GATEWAY_PORT"
KEYPAIR="${BUYER_SOLANA_KEYPAIR:-$ROOT/.demo/buyer.json}"
MODEL="${CLAUDE_MODEL:-sonnet}"
OUT="${OUT:-$ROOT/docs/assets/claude-pays-transcript.md}"
[ -f "$ROOT/demo/pay-mcp/dist/index.js" ] || { echo "build pay-mcp first: cd demo/pay-mcp && npm install && npm run build" >&2; exit 1; }
[ -f "$KEYPAIR" ] || { echo "no buyer keypair at $KEYPAIR (run scripts/demo-local.sh once)" >&2; exit 1; }
curl -fs -o /dev/null "$GW/" || { echo "no gateway at $GW (start: STACK_ONLY=1 bash scripts/demo-local.sh)" >&2; exit 1; }

W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT; chmod 700 "$W"
cat > "$W/mcp.json" <<JSON
{"mcpServers":{"agenttoll-pay":{"command":"node","args":["$ROOT/demo/pay-mcp/dist/index.js"],
 "env":{"BUYER_SOLANA_KEYPAIR":"$KEYPAIR","PAY_MCP_NETWORK":"solana",
 "BUYER_MAX_USD_PER_CALL":"0.01","BUYER_MAX_USD_PER_DAY":"0.25","PAY_MCP_SPEND_FILE":"$W/spend.json"}}}}
JSON

P1="Find the price of $GW/api/quote with your agenttoll-pay tools. If it is within your spending caps, pay for it. Then tell me the data you received and the receipt: amount, network, transaction id, and whether the payment was simulated."
P2="Call the generate_report tool on the MCP server at $GW/mcp with call_paid_tool. You may spend up to 10 cents on it. If your wallet refuses, tell me exactly why and do not try to work around it. Then call spend_status and tell me what you have spent in total today."
P3="Use call_paid_tool to run the search_docs tool on the MCP server at $GW/mcp with the query \"x402\". Tell me the result, what you paid, and whether the payment was simulated. Then call spend_status and tell me what you have spent in total today."

run() { # $1 = prompt, $2 = output jsonl
  (cd "$W" && claude -p "$1" --model "$MODEL" --mcp-config "$W/mcp.json" --strict-mcp-config \
    --tools "" --allowedTools "mcp__agenttoll-pay" --no-session-persistence \
    --output-format stream-json --verbose) > "$2"
}
run "$P1" "$W/run1.jsonl"
run "$P2" "$W/run2.jsonl"
run "$P3" "$W/run3.jsonl"

python3 "$ROOT/scripts/format-claude-transcript.py" --gateway "$GW" --model "$MODEL" \
  --prompt "$P1" --run "$W/run1.jsonl" --prompt "$P2" --run "$W/run2.jsonl" \
  --prompt "$P3" --run "$W/run3.jsonl" > "$OUT"
echo "wrote $OUT"
