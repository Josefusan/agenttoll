# Submit day checklist (Joseph)

For 2026-10-06 onward. Hard stop: **11:59pm PT on 2026-10-12** (Official Rules section 5). Aim to click Submit on 2026-10-10 so a broken upload does not cost the entry.

Sources and the full requirement list: `docs/COLOSSEUM_REQUIREMENTS.md`. Every answer below lives in `docs/COLOSSEUM_SUBMISSION.md`. Edit that file first, never the form alone.

Nothing here is done by an agent. Agents do not record videos, do not touch your Colosseum account and do not click Submit.

## 0. Before you open the form (30 minutes)

1. Merge PR #9 (`feat/d7-release`) into `main` on GitHub. Judges open `main`. Then open https://github.com/Josefusan/agenttoll in a private window and check the README shows the Status table and that you are not logged in.
2. On a clean checkout of `main`, run `bash scripts/demo-local.sh`. It must finish and print the simulated payments. If it fails, stop and fix before recording.
3. Run the secret scan from `docs/COLOSSEUM_REQUIREMENTS.md` section "Secret hygiene" (or `git log -p --all | grep -E "AGENTTOLL_ADMIN_TOKEN=[A-Za-z0-9]{20,}"`). Expect no output.
4. Re-run the character counter at the bottom of `docs/COLOSSEUM_SUBMISSION.md`. Every line must read `OK`.
5. Re-check the five why-now facts listed under "Pre-submit checklist" in `docs/COLOSSEUM_SUBMISSION.md`. If one changed, edit the doc, then the form.
6. Confirm the public gateway URL (the deploy lane fills `<LIVE_GATEWAY_URL>` in the doc). Open it in a private window. If it does not load, leave the Project website field empty.

## 1. Record the videos (Joseph only)

| Item | Length rule | Script | Notes |
|---|---|---|---|
| Presentation (pitch) video | 2 to 3 minutes. Judges "review it first". | `docs/launch/PITCH_VIDEO.md` | Aim for 2:30 to 2:50. You on camera for the open and close. |
| Product demo video | 3 minutes at most | `docs/launch/DEMO_VIDEO.md` | Aim for 2:45. |

Rules for both:
- Payments in the demo are **simulated** unless a funded devnet settlement exists by then. Keep the `simulated settlement, no funds moved` label on screen for every payment shot. Never say "on-chain" for a simulated payment.
- No Colosseum logo in the video.
- English only.
- Upload to YouTube or Loom as **unlisted**. Open each link in a private window to confirm it plays. Check the length in the player.

## 2. Fill the form (colosseum.com, your account)

Open https://colosseum.com/arena/projects/agenttoll-1. If you are asked to join Crypto World's Fair first, join it and accept the Official Rules checkbox.

| Form field | What to enter | Source |
|---|---|---|
| Project name | `AgentToll` | doc, "Project name" |
| Brief description (500) | Paste as is | doc, "Brief description" |
| Project website | The live gateway URL if it loads, else leave empty. Never paste `<LIVE_GATEWAY_URL>`. | doc, "Project website" |
| What are you building, and who is it for? (1000) | Paste as is | doc |
| Why build it, why now? (1000) | Paste as is | doc |
| Technologies (500) | Paste as is | doc |
| Chains | Solana, Base | doc |
| How chains are used (500) | Paste as is | doc |
| Category | Developer Infrastructure | doc |
| Mobile-focused dApp | No | doc |
| Team location | United States | doc |
| Team Telegram | `@jdev_1` (see section 4) | doc |
| Other contributors (600) | Paste as is. It discloses AI coding agents. | doc |
| Anything else judges should know (500) | Paste as is. It includes the prior-work disclosure and the test counts. | doc |
| Go-to-market, demand validation, distribution | Paste the "Go-to-market" answer. Check the field limit in the editor first. | doc, "Go-to-market" |
| GitHub repository | `https://github.com/Josefusan/agenttoll` | repo is public, MIT |
| Presentation video | The unlisted pitch video link | section 1 |
| Demo video | The unlisted demo video link | section 1 |
| Logo | `brand/logo-square.png` | repo |
| Cover or graphic | `brand/banner.png` | repo |
| Screenshots, if the form takes them | `docs/assets/dashboard-1440.png`, `docs/assets/payment-required.png`, `docs/assets/terminal-demo.png` | repo |
| Tracks | Solana. Base too if the form offers it (Base is testnet only, the answers say so). | `docs/COLOSSEUM_REQUIREMENTS.md` rows 20, 21 |

Any field the editor shows that is not in this table: answer it only from facts in the truth table in `docs/COLOSSEUM_SUBMISSION.md`. Do not claim customers, revenue, a live Worker, mainnet, Web Bot Auth verification or an on-chain settlement.

## 3. Your profile and eligibility (Joseph only)

- [ ] Profile complete: bio in one line with no invented titles, GitHub `Josefusan`, X handle, LinkedIn `linkedin.com/in/josephc9`.
- [ ] You meet the rules: 18 or older, not in an excluded country, no employer conflict, no significant outside capital (Rules section 3, FAQ).
- [ ] The prior-work answer is true: no code from Website Factory or other earlier work was copied into AgentToll. If some was, add the names to "Anything else" before submitting.
- [ ] You are the only member of the team, or every teammate has an account and you added them.

## 4. Telegram and contact

- [ ] `@jdev_1` is the Telegram handle in the form. Open Telegram and confirm it is yours and that you get messages from a stranger.
- [ ] `hackathon@colosseum.com` is the contact in the Rules. Check your email (spam too) for Colosseum messages on each day until results.

## 5. Last checks, then Submit

- [ ] Every field filled. Both video links open in a private window.
- [ ] Re-read the form once against the truth table. Anything you cannot defend in a 15-minute interview comes out.
- [ ] Click **Submit** yourself.
- [ ] Take a screenshot of the confirmation page. Save it in your own notes, not in the repo.
- [ ] Open the public project page while logged out and check it renders.

## 6. After you submit

- [ ] Post the launch thread from `docs/launch/POSTS.md` only after you read each post. Nothing is posted for you.
- [ ] Optional: a one-minute weekly update video (FAQ says these are not required).
- [ ] Keep the week of 2026-10-13 free in case you are picked for a 15-minute Zoom interview. Prep: `docs/launch/JUDGE_FAQ.md`.
- [ ] Winners are announced by 2026-12-05. A prize needs a wallet address you control (Rules section 15).
- [ ] Do not edit the repo's `main` in a way that breaks the demo until results are out.

## Joseph-only summary

| Task | Why an agent cannot do it |
|---|---|
| Merge PR #9 | Rule for this team: Joseph merges |
| Record and upload both videos | Needs your face and voice |
| Colosseum account, profile, Telegram | Your identity |
| Confirm eligibility and prior-work facts | Personal facts |
| Fund a devnet wallet (optional) | Funding is a Joseph decision |
| Click Submit | Rule for this team |
