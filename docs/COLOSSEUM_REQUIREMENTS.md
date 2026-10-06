# Colosseum requirements: compliance matrix

Checked 2026-10-04 against the live Colosseum pages. This file maps each real requirement to AgentToll evidence. Status values: **met** (evidence exists in this repo), **gap** (work left that an agent or Joseph can do), **Joseph-only** (needs his account, face, voice, identity or a click).

## Sources

| ID | URL | Fetched | Notes |
|---|---|---|---|
| S1 | https://colosseum.com/worldsfair | 2026-10-04 | Public. Tracks, prizes, "Submissions due October 12, 2026", judges, links to the rules PDF and FAQ. No timezone on the page. |
| S2 | https://colosseum.com/legal/Crypto%20World's%20Fair%20Hackathon%20Rules.pdf | 2026-10-04 | Public, 10 pages. The binding Official Rules. Section numbers below refer to it. |
| S3 | https://colosseum.com/hackathon (FAQs) | 2026-10-04 | Public. Submission fields, video lengths, eligibility, prior code, repo expectations. Shared by all Colosseum hackathons. |
| S4 | https://colosseum.com/worldsfair/resources | 2026-10-04 | Public. Developer resource list only. No rules or requirements. |
| S5 | colosseum.com/arena (project editor, dashboard) | not fetched | Needs Joseph's login. The exact form fields, character limits and the "submission opens 2026-10-06 04:00 PDT" claim in earlier docs come from his editor and cannot be checked from public pages. |

## Key facts

- Contest period: 6:00am PT on 2026-09-14 to 11:59pm PT on 2026-10-12 (S2 section 5). Winners announced by 2026-12-05.
- One team per person, one submission per team (S2 section 7, S3).
- Only work done inside the contest period is judged. Pre-existing code is allowed if disclosed in the form (S3). Open-source code by others does not count as pre-existing.
- Judging criteria in the Official Rules (S2 section 8): Functionality and code quality, Potential impact (TAM), Novelty, UX (blockchain used for good downstream UX), Open-source and composability, Business plan.
- The FAQ lists a second, startup-style set of factors: founder-market fit, insight, product and execution, market size, founder communication, viability, traction (S3).
- Track prizes are extra, on top of the main awards. Solana: $100,000 across 10 products. Base: $25,000 across 5 products (S2 section 14). The Rules define a track only as "products that integrate with" that chain. No further track rule is published.
- Judging process: Colosseum team review, shortlist, panel, then a 15-minute Zoom interview for a small group (S3). Track judges include a Base ecosystem person and Phantom, Anza, Drift and Ellipsis Labs people (S1).

## Matrix

| # | Requirement (quoted) | Source | AgentToll evidence | Status | Action |
|---|---|---|---|---|---|
| 1 | "at least 18 years of age", not in a sanctioned jurisdiction, no conflicting employer obligations | S2 s3 | Joseph is US-based (`docs/COLOSSEUM_SUBMISSION.md` Location). Age and employer terms are personal facts. | Joseph-only | Confirm none of the s3(b) and s3(c) exclusions apply to him. |
| 2 | "new startups that haven't raised significant outside capital" | S3 | Solo builder, no funding stated anywhere in the repo. | Joseph-only | Confirm no significant outside capital. |
| 3 | "each Member must visit and register on the colosseum.com platform before 11:59pm PT on October 12, 2026" and accept the Official Rules checkbox | S2 s4(a), s6(a) | Project page exists: https://colosseum.com/arena/projects/agenttoll-1 (per `docs/COLOSSEUM_SUBMISSION.md`). | Joseph-only | Verify the account shows as registered for Crypto World's Fair before 2026-10-12. |
| 4 | "the team leader must upload the Project Submission before the end of the Entry Period" | S2 s6(b) | Answers drafted in `docs/COLOSSEUM_SUBMISSION.md`. Click-by-click in `docs/SUBMIT_DAY.md`. | Joseph-only | Click Submit by 11:59pm PT on 2026-10-12. Aim for 2026-10-10. |
| 5 | "A Team may only submit one (1) Project Submission" | S2 s7 | One project, AgentToll. | met | Do not create a second project. |
| 6 | "Product name and a brief description" | S3 | Name and 500-char description in `docs/COLOSSEUM_SUBMISSION.md`. | met | Re-run the character counter before pasting. |
| 7 | "Which blockchains and tools are being integrated" | S3 | "Chains" answer is Solana, Base. Technologies answer lists only things in the repo. Truth table in `docs/COLOSSEUM_SUBMISSION.md`. | met | None. |
| 8 | "All teammates, with context on their backgrounds and previous experience" | S3 | Solo. "Other contributors" answer discloses AI coding agents and credited libraries. | met | Joseph completes his profile bio (no invented titles). |
| 9 | "Where the team is located" | S3 | United States, set in the form answers. | met | None. |
| 10 | "A product logo or graphic" | S3 | `brand/logo-square.png`, `brand/banner.png`. | met | Upload both. |
| 11 | "A GitHub repository link. Open-source repositories are encouraged" | S3 | https://github.com/Josefusan/agenttoll, MIT (`LICENSE`). Release code lives on `feat/d7-release` (PR #9). | gap | Joseph merges PR #9 so `main` holds the release. The repo's default branch is `main` and judges open that first. |
| 12 | "A two-to-three-minute presentation video. This is one of the first resources judges review" | S3 | Script `docs/launch/PITCH_VIDEO.md`, written to 3:00. | Joseph-only | Record on camera. Target 2:30 to 2:50 so it is inside the window with margin. Not recorded yet. |
| 13 | "A product-demo video of no more than three minutes explaining how the product works" | S3 | Script `docs/launch/DEMO_VIDEO.md`, 3:00 max. Demo runs with `scripts/demo-local.sh` on the simulated facilitator. | Joseph-only | Record. Label every payment as simulated. Target 2:45. Not recorded yet. |
| 14 | "Go-to-market strategy, demand validation, and plans for developing distribution" | S3 | `docs/WIN_PLAN.md` (Distribution), `docs/USE_CASES.md` ("Who pays us later (plan, not traction)"), `docs/launch/JUDGE_FAQ.md`. A paste-ready answer is added to `docs/COLOSSEUM_SUBMISSION.md` under "Go-to-market". | met | Check the live editor for the field and its limit. If the field has a limit under the draft length, shorten. |
| 15 | "teams must disclose all relevant past development work in the submission form" | S3 | First commit in the repo is 2026-10-02 (`git log --reverse`), after the 2026-09-14 start. Website Factory is a separate earlier product. Disclosure sentence added to "Anything else judges should know". | met | Joseph confirms no code from Website Factory or other earlier work was copied in. If any was, name it in the form. |
| 16 | "Did significant work during the hackathon; Were the ones to do this work, rather than a third party" | S3 (repo review) | 60 commits on 13 remote branches, dated 2026-10-02 to 2026-10-04 (`git log --all --format=%ad`). AI agent use is disclosed in "Other contributors". | met | None. Keep the AI disclosure. |
| 17 | "Entrants agree to inform Administrator of the status and ownership of any open-source or other third party code" | S2 s9 | `README.md` Credits (x402-foundation/x402, x402-rs, Skillbox). "Other contributors" answer names x402 SDKs and x402-rs. | met | None. |
| 18 | "All Content must be in English" | S2 s12(a) | All docs and form answers are English. | met | Videos in English. |
| 19 | No infringement, no use of Administrator marks: "Entrant shall not use ... Administrator's trademarks, logos" without written consent | S2 s12(b), s17 | `brand/` holds AgentToll assets only. | met | Do not put the Colosseum logo in videos or on the site. Naming Colosseum in text is fine. |
| 20 | Solana track: "best products that integrate with the Solana blockchain" | S2 s14(e) | Primary rail. Buyer CLI and pay-mcp use x402 SVM on Solana devnet. Facilitator `/verify` reached live (rejected only because the key is unfunded, see truth table). | gap | The one-command demo uses a simulated facilitator, so no real devnet settlement exists yet. A funded devnet settlement with an explorer link would close this. Funding is Joseph-only. Until then say "devnet, simulated settlement in the demo" everywhere. |
| 21 | Base track: "best products that integrate with the Base blockchain" | S2 s14(j) | Base Sepolia is the second rail (EIP-3009 USDC), configured and mock-tested. | gap | Same as row 20. Base is configured, not exercised with funds. The form says "Base (Sepolia today) ... Devnet and testnet only so far", which is true. Do not claim a Base settlement. |
| 22 | Judging: Functionality, "How well does this Project Submission work? What is the quality of the code?" | S2 s8(a) | Rust gateway, pay-mcp and Worker test suites (counts in `README.md` Status), critic-agent review on every PR, `scripts/demo-local.sh`. | met | Judges may run the demo. Keep `bash scripts/demo-local.sh` working on a clean machine. |
| 23 | Judging: Potential impact, "total addressable market" | S2 s8(b) | "Why now" answer, `docs/USE_CASES.md`, KB-MKT-01. | met | Re-check the $3.3M figure on submit day (listed in the pre-submit checklist). |
| 24 | Judging: Novelty, "How unique is this Project Submission's concept?" | S2 s8(c) | Open-source, self-hosted, multi-chain, MCP-tool pricing, non-custodial. Contrast with Cloudflare's waitlist gateway in "Why now". | met | None. |
| 25 | Judging: UX, "How well does this Project Submission utilize blockchain to create great UX for downstream users?" | S2 s8(d) | Agents hold only USDC (facilitator sponsors fees), no signups or keys, founders see a live dashboard. | met | State it in the demo video voice-over. |
| 26 | Judging: Open-source, "Is this Project Submission open-source? How well does the Project Submission compose with other primitives" | S2 s8(e) | MIT, x402 v2 spec, x402-rs, PayAI facilitator, MCP, Cloudflare Workers. | gap | Same as row 11: `main` must hold the release. |
| 27 | Judging: Business plan, "Is there a viable business that can be built" | S2 s8(f) | Plan section labelled PLAN in `docs/launch/PITCH_VIDEO.md`, `docs/launch/JUDGE_FAQ.md`. No revenue or customers claimed. | met | Keep "plan" labels. The FAQ factor "Traction" will score low. Do not invent traction. |
| 28 | "Weekly updates ... aren't strictly required ... one-minute video" | S3 | None recorded. | Joseph-only | Optional. A one-minute update in the final week is low cost. |
| 29 | Project website (form field, public) | S5 | Not a stated Colosseum requirement. A quick-tunnel gateway URL (2026-10-04) is filled in `docs/COLOSSEUM_SUBMISSION.md`. It changes on tunnel restart. | gap | Re-read the URL from `~/Hackathons/AgentToll-LIVE.txt` on submit day and open it in a private window, or leave the field empty. |
| 30 | Deadline: "Submissions due October 12, 2026"; period ends "11:59pm PT" | S1, S2 s5 | `docs/KNOWLEDGE_BASE.md` KB-HACK-01. | met | Treat 2026-10-12 11:59pm PT as the hard stop. |
| 31 | Interview: a small group "is invited to a 15-minute Zoom interview" | S3 | Prep in `docs/launch/JUDGE_FAQ.md`. | Joseph-only | Keep the week after the deadline free. |
| 32 | Prize: "Each winning team may be required to set up a wallet address" | S2 s15(b) | n/a | Joseph-only | Have a wallet ready for a prize payout later. Not needed to submit. |
| 33 | "Final submission opens 2026-10-06 04:00 PDT" | earlier docs (ROADMAP, KB) | Not on any public page. Source is likely Joseph's dashboard. | Joseph-only | Check the date in the Colosseum dashboard. The project editor already accepts saved answers. |

## Open gaps, ranked

1. **Merge PR #9 to `main`** (rows 11, 26). Joseph only. Judges see `main`.
2. **Record both videos** (rows 12, 13). Joseph only. Pitch video is read first by judges.
3. **No real devnet settlement yet** (rows 20, 21). Needs a funded devnet wallet. Joseph decides. All current copy is already honest about it.
4. **Public gateway URL** (row 29). The URL in `docs/COLOSSEUM_SUBMISSION.md` is a temporary quick tunnel; re-check it on submit day.
5. **Confirm eligibility and prior-work facts** (rows 1, 2, 15). Joseph only.

## What changed on 2026-10-04

- Pitch video must be two to three minutes, not "3:00 max". The script is written to 3:00. Record it shorter.
- The FAQ lists go-to-market, demand validation and distribution plan as a required submission item. Earlier docs had no answer for it. Added.
- The FAQ requires disclosure of past development work. Earlier docs had no disclosure sentence. Added.
- Private repos are allowed only if `hackathon@colosseum.com` gets access. AgentToll is public, so this does not apply.

## Secret hygiene (scan run 2026-10-04)

Scope: all 31 refs and all 60 commits, read as added lines of `git log -p --all`. Command shapes, so Joseph can re-run them on `main` before submitting:

```bash
git log -p --all --no-color -U0 | grep -E '^\+' | grep -cE '\[ *([0-9]{1,3} *, *){31,}[0-9]{1,3} *\]'            # keypair JSON arrays
git log -p --all --no-color -U0 | grep -E '^\+' | grep -oE '\b[1-9A-HJ-NP-Za-km-z]{86,88}\b' | wc -l           # base58 secret keys
git log -p --all --no-color -U0 | grep -E '^\+' | grep -cE 'sk-[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}'
git log -p --all --no-color -U0 | grep -E '^\+' | grep -cE '0x[0-9a-fA-F]{64}\b'                               # EVM private keys
git log --all --name-only --format= | sort -u | grep -Ei '(^|/)\.env($|\.)|keypair|id\.json|\.pem$|\.demo/'    # files ever tracked
```

| Check | Result |
|---|---|
| Keypair JSON arrays (32+ integers) in any added line | 0 |
| base58 strings of 86 to 88 characters | 0 |
| `sk-`, PEM private key blocks, `ghp_`, `AKIA` keys | 0 |
| `0x` plus 64 hex characters | 0 |
| `.env` files ever tracked | none. Only `.env.example`, `apps/dashboard/.env.example`, `demo/pay-mcp/.env.example` |
| `.demo/`, `id.json`, `*keypair*` files ever tracked | none |
| `AGENTTOLL_ADMIN_TOKEN=` assignments in history | all placeholders or docs: `<token>`, `...`, `change-me`, `fixture-token`, `$AGENTTOLL_ADMIN_TOKEN`, empty, and a `${AGENTTOLL_ADMIN_TOKEN:-demo-admin-token-$(head ...)}` generator in the demo script (a random value made at run time, not stored) |
| `BUYER_SOLANA_KEYPAIR=` assignments | all file paths (`.demo/buyer.json`, `./buyer.keypair.json`, `/ABSOLUTE/PATH/...`) or `...`. No inline key material |
| `BUYER_EVM_PRIVATE_KEY=` | empty or `0x...` |

Finding: no secrets in git history on any branch. No value was printed during the scan; token values were reduced to their shape.

`.gitignore` before this change covered `.env`, `.env.*` (except `.env.example`), `.demo/`, `*.db`, `*.keypair.json`, `id.json`, `agenttoll.yaml`. It did not cover other keypair file names, for example `buyer.json` or `my-keypair.json`. This lane adds `*keypair*.json`, `buyer.json`, `payto.json` and `wallet*.json`. Checked that no tracked file matches the new patterns.

The scan covers this repository only. Local files outside the repo (`~/agenttoll/config/agenttoll-buyer.json`, `~/agenttoll/config/agenttoll-payto.json`, the mode-600 `.env` in the release worktree) were not read or touched.

## Test counts (re-run 2026-10-04 at commit 0c54a00)

| Suite | Command | Result |
|---|---|---|
| Rust workspace | `CARGO_TARGET_DIR=~/Hackathons/AgentToll-release/target cargo test --release --workspace` | 90 passed, 0 failed (core 29, core-wasm 3, gateway 19 + 10 + 27, mock-facilitator 2) |
| pay-mcp | `cd demo/pay-mcp && npm ci && npm test` | 69 passed, 8 files |
| Worker edition | `cd workers/agenttoll-edge && npm ci && npm test` | 70 passed (edge 39, parity 21, mcp unit 7, proxy unit 3) |

Notes: the Rust run used `--release` to reuse the release build's compiled dependencies, so test code ran with the release profile. The Worker needs the WASM core in `src/core`. It is not tracked, so the lane copied it from the release worktree (same commit, same Rust sources) instead of rebuilding. The parity test builds and starts the Rust gateway itself.
