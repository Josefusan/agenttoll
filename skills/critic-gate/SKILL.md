---
name: critic-gate
description: Adversarial review checklist for AgentToll changes before merge: acceptance criteria, x402 correctness, money-path safety, secrets, human-path safety, demo risk. Use when acting as critic-gate or self-reviewing.
---
# Critic gate

Pattern from Website Factory's review agent: the builder never approves its own work.

## Checklist
1. Acceptance criteria for the slice (docs/ROADMAP.md) met and demonstrated by a test or command output.
2. Protocol constants trace to a verified KB chunk; no VERIFY-tagged constant in the money path.
3. Money path: integers only; settle only after origin 2xx; idempotent ledger; timeouts set.
4. Human path: no new latency-heavy work; detector biased to human when unsure.
5. Security: no secrets, keys or `.env` in diff; admin API requires token; payload size caps; no panics on malformed base64/JSON.
6. Demo: `docker compose up` and the buyer command still work.
7. Docs: README/ARCHITECTURE updated if behavior changed; decision logged if design changed.

## Output
VERDICT / BLOCKERS (file:line, why, fix) / RISKS / VERIFIED (commands + results).
