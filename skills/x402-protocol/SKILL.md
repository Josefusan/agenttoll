---
name: x402-protocol
description: Reference and rules for implementing x402 v2 pay-per-request on HTTP and MCP: headers, PaymentRequired/PaymentPayload shapes, exact scheme, facilitator verify/settle order, amounts. Use whenever code builds, parses or validates x402 challenges or payments.
---
# x402 protocol (AgentToll)

## Retrieve first
KB chunks: KB-X402-01 (headers), KB-X402-02/03 (SDKs), KB-X402-04 (facilitators), KB-X402-05 (MCP), KB-AMT-01 (amounts). Spec of record: https://github.com/coinbase/x402/tree/main/specs. If the spec and the KB disagree, the spec wins; fix the KB.

## Flow AgentToll implements
1. Unpaid priced request → `402` + `PAYMENT-REQUIRED: base64(PaymentRequired)`.
2. Client retries with `PAYMENT-SIGNATURE: base64(PaymentPayload)`.
3. Gateway → facilitator `/verify`. Invalid → `402` again with a reason.
4. Forward to origin. Origin 2xx → facilitator `/settle`. Non-2xx → no settle, pass status through.
5. Respond with `PAYMENT-RESPONSE: base64(SettleResponse)`; write ledger row.

## PaymentRequired essentials
- `x402Version: 2`
- `accepts[]`: one per configured network: `scheme: "exact"`, `network` (CAIP-2), `asset`, `amount` (atomic string), `payTo`, `maxTimeoutSeconds`, resource URL + description, optional `extra` (e.g. Solana fee payer from facilitator `/supported`).
- Field names: copy from the spec / SDK types. Do not hand-roll if the SDK exposes the type.

## Rules
- Integers only. $0.002 = "2000".
- Same request must produce the same requirements (deterministic) so retries validate.
- Bind the payment to the resource: include method + path in the resource field; reject payloads for a different resource.
- Time-box verify/settle calls (2 s / 10 s). On facilitator timeout during settle after forwarding: return the origin response, mark the ledger row `settle_pending`, retry in background.
- Log the decoded challenge and verdict at debug level; never log raw signatures at info.

## Test vectors to write
- Decode/encode round-trip of PaymentRequired.
- Wrong network, wrong amount, wrong payTo, expired payload → 402.
- Origin 500 → no settle call (assert with a mock facilitator).
