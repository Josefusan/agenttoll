#!/usr/bin/env bash
# One-command local demo: demo origin + SIMULATED facilitator + gateway (+ admin API), then
# a human, an AI crawler, the buyer CLI and an MCP client hit it. No funds needed; every
# payment is labelled SIMULATED. Ctrl-C (or the end of the script) stops everything.
#   bash scripts/demo-local.sh          # run the scripted walkthrough and exit
#   KEEP=1 bash scripts/demo-local.sh   # leave the stack running for the dashboard
#   STACK_ONLY=1 bash scripts/demo-local.sh   # start the stack, skip the walkthrough (empty ledger)
# Ports (defaults in brackets): GATEWAY_PORT [8402] ADMIN_PORT [8403] ORIGIN_PORT [4000]
# FACILITATOR_PORT [4020]. Set CARGO_TARGET_DIR to reuse an existing build, and
# PROFILE=release to use release binaries (default: debug).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export PATH="$HOME/.cargo/bin:$PATH"
mkdir -p .demo

GATEWAY_PORT="${GATEWAY_PORT:-8402}"; ADMIN_PORT="${ADMIN_PORT:-8403}"
ORIGIN_PORT="${ORIGIN_PORT:-4000}"; FACILITATOR_PORT="${FACILITATOR_PORT:-4020}"

echo "Building (first run compiles about 400 crates; later runs are instant)..."
PROFILE="${PROFILE:-debug}"
cargo build -q $([ "$PROFILE" = release ] && echo --release) -p agenttoll-gateway -p agenttoll-demo-origin -p agenttoll-buyer -p agenttoll-mock-facilitator
BIN="${CARGO_TARGET_DIR:-$ROOT/target}/$PROFILE"

# The shipped config uses the default ports; write a copy with yours.
sed -e "s#127.0.0.1:4000#127.0.0.1:$ORIGIN_PORT#" -e "s#127.0.0.1:4020#127.0.0.1:$FACILITATOR_PORT#" \
    -e "s#127.0.0.1:8402#127.0.0.1:$GATEWAY_PORT#" -e "s#127.0.0.1:8403#127.0.0.1:$ADMIN_PORT#" \
    demo/agenttoll.demo.yaml > .demo/agenttoll.yaml

[ -f .demo/payto.json ] || "$BIN/agenttoll-buyer" --new-solana-keypair .demo/payto.json > .demo/payto.pub
[ -f .demo/buyer.json ] || "$BIN/agenttoll-buyer" --new-solana-keypair .demo/buyer.json > .demo/buyer.pub
export AGENTTOLL_SOLANA_PAYTO="$(cat .demo/payto.pub)"
export AGENTTOLL_ADMIN_TOKEN="${AGENTTOLL_ADMIN_TOKEN:-demo-admin-token-$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')}"

pids=()
cleanup() { for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT INT TERM

ORIGIN_LISTEN=127.0.0.1:$ORIGIN_PORT "$BIN/agenttoll-demo-origin" > .demo/origin.log 2>&1 & pids+=($!)
MOCK_FACILITATOR_LISTEN=127.0.0.1:$FACILITATOR_PORT "$BIN/agenttoll-mock-facilitator" > .demo/facilitator.log 2>&1 & pids+=($!)
sleep 1
"$BIN/agenttoll-gateway" --config .demo/agenttoll.yaml > .demo/gateway.log 2>&1 & pids+=($!)
for _ in $(seq 50); do curl -fs -o /dev/null http://127.0.0.1:$GATEWAY_PORT/ 2>/dev/null && break; sleep 0.2; done

GW=http://127.0.0.1:$GATEWAY_PORT
step() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }

if [ -n "${STACK_ONLY:-}" ]; then
  step "Stack is running with an empty ledger. Ctrl-C stops it."
  echo "gateway $GW | admin http://127.0.0.1:$ADMIN_PORT | origin :$ORIGIN_PORT | facilitator :$FACILITATOR_PORT (SIMULATED)"
  echo "buyer keypair: $ROOT/.demo/buyer.json | pay_to: $AGENTTOLL_SOLANA_PAYTO"
  echo "admin token:   $AGENTTOLL_ADMIN_TOKEN"
  wait
fi

step "1. A human opens the site: free"
curl -s -o /dev/null -w "HTTP %{http_code}\n" -A "Mozilla/5.0 (Macintosh) Chrome/141" -H "Accept-Language: en" -H "Sec-Fetch-Mode: navigate" $GW/api/quote

step "2. An AI crawler asks for the same data: 402 with a price quote"
curl -s -D - -o /dev/null -A "Mozilla/5.0 (compatible; GPTBot/1.2)" $GW/api/quote | grep -iE "^HTTP|^x-agenttoll-verdict"

step "3. Agents read the price list before spending"
curl -s $GW/.well-known/agenttoll.json | python3 -m json.tool | head -20

step "4. The buyer CLI pays \$0.002 (SIMULATED settlement)"
BUYER_SOLANA_KEYPAIR=.demo/buyer.json "$BIN/agenttoll-buyer" $GW/api/quote

step "5. An MCP client calls a paid tool: MCP-native x402 challenge"
curl -s $GW/mcp -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_docs","arguments":{"query":"x402"}}}' \
  | python3 -c 'import sys,json; r=json.load(sys.stdin)["result"]; print("isError:", r["isError"], "| price:", r["structuredContent"]["accepts"][0]["amount"], "atomic USDC")'

step "6. Free discovery still works, with prices advertised"
curl -s $GW/mcp -H "content-type: application/json" -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | python3 -c 'import sys,json; [print("-", t["name"], ":", t["description"]) for t in json.load(sys.stdin)["result"]["tools"]]'

step "7. Unbilled crawler traffic on free pages"
for _ in 1 2 3; do curl -s -o /dev/null -A "Mozilla/5.0 (compatible; ClaudeBot/1.0)" $GW/; done
sleep 0.5

step "8. The founder's ledger (admin API)"
curl -s -H "Authorization: Bearer $AGENTTOLL_ADMIN_TOKEN" http://127.0.0.1:$ADMIN_PORT/admin/stats > .demo/stats.json
python3 - <<'PY'
import json
s = json.load(open(".demo/stats.json"))
t = s["totals"]
print(f"revenue ${t['revenue_atomic'] / 1e6:.3f} | payments {t['payments']} | agents {t['unique_agents']} | unbilled agent requests {t['unbilled_agent_requests']}")
for e in s["recent"][:3]:
    print(" ", e["route"], e["agent_name"], e["tx_signature"], e["status"], "(simulated)" if e["simulated"] else "")
for u in s["unbilled"]:
    n = u["requests"]
    print(f"  not billing yet: {u['agent']} ({u['reason']}) {n} request{'' if n == 1 else 's'}")
PY

if [ -n "${KEEP:-}" ]; then
  step "Stack is running. Dashboard: AGENTTOLL_ADMIN_URL=http://127.0.0.1:$ADMIN_PORT AGENTTOLL_ADMIN_TOKEN=$AGENTTOLL_ADMIN_TOKEN pnpm --dir apps/dashboard dev"
  wait
fi
