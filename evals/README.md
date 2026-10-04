# AgentToll end-to-end evals

A black-box suite that checks AgentToll's product promises against a running stack. It uses
only Python 3 standard library and real HTTP. It never reads gateway internals.

All payments here are SIMULATED. The suite starts the demo origin, the mock facilitator
(`SIMULATED-` transaction ids) and the gateway on private ports. Nothing touches a chain, and
no wallet is funded. Keypairs are throwaway files created in a temp directory and deleted at the end.

## Run

```bash
cargo build --release -p agenttoll-gateway -p agenttoll-demo-origin -p agenttoll-buyer -p agenttoll-mock-facilitator
python3 evals/run.py                 # all cases
python3 evals/run.py --only MCP-     # cases whose id starts with MCP-
python3 evals/run.py --list          # ids and promises
python3 evals/run.py --build         # build first (CARGO_BUILD_JOBS defaults to 2)
python3 evals/run.py --keep          # keep logs and the ledger in the temp dir
```

The run exits 1 if any case fails (2 if the stack cannot start). It writes
`evals/results/latest.json` and `evals/results/latest.md` (case id, promise, pass or fail, evidence).

Binaries come from `$EVAL_BIN_DIR`, else `$CARGO_TARGET_DIR/release`, else `target/release`,
else `target/debug`. Ports are `EVAL_GATEWAY_PORT` (18402), `EVAL_ADMIN_PORT` (18403),
`EVAL_ORIGIN_PORT` (14000), `EVAL_FACILITATOR_PORT` (14020).

The buyer CLI cases need a Solana RPC endpoint to read a recent blockhash. The default is
`https://api.devnet.solana.com`; override with `EVAL_SOLANA_RPC`. Reading is free.

## Layout

| Path | What |
|---|---|
| `run.py` | Starts and stops the stack, runs cases, writes results |
| `checks.py` | Custom checks for cases that need more than one request (buyer CLI, ledger cross-checks, SSE) |
| `cases/vars.json` | User-agent strings by alias |
| `cases/NN-*.json` | Case lists, run in file order |
| `results/` | `latest.json`, `latest.md` from the last run |

## Case format

```json
{
  "id": "PAY-01",
  "promise": "Pay the quote: 200, SIMULATED- tx id",
  "steps": [
    {"id": "q", "request": {"path": "/api/quote", "agent": "GPTBot"}, "expect": {"status": 402}},
    {"request": {"path": "/api/quote", "agent": "GPTBot"},
     "pay": {"from": "q"},
     "expect": {"status": 200, "receipt": {"/transaction": {"re": "^SIMULATED-"}}}}
  ]
}
```

- `request`: `method`, `path` (sent byte for byte, so bypass paths are not normalized by the client),
  `agent` (alias from `vars.json`; `human-*` aliases add browser headers), `headers`, `json`, `body`,
  `base` (`gateway` default, `admin`, `facilitator`), `auth` (`bearer`, `wrong`, `empty`, `query`).
- `pay`: build a `PAYMENT-SIGNATURE` from the challenge of an earlier step (`from`). Options:
  `accept` (index in `accepts[]`), `tamper` (dotted overrides on `accepted`), `version`, `drop`
  (top-level keys to remove), `transport` (`header` or `mcp-meta`), `reuse` (resend the exact
  header of an earlier step, for replay), `raw` (literal header value).
- `expect`: `status`, `headers`, `json` (response body), `challenge` (decoded `PAYMENT-REQUIRED`),
  `receipt` (decoded `PAYMENT-RESPONSE`), `body_contains`, `body_not_contains`. Fields are JSON
  pointers. A value is a literal or one of `re`, `absent`, `exists`, `in`, `ne`, `gte`, `lte`,
  `contains`, `not_contains`, `type`. `$name` refers to a run variable (`payto`, `solana_network`,
  `solana_usdc`, `base_network`, `base_usdc`, `base_payto`, `admin_token`).
- A step may be `{"check": "<function in checks.py>", "args": {...}}` instead of a request.

The runner counts every settlement it observes. `STAT-01` then requires the ledger to match that
total exactly, so any refused, replayed, tampered or failed attempt that was charged shows up as a failure.

## Groups

HUM (humans and non-charged clients are free), AGT (declared agent classes get 402), X402 (quote
shape), DISC (price list), PAY (paid flow, buyer CLI, Base rail), REPLAY (replay and origin
failure), TAMPER (tampered or malformed payments), BIND (payment bound to its resource),
MCP, NORM (path bypass attempts), ADM (admin auth), LOG (unbilled traffic log), FAIL (facilitator
down), STAT (ledger and simulated-money reporting).

## Adding a case

Append to the list in the right `cases/NN-*.json` file with a unique id. Cases share one gateway
and one ledger, so keep each case self-contained (fetch its own quote with `pay.from`).
