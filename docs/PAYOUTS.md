# Payouts: how AgentToll revenue becomes dollars in a bank account

Audience: founders running AgentToll. Also the answer to "should we add a neobank integration?"

Short answer: not as a live integration during the hackathon. AgentToll already supports the only part that matters for cash-out: `pay_to` is any Solana or Base address you choose. Point it at a wallet you control, or at a deposit address issued by a stablecoin business account or off-ramp, and USDC from agents lands there with no AgentToll code in the money path. This document explains the options, what each one requires, and what to do today versus after Oct 12.

All facts below were checked on 2026-10-02 against the linked pages. Anything we could not confirm on a primary page is marked UNVERIFIED. Nothing here is financial, legal or tax advice.

## 1. The shape of the problem

- AgentToll settles each agent payment as its own on-chain USDC transfer to `pay_to` (ARCHITECTURE.md §1.4, KB-X402-07). Payments are tiny: $0.001 to $0.05 per request in the default price file.
- AgentToll never holds funds or keys (DECISIONS.md, 2026-10-02 "Non-custodial"). So "get dollars in the bank" has to happen downstream of `pay_to`, operated by the founder or a provider the founder has an account with.
- Every provider that touches a bank account requires the account holder to pass KYC (individual) or KYB (business). None of them run on Solana devnet. Both facts rule out a live bank integration in the hackathon demo, which is devnet-only and has no KYB'd business account behind it.
- Off-ramps have per-transaction minimums and exchanges may not credit dust. Streams of $0.002 deposits are the wrong input for a bank rail. The right pattern is: micro-payments in to a wallet you control, periodic batched sweeps out to the off-ramp.

## 2. Options table (seller side: USDC to bank)

| Option | What it is | USDC on Solana | USDC on Base | Address usable as `pay_to` | KYC/KYB | Sandbox | API or no-code | Fees (published) | Verdict for AgentToll |
|---|---|---|---|---|---|---|---|---|---|
| Your own wallet (Phantom, Solana CLI, Squads multisig, hardware) | Self-custody. You sweep to an off-ramp when you want dollars | Yes | Yes (EVM wallet) | Yes, this is the default | None for the wallet; KYC at whichever off-ramp you later use | Devnet works today | n/a | Network fees only | **Default for everyone, and the only thing that works on devnet** |
| Bridge (Stripe) liquidation address | A permanent on-chain address that auto-routes incoming USDC to a bank account (ACH, wire, SEPA and more) or another chain | Yes (`chain: solana`) | Yes (`chain: base`) | Yes in principle: it is a permanent address. UNVERIFIED: per-deposit minimums for $0.002 drains, and whether Bridge credits SPL transfers that include the x402 memo instruction | Bridge is a B2B API. The end "customer" must have `kyc_status: approved` and accept Bridge's ToS; the developer needs a Bridge dashboard account. Developer onboarding terms UNVERIFIED | Yes: `api.sandbox.bridge.xyz`, `simulate_kyc_approval`, fake liquidation addresses. **No testnet; sandbox addresses are fake and never touch a chain** | API | Developer fee optional, default 0. Bridge's own fee is not on the public docs page we checked (third-party reports 0.25% orchestration, UNVERIFIED) | Best candidate for the post-hackathon "agent revenue lands in your bank" integration |
| Stripe financial account, stablecoin balance | Your Stripe financial account holds a USDC balance; you add funds by sending USDC to a deposit address; pay out to a US bank over ACH or wire | Yes | Yes | Likely: Stripe issues a deposit address per network. UNVERIFIED: whether the address is permanent and reusable, and whether it is exposed via API | Standard Stripe business verification. USDC balance is GA for US legal entities, private preview elsewhere | UNVERIFIED for stablecoin balances | Dashboard (crypto deposit); API for fiat moves | Not stated for stablecoin payouts on the pages checked; fiat transfers to your own bank are free, 1 to 2 business days | Good no-code path for US founders who already use Stripe. Bridge custodies the USDC |
| Coinbase Business | Business account: receive USDC, payment links, payouts, cash out to a linked business bank account | Yes (Coinbase credits USDC on Solana, per Coinbase help) | Yes | Likely (exchange deposit address). UNVERIFIED for Business accounts, and dust deposits may not be credited | KYB. Reported as available to US and Singapore C-corps and LLCs (help center blocked our fetch; UNVERIFIED) | No | Dashboard; Payment Links API "upcoming" per Oct 2025 launch coverage | ACH cash-out free, wire fee reported by third parties (UNVERIFIED for Business) | Workable custodial option for US entities. Not demoable |
| Squads Altitude | Self-custodial business account on stablecoin rails: USD and EUR accounts, cards, bill pay, bank connectivity via partners | Squads is Solana-native; the Altitude page does not list chains. UNVERIFIED | Not stated. UNVERIFIED | If the account is a Solana address the customer controls, yes. UNVERIFIED | KYB, sanctions screening, eligible jurisdictions | No | Web app; API not stated | "Zero onramp and offramp fees" stated; FX and other fees disclosed per transaction | Closest match to AgentToll's non-custodial story and to the Solana track. Worth a conversation after the hackathon |
| Coinflow | Off-ramp provider (Squads' official partner): USDC to bank via ACH, SEPA, RTP, PIX and more | Yes (Solana listed) | Base not listed on the pages found (Solana, Ethereum, Polygon, Near) | No. It is a withdrawal flow, not a standing deposit address | KYC inside the withdraw component; merchant onboarding UNVERIFIED | Has a testnet USDC faucet in its API reference | API + React component | Not found | A building block for a future "sweep and cash out" button, not a `pay_to` destination |
| Kast | Consumer stablecoin account with a US account number plus ACH details and an EU IBAN, Visa card | Yes | Not listed (Ethereum, Solana, Polygon, Arbitrum, Tron) | Yes, as a personal deposit address (custodial on Kast's side). UNVERIFIED for micro-deposits | Individual KYC. Business tier "launching in 2026" per third parties, UNVERIFIED | No | App | Third parties report 0% stablecoin deposit fee; Kast's fee page blocked our fetch, UNVERIFIED | Simplest path for a solo founder who is fine with a consumer account |
| Circle Mint | Institutional USDC mint/redeem account; redeem USDC for a USD wire | Yes (chain code `SOL`) | Yes (`BASE`) | n/a | Institutional KYB; "not available to individuals" | Separate testnet keys mentioned, details UNVERIFIED | API | Not published | Not a fit for an indie founder |
| Mercury | US business bank (fiat only) | No | No | No | KYB | n/a | n/a | n/a | The bank account on the far end of Bridge, Stripe or Coinbase. Does not hold stablecoins (third-party reviews; Mercury's own page not checked, UNVERIFIED) |

Sources for the table are in KB-PAY-01 to KB-PAY-05 in `docs/KNOWLEDGE_BASE.md`.

## 3. Buyer side: how an agent's wallet gets funded

| Option | What it does | Networks | Funding | Spend controls | Devnet |
|---|---|---|---|---|---|
| AgentToll `pay-mcp` (ours) | `pay_and_fetch(url, max_usd)` and `wallet_status()` for Claude Desktop and Claude Code | Solana devnet first, Base Sepolia fallback | Founder funds the buyer keypair from faucet.circle.com (devnet) | `BUYER_MAX_USD_PER_CALL`, `BUYER_MAX_USD_PER_DAY` | Yes |
| Coinbase Payments MCP (Agentic Wallet MCP) | `npx @coinbase/payments-mcp`: wallet, x402 service discovery, automatic x402 payments | Base, Polygon, Solana | "Use Coinbase Onramp to add USDC" | User-set max per call and per session | Not mentioned on the page checked |
| Coinbase Onramp | Fiat to crypto "to any wallet address" with debit card, Apple Pay, Google Pay, ACH (US) | Solana and Base listed | Card or bank | n/a | Sandbox with test cards reported by search; the sandbox page returned 404 for us, UNVERIFIED |
| PayAI payment channels (KB-SOL-03) | Buyer funds a channel once (0.01 to 100 USDC); merchant claims in batches | Solana mainnet only | USDC transfer | Channel cap | No |

What this means for AgentToll: any agent that can produce an x402 v2 `PAYMENT-SIGNATURE` for USDC on Solana or Base can pay an AgentToll gateway. Coinbase's own MCP already lists Solana, so the buyer side is not something we need to build beyond our demo tool.

## 4. Recommendation

### Hackathon (now to Oct 12): no neobank API integration. Ship the "payout destination" pattern.

Evidence:
1. Every bank-touching option needs KYB or KYC and a live account (sections 2 and 3). We have no KYB'd business account and ten days.
2. None of them run on Solana devnet. Bridge's sandbox explicitly has "no testnet support" and uses fake addresses, so a sandbox integration could not appear in a devnet demo anyway.
3. AgentToll's trust story is non-custodial. A `pay_to` that happens to be a Bridge, Stripe or Altitude address keeps AgentToll out of the money path and lets the founder choose their custodian. That is a better story for judges than a fourth custodial hop.
4. Micro-payments and off-ramps do not mix (section 1). The honest architecture is wallet in, batched sweep out. That is a documentation and roadmap item, not a sprint.

Deliverables that fit in the remaining days (docs and a small dashboard panel, no money-path code):
- `agenttoll.example.yaml`: a comment on `pay_to` saying it can be a self-custody wallet, a stablecoin business account deposit address, or an off-ramp liquidation address, with a link to this file. (Owner of the config file applies it; not changed from this worktree.)
- Dashboard: a "Cash out" panel that shows the `pay_to` USDC balance read from chain (devnet or mainnet) and links to section 5 below. Read-only.
- README: one line under "How it works": "Earnings land in the `pay_to` account you choose. See docs/PAYOUTS.md for turning USDC into dollars."
- ROADMAP stretch: "Payout destinations: optional Bridge liquidation address or Stripe deposit address as `pay_to`, created by the founder in their own account; AgentToll never holds funds."

### Post-hackathon (first 90 days): native payout destinations, still non-custodial.

1. Bridge liquidation addresses as the first integration target: permanent address, Solana and Base both supported, bank rails include ACH, same-day ACH, wire, SEPA, SPEI, Pix. The founder is the Bridge customer and completes KYB in their own name; AgentToll (hosted edition) can create the liquidation address through the API and write it into `pay_to`. Before building, confirm the two UNVERIFIED items: minimum deposit per drain, and crediting of SPL transfers that carry the x402 memo instruction.
2. Sweeper: a founder-run job (their key, their machine or our hosted edition acting under a spend-limited delegation) that moves the `pay_to` balance to the off-ramp address when it crosses a threshold. This also solves the micro-deposit minimum problem.
3. Talk to Squads about Altitude: if an Altitude account is a Solana address the founder controls, it is the most on-brand `pay_to` for the Solana ecosystem, with ACH, SEPA, wire and SWIFT behind it.
4. Keep Stripe financial account and Coinbase Business as documented no-code paths for US founders.

## 5. Step-by-step: cash out today (founder guide)

### Devnet (hackathon demo)
Devnet USDC has no cash value. Nothing to cash out. Use the `pay_to` balance on the dashboard and the explorer link as the proof.

### Mainnet, simplest path (self-custody wallet, manual cash-out)
1. Create a Solana wallet you control (Phantom, Solana CLI, or a Squads multisig). Create its USDC associated token account before going live (KB-SOL-01).
2. Put the owner pubkey in `networks.solana.pay_to`. For Base, put your EVM address in `networks.base.pay_to`.
3. Switch `network` and `asset` to mainnet values (KB-SOL-01, KB-BASE-01) and the facilitator to a mainnet facilitator (KB-X402-04). Joseph approves any mainnet change (ARCHITECTURE.md §2.1).
4. When the balance is worth moving, send USDC from that wallet to the deposit address of the account you cash out through: Kast (individual), Stripe financial account, Coinbase Business, or Altitude (business). Pay out to your bank from there.
5. Keep the dashboard CSV export and the explorer signatures for your books. Each settlement is an on-chain receipt.

### Mainnet, automatic path (Bridge liquidation address; needs a Bridge account and KYB)
1. Onboard with Bridge, create yourself as a customer, pass KYB, accept ToS, register your bank account as an external account.
2. `POST /v0/customers/{customer_id}/liquidation_addresses` with `chain: solana`, `currency: usdc`, `destination_payment_rail: ach` (or `wire`, `ach_same_day`, `sepa`), and your external account id. Do the same with `chain: base` for Base.
3. Prefer not to put the liquidation address directly in `pay_to` until the minimum-deposit question is confirmed. Instead, set `pay_to` to your own wallet and sweep to the liquidation address on a threshold. ACH drains are batched daily by Bridge; wire and SEPA are real-time.
4. Check `GET .../liquidation_addresses/{id}/drains` to reconcile what landed in the bank against the dashboard ledger.

## 6. What is UNVERIFIED (check before building or promising)

- Bridge: per-deposit minimum for liquidation address drains; handling of SPL transfers with the x402 memo instruction; Bridge's own fee schedule; developer onboarding requirements for a solo founder.
- Stripe: whether the crypto deposit address is permanent and reusable, whether it is available via API, stablecoin payout fees, test mode for stablecoin balances.
- Coinbase Business: eligibility list, Business deposit addresses, dust crediting, wire fee. The help center returned 403 to our fetch; claims come from launch coverage and third-party summaries.
- Squads Altitude: which chains and stablecoins are accepted; whether the account is a founder-controlled Solana address; API availability.
- Kast: fee schedule (help center returned 403), business tier timing, micro-deposit handling.
- Coinflow: merchant onboarding, fees, Base support.
- Mercury: "fiat only" comes from third-party reviews, not Mercury's own page.
- Coinbase Onramp sandbox: page returned 404; test-card details come from search summaries only.

## 7. Open questions for Joseph

1. Which entity would hold the payout account later: Clark Technology Ventures (KYB) or you personally (KYC, Kast-style)? This decides whether Bridge or Kast is the first real-money path.
2. Do you want the read-only "Cash out" dashboard panel in the D4 scope, or keep D4 to the live feed and add it on D9 if time allows?
3. Should the pitch video name Bridge and Altitude as the roadmap integrations, or keep it to "off-ramp partners"? Naming is more concrete; both are unconfirmed relationships.
