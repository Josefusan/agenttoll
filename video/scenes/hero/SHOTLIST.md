# Hero film shot list (90 s, 1920x1080)

Scene source: `video/scenes/hero/index.html`. On-screen captions and title lines are in `captions.json`. Run `python3 video/scenes/hero/captions.py` to regenerate that file from `index.html`; the script also fails if any caption is on screen for less than 0.35 s per word.

## Rules this film follows

- **Payments are simulated.** All of them went through the local mock facilitator, and every transaction id starts with `SIMULATED-`. Any frame showing a payment or a settlement (03 from 28.95 s, 04, 05) carries the gold `SIMULATED · no funds moved` badge.
- **No made-up strings.** Every terminal line, number, header, price and UI state comes from a real run or from a file in the repo, as the table below shows. There are only three kinds of edit:
  - **Line selection:** a capture is excerpted, but each line shown is unchanged.
  - **Long values truncated:** these use `…` (`solana:EtWTRABZ…qa1`, `G3r9m7Ej…JtmoUt`), and the `payment-required` base64 line fades out at the panel edge.
  - **Tool-call formatting:** in the Claude panels, the arguments of each tool call are printed as compact JSON on one line, and each result is shown as a few `"key": value` pairs copied verbatim from the result JSON. The labels `→`, `└` and `Claude` are presentation, not CLI output.
- **Plain truth only.** The film claims no revenue, users, customers or traction. Sources appear on screen as footnotes.

## Scenes

| Time | Scene | Transition in |
|---|---|---|
| 0–5 | 00 Cold open | none |
| 5–14 | 01 The problem | push through the wordmark |
| 14–26 | 02 Same URL, two answers | gradient wipe left to right |
| 26–42 | 03 How it works | camera push into the `amount` row, then a push cut |
| 42–70 | 04 Using it (the Loom part) | gradient wipe right to left |
| 70–78 | 05 MCP servers sell per tool | push |
| 78–86 | 06 Proof | gradient wipe left to right |
| 86–90 | Close | push |

## Strings and their sources

| Time | On screen | Source |
|---|---|---|
| 0.4–2.3 | `$ curl -s -i -A 'Mozilla/5.0 (compatible; ClaudeBot/1.0)' http://127.0.0.1:8502/api/quote`, `HTTP/1.1 402 Payment Required`, `x-agenttoll-verdict: ua:ClaudeBot` | `video/captures/terminal/claudebot-402.json` (command plus 2 of its header lines) |
| 2.5–5.4 | Robot icon, `AgentToll`, "Agents already use your product. Now you can bill them." | `brand/icon.svg`; tagline from `README.md` line 26 and `docs/launch/PITCH_VIDEO.md` (close) |
| 5–9 | "Agents read. / Founders pay." | `docs/launch/PITCH_VIDEO.md` (0:00 on-screen text) |
| 6.3–9 | "Until now the choices were block them or absorb it." | `docs/launch/PITCH_VIDEO.md` (problem voiceover) |
| 6–9 | The `for ua in …; do curl …; done` loop and its 7 output lines `200  …ClaudeBot/1.0)` etc. | `video/captures/terminal/crawler-hits-free-pages.json` (command and stdout verbatim; the bot names are coloured) |
| 8.9–14 | Dashboard at `http://127.0.0.1:3502`: "Agent traffic you are not billing yet", 8 requests, ClaudeBot 3, GPTBot 2, CCBot 1, PerplexityBot 1, unknown 1 | `video/captures/dashboard/dashboard-02-unbilled-no-payments-full.png` (real Playwright capture with zero payments, cropped to page x 300–1620, scrolled and zoomed) |
| 9.3–13.7 | "The dashboard counts them: 8 agent requests on routes with no price." | The same screenshot reads "8 agent requests reached routes with no price" |
| 14–26 | Browser at `http://127.0.0.1:8502/api/quote`, JSON `{"agent":null,…,"paid":false,"price":142.67,…}`, `200 OK` pill | `video/captures/origin/origin-api-quote.png` and `origin/origin.json` (status 200) |
| 16.4–26 | Response headers card: status 200, `content-type: application/json`, `content-length: 80` | `video/captures/origin/origin.json` (the same request as the screenshot) |
| 17.6–26 | `curl -s -i -A '…ClaudeBot/1.0)' …/api/quote`, then `HTTP/1.1 402 Payment Required`, `content-type`, `payment-required: eyJ4…` and `x-agenttoll-verdict: ua:ClaudeBot` | `video/captures/terminal/claudebot-402.json` (4 of 7 header lines; the base64 line is complete and only visually clipped) |
| 20.4–26 | Decoded card: `scheme "exact"`, `amount "2000"`, `network "solana:EtWTRABZ…qa1"`, `payTo "G3r9m7Ej…JtmoUt"`, `maxTimeoutSeconds 60` | `video/captures/terminal/payment-required-decoded.json` |
| 21.8–26 | `= $0.002 USDC`, `= Solana devnet`, `= the seller's wallet` | `docs/assets/claude-pays-transcript.md`: the quote shows `"usd": "0.002"`, `"amount_atomic": "2000"` and `"network_name": "Solana devnet"` for the same network; `payTo` is the seller's address (README: "funds go straight to your pay_to") |
| 26–42 | Steps: Quote, Sign, Verify, Origin answers, Settle, USDC to your pay_to. Nodes: Agent (Claude + pay-mcp), AgentToll, Your origin, Facilitator (`/verify · /settle`), pay_to. Packets: `GET /api/quote`, `402 · $0.002`, `PAYMENT-SIGNATURE`, `/verify`, `isValid`, `200`, `/settle`, `$0.002 USDC`, `200 + data` | `docs/KNOWLEDGE_BASE.md`: KB-X402-01 for headers, KB-X402-04 for facilitator endpoints, and KB-X402-06 for the order verify, then resource, then settle and the `isValid` field. The footnote cites these IDs on screen |
| 38.4–42 | "Funds go to your pay_to. / AgentToll holds nothing." | `docs/launch/DEMO_VIDEO.md` (2:15 line) and `README.md` ("Non-custodial. Funds go straight to your pay_to.") |
| 38.4–41.6 | "Settle only after the origin succeeds." | `docs/launch/DEMO_VIDEO.md` (2:15 line) |
| 42–70 | Claude terminal, Run 1: `claude -p "<Run 1 prompt>" --model sonnet … --verbose`; the session line; `get_quote`, `spend_status` and `pay_and_fetch` calls and results; `tx "SIMULATED-2133136493f49f4aee5a4b43"`; the note; Claude's two answers | `docs/assets/claude-pays-transcript.md` Run 1. The prompt, flags and Claude's text are verbatim. This was a real `claude -p` run on 2026-10-04 against gateway port 28402; the footnote says so |
| 42–60 | Dashboard at `http://127.0.0.1:23402` with `+$0.002 AgentToll-Buyer GET /api/quote Solana devnet Simulated`, `2 of 2 simulated` and `$0.007` | `docs/assets/claude-pays-dashboard.png`, captured right after that Claude run (see `docs/assets/README.md`). The row "lift" is a crop of the same pixels raised with a gold ring; the UI is not altered |
| 52.4–53.7 | `+$0.002` gold chip | The row's own amount |
| 54.5–56.4 | Tooltip: "Paid through the local simulated facilitator. No on-chain transaction exists." | The badge's `title` attribute, from `video/captures/dashboard/dashboard-03-one-payment.boxes.json`. **This is a recreation.** Headless Chromium doesn't paint native tooltips, so it is redrawn from that string, and an on-screen footnote says so |
| 57.3–70 | Run 2: `claude -p "<Run 2 prompt>" …`, `call_paid_tool {… "generate_report", "max_usd": 0.1}`, `"error": "refused:per_call"`, `"message": "Refused before signing (no money moved, nothing counted against caps): quote $0.05 is above BUYER_MAX_USD_PER_CALL ($0.01); not paid"`, Claude's reply | `docs/assets/claude-pays-transcript.md` Run 2. The live pay-mcp re-run in `video/captures/terminal/pay-mcp-session.json` prints the same refusal string |
| 60.4–70 | Caps card: `per_call_usd "0.01"`, `per_day_usd "0.25"`, `spent_usd "0.002"`, `remaining_usd "0.248"`, `refused:per_call`, "generate_report quoted $0.05" | Run 2's `spend_status` result and the refusal message, both in the transcript |
| 70–78 | `tools/list`: `search_docs`, "Search Acme's documentation. (Paid tool: $0.005 USDC per call via x402.)"; `generate_report` with $0.05; `ping_free`, "A free tool." | `video/captures/terminal/mcp-tools-list.json` (descriptions verbatim; the request was a curl POST to `/mcp`) |
| 72–78 | Run 3: `call_paid_tool` for `search_docs` with `{"query": "x402"}`, the result text, `"usd": "0.005"`, `"payment_transport": "mcp-native"`, `tx "SIMULATED-d25d80847de12b78e8cd599d"`, and "I paid $0.005 (5000 atomic USDC units) on Solana devnet. The payment was simulated." | `docs/assets/claude-pays-transcript.md` Run 3 (bold markers removed) |
| 74.3–78 | Live feed crop: `+$0.005 AgentToll-Buyer mcp search_docs` above `+$0.002 … GET /api/quote` | `docs/assets/claude-pays-dashboard.png` (crop) |
| 74–77.6 | "initialize and tools/list stay free." | `docs/launch/PITCH_VIDEO.md` (who-buys table) and `docs/launch/DEMO_VIDEO.md` (1:25) |
| 78–86 | `119/119` black-box evals pass, `93` Rust tests, `69` pay-mcp tests, `21` Worker parity tests | `evals/results/latest.md` ("119/119 passed", run 2026-10-04) and the `README.md` test table (93, 69, and Worker 70 of which 21 are parity tests) |
| 78–86 | "The repo grades itself." | `docs/launch/DEMO_VIDEO.md` (2:27 voiceover) |
| 81.4–86 | "Talks to the real PayAI and x402.org facilitators. Settlement waits on funded devnet and testnet wallets." | `docs/assets/real-facilitator-handshake.md`: PayAI on Solana devnet and x402.org on Base Sepolia were both reached and both rejected the unfunded wallets. The plan's wording said "devnet wallets"; "and testnet" was added because Base Sepolia is a testnet |
| 83–85.8 | "Devnet and testnet only. Demo payments are simulated." | `docs/COLOSSEUM_SUBMISSION.md` ("Honest status: devnet and testnet only… settles through a simulated facilitator") |
| 86–90 | Wordmark, tagline, `github.com/Josefusan/agenttoll`, "COLOSSEUM CRYPTO WORLD'S FAIR" | The same sources as the cold open, plus the event name from the task brief |

## Known differences from the plan

- **Cold open command.** The plan's `$ ./agenttoll --explain` doesn't exist: there is no such binary or flag in the repo. The cold open types the real ClaudeBot curl and shows its real `402`.
- **Different ports.** The Claude runs used gateway port 28402 (earlier run, transcript), while the film-stack captures used 8502. Both ports appear exactly as captured.
- **Dashboard rows.** Scene 04 doesn't fake a row "landing". The dashboard is the real screenshot taken right after the Claude run, and the camera zooms in while the existing row lifts.
- **Mid-transition frames.** In those frames the camera and the Ken Burns drift scale real screenshots. No pixels inside a screenshot are edited.
