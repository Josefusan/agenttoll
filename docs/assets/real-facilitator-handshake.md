# Real-facilitator handshake (Solana devnet, no funds)
> **Path note (added 2026-10-06).** Commands below are the pre-reorg paths, kept as the record of what was run on 2026-10-04. `~/agenttoll-scratch` is now `~/agenttoll/scratch`; see `~/AGENT_CONTEXT.md` for the full old-to-new map.


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
  `isValid: false` and the reason `invalid_exact_svm_transaction_simulation_failed`. The gateway
  then re-issued the 402. On 2026-10-04, `getTokenAccountsByOwner` on devnet showed no USDC token
  account for either the throwaway buyer (`E1vu71Ys...`) or the payTo (`FFgkc6Zm...`). The source and
  the destination account are both missing, and the exact scheme needs the destination one to exist
  (KB-X402-07). The facilitator returns only the reason code, so this page does not say which
  missing account failed the simulation first.
- No transaction was signed onto the chain, no signature exists, and there is no explorer link.
  This is a rejection, not a settlement.
- The value it proves is the wire format: the real facilitator `/supported` feePayer flows into
  the AgentToll quote, and the AgentToll verify path speaks the real facilitator `/verify` API and
  surfaces its `invalidReason`. A funded wallet is the only missing piece, and it is deliberately
  out of scope for this task.

## Base Sepolia

Real x402.org testnet facilitator on Base Sepolia, unfunded throwaway wallet. The payment was rejected as expected, so no transaction exists. This shows the wire format and verify path against the real facilitator, not a settlement.

Date: 2026-10-04. Same gateway build as above, with a base-only config copied from the `eip155:84532`
block of `agenttoll.example.yaml`.

Throwaway EVM keys, outside every repo, never funded (mode 600, never printed):

```
python3 -c "import secrets;print('0x'+secrets.token_hex(32))" > ~/agenttoll-scratch/throwaway-evm-buyer.key
python3 -c "import secrets;print('0x'+secrets.token_hex(32))" > ~/agenttoll-scratch/throwaway-evm-payto.key
# buyer 0x6CAdd3692c29fAda4698844a8cAa22EfE7f8E02e ; payTo 0x3DDfb063ECA1dAFc7259EeE4a36D38f6769edfBa
```

A throwaway gateway on loopback (admin token a fresh random mode-600 file and never printed),
pointed at the demo origin and the real x402.org testnet facilitator, `network: eip155:84532`, asset
`0x036CbD53842c5426634e7929541eC2318f3dCF7e`, `pay_to` the throwaway address above:

```
tmux new-session -d -s at18402b "cd ~/agenttoll-scratch && \
  AGENTTOLL_ADMIN_TOKEN=$(cat admin-token-base) RUST_LOG=debug \
  ~/Hackathons/AgentToll-d8/target/release/agenttoll-gateway \
  --config ~/agenttoll-scratch/agenttoll.handshake-base.yaml"

BUYER_EVM_PRIVATE_KEY=$(cat ~/agenttoll-scratch/throwaway-evm-buyer.key) \
  agenttoll-buyer --network base http://127.0.0.1:18402/api/quote
```

What came back (buyer exit code 1):

```
buyer 0x6CAdd3692c29fAda4698844a8cAa22EfE7f8E02e on Base Sepolia
status: 402 Payment Required
body:   {"x402Version":2,"error":"invalid_exact_evm_insufficient_balance",
         "resource":{"url":"http://127.0.0.1:18402/api/quote","description":"Live price quote"},
         "accepts":[{"scheme":"exact","network":"eip155:84532","amount":"2000",
                     "asset":"0x036CbD53842c5426634e7929541eC2318f3dCF7e",
                     "payTo":"0x3DDfb063ECA1dAFc7259EeE4a36D38f6769edfBa",
                     "maxTimeoutSeconds":60,"extra":{"name":"USDC","version":"2"}}]}
Error: request failed with 402 Payment Required and no payment receipt
```

Gateway log at `debug` (outbound to the real facilitator):

```
DEBUG reqwest::connect: starting new connection 'Some("x402.org")'
DEBUG hyper_util::client::legacy::pool: pooling idle connection for ("https", x402.org)
```

`GET https://x402.org/facilitator/supported` (same day, HTTP 200) lists
`{x402Version: 2, scheme: exact, network: eip155:84532}`, and its `signers.eip155` is
`0xd407e409E34E0b9afb99EcCeb609bDbcD5e7f1bf`.

### Why the reason is the real facilitator

`crates/agenttoll-gateway/src/pay.rs` refuses with the facilitator's own string:

```rust
if !verified.is_valid {
    gw.replay.release(&replay_key);
    return refuse(verified.invalid_reason.as_deref().unwrap_or("payment is invalid"));
}
```

The local test facilitator (`demo/mock-facilitator`) cannot produce it: its only verify reasons are
`invalid_x402_version`, `invalid_payload`, `invalid_payment_requirements` and `mock_verify_failure`
(shape checks plus a test knob). `invalid_exact_evm_insufficient_balance` is not one of them, so it
came from the real x402.org facilitator.

### Cause

The facilitator returned `invalid_exact_evm_insufficient_balance`: the unfunded buyer holds no Base
Sepolia USDC, so the EIP-3009 authorization cannot be simulated. This page states the cause only as
far as the reason code goes. No transaction was signed onto the chain and no signature exists.
