# Hero film shot list (90.5 s, 1920x1080, 60 fps, with sound)

Scene source: `video/scenes/hero/index.html`. On-screen captions and title lines are in `captions.json`. Run `python3 video/scenes/hero/captions.py` to regenerate that file from `index.html`; the script also fails if any caption is on screen for less than 0.35 s per word.

## Rules this film follows

- **Payments are simulated.** All of them went through the local mock facilitator, and every transaction id starts with `SIMULATED-`. Any frame showing a payment or a settlement carries the gold `SIMULATED · no funds moved` badge: one badge, on without a break from 32.4 s (the settlement diagram) to 77.3 s (end of 05). `S.requireBadge` makes the render fail if any frame between 32.7 s and 77.0 s lacks it.
- **No made-up strings.** Every terminal line, number, header, price and UI state comes from a real run or from a file in the repo, as the table below shows. There are only three kinds of edit:
  - **Line selection:** a capture is excerpted, but each line shown is unchanged.
  - **Long values truncated:** these use `…` (`solana:EtWTRABZ…qa1`, `G3r9m7Ej…JtmoUt`), and the `payment-required` base64 line fades out at the panel edge.
  - **Tool-call formatting:** in the Claude panels, the arguments of each tool call are printed as compact JSON on one line, and each result is shown as a few `"key": value` pairs copied verbatim from the result JSON. The labels `→`, `└` and `Claude` are presentation, not CLI output.
- **Plain truth only.** The film claims no revenue, users, customers or traction. Sources appear on screen as footnotes.

## Scenes

| Time | Scene | Transition in |
|---|---|---|
| 0–5.3 | 00 Cold open: giant gold `402 Payment Required` (camera in on the real line), pull out to the terminal, terminal blurs out, wordmark lands at 2.1 s | none |
| 5–14 | 01 The problem | blur-out, clean build |
| 14–26 | 02 Same URL, two answers | gradient wipe left to right |
| 26–32.3 | 02b Why x402, why Solana | blur-out, clean build |
| 32.2–43.6 | 03 How it works (diagram trimmed to 11 s) | blur-out, clean build |
| 43.4–69 | 04 Using it: Claude pays, the dashboard row, the refusal | gradient wipe right to left |
| 68.9–77.4 | 05 MCP servers sell per tool | blur-out, clean build |
| 77.1–86.2 | 06 Proof | gradient wipe left to right |
| 85.9–90.5 | Close | blur-out, clean build |

One transition grammar: an in-scene camera move is a single layer on cubic-bezier(.22,1,.36,1), and the camera is back at full frame before any scene leaves, so two zoom states never dissolve into each other. Camera targets are fitted inside a safe area (150 px top and bottom), clear of the badge band and the caption pill; while zoomed, a dark band sits behind the top chrome and the badge. Provenance lines are one fixed line bottom-left, outside the camera.

Sound: `video/render/audio.mjs` synthesizes the bed and UI sounds from the cues in `index.html` (`AT.sfx`): a thud on the 402, riser and lift into the logo, coin on the gold money moments (39.35 diagram packet, 53.3 row, 73.9 search_docs), a muted two-step on `refused:per_call` (60.2), clicks, key ticks, wipe whooshes, a duck under 04 and a swell into the close. Licence: `video/assets/audio/LICENSE.md` (CC0, generated). No voiceover; script in `video/vo/VO_SCRIPT.md`.

## Strings and their sources

| Time | On screen | Source |
|---|---|---|
| 0–2.0 | `HTTP/1.1 402 Payment Required` and `x-agenttoll-verdict: ua:ClaudeBot` full frame, then the command `$ curl -s -i -A 'Mozilla/5.0 (compatible; ClaudeBot/1.0)' http://127.0.0.1:8502/api/quote` above them at 40 px | `video/captures/terminal/claudebot-402.json` (command plus 2 of its header lines) |
| 26–32 | "x402: the web's 402 status code, finally paid." / "USDC on Solana: the facilitator pays the fee, the agent only holds USDC." | `docs/COLOSSEUM_SUBMISSION.md` chains answer ("a facilitator whose fee payer sponsors the fee, so agents only hold USDC"); KB-X402-01, KB-X402-04 |
| 2.0–5.3 | Robot icon, `AgentToll`, "Agents already use your product. Now you can bill them." | `brand/icon.svg`; tagline from `README.md` line 26 and `docs/launch/PITCH_VIDEO.md` (close) |
| 5–9 | "Agents read. / Founders pay." | `docs/launch/PITCH_VIDEO.md` (0:00 on-screen text) |
| 6.3–9 | "Until now the choices were block them or absorb it." | `docs/launch/PITCH_VIDEO.md` (problem voiceover) |
| 6–9 | The `for ua in …; do curl …; done` loop and its 7 output lines `200  …ClaudeBot/1.0)` etc. | `video/captures/terminal/crawler-hits-free-pages.json` (command and stdout verbatim; the bot names are coloured) |
| 8.9–14 | Dashboard at `http://127.0.0.1:3502`: "Agent traffic you are not billing yet", 8 requests, ClaudeBot 3, GPTBot 2, CCBot 1, PerplexityBot 1, unknown 1 | `video/captures/dashboard/dashboard-02-unbilled-no-payments-full.png` (real Playwright capture with zero payments, cropped to page x 300–1620, scrolled and zoomed) |
| 9.3–13.7 | "The dashboard counts them: 8 agent requests on routes with no price." | The same screenshot reads "8 agent requests reached routes with no price" |
| 14–26 | Browser at `http://127.0.0.1:8502/api/quote`, JSON `{"agent":null,…,"paid":false,"price":143.62,…}`, `200 OK` pill | `video/captures/origin/origin-api-quote.png` and `origin/origin.json` (status 200), re-captured in dark mode on 2026-10-05 (commit 6f5db63); the top 22 CSS px, Chrome's Pretty-print bar, sit above the view |
| 16.4–26 | Response headers card: status 200, `content-type: application/json`, `content-length: 80` | `video/captures/origin/origin.json` (the same request as the screenshot) |
| 17.6–26 | `curl -s -i -A '…ClaudeBot/1.0)' …/api/quote`, then `HTTP/1.1 402 Payment Required`, `content-type`, `payment-required: eyJ4…` and `x-agenttoll-verdict: ua:ClaudeBot` | `video/captures/terminal/claudebot-402.json` (4 of 7 header lines; the base64 line is complete and only visually clipped) |
| 20.4–26 | Decoded card: `scheme "exact"`, `amount "2000"`, `network "solana:EtWTRABZ…qa1"`, `payTo "G3r9m7Ej…JtmoUt"`, `maxTimeoutSeconds 60` | `video/captures/terminal/payment-required-decoded.json` |
| 21.8–26 | `= $0.002 USDC`, `= Solana devnet`, `= the seller's wallet` | `docs/assets/claude-pays-transcript.md`: the quote shows `"usd": "0.002"`, `"amount_atomic": "2000"` and `"network_name": "Solana devnet"` for the same network; `payTo` is the seller's address (README: "funds go straight to your pay_to") |
| 32.2–43.6 | Steps: Quote, Sign, Verify, Origin answers, Settle, USDC to your pay_to. Nodes: Agent (Claude + pay-mcp), AgentToll, Your origin, Facilitator (`PayAI (Solana) · x402.org (Base)`, the two real facilitators the gateway is wired to, `docs/assets/real-facilitator-handshake.md`), pay_to (`USDC · Solana`, with the Solana mark). Packets: `GET /api/quote`, `402 · $0.002`, `PAYMENT-SIGNATURE`, `/verify`, `isValid`, `200`, `/settle`, `$0.002 USDC`, `200 + data` | `docs/KNOWLEDGE_BASE.md`: KB-X402-01 for headers, KB-X402-04 for facilitator endpoints, and KB-X402-06 for the order verify, then resource, then settle and the `isValid` field. The footnote cites these IDs on screen |
| 40.45–43.6 | "Funds go to your pay_to. / AgentToll holds nothing." | `docs/launch/DEMO_VIDEO.md` (2:15 line) and `README.md` ("Non-custodial. Funds go straight to your pay_to.") |
| 40.45–43.3 | "Settle only after the origin succeeds." | `docs/launch/DEMO_VIDEO.md` (2:15 line) |
| 43.4–69 | Claude terminal at 26 px, Run 1: `claude -p "<first two sentences of the Run 1 prompt> …" …` (the rest of the prompt and the flags are behind the ellipsis; a provenance line says so); the session line; `get_quote`, `spend_status` and `pay_and_fetch` calls and results; `tx "SIMULATED-2133136493f49f4aee5a4b43"`; the note; Claude's two answers | `docs/assets/claude-pays-transcript.md` Run 1. Shown prompt text, results and Claude's text are verbatim; each beat dims the other lines to 25% and pushes in on its 2-3 lines. This was a real `claude -p` run on 2026-10-04 against gateway port 28402; the footnote says so |
| 52.9–57 | Only the quote row: `+$0.002 AgentToll-Buyer GET /api/quote Solana devnet Simulated 25s ago SIMU…4b43`, labelled "THE DASHBOARD · the row this payment wrote" | A crop (CSS px 112,877 806x58) of `docs/assets/claude-pays-dashboard.png`, captured right after that Claude run. The full dashboard is no longer shown: its totals ($0.007) and the search_docs row came from Run 3, so the first money on screen is this row. The header subtitle ("Links open the transaction on the explorer", from that older dashboard build) is outside the crop |
| 53.3–54.9 | `+$0.002` gold chip | The row's own amount |
| 55.45–56.9 | Tooltip: "Paid through the local simulated facilitator. No on-chain transaction exists." | The badge's `title` attribute, from `video/captures/dashboard/dashboard-03-one-payment.boxes.json`. **This is a recreation.** Headless Chromium doesn't paint native tooltips, so it is redrawn from that string, and an on-screen footnote says so |
| 57.55–69 | Run 2: `claude -p "<first two sentences of the Run 2 prompt> …" …`, `call_paid_tool {… "generate_report", "max_usd": 0.1}`, `"error": "refused:per_call"`, `"message": "Refused before signing (no money moved, nothing counted against caps): quote $0.05 is above BUYER_MAX_USD_PER_CALL ($0.01); not paid"`, Claude's reply | `docs/assets/claude-pays-transcript.md` Run 2. The live pay-mcp re-run in `video/captures/terminal/pay-mcp-session.json` prints the same refusal string |
| 63.7–69 | Floating card "spend_status · from the transcript" (labelled "Run 2 · card drawn for the film", not a dashboard view): `per_call_usd "0.01"`, `per_day_usd "0.25"`, `spent_usd "0.002"`, `remaining_usd "0.248"`, `refused:per_call`, "generate_report quoted $0.05" | Run 2's `spend_status` result and the refusal message, both in the transcript |
| 68.9–77.4 | `tools/list`: `search_docs`, "Search Acme's documentation. (Paid tool: $0.005 USDC per call via x402.)"; `generate_report` with $0.05; `ping_free`, "A free tool." | `video/captures/terminal/mcp-tools-list.json` (descriptions verbatim; the request was a curl POST to `/mcp`) |
| 71–77.4 | Run 3: `call_paid_tool` for `search_docs` with `{"query": "x402"}`, the result text, `"usd": "0.005"`, `"payment_transport": "mcp-native"`, `tx "SIMULATED-d25d80847de12b78e8cd599d"`, and "I paid $0.005 (5000 atomic USDC units) on Solana devnet. The payment was simulated." | `docs/assets/claude-pays-transcript.md` Run 3 (bold markers removed) |
| 73.2–77.4 | The two rows only: `+$0.005 AgentToll-Buyer mcp search_docs` above `+$0.002 … GET /api/quote` | `docs/assets/claude-pays-dashboard.png` (crop CSS px 112,820 806x116: header and its subtitle are outside the crop) |
| 73.8–77.1 | "initialize and tools/list stay free." | `docs/launch/PITCH_VIDEO.md` (who-buys table) and `docs/launch/DEMO_VIDEO.md` (1:25) |
| 77.1–86.2 | `119/119` black-box evals pass, `93` Rust tests, `69` pay-mcp tests, `21` Worker parity tests | `evals/results/latest.md` ("119/119 passed", run 2026-10-04) and the `README.md` test table (93, 69, and Worker 70 of which 21 are parity tests). The tiles show their final values from the first visible frame (no count-up, so no frame shows a partial count) |
| 77.4–86.2 | "The repo grades itself." | `docs/launch/DEMO_VIDEO.md` (2:27 voiceover) |
| 80.8–86.2 | "Talks to the real PayAI and x402.org facilitators. Settlement waits on funded devnet and testnet wallets." | `docs/assets/real-facilitator-handshake.md`: PayAI on Solana devnet and x402.org on Base Sepolia were both reached and both rejected the unfunded wallets. The plan's wording said "devnet wallets"; "and testnet" was added because Base Sepolia is a testnet |
| 83.3–86.1 | "Devnet and testnet only. Demo payments are simulated." | `docs/COLOSSEUM_SUBMISSION.md` ("Honest status: devnet and testnet only… settles through a simulated facilitator") |
| 85.9–90.5 | Wordmark, tagline, `github.com/Josefusan/agenttoll`, "COLOSSEUM CRYPTO WORLD'S FAIR" | The same sources as the cold open, plus the event name from the task brief |

## Known differences from the plan

- **Cold open command.** The plan's `$ ./agenttoll --explain` doesn't exist: there is no such binary or flag in the repo. The cold open types the real ClaudeBot curl and shows its real `402`.
- **Different ports.** The Claude runs used gateway port 28402 (earlier run, transcript), while the film-stack captures used 8502. Both ports appear exactly as captured.
- **Dashboard rows.** Scene 04 doesn't fake a row "landing": it shows a crop of the real row from the screenshot taken right after the Claude run. Scene 05 shows both rows.
- **Pitch cut.** `?cut=pitch` renumbers 04 as 08 and 06 as 09 (05 is not in the cut) for `video/scenes/pitch/EDL.json`.
- **Mid-transition frames.** In those frames the camera and the Ken Burns drift scale real screenshots. No pixels inside a screenshot are edited.
