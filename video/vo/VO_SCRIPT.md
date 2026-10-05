# Voiceover script (for Joseph to record)

The films ship with burned-in captions, a synthesized music bed and UI sound. A voice and a face are the pieces an agent cannot supply: record them, then mux the voice with
`bash video/render/mux.sh --video <film>-picture.mp4 --audio <bed>.wav --vo voice.wav --out <film>.mp4` (the bed is ducked about 8:1 under the voice).

Read each line so it starts at its timecode and ends by the next one. The lines are the on-screen captions, so voice and captions agree. Regenerate a table after a caption or EDL change: hero `python3 video/scenes/hero/captions.py` then the table below; pitch `python3 video/vo/pitch_vo.py`.

Before upload, a person listens to all three mixes on laptop speakers and on earbuds: the coin and thud SFX must not clip under the voice, and the bed must sit at least 10 dB under speech. If the synthesized bed sounds thin, replace it with a licensed or CC0 track and keep only the 402 thud, the logo riser and the refusal tone.

## Pitch cut (agenttoll-pitch.mp4): two on-camera slots, not in the render

The render (`video/scenes/pitch/EDL.json`) is 2:04.35. Joseph's two on-camera pieces are spliced before and after it, for about 2:24 in all (the Colosseum pitch field allows 2:00 to 3:00). They are listed in `EDL.json` under `slots` with `"rendered": false`; the render never contains them.

Recording: eye level, soft key light, a dark backdrop close to the film's `#07060F`, 1080p, the same sitting for both.

### SLOT A: joseph-open, 10 s, before 0:00 of the render

"I'm Joseph Clark. I run an AI landing-page service: we ship sites for small businesses. Agents read every one of them, all day, for free. AgentToll lets them pay."

(Source: docs/launch/PITCH_VIDEO.md 0:00 problem; docs/COLOSSEUM_SUBMISSION.md "We run … an AI landing-page service".)

### SLOT B: joseph-close, 10 s, after the end of the render

"Everything you saw is open source and runs with one command, no wallet needed: github.com/Josefusan/agenttoll. Put it in front of something agents already read. Agents already use your product. Now you can bill them."

(Source: docs/launch/PITCH_VIDEO.md 2:50 close and ask; README.md "Try it in one command (no wallet, no funds)".)

### Voiceover over the render (timecodes are the render's, slot A not counted)

Optional extra lines for Joseph's own voice, not on screen: at the business model (about 1:30), "an agency bundle and a pro dashboard come later"; at distribution (about 1:38), "that is our own landing-page service, so the first sites are ours." Both are plans (docs/COLOSSEUM_SUBMISSION.md business model and distribution).

Render length 2:04.35 (124.35 s).

| Start | End | Line |
|---|---|---|
| 0:05.40 | 0:08.60 | Agents read your site all day. They pay nothing. |
| 0:09.40 | 0:13.20 | 8 agent requests, no price: $0.016 left on the table. |
| 0:14.50 | 0:17.30 | Same URL. A person gets the data, free. |
| 0:17.40 | 0:20.90 | An agent gets 402 Payment Required, with a price. |
| 0:21.00 | 0:25.60 | People: free. Agents: $0.002. |
| 0:25.35 | 0:28.15 | Claude gets a wallet: pay-mcp, with hard spend caps. |
| 0:28.25 | 0:31.85 | It checks the price, checks its caps, then pays $0.002. |
| 0:31.95 | 0:33.80 | The receipt says SIMULATED. |
| 0:33.95 | 0:36.45 | The payment lands on the founder's dashboard. |
| 0:36.55 | 0:38.35 | Simulated: no on-chain transaction exists. |
| 0:38.45 | 0:41.65 | Now a $0.05 tool. Claude's per-call cap is $0.01. |
| 0:41.75 | 0:44.45 | Refused before signing. No money moved. |
| 0:44.65 | 0:49.45 | The wallet's caps win. Claude does not work around them. |
| 0:51.25 | 0:54.55 | MCP servers sell per tool. tools/list carries each price. |
| 0:54.70 | 0:57.05 | initialize and tools/list stay free. search_docs: $0.005. |
| 0:56.65 | 0:58.20 | Open protocol: HTTP and MCP. |
| 0:58.65 | 1:02.35 | Solana leads x402: about $3.3M USDC settled in one week. |
| 1:02.15 | 1:04.85 | Funded wallet: USDC settles to your pay_to. |
| 1:04.95 | 1:07.80 | Settle only after the origin succeeds. |
| 1:07.65 | 1:10.85 | Why now? PayAI batch settlement on Solana, Sep 30. |
| 1:10.95 | 1:14.85 | Cloudflare announced a gateway in July: waitlist-only, tied to its network. |
| 1:14.95 | 1:18.85 | Agents already hold wallets: Coinbase's Payments MCP pays x402 on Solana. |
| 1:18.95 | 1:22.85 | The open, self-hosted version was not built. So we built it. |
| 1:22.95 | 1:26.85 | Who buys: four kinds of seller whose product agents already use. |
| 1:26.95 | 1:30.55 | Buyer types, not customers. No customers and no revenue yet. |
| 1:30.75 | 1:34.35 | We charge for convenience, never by holding the seller's funds. |
| 1:34.45 | 1:38.35 | Free core. Hosted: flat tier plus a fee on settled volume. |
| 1:38.45 | 1:41.65 | Distribution: we already ship landing pages to small businesses. |
| 1:41.75 | 1:43.85 | Plan: each client's pay_to, their own address. |
| 1:44.25 | 1:48.25 | 119 of 119 evals. 93 Rust, 69 pay-mcp, 70 Worker tests. |
| 1:48.90 | 1:52.40 | What's next, as a plan: a funded devnet settlement, then mainnet. |
| 1:52.50 | 1:55.50 | A funded wallet is the only missing piece. |
| 1:56.30 | 2:00.00 | Built by Joseph Clark, a solo builder. |
| 2:00.25 | 2:03.75 | Open source. One command, no wallet needed. |

## Hero film (1:31.5, agenttoll-film-90s.mp4)

| Start | End | Line |
|---|---|---|
| 0:05.40 | 0:08.60 | Agents read your site all day. They pay nothing. |
| 0:09.40 | 0:13.20 | 8 agent requests, no price: $0.016 left on the table. |
| 0:14.50 | 0:17.30 | Same URL. A person gets the data, free. |
| 0:17.40 | 0:20.90 | An agent gets 402 Payment Required, with a price. |
| 0:21.00 | 0:25.60 | People: free. Agents: $0.002. |
| 0:26.10 | 0:27.85 | Open protocol: HTTP and MCP. |
| 0:28.30 | 0:32.00 | Solana leads x402: about $3.3M USDC settled in one week. |
| 0:32.75 | 0:35.30 | The agent asks, gets a price, signs. |
| 0:35.40 | 0:37.55 | The facilitator verifies. The origin answers. |
| 0:37.65 | 0:40.35 | Funded wallet: USDC settles to your pay_to. |
| 0:40.45 | 0:43.30 | Settle only after the origin succeeds. |
| 0:43.90 | 0:47.10 | Claude gets a wallet: pay-mcp, with hard spend caps. |
| 0:47.20 | 0:50.80 | It checks the price, checks its caps, then pays $0.002. |
| 0:50.90 | 0:52.75 | The receipt says SIMULATED. |
| 0:52.90 | 0:55.40 | The payment lands on the founder's dashboard. |
| 0:55.50 | 0:57.30 | Simulated: no on-chain transaction exists. |
| 0:57.40 | 1:00.60 | Now a $0.05 tool. Claude's per-call cap is $0.01. |
| 1:00.70 | 1:03.40 | Refused before signing. No money moved. |
| 1:03.60 | 1:08.40 | The wallet's caps win. Claude does not work around them. |
| 1:10.20 | 1:13.50 | MCP servers sell per tool. tools/list carries each price. |
| 1:13.65 | 1:16.10 | initialize and tools/list stay free. search_docs: $0.005. |
| 1:16.60 | 1:19.40 | The plan: free open-source core, paid hosted edition. |
| 1:21.20 | 1:25.20 | 119 of 119 evals. 93 Rust, 69 pay-mcp, 70 Worker tests. |
| 1:27.40 | 1:30.90 | Open source. One command, no wallet needed. |

## Full product demo (2:51, agenttoll-full-demo.mp4)

| Start | End | Line |
|---|---|---|
| 0:00.20 | 0:03.00 | Same URL. A person gets the data, free. |
| 0:03.10 | 0:05.60 | An agent gets 402 Payment Required. |
| 0:09.90 | 0:12.50 | One YAML file: Solana devnet USDC, paid to your own pay_to. Facilitator here: SIMULATED. |
| 0:12.60 | 0:14.90 | GET /api/quote costs an agent $0.002. Everything under /* stays free. |
| 0:15.00 | 0:17.20 | MCP tools carry their own prices: search_docs $0.005, generate_report $0.05. |
| 0:17.40 | 0:19.40 | One command starts the stack. SIMULATED facilitator, empty ledger. |
| 0:20.10 | 0:23.90 | A person opens the site through the gateway: the normal page, free. |
| 0:24.10 | 0:27.50 | Same gateway, /api/quote: the browser gets the JSON, with paid: false. |
| 0:27.70 | 0:32.00 | Claude-User asks for the same URL and gets 402 Payment Required. |
| 0:32.20 | 0:36.30 | The PAYMENT-REQUIRED header decodes to an x402 v2 quote: 2000 atomic USDC, $0.002. |
| 0:36.50 | 0:39.60 | Network, asset and payTo: everything an agent needs to pay. |
| 0:40.50 | 0:44.50 | Agents can read every price first: /.well-known/agenttoll.json is free. |
| 0:44.70 | 0:48.70 | Routes, MCP tools and networks, generated from the same YAML file. |
| 0:49.50 | 0:53.70 | The buyer CLI asks, gets the 402, signs a devnet USDC transfer and retries. |
| 0:53.90 | 0:57.50 | 200 OK. The receipt comes back in the PAYMENT-RESPONSE header. |
| 0:57.70 | 1:01.90 | The dashboard gets the row: +$0.002, AgentToll-Buyer, Solana devnet, Simulated. |
| 1:02.10 | 1:06.30 | Same id on both sides: SIMULATED-…121d. No funds moved. |
| 1:07.00 | 1:10.60 | Claude gets a wallet through pay-mcp. First it reads the price. |
| 1:10.80 | 1:15.00 | $0.002 is under both caps, so Claude pays. The receipt says simulated. |
| 1:15.20 | 1:19.40 | Next, a $0.05 tool. Claude is told it may spend up to 10 cents. |
| 1:19.60 | 1:23.80 | The wallet refuses before signing: $0.05 is above the $0.01 per-call cap. |
| 1:24.00 | 1:27.40 | Nothing was signed and nothing counted. Claude did not work around it. |
| 1:27.60 | 1:30.30 | On the film stack the wallet gives the same refusal, word for word. |
| 1:31.00 | 1:35.20 | MCP servers sell per tool. tools/list stays free and carries every price. |
| 1:35.40 | 1:40.00 | An unpaid tools/call gets the MCP-native challenge: isError plus a quote, 5000 = $0.005. |
| 1:40.20 | 1:44.40 | Paid through pay-mcp, the tool gets its own dashboard row: mcp search_docs. |
| 1:45.00 | 1:50.00 | Recorded from the running dashboard: the buyer CLI pays every 2 s, rows land. |
| 1:50.20 | 1:55.40 | Each simulated payment updates the totals and the feed as it arrives. |
| 1:55.90 | 1:59.60 | After 19 payments: $0.034, and the card says it outright: all of it simulated. |
| 1:59.80 | 2:03.40 | By network: 100% Solana devnet. Base Sepolia, the backup rail, is not set up here. |
| 2:03.60 | 2:07.20 | The feed: 19 of 19 simulated. No transaction exists, so there is nothing to link. |
| 2:07.40 | 2:11.00 | Agent traffic you are not billing yet, per agent, by name. |
| 2:11.20 | 2:15.00 | Cash out: spendable $0.00, because every payment was simulated. |
| 2:15.20 | 2:18.60 | Funds go to your own pay_to. AgentToll holds nothing. |
| 2:18.80 | 2:21.60 | The same dashboard on a phone. |
| 2:22.20 | 2:26.20 | The same core compiles to WebAssembly and runs as a Cloudflare Worker. |
| 2:26.40 | 2:30.60 | 21 parity tests check byte-identical quotes against the Rust gateway. |
| 2:32.30 | 2:35.80 | In the repo: 119 of 119 evals, 93 Rust tests, 69 pay-mcp tests, 70 Worker tests. |
| 2:36.20 | 2:38.40 | Wired to the real PayAI and x402.org facilitators. |
| 2:38.50 | 2:41.00 | PayAI, Solana devnet: an unfunded throwaway wallet, rejected as expected. |
| 2:41.10 | 2:43.60 | x402.org, Base Sepolia: also rejected. The wallet holds no USDC. |
| 2:43.80 | 2:46.40 | A funded wallet is the only missing piece. |
