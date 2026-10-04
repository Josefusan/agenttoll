#!/usr/bin/env bash
# Funding-day preflight for a real Solana devnet payment.
# READ-ONLY: it never reads a keypair file, never signs and never sends a transaction. It only
# reads public devnet state and the real facilitator's /supported.
#
#   bash scripts/real-payment-preflight.sh <buyer-pubkey> <payto-pubkey>
#
# Both arguments are Solana public addresses. Exit 0 when the last line is READY, 1 when NOT READY.
set -u

RPC="${SOLANA_RPC_URL:-https://api.devnet.solana.com}"
MINT="4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"          # devnet USDC (KB-SOL-01)
NETWORK="solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"            # Solana devnet (KB-SOL-01)
FACILITATOR="https://facilitator.payai.network"              # KB-X402-04
MIN_ATOMIC=2000                                              # $0.002 (KB-AMT-01)

buyer="${1:-}"
payto="${2:-}"
if [ -z "$buyer" ] || [ -z "$payto" ]; then
  echo "usage: bash scripts/real-payment-preflight.sh <buyer-pubkey> <payto-pubkey>" >&2
  exit 2
fi

ready=1

# Prints 'error: <reason>', 'none', or the largest USDC balance in atomic units for the owner.
usdc_state() {
  local owner="$1"
  curl -s --max-time 25 "$RPC" -X POST -H 'content-type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getTokenAccountsByOwner\",\"params\":[\"$owner\",{\"mint\":\"$MINT\"},{\"encoding\":\"jsonParsed\"}]}" \
  | python3 -c '
import json, sys
try:
    d = json.loads(sys.stdin.read())
except Exception:
    print("error: unreadable JSON-RPC response"); sys.exit(0)
if isinstance(d, dict) and d.get("error"):
    print("error: " + str(d["error"].get("message", d["error"]))[:120]); sys.exit(0)
vals = (d.get("result") or {}).get("value") or []
best = None
for a in vals:
    try:
        amt = int(a["account"]["data"]["parsed"]["info"]["tokenAmount"]["amount"])
        best = amt if best is None else max(best, amt)
    except Exception:
        pass
print("none" if best is None else best)
'
}

bs="$(usdc_state "$buyer")"
case "$bs" in
  error:*) echo "FAIL buyer: $bs"; ready=0 ;;
  none)    echo "FAIL buyer: no USDC token account for mint $MINT"; ready=0 ;;
  *) if [ "$bs" -ge "$MIN_ATOMIC" ]; then
       echo "PASS buyer: USDC balance $bs atomic (>= $MIN_ATOMIC)"
     else
       echo "FAIL buyer: USDC balance $bs atomic (< $MIN_ATOMIC)"; ready=0
     fi ;;
esac

ps="$(usdc_state "$payto")"
case "$ps" in
  error:*) echo "FAIL payTo: $ps"; ready=0 ;;
  none)    echo "FAIL payTo: no USDC token account for mint $MINT (the destination account must exist, KB-X402-07)"; ready=0 ;;
  *) echo "PASS payTo: USDC token account exists ($ps atomic)" ;;
esac

fee="$(curl -s --max-time 25 "$FACILITATOR/supported" | python3 -c '
import json, sys
network = sys.argv[1]
try:
    d = json.load(sys.stdin)
except Exception:
    print(""); sys.exit(0)
for k in d.get("kinds", []):
    if (k.get("x402Version") == 2 and k.get("scheme") == "exact"
            and k.get("network") == network):
        fp = (k.get("extra") or {}).get("feePayer")
        if fp:
            print(fp); sys.exit(0)
print("")
' "$NETWORK")"
if [ -n "$fee" ]; then
  echo "PASS facilitator: v2 exact on $NETWORK, feePayer $fee"
else
  echo "FAIL facilitator: $FACILITATOR/supported does not list v2 exact on $NETWORK with a feePayer"; ready=0
fi

if [ "$ready" -eq 1 ]; then
  echo "READY"
  exit 0
fi
echo "NOT READY"
exit 1
