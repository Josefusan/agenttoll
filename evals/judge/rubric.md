# Judge rubric: Colosseum Crypto World's Fair

Used by `evals/judge/judge.py`. Each criterion is scored 1 to 10 as an integer. Anchors are given for 3, 6, 8 and 10. Use 1 to 2, 4 to 5, 7 and 9 for in-between cases.

## What the sources say

- Colosseum's page (https://colosseum.com/worldsfair, fetched 2026-10-04) says "The Colosseum team reviews all product submissions and determines the overall hackathon winners". Track judges "work with the Colosseum team by providing feedback and evaluating submissions in the dedicated hackathon tracks". It lists a Solana track with a $100,000 pool, "10 projects receive $10,000 each", and "Submissions due October 12, 2026". The page text we fetched states no scoring criteria or weights. It says nothing more than the above about how entries are scored.
- The repo's KB-HACK-01 (`docs/KNOWLEDGE_BASE.md`) records: "Judged on product quality and innovation potential, plus track judges." The repo does not cite where that sentence came from beyond the same page.
- `skills/colosseum-submission/SKILL.md` says judges reward: a demo that works live and on-chain in under 3 minutes, a clear buyer, a distribution story, and honest scope ("say what is devnet, what is next").
- The weights below are this repo's own choice. They put the two stated criteria (product quality, innovation) first, add Solana track fit because track judges score within a track, and add honesty because the team's own rule is that every claim must be true.

## Weights

| id | Criterion | Weight |
|---|---|---|
| product_quality | Product quality | 20 |
| innovation | Innovation potential | 15 |
| solana_fit | Solana track fit | 15 |
| technical_depth | Technical depth | 15 |
| demo_clarity | Demo clarity | 15 |
| why_now | Why now and market | 10 |
| honesty | Honesty of claims | 10 |

Total weighted score = sum(score / 10 * weight), out of 100.

## Rules for every judge

- Score only what the packet shows. Do not assume code works because a doc says so.
- Penalize unverifiable claims. A claim with a command, a test count tied to output, a file path or a quoted source is verifiable. A claim with none of those is not.
- A simulated payment is not an on-chain payment. If any doc blurs the two, cap honesty at 4.
- Quote evidence from the packet verbatim. Do not paraphrase inside a quote.
- Do not reward length, polish or hype words.

## 1. Product quality (20)

Does it work, is it complete for its scope, and would a real user keep using it?

- 3: A concept or a thin script. No tests cited, or the main path is not shown working.
- 6: The main path works and has tests. Gaps in setup, docs or error handling are visible. A user could try it but would hit rough edges.
- 8: Complete core flow with failure handling, tests tied to real counts, a one-command demo and a dashboard. Known gaps are listed and small.
- 10: Production-grade for its stated scope: real users or a live public deployment, failure modes proven, install in minutes, nothing in the main path simulated.

## 2. Innovation potential (15)

Is the idea new, and can it grow into a company?

- 3: A known pattern with a different label. Many identical projects exist.
- 6: A useful combination of known parts for a clear niche. Some differentiation, no moat.
- 8: A sharp wedge nobody serves well (for example open, self-hosted, per-tool pricing) with a plausible path to users and a reason it compounds.
- 10: A new primitive or market that other builders would build on. Clear distribution, clear defensibility.

## 3. Solana track fit (15)

Would a Solana track judge see Solana as central, not bolted on?

- 3: Solana is named but nothing uses it, or it is only configured and never exercised.
- 6: Solana is the default rail and exercised in tests or mocks. No real devnet transaction is shown.
- 8: Solana is the primary rail, uses Solana-native features (USDC SPL, fee-payer sponsorship, a Solana facilitator) and the docs show how, plus a real devnet path that reaches the facilitator.
- 10: A real devnet or mainnet transaction with an Explorer link, Solana-specific design choices that other chains could not copy, and use of ecosystem infrastructure.

## 4. Technical depth (15)

Is the engineering hard, correct and well-argued?

- 3: Glue code over an SDK. No tests or design notes.
- 6: Sound structure and tests. Design choices are stated but not defended.
- 8: Hard problems handled and documented: settlement ordering, replay protection, resource binding, parity between two runtimes, spend caps. Tests back the claims.
- 10: Novel technique or rigor that experts would respect: formal parity proofs, adversarial reviews with recorded findings, measured performance, security analysis.

## 5. Demo clarity (15)

Can a judge understand the product and see it work in under three minutes?

- 3: No demo, or one that needs a long setup and explanation.
- 6: A script or video plan exists. The story is clear but the demo is simulated or not yet recorded.
- 8: A one-command demo and a tight 3:00 script showing human free, agent pays, dashboard updates. Labels are honest about what is simulated.
- 10: A recorded, polished demo with a real transaction and an Explorer link, plus a live URL a judge can hit.

## 6. Why now and market (10)

Is there real demand and a reason this is the moment?

- 3: Generic claims about "the agent economy". No numbers.
- 6: Some cited numbers and a named buyer. Sources are weak or unverified.
- 8: Specific, dated, cited facts (volumes, launches, competitor gaps) and a named first buyer with a distribution path.
- 10: Evidence of demand: users, pilots, waitlist or revenue, plus cited market facts.

## 7. Honesty of claims (10)

Is every claim true, labelled and checkable?

- 3: Claims that the packet itself contradicts, or simulated work described as real.
- 6: Mostly honest. Some claims lack evidence or some labels are missing.
- 8: Truth table of built versus not built, every simulated payment labelled, forbidden claims removed, numbers tied to commands.
- 10: Everything above, plus self-audit artifacts (eval results, judge reports) that show weaknesses openly.

## Required output

Strict JSON, no prose outside it:

```json
{
  "scores": {
    "<criterion id>": {"score": 7, "evidence": ["verbatim quote from packet"], "reason": "one sentence"}
  },
  "biggest_weakness": "one sentence",
  "top_improvements": ["concrete change 1", "concrete change 2", "concrete change 3"]
}
```
