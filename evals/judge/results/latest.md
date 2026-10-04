# LLM-as-judge results

Run: 2026-10-04T15:32:01+00:00. Commit: `79b980e`. Judges: 3/3 returned valid JSON. Model alias: `sonnet`. Resolved model id: `claude-sonnet-5-5`.
System-1 output in the packet: no, `evals/judge/results/system1.json` was left out, so the judges read the docs independently of the rule results.
Limitation: all 3 judges use the same model and differ only by lens prompt. Their agreement is weaker evidence than agreement between independent models.
Judges are skeptical, see `rubric.md`. Scores are model opinions on the packet, not ground truth.

**Weighted total (median per criterion): 66.0 / 100**. Per-judge totals: [67.5, 66.0, 66.0]. Spread: 1.5. Mean criterion spread: 0.14.

| Criterion | Weight | Median | Judge scores | Spread | Quotes verified |
|---|---|---|---|---|---|
| Product quality | 20 | 6 | 6, 6, 6 | 0 | 7/7 |
| Innovation potential | 15 | 6 | 6, 6, 6 | 0 | 5/6 |
| Solana track fit | 15 | 6 | 6, 6, 6 | 0 | 5/6 |
| Technical depth | 15 | 8 | 8, 8, 8 | 0 | 9/9 |
| Demo clarity | 15 | 6 | 7, 6, 6 | 1 | 6/6 |
| Why now and market | 10 | 6 | 6, 6, 6 | 0 | 6/6 |
| Honesty of claims | 10 | 9 | 9, 9, 9 | 0 | 8/8 |

## Biggest weakness per judge

- Judge 1: No real on-chain devnet settlement exists, so the core promise of agents paying USDC on Solana is demonstrated only through a simulated facilitator.
- Judge 2: No real on-chain settlement exists: every payment is simulated and the only real-facilitator evidence is a rejected unfunded handshake, so the core Solana claim is unproven.
- Judge 3: No real on-chain devnet transaction exists, so every payment demonstrated is simulated and the Solana claim is untested end to end.

## Top improvements per judge

Judge 1:
1. Fund two devnet wallets with Circle faucet USDC, complete one real PayAI settlement, and publish the Explorer link in the README and demo video.
2. Record the demo and pitch videos and keep a stable public URL, such as a named Cloudflare tunnel or a VPS domain, so judges can hit a live gateway.
3. Run a real pilot, for example the gateway in front of a Website Factory client site, and report actual agent hits and unbilled-traffic numbers as demand evidence.

Judge 2:
1. Fund the devnet buyer and pay_to wallets with Circle faucet USDC, settle one real payment through PayAI, and publish the Solana Explorer link with the gateway log.
2. Record and publish the 3:00 demo video, ideally the real devnet variant, and keep a stable public URL (a named Cloudflare tunnel or a VPS domain) instead of a quick tunnel that changes.
3. Deploy the Worker edition and run the gateway in front of a real Website Factory client page, then report any real traffic or pilot evidence to back the demand claims.

Judge 3:
1. Fund two devnet wallets and record a real PayAI-settled payment with a Solana Explorer link, then switch the demo to variant A.
2. Record and publish the 3:00 demo and the pitch video, and host the gateway at a stable URL instead of a Cloudflare quick tunnel.
3. Get one real pilot, such as a Website Factory client site or an MCP author running the gateway, and report real traffic or a waitlist as demand evidence.

## Packet

Files: `README.md`, `docs/COLOSSEUM_SUBMISSION.md`, `docs/launch/DEMO_VIDEO.md`, `docs/launch/JUDGE_FAQ.md`, `docs/launch/PITCH_VIDEO.md`, `docs/launch/POSTS.md`, `docs/launch/RECORDING_RUNBOOK.md`, `docs/USE_CASES.md`, `evals/results/latest.md`, `git ls-files`. Size: 140108 characters.
