# LLM-as-judge results

Run: 2026-10-04T20:12:28+00:00. Commit: `c21f33a`. Judges: 1/3 returned valid JSON. Model alias: `claude-fable-5-1`. Resolved model id: `claude-fable-5-1`.
System-1 output in the packet: no, `evals/judge/results/system1.json` was left out, so the judges read the docs independently of the rule results.
Limitation: all 3 judges use the same model and differ only by lens prompt. Their agreement is weaker evidence than agreement between independent models.
Judges are skeptical, see `rubric.md`. Scores are model opinions on the packet, not ground truth.

**Weighted total (median per criterion): 71.5 / 100**. Per-judge totals: [71.5]. Spread: 0.0. Mean criterion spread: 0.0.

| Criterion | Weight | Median | Judge scores | Spread | Quotes verified |
|---|---|---|---|---|---|
| Product quality | 20 | 7 | 7 | 0 | 3/3 |
| Innovation potential | 15 | 7 | 7 | 0 | 3/3 |
| Solana track fit | 15 | 7 | 7 | 0 | 3/3 |
| Technical depth | 15 | 8 | 8 | 0 | 3/3 |
| Demo clarity | 15 | 7 | 7 | 0 | 3/3 |
| Why now and market | 10 | 7 | 7 | 0 | 3/3 |
| Honesty of claims | 10 | 7 | 7 | 0 | 3/3 |

## Biggest weakness per judge

- Judge 1: No payment anywhere in the packet has touched a chain; every settlement is a SIMULATED- id from a mock facilitator, so the Solana story rests on a rejected handshake rather than a transaction.
- Judge 2: FAILED, ValueError: missing biggest_weakness
- Judge 3: FAILED, JSONDecodeError: Expecting ',' delimiter: line 1 column 5009 (char 5008)

## Top improvements per judge

Judge 1:
1. Fund the two devnet wallets from faucet.circle.com, run `agenttoll-buyer` against PayAI, and commit the Solana Explorer link plus the raw output to docs/assets so the demo and README can show one real settlement.
2. Bring docs/USE_CASES.md in line with the truth table: label the case 1 and case 6 'Proof' lines as simulated or not built, delete 'Planned, not built' for tools/list price advertising, and rename `wallet_status` to `spend_status`.
3. Record the 3:00 variant B video now and replace the quick tunnel with a stable URL (named Cloudflare tunnel or a domain on the VPS), and publish prebuilt release binaries so judges skip the 14-minute first compile.

## Packet

Files: `README.md`, `docs/COLOSSEUM_SUBMISSION.md`, `docs/launch/DEMO_VIDEO.md`, `docs/launch/JUDGE_FAQ.md`, `docs/launch/PITCH_VIDEO.md`, `docs/launch/POSTS.md`, `docs/launch/RECORDING_RUNBOOK.md`, `docs/USE_CASES.md`, `evals/results/latest.md`, `git ls-files`. Size: 141226 characters.
