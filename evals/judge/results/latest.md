# LLM-as-judge results

Run: 2026-10-04T19:16:21+00:00. Commit: `cefde49`. Judges: 3/3 returned valid JSON. Model alias: `sonnet`. Resolved model id: `claude-sonnet-5-5`.
System-1 output in the packet: no, `evals/judge/results/system1.json` was left out, so the judges read the docs independently of the rule results.
Limitation: all 3 judges use the same model and differ only by lens prompt. Their agreement is weaker evidence than agreement between independent models.
Judges are skeptical, see `rubric.md`. Scores are model opinions on the packet, not ground truth.

**Weighted total (median per criterion): 66.0 / 100**. Per-judge totals: [64.5, 66.0, 63.5]. Spread: 2.5. Mean criterion spread: 0.43.

| Criterion | Weight | Median | Judge scores | Spread | Quotes verified |
|---|---|---|---|---|---|
| Product quality | 20 | 6 | 6, 6, 6 | 0 | 8/9 |
| Innovation potential | 15 | 6 | 6, 6, 6 | 0 | 6/6 |
| Solana track fit | 15 | 6 | 5, 6, 6 | 1 | 9/9 |
| Technical depth | 15 | 8 | 8, 8, 7 | 1 | 9/9 |
| Demo clarity | 15 | 6 | 6, 6, 6 | 0 | 8/9 |
| Why now and market | 10 | 6 | 6, 6, 6 | 0 | 6/7 |
| Honesty of claims | 10 | 9 | 9, 9, 8 | 1 | 9/9 |

## Biggest weakness per judge

- Judge 1: No real on-chain settlement exists: every payment is simulated, so the Solana story, the demo and the product claims all rest on mocks and one recorded facilitator rejection.
- Judge 2: No real on-chain settlement exists: no wallet is funded and the only real facilitator contact is a rejected handshake, so the Solana claims stay unproven.
- Judge 3: No real on-chain transaction exists on either rail: every payment is simulated and the only real-facilitator evidence is a rejection.

## Top improvements per judge

Judge 1:
1. Fund two devnet wallets with USDC, run a real settlement through the PayAI facilitator, and publish the Solana Explorer link in the README, the demo video and the eval results.
2. Record and upload the 3-minute demo and the pitch video, and deploy a stable public gateway and dashboard on a named domain instead of a Cloudflare quick tunnel.
3. Put the gateway in front of one real Website Factory client site, or recruit one external pilot, and report the agent traffic and pricing data as demand evidence.

Judge 2:
1. Fund the two devnet wallets with devnet USDC, run one real PayAI settlement, and put the Solana Explorer link in the README, the demo and the recorded video.
2. Record and publish the 3:00 demo video, and deploy a stable public URL, such as a named Cloudflare tunnel or VPS domain, instead of a quick tunnel that changes on restart.
3. Get one real pilot, for example Website Factory in front of a live client site, and cite the resulting traffic. Also add Web Bot Auth verification and CI-visible test output so the test counts can be checked.

Judge 3:
1. Fund two devnet wallets, complete one real PayAI settlement, and publish the Solana Explorer link in the README and demo.
2. Record the 3:00 demo video against a stable public URL (not a quick tunnel) and link it in the submission.
3. Show a design partner or Website Factory client running AgentToll in front of a live site with real agent traffic logs, and cite primary sources for the market numbers.

## Packet

Files: `README.md`, `docs/COLOSSEUM_SUBMISSION.md`, `docs/launch/DEMO_VIDEO.md`, `docs/launch/JUDGE_FAQ.md`, `docs/launch/PITCH_VIDEO.md`, `docs/launch/POSTS.md`, `docs/launch/RECORDING_RUNBOOK.md`, `docs/USE_CASES.md`, `evals/results/latest.md`, `git ls-files`. Size: 141130 characters.
