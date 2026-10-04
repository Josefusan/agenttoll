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
6. Confirm the public gateway URL. The live demo runs on a Cloudflare quick tunnel; on 2026-10-04 the gateway was `https://years-cow-stations-dubai.trycloudflare.com` and the dashboard was `https://commonwealth-dam-wheat-constructed.trycloudflare.com`. Quick-tunnel URLs change on every tunnel restart and nothing restarts pm2 after a reboot, so re-read them from `~/Hackathons/AgentToll-LIVE.txt` on the VPS (and run `pm2 resurrect` first if the host rebooted). Update the "Project website" answer in `docs/COLOSSEUM_SUBMISSION.md` to match. Open the URL in a private window and run `curl -A 'Claude-User/1.0' <url>/api/quote` (expect 402; ClaudeBot and GPTBot get a Cloudflare 403 on quick tunnels, see `deploy/README.md`). If it does not load, leave the Project website field empty. Every payment behind it is simulated.

## Funding day (optional: the only path to a real settlement)

Everything in the demo is simulated until both devnet wallets hold USDC. To make the first real
settlement:

1. Fund both addresses at [faucet.circle.com](https://faucet.circle.com) (Solana Devnet):
   - buyer `8K5C7q93ANYbSz5M8Mho7Fra9WmBa58RAcMvycbxtB5D`
   - payTo `FFgkc6ZmZHPrRwjyBFL56VP6u572g27TAyAdVqmBro7d`
   No SOL is needed; the facilitator pays the fee.
2. Run the preflight until it prints `READY`. It is read-only: it never reads a keypair file, never
   signs and never sends a transaction. It checks both devnet USDC token accounts and the
   facilitator's feePayer:

   ```bash
   bash scripts/real-payment-preflight.sh 8K5C7q93ANYbSz5M8Mho7Fra9WmBa58RAcMvycbxtB5D FFgkc6ZmZHPrRwjyBFL56VP6u572g27TAyAdVqmBro7d
   ```

3. Then run the buyer against a gateway configured with the real PayAI facilitator (`agenttoll.example.yaml`
   keeps `facilitator: https://facilitator.payai.network`):

   ```bash
   agenttoll-buyer --network solana --solana-keypair ~/agenttoll-buyer.json <gateway-url>/api/quote
   ```

   It prints the Solana Explorer link for the settlement. Only after this succeeds may any doc or the
   demo video say a payment settled on chain. Do not repoint the live d8 gateway to the real
   facilitator to make this happen; run the funded wallets through a gateway built with
   `agenttoll.example.yaml`.

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

Regenerate the copy-paste page with `python3 scripts/build-submission-page.py` before pasting; it reads `docs/COLOSSEUM_SUBMISSION.md` and shows every answer with its character count, and its counts match System-1.

| Form field | What to enter | Source |
|---|---|---|
| Project name | `AgentToll` | doc, "Project name" |
| Brief description (500) | Paste as is | doc, "Brief description" |
| Project website | The live gateway URL if it loads (re-read it today, it changes on tunnel restart), else leave empty. | doc, "Project website" |
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

- [ ] Run `bash scripts/refresh-live-urls.sh` on the VPS first (it checks every quick-tunnel URL in tracked files against `~/Hackathons/AgentToll-LIVE.txt` and prints `STALE`/`DEAD` for anything wrong; `--apply` rewrites the stale ones).
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

## Live feed behind a quick tunnel

Cloudflare quick tunnels buffer server-sent events, so the public dashboard's live feed may stay silent. The dashboard reconciles with `/api/stats` every 5 seconds, so new payments still appear within about 5 seconds. Record the instant "dashboard ticks" shot on localhost (or behind a named tunnel), not on the quick-tunnel URL.
