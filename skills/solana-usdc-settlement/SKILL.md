---
name: solana-usdc-settlement
description: Solana devnet/mainnet USDC settlement for x402: CAIP-2 IDs, USDC mints, ATAs, faucets, Kora fee payment, facilitator choice, explorer links, PayAI batch mode. Use for any Solana payment code or demo wallet setup.
---
# Solana USDC settlement

## Retrieve
KB-SOL-01 (IDs, mints), KB-SOL-02 (Kora), KB-SOL-03 (batch settlement), KB-X402-04 (facilitators).

## Demo wallet setup (Joseph runs; never commit keys)
```bash
solana config set --url devnet
solana-keygen new -o ./payto.keypair.json      # founder payTo (devnet)
solana-keygen new -o ./buyer.keypair.json      # Claude's buyer wallet (devnet)
solana airdrop 1 $(solana-keygen pubkey ./buyer.keypair.json)
spl-token create-account <DEVNET_USDC_MINT> --owner ./payto.keypair.json --fee-payer ./buyer.keypair.json
# Fund buyer with devnet USDC at https://faucet.circle.com
```

## Rules
- `payTo` is the owner pubkey; funds land in its ATA for the USDC mint. Create the ATA before the demo.
- Fee payer: facilitator (Kora or PayAI) so the buyer only needs USDC. Read `extra.feePayer` from facilitator `/supported` if the scheme requires it.
- Confirmation: treat `confirmed` as settled for the demo; record the signature; link `https://explorer.solana.com/tx/<sig>?cluster=devnet`.
- Batch/channel mode (PayAI) is mainnet-only today: stretch goal, behind a config flag.
