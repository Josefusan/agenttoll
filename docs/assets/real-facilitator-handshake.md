# Real-facilitator handshake (Solana devnet, no funds)

**Real PayAI facilitator on Solana devnet, unfunded throwaway wallet. The payment was rejected as expected, so no transaction exists. This shows the wire format and verify path against the real facilitator, not a settlement.**

Date: 2026-10-04. Gateway built from `feat/d9-away` sources; binaries reused from the `AgentToll-d8` target directory.

The three judges named the same top gap: every payment in the demo is settled by the local
SIMULATED facilitator, so the Solana claim is never put in front of the real x402 facilitator.
Funding is off the table for this task, so the honest way to close part of the gap is to prove the
wire format end to end and show the real facilitator rejecting the payment. That is what this page
records. The rejection is the evidence. Nothing here is on chain.

## What was run

Throwaway keypair, outside every repo, never funded:

```
mkdir -p ~/agenttoll-scratch && chmod 700 ~/agenttoll-scratch
agenttoll-buyer --new-solana-keypair ~/agenttoll-scratch/throwaway-buyer.json
# -> E1vu71YssBkM7WAxoPhtCfH8cNp8nHtZrGnedzevYSai   (mode 600, never funded)
```

A throwaway gateway on loopback, pointed at the running demo origin, the real PayAI facilitator,
and the public `pay_to`. The admin token is a fresh random value in a mode-600 file and is never
printed. Config (`~/agenttoll-scratch/agenttoll.handshake.yaml`) keeps `facilitator:
https://facilitator.payai.network`, `network: solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`, the devnet
USDC asset, and `pay_to: FFgkc6ZmZHPrRwjyBFL56VP6u572g27TAyAdVqmBro7d`:

```
tmux new-session -d -s at18402 "cd ~/agenttoll-scratch && \
  AGENTTOLL_ADMIN_TOKEN=$(cat admin-token) \
  ~/Hackathons/AgentToll-d8/target/release/agenttoll-gateway \
  --config ~/agenttoll-scratch/agenttoll.handshake.yaml"
```

The buyer pays that gateway with the throwaway key only:

```
BUYER_SOLANA_KEYPAIR=~/agenttoll-scratch/throwaway-buyer.json \
  agenttoll-buyer --network solana http://127.0.0.1:18402/api/quote
```

## What came back

Buyer stdout/stderr (exit code 1):

```
buyer E1vu71YssBkM7WAxoPhtCfH8cNp8nHtZrGnedzevYSai on Solana devnet
status: 402 Payment Required
body:   {"x402Version":2,"error":"invalid_exact_svm_transaction_simulation_failed",
         "resource":{"url":"http://127.0.0.1:18402/api/quote","description":"Live price quote"},
         "accepts":[{"scheme":"exact",
                     "network":"solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
                     "amount":"2000",
                     "asset":"4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
                     "payTo":"FFgkc6ZmZHPrRwjyBFL56VP6u572g27TAyAdVqmBro7d",
                     "maxTimeoutSeconds":60,
                     "extra":{"feePayer":"2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4"}}]}
Error: request failed with 402 Payment Required and no payment receipt
```

Gateway log at `debug` shows the outbound connection to the real facilitator:

```
DEBUG reqwest::connect: starting new connection 'Some("facilitator.payai.network")'
DEBUG hyper_util::client::legacy::pool: pooling idle connection for ("https", facilitator.payai.network)
DEBUG hyper_util::client::legacy::pool: reuse idle connection for ("https", facilitator.payai.network)
```

The `feePayer` in the quote matches the real facilitator. `GET /supported` on
`https://facilitator.payai.network` (fetched the same day) lists, for
`solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`, `scheme: exact`, `x402Version: 2` with
`extra.feePayer: 2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4`. The gateway reads that value from
the facilitator at startup (KB-X402-04), so the quote proves the real `/supported` was reached.

## Read this correctly

- The facilitator was reached and it validated the transaction it was shown. It answered with
  `isValid: false` and the reason `invalid_exact_svm_transaction_simulation_failed`: the unfunded
  throwaway wallet cannot move 2000 atomic USDC, so the transfer simulation fails (no funded token
  account). The gateway then re-issued the 402.
- No transaction was signed onto the chain, no signature exists, and there is no explorer link.
  This is a rejection, not a settlement.
- The value it proves is the wire format: the real facilitator `/supported` feePayer flows into
  the AgentToll quote, and the AgentToll verify path speaks the real facilitator `/verify` API and
  surfaces its `invalidReason`. A funded wallet is the only missing piece, and it is deliberately
  out of scope for this task.
