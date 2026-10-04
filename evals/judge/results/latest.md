# LLM-as-judge results

Run: 2026-10-04T06:45:04+00:00. Commit: `0c54a00`. Judges: 3/3 returned valid JSON. Model: `sonnet`.
Judges are skeptical, see `rubric.md`. Scores are model opinions on the packet, not ground truth.

**Weighted total (median per criterion): 65.5 / 100**. Per-judge totals: [66.5, 66.5, 55.0]. Spread: 11.5. Mean criterion spread: 1.29.

| Criterion | Weight | Median | Judge scores | Spread | Quotes verified |
|---|---|---|---|---|---|
| Product quality | 20 | 6 | 6, 6, 5 | 1 | 9/9 |
| Innovation potential | 15 | 7 | 7, 7, 6 | 1 | 6/6 |
| Solana track fit | 15 | 6 | 6, 6, 5 | 1 | 8/8 |
| Technical depth | 15 | 8 | 8, 8, 6 | 2 | 8/8 |
| Demo clarity | 15 | 6 | 6, 6, 5 | 1 | 7/8 |
| Why now and market | 10 | 6 | 7, 6, 6 | 1 | 6/7 |
| Honesty of claims | 10 | 7 | 7, 8, 6 | 2 | 8/8 |

## Biggest weakness per judge

- Judge 1: No real on-chain devnet transaction exists anywhere in the packet. Every payment shown is simulated, there is no deployment, and the demo video is unrecorded.
- Judge 2: No real devnet settlement exists, so every payment shown is simulated and the Solana claims rest on mocks and a rejected /verify call.
- Judge 3: No real devnet transaction exists. Solana is only exercised against mocks, the demo is simulated, and the test counts in the README and submission disagree with the repo's own captured output.

## Top improvements per judge

Judge 1:
1. Fund the two devnet wallets, run a real settlement through the PayAI facilitator, and publish the Solana Explorer link (cluster=devnet) in the README and demo video.
2. Fix the stale test counts (Rust 90, Worker 70, parity 21) in the README and submission, and add 'simulated' labels to the USE_CASES demo-payment lines flagged by the audit, then re-run the eval until it passes.
3. Deploy a public gateway in front of the demo origin or a Website Factory client page, so judges get a live URL. Record the demo video and get at least one external pilot or waitlist signal.

Judge 2:
1. Fund the devnet wallets, run the PayAI facilitator path end to end, and publish the Solana Explorer link (cluster=devnet) in the README and demo video.
2. Record and upload the 3:00 demo and pitch videos, and deploy a public gateway URL that judges can hit.
3. Fix the stale test counts (90 Rust, 70 Worker, 21 parity) in the README and submission, and add simulated labels to docs/USE_CASES.md so the self-audit passes.

Judge 3:
1. Fund two devnet wallets, run the buyer CLI against the PayAI facilitator, and commit the Explorer link and command output. Re-record the demo as variant A.
2. Fix the README and submission test counts (90 Rust, 70 Worker, 21 parity) to match captured output. Label the USE_CASES demo-payment passages as simulated, or remove the Explorer-link claims there.
3. Deploy the gateway and dashboard at a public URL in front of a Website Factory page, and attach the recorded demo and pitch videos with the live link.

## Packet

Files: `README.md`, `docs/COLOSSEUM_SUBMISSION.md`, `docs/launch/DEMO_VIDEO.md`, `docs/launch/JUDGE_FAQ.md`, `docs/launch/PITCH_VIDEO.md`, `docs/launch/POSTS.md`, `docs/USE_CASES.md`, `evals/judge/results/system1.json`, `git ls-files`. Size: 87586 characters.
