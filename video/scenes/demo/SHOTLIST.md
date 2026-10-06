# Full product demo: shot list

`video/scenes/demo/index.html` is a Loom-style walkthrough of the real product. It runs 171.2 s (2:51) at 1920x1080 and 30 fps, has captions burned in, a synthesized music bed and UI sound (`video/render/audio.mjs`, CC0), and narration by a stock female AI voice presented as Joseph's AI assistant (Kokoro TTS; the captions are her lines word for word, see `video/vo/VO_SCRIPT.md`). It shows a desktop canvas on the brand background, browser and terminal windows, a visible cursor and Screen Studio-style zooms.

All payments in it are **SIMULATED**. They went through the local test facilitator (`demo/mock-facilitator`), every transaction id starts with `SIMULATED-`, and no funds moved. The gold `SIMULATED · no funds moved` badge appears in two places. It is on the title card from 6.9 to 9.4 s, and it stays in the top-right corner, without a break, from 49.35 s to 140.05 s (`S.requireBadge` fails the render if any frame from 49.6 s to 139.7 s lacks it) (it leaves only after the last payment frame has faded), which covers acts 04 to 07: every act that shows a payment.

## Files

| File | What it is |
|---|---|
| `index.html` | The scene. It loads `../../engine/engine.css`, `../../engine/timeline.js`, `demo.css` and `demo.js`. |
| `demo.js` | Builds every shot. All terminal text is read **at build time** from committed captures through a synchronous XHR. None of it is retyped. The script throws if a capture changes shape (see "Build-time checks"). |
| `demo.css` | Components used only by this film: a YAML file viewer, a screenshot stack, rings, callouts, the x402 flow strip, the caps card, the info card and the phone frame. |
| `captions.json` | Act start times plus every caption cue, with times relative to the act. It is the single source for both the scene and the guardrail checks. |
| `media/dashboard-live-0.6-10.6s.webm` | 10 s of the real dashboard screencast, re-encoded to VP9 and cropped to the content column (447 KB). The film plays its first 8 s. See "Live segment". |

The scene also reads one new capture made by this stage: `video/captures/terminal/stack-only.json`.

## Acts

All times are absolute seconds. Every act opens on composed state: its first window is already up (pre-rolled command, loaded page) and cross-dissolves with the outgoing act, so there is no empty "New Tab" or bare `$ curl -s` opener. Frame 0 is a composed thumbnail. Provenance lines are one fixed line bottom-left, outside the camera. In two-pane shots the pane that is not speaking dims to about 30% with a 4-6 px blur. Fix round 2 timings (2026-10-05):

| # | Time | Act | On screen | Sources (all committed) |
|---|---|---|---|---|
| C | 0.0–6.0 | Cold open | Same URL, two answers in 6 s: the browser gets `/api/quote` JSON (200 OK, dark capture), `curl -A 'Claude-User/1.0'` gets `402 Payment Required` and `x-agenttoll-verdict: ua:Claude-User` (4 of its header lines); a push onto the 402. | `captures/origin/origin-api-quote.png`, `origin.json`, `terminal/claude-user-402.json` |
| 00 | 6.0–9.6 | Title | Brand icon, "AgentToll / full product demo", gold SIMULATED badge, and two lines: "Payments are SIMULATED on Solana devnet …" and "captured from real runs". | `brand/icon.svg` |
| 01 | 9.6–19.6 | One config file (YAML 8 s with three beats: networks + pay_to, the $0.002 route, MCP tool prices; then a 2 s insert of the stack start) | A top-right chip says "demo run on spare ports: GATEWAY_PORT=8502 ADMIN_PORT=8503 ORIGIN_PORT=4100 FACILITATOR_PORT=4120 · dashboard :3502" (parsed from the stack-only command and the dashboard capture URL). No cursor (it only covered values). (1) An editor view of `demo/agenttoll.demo.yaml`. Highlight bands and camera zooms move to `networks` (pay_to, `# SIMULATED` facilitator), then `routes` (`price_usd: "0.002"` in gold, `/*` at `"0"`), then the `mcp.tools` prices. (2) The right-hand terminal types the `STACK_ONLY=1 … bash scripts/demo-local.sh` command and prints its real banner. | `video/captures/terminal/demo-config.json`, `stack-only.json` |
| 02 | 19.6–40.1 | Same URL, two answers | (1) The browser opens already on `127.0.0.1:8502/` with the Acme Data home page, then goes to `/api/quote` and shows the JSON with `"paid":false` (Chrome's Pretty-print bar cropped). A loading bar runs and the tab title changes, both taken from `origin.json`. (2) The terminal runs `curl -s -i -A 'Claude-User/1.0' …` and gets back the 402 with all its headers. (3) A zoom shows the 402 status and `x-agenttoll-verdict: ua:Claude-User`. (4) The decode pipeline prints the x402 v2 quote, and a zoom shows `amount`, `network` and `payTo` with the callout "2000 atomic = $0.002" right of the `amount` line, joined to it by a 1 px leader. | `captures/origin/*.png`, `origin.json`, `terminal/claude-user-402.json`, `payment-required-decoded.json` |
| 03 | 40.1–49.1 | A price list for agents | `curl …/.well-known/agenttoll.json \| python3 -m json.tool`, with the prices in gold, then a zoom to the routes block. | `terminal/well-known.json` |
| 04 | 49.1–66.6 | An agent pays: the buyer CLI | (1) The x402 flow strip lights up in order: GET, then 402 + PAYMENT-REQUIRED, sign, retry + PAYMENT-SIGNATURE, and finally 200 + PAYMENT-RESPONSE. (2) The terminal shows the buyer's real stderr and stdout, with the `tx:` line in gold. (3) The dashboard cross-fades from state 02 (empty-state card) to state 03 (one payment). (4) From 53.6 s the camera pushes in on the terminal's `status: 200 OK` … `tx:` lines (the receipt cue); the dashboard stays dimmed until 57.7 s. (5) At 57.7 s the dashboard swaps to state 03 and the camera pushes in (2.6x) on the new feed row, framed so the SETTLEMENT HEALTH tiles stay out of shot; the cursor rests below the row. (6) The revenue KPI ("Includes $0.002 simulated"), cursor parked inside the tile right of the value. (7) Same id on both sides as two magnified insets over a dark scrim: the terminal's `status`/`tx:` lines (last four characters ringed) and a 2x crop of the dashboard row's right end (`Simulated` badge, `SIMU…121d` ringed). | `terminal/buyer-pay-1.json`, `dashboard/dashboard-02-…png`, `dashboard-03-…png` + `.boxes.json` |
| 05 | 66.6–90.6 | Claude pays, within caps | (1) A Claude transcript panel shows Run 1: the prompt is typed, then get_quote, spend_status, Claude's line, pay_and_fetch, the receipt lines (`"tx": "SIMULATED-2133…"`, `"status": "simulated"`) and Claude's answer. (2) Run 2: the prompt, call_paid_tool for generate_report with `max_usd 0.1`, the red `refused:per_call` error and message, Claude's reply, spend_status, and Claude's explanation. (3) A caps card on the right shows per call $0.01, per day $0.25, spent $0 → $0.002 and remaining $0.25 → $0.248. Its per-call row turns red and it shows the refusal reason. (4) A small "film stack" terminal shows the same refusal coming from pay-mcp on the film stack. | `claude-pays/excerpts.json` (from `docs/assets/claude-pays-transcript.md`), `terminal/pay-mcp-session.json` |
| 06 | 90.6–104.6 | MCP servers sell per tool | (1) `tools/list` with the paid descriptions in gold ($0.005, $0.05) and "A free tool.". (2) An unpaid `tools/call search_docs` returns `"isError": true` and `"amount": "5000"`, and the camera zooms in. (3) A scrim dims the screen, a feed card from state 04 comes up, and a ring marks the `mcp search_docs +$0.005` row. | `terminal/mcp-tools-list.json`, `mcp-search-docs-challenge.json`, `dashboard/panel-04-buyer-and-pay-mcp-live-feed-card.png` |
| 07a | 104.6–112.9 | Dashboard, live segment | The real screencast of the running dashboard, 8 s in real time, full width (1.28x): a push-in on the revenue and paid-requests tiles as they tick up, then the page scrolls and the camera moves to the feed as new rows land. (The round-1 side terminal is gone: at 45% scale nothing on either side was readable.) | `media/dashboard-live-0.6-10.6s.webm`, `dashboard/dashboard-live-recording.json` |
| 07b | 113.0–136.3 | Dashboard tour | The full-page screenshot of state 05 (19 payments) pans zoom to zoom through these stops: (1) the revenue KPI, with a gold ring on "Includes $0.034 simulated"; (2) By network (Solana devnet 100%) — the SETTLEMENT HEALTH tiles below stay in frame, so a gold callout "Settled = SIMULATED settlements · no funds moved" is pinned under them; (3) the feed header, with a gold ring on "19 of 19 simulated"; (4) the "Agent traffic you are not billing yet" list (1.9x); (5) Cash out, with a gold ring on "Spendable USDC $0.00". The cursor parks beside each ringed value and waits off the page between stops. | `dashboard/dashboard-05-many-payments-full.png` + `.boxes.json` |
| 07c | 136.2–139.8 | Mobile | A phone frame scrolls the 390 px full-page capture. | `dashboard/dashboard-05-many-payments-mobile-390-full.png` |
| 08 | 139.8–148.8 | Same rules at the edge | (1) `npx vitest run test/parity.test.ts` in `workers/agenttoll-edge`, showing the summary lines: 21 passed. (2) An info card with four lines from the Worker README: "agenttoll-core compiled to WebAssembly", "byte-identical PAYMENT-REQUIRED", "D1 ledger" and "Not deployed: no Cloudflare account yet". | `evals/judge/results/test-output/worker-parity.txt`, `workers/agenttoll-edge/README.md` |
| 09 | 148.8–154.1 | Proof | "The repo grades itself." (white, 96 px, same as the hero's proof beat) with tiles that show their final values from the first frame (no count-up) for 119/119 evals, 93 Rust, 69 pay-mcp and 70 Worker (21 parity), plus "Rerun … `python3 evals/run.py --build`". | Numbers are parsed at build time from `README.md` (the test table) and `evals/results/latest.md` |
| 10 | 154.1–166.75 | Wired to real facilitators | Two terminals, each with its full command from the doc: the env line ending in `\` and its `agenttoll-buyer --network solana|base http://127.0.0.1:18402/api/quote` continuation line, both verbatim. PayAI on Solana devnet returns `invalid_exact_svm_transaction_simulation_failed`. x402.org on Base Sepolia returns `invalid_exact_evm_insufficient_balance`. Each shows its buyer line, `status: 402`, `Error: … no payment receipt` and the gateway's outbound connection log line. Text below: "Both real facilitators were reached and rejected the unfunded wallets, as expected. A funded wallet is the only missing piece." About 12.6 s (2 s longer than round 1). | `docs/assets/real-facilitator-handshake.md` (lines are matched verbatim) |
| close | 166.75–171.2 | Close | The hero/pitch close lockup, centred: robot mark, gradient "AgentToll" wordmark, tagline "Agents already use your product. Now you can bill them.", `github.com/Josefusan/agenttoll`, "COLOSSEUM CRYPTO WORLD'S FAIR"; quiet mono footer "Run it: KEEP=1 bash scripts/demo-local.sh · Devnet and testnet only. Every payment in this demo was simulated." | README / COLOSSEUM_SUBMISSION |

Every window has a mono source note (now on the fixed provenance line, bottom-left) (for example `stdout · video/captures/terminal/buyer-pay-1.json`) that names the file its pixels came from.

## Truth caveats

1. **Simulated only.** Every payment went through the local mock facilitator. Nothing on screen says a payment was settled on chain, and the captions avoid the words DEMO_VIDEO.md bans for variant B (on-chain, settled, live, real payment, transaction link, explorer, mainnet, revenue earned). The real dashboard UI still shows its own labels, such as "Live settlements" and "Settled 19", and the captions next to them say the payments are simulated.
2. **Claude was not re-run for this film.** Act 05 shows verbatim excerpts from `docs/assets/claude-pays-transcript.md`, a real `claude -p --model sonnet` run on 2026-10-04 against an earlier gateway on `:28402`. That is why its payTo and tx ids differ from those of the film stack on `:8502`.
   - Tool-call arguments are shown as compact JSON, with whitespace only reformatted.
   - Tool results show selected lines from the JSON, each line verbatim.
   - The "film stack" panel is pay-mcp driven by a script (`pay_mcp_driver.mjs`), not by an LLM. At build time, `demo.js` asserts that its refusal message equals the transcript's message byte for byte.
3. **The config file shows the default ports** (listen 8402, origin 4000, facilitator 4020). The stack in the film ran on the spare ports 8502/8503/4100/4120. The YAML beat carries a chip with the exact overrides (`GATEWAY_PORT=8502 ADMIN_PORT=8503 ORIGIN_PORT=4100 FACILITATOR_PORT=4120`, dashboard :3502), the provenance line says the film stack overrides the ports via env, the typed `STACK_ONLY=1 GATEWAY_PORT=8502 …` command shows them again, and `demo-local.sh` rewrites the ports into `.demo/agenttoll.yaml`.
4. **Act 04's dashboard change is a cross-fade between two screenshots** (state 02, then state 03), not a recording. State 03 was taken after the buyer payment shown in the terminal. At build time, `demo.js` asserts that the dashboard row text contains `SIMU…` plus the last four characters of the terminal's tx id.
5. **The live segment (07a)** is the real CDP screencast from `dash_capture.mjs`, at 0.6–8.6 s, in real time.
   - It is cropped to the content column (x 336–1584 CSS px) and re-encoded to VP9 (libvpx-vp9, CRF 20).
   - Round 2 dropped the side terminal of buyer stdout; the provenance line still names `dashboard-live-recording.json` (the scripted buyer paid every 2 s).
6. **Network split.** Only Solana devnet appears, because the demo config prices Solana only. The caption says "By network: 100% Solana devnet."
7. **Other dashboard details.** "Unique agents 1" is correct: every payment came from AgentToll-Buyer. Dashboard times are in the VPS's local time zone.
8. **No tooltip recreation.** Headless Chromium does not draw native `title` tooltips, so the film shows no tooltip. The cursor hovers the real Simulated badge, and the gold rings point to the dashboard's own "Includes … simulated" and "19 of 19 simulated" labels.
9. **Worker.** Act 08 shows only the summary lines of the captured parity run. The gateway's WARN log lines are omitted and the RUN path is shown with `$HOME`. The Worker is not deployed, and the info card says so.
10. **Handshakes.** Commands are shown in full (two verbatim lines each). Each `body:` line shows only its first physical line from the doc, because the doc wraps that JSON across several lines. Both are rejections from the real facilitators against unfunded throwaway wallets. No transaction exists.
11. **Proof numbers.** The tickers are parsed at build time from README.md and `evals/results/latest.md`. The evals do not cover the Worker, the dashboard, pay-mcp or Web Bot Auth, so the label says only "black-box evals".
12. **Film annotations** are drawn on top of the captures and never change a captured pixel: the flow strip, rings, callouts, the caps card (its values come from the transcript's spend_status JSON), the info card and the scrim. The flow strip takes about 1.7 s to animate, while the real buyer call took 554 ms.
13. **New capture.** This stage added `stack-only.json`: a real `STACK_ONLY=1` run on the spare ports, stopped with `tmux kill-session` after it printed its banner. Its stdout and stderr were checked to contain no admin token, and the repo path was replaced with `$REPO`.

## Build-time checks (demo.js throws, so the render fails)

- Each expected line is still present in its capture: the YAML keys, the stack banner, the tx line, the receipt keys, the error and message lines, the handshake lines and the parity header.
- The dashboard row text contains the buyer's tx suffix (`SIMU…121d`).
- The film-stack refusal message equals the transcript's refusal message.
- The test-count regexes match README.md and `evals/results/latest.md`.

## Render

```bash
cd ~/Hackathons/AgentToll-film && export PATH=$HOME/.local/bin:$PATH
# preview (10 fps, half scale)
node video/render/render.mjs --scene video/scenes/demo/index.html --fps 10 --scale 0.5 --out ~/agenttoll/scratch/frames/demo-preview --jobs 2
video/render/encode.sh --frames ~/agenttoll/scratch/frames/demo-preview --fps 10 --out ~/agenttoll/scratch/film-out/demo-preview.mp4 --clean
EVERY=2 video/render/sheet.sh ~/agenttoll/scratch/film-out/demo-preview.mp4 ~/vps-audit/film-shots/demo-preview
# final master (not done by this stage): 30 fps, scale 1, about 5,025 frames
node video/render/render.mjs --scene video/scenes/demo/index.html --fps 30 --out ~/agenttoll/scratch/frames/demo --jobs 3
video/render/encode.sh --frames ~/agenttoll/scratch/frames/demo --fps 30 --out ~/agenttoll/scratch/film-out/agenttoll-full-demo.mp4 --crf 18 --clean
```

At 30 fps the master is about 5,025 frames. At the engine's measured rate under load, 2.6–3.9 frames/s with 2–3 shards, that is about 22–32 minutes. Before seeking, the video layer waits for the `seeked` event on the WebM, so the same `t` always gives the same frame.

Preview in a desktop browser: open `video/scenes/demo/index.html?t=58` or `?play` through any static server rooted at the repo. The scene needs the repo root to be served, because it reads `README.md`, `docs/` and `evals/`.

## Fix round 1 (2026-10-05)

- Cold open added; title shortened to 3.6 s; config act trimmed from 15 s to 10 s.
- Act 07 caption "Agent traffic you are not billing yet, per agent, by name." (the zoom shows the AgentToll-Buyer row first, so "crawlers on free pages" no longer matched the picture).
- Act 10 holds about 10 s: the camera walks the Solana panel, then the Base panel; the `starting new connection` gateway-log line is highlighted in teal on each; in-frame note "Expected: unfunded throwaway wallet → the real facilitator rejects it."; closing line "A funded wallet is the only missing piece." (verbatim, `docs/assets/real-facilitator-handshake.md`).
- Terminal text is larger (17-21 px) and wraps at word boundaries; transcript strings are unchanged.

## Fix round 2 (2026-10-05, engine cfe5f65)

- Lint clean (`node video/engine/lint.mjs --scene video/scenes/demo/index.html`): frame 0 = 1.0, no dead frames, no camera violations, no badge overlaps.
- Every act opens on composed state (pre-rolled commands, loaded pages); act 07a lost 2 s and act 10 gained them, total still 171.2 s.
- `captions.json` acts now match the on-screen numbering: a10 `09 Proof` (148.8), a11 `10 Wired to real facilitators` (154.1), a12 `Close` (166.75).
- Receipt cue keeps the buyer terminal in focus; no push-in frames the Settled tile without the gold SIMULATED callout.
- Cursor never rests on the value a shot explains (YAML cursor removed; parked beside values elsewhere).
- Windows on the right of payment acts start at y 170, below the badge band.
- The YAML viewer dims every line outside the active band while it is pushed in, so the zoomed block reads alone.
- Act 02 goes straight from the browser push-in to the terminal push-in (command pre-rolled, the 402 prints as the camera lands); the decode command gets its own push-in instead of a wide frame.
- Act 03 output starts on the cut and the camera pushes in at 0.7 s (tool prices), then pans to the routes.
- Act 06: the unpaid `tools/call` is pre-rolled and framed on its own (no wide frame with a dimmed pane and a bare `$ curl`).
- Every push-in that frames the dashboard's own "Live settlements" heading carries a gold note beside it, "= SIMULATED settlements · no funds moved" (act 04 row, act 07 live segment, act 07 feed stop); the By-network stop frames the Settled tiles together with their gold callout, above the caption.
- While the camera is pushed in, a dark band under the caption (scene-level, `.botscrim`) pairs with the engine's top scrim, so half-cropped lines never read beside the caption pill or the eyebrow.
- The Worker info card joins the camera's crop guard (`data-at-panel`).

## Narration (2026-10-05)

- The captions are the narration's subtitles, word for word (`video/vo/narration.py` builds
  `video/vo/narration/demo.json` from `captions.json`). Lines were shortened to a natural spoken
  pace; the cold open is now the narrator's intro ("Hi, I'm Joseph's AI assistant. Let me show you
  AgentToll."), the title card says "Every payment here is simulated.", and the close says "Open
  source. One command, no wallet needed."
- The end card adds the credit "Narration: AI voice (Kokoro TTS) · Joseph's AI assistant"; the
  run/devnet footer moved up to 868 px to make room.
