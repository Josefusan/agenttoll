# Voiceover script (for Joseph to record)

The films ship with burned-in captions, a synthesized music bed and UI sound. A voice is the one piece an agent cannot supply: record it, then mux it with
`bash video/render/mux.sh --video <film>-picture.mp4 --audio <bed>.wav --vo voice.wav --out <film>.mp4` (the bed is ducked about 8:1 under the voice).

Read each line so it starts at its timecode and ends by the next one. The lines are the on-screen captions, so voice and captions agree. For the pitch cut, the full voiceover with the business sections is in `docs/launch/PITCH_VIDEO.md`; Joseph's on-camera open and close (10 s each) go before and after `agenttoll-pitch.mp4`.

## Hero film (1:30.5, agenttoll-film-90s.mp4)

| Start | End | Line |
|---|---|---|
| 0:05.60 | 0:08.80 | Agents read your site all day. They pay nothing. |
| 0:09.30 | 0:13.70 | The dashboard counts them: 8 agent requests on routes with no price. |
| 0:14.60 | 0:18.00 | Same URL. A person gets the data, free. |
| 0:18.20 | 0:21.80 | An agent gets 402 Payment Required, with a price. |
| 0:22.00 | 0:25.60 | People: free. Agents: $0.002. |
| 0:26.30 | 0:29.15 | x402: the web's 402 status code, finally paid. |
| 0:29.55 | 0:32.00 | On Solana the agent only holds USDC. |
| 0:32.75 | 0:35.30 | The agent asks, gets a price, signs. |
| 0:35.40 | 0:37.70 | The facilitator verifies. The origin answers. |
| 0:37.80 | 0:40.30 | It settles. USDC goes to your pay_to. |
| 0:40.45 | 0:43.30 | Settle only after the origin succeeds. |
| 0:43.90 | 0:47.10 | Claude gets a wallet: pay-mcp, with hard spend caps. |
| 0:47.20 | 0:50.80 | It checks the price, checks its caps, then pays $0.002. |
| 0:50.90 | 0:52.75 | The receipt says SIMULATED. |
| 0:52.90 | 0:55.40 | The payment lands on the founder's dashboard. |
| 0:55.50 | 0:57.30 | Simulated: no on-chain transaction exists. |
| 0:57.40 | 1:00.60 | Now a $0.05 tool. Claude's per-call cap is $0.01. |
| 1:00.70 | 1:03.40 | Refused before signing. No money moved. |
| 1:03.60 | 1:08.40 | The wallet's caps win. Claude does not work around them. |
| 1:10.20 | 1:13.60 | MCP servers sell per tool. tools/list carries each price. |
| 1:13.80 | 1:17.10 | initialize and tools/list stay free. search_docs: $0.005. |
| 1:18.95 | 1:23.15 | 119 of 119 evals pass. 93 Rust tests. 21 Worker parity tests. |
| 1:23.30 | 1:26.10 | Devnet and testnet only. Demo payments are simulated. |

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
