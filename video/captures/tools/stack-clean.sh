#!/usr/bin/env bash
# Restart the demo stack on the film's spare ports with a truly empty ledger.
# Same binaries, config and env as `STACK_ONLY=1 bash scripts/demo-local.sh` (run that once
# first: it builds, writes .demo/agenttoll.yaml, the throwaway keypairs and the admin token),
# minus the script's `curl` readiness probe, which the gateway would correctly count as one
# unbilled agent request (heuristic:tool-ua:curl) before the "empty" screenshot.
# Readiness is checked with `ss` instead, so no HTTP request reaches the gateway.
#   CARGO_TARGET_DIR=... bash video/captures/tools/stack-clean.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"
BIN="${CARGO_TARGET_DIR:?set CARGO_TARGET_DIR}/debug"
[ -f .demo/agenttoll.yaml ] && [ -f .demo/payto.pub ] && [ -f .demo/admin-token ] || { echo "run scripts/demo-local.sh once first" >&2; exit 1; }
export AGENTTOLL_SOLANA_PAYTO="$(cat .demo/payto.pub)"
AGENTTOLL_ADMIN_TOKEN="$(cat .demo/admin-token)"; export AGENTTOLL_ADMIN_TOKEN
rm -f .demo/agenttoll-demo.db .demo/agenttoll-demo.db-shm .demo/agenttoll-demo.db-wal
pids=()
cleanup() { for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT INT TERM HUP
ORIGIN_LISTEN=127.0.0.1:4100 "$BIN/agenttoll-demo-origin" > .demo/origin.log 2>&1 & pids+=($!)
MOCK_FACILITATOR_LISTEN=127.0.0.1:4120 "$BIN/agenttoll-mock-facilitator" > .demo/facilitator.log 2>&1 & pids+=($!)
sleep 1
"$BIN/agenttoll-gateway" --config .demo/agenttoll.yaml > .demo/gateway.log 2>&1 & pids+=($!)
for _ in $(seq 50); do ss -ltn 'sport = :8502' | grep -q LISTEN && break; sleep 0.2; done
echo "stack up on 8502/8503/4100/4120 (SIMULATED facilitator), empty ledger, pids ${pids[*]}"
wait
