# Narration: an AI voice, presented as Joseph's AI assistant

All three films are narrated by a stock **female synthetic voice**: Kokoro-82M v1.0, voice
`af_heart` (kokoro-onnx on CPU, set up in `~/agenttoll/vo/` on the VPS). Joseph's voice is not
cloned, and the voice never claims to be a person or to be Joseph.

- The pitch and the full demo open with her naming herself: "Hi, I'm Joseph's AI assistant. Let
  me show you AgentToll."
- Every end card carries the credit line `Narration: AI voice (Kokoro TTS) · Joseph's AI assistant`.
- The pitch's founder card (section 12, TEAM) is narrated by her: "Joseph Clark builds AgentToll,
  at Clark Technology Ventures. A solo builder, working with AI coding agents." It shows
  only facts from the repo: docs/COLOSSEUM_SUBMISSION.md (solo builder, based in the United
  States, AI coding agents plus an adversarial critic agent on every pull request, the
  landing-page service), docs/launch/PITCH_VIDEO.md (Clark Technology Ventures) and README.md
  (@Josefusan). It replaces the two 10 s on-camera slots the earlier cut reserved for Joseph.

## Captions are the narration

Every spoken line is a burned-in caption, word for word, at the same time. The `say` field in the
scripts differs from `text` only in pronunciation spelling ("x402" -> "x four oh two", "$0.002" ->
"two tenths of a cent", "USDC" -> "U S D C"; the rules are `~/agenttoll/vo/lexicon.json` plus
`SAY` in `narration.py`). To change a line, change the caption, then rebuild:

| Film | Captions live in | Spoken lines |
|---|---|---|
| hero | `video/scenes/hero/index.html` (`AT.Caption` block; `python3 video/scenes/hero/captions.py` writes `captions.json`) | `video/vo/narration/hero.json` |
| demo | `video/scenes/demo/captions.json` (act-relative; demo.js ends a cue 0.42 s before the next) | `video/vo/narration/demo.json` |
| pitch | hero cues inside each `EDL.json` segment (`only: 'pitch'` cues included) + `video/scenes/pitch/index.html` | `video/vo/narration/pitch.json` (cut time) |

Pace: lines are written to be said at a natural rate inside their window (Kokoro speed 1.0, never
above 1.12). Not every second is spoken: the cold open's 402, the gold `+$0.002` row and the
refusal land on a beat of silence and their sound cue.

## Rebuild

On the VPS, in `~/Hackathons/AgentToll-film`:

```bash
python3 video/scenes/hero/captions.py                       # hero captions.json from index.html
~/agenttoll/vo/.venv/bin/python video/vo/narration.py --check   # scripts + pace table; fails on a line
                                                            # inside a pitch dissolve or past its segment
python3 video/vo/claims_check.py                            # System-1 claim checks over the spoken text
for f in hero demo pitch; do                                # voice tracks at absolute film time, -16 LUFS
  ~/agenttoll/vo/.venv/bin/python ~/agenttoll/vo/narrate.py --script video/vo/narration/$f.json \
    --out-dir video/vo/narration/out/$f --voice af_heart --max-speed 1.12 --threads 4 \
    --duration $(case $f in hero) echo 91.5;; demo) echo 171.2;; pitch) echo 156.65;; esac)
  cp video/vo/narration/out/$f/report.json video/vo/narration/report-$f.json   # committed
done
```

`narrate.py` writes `out/<film>/voice.wav` (48 kHz mono, -16 LUFS integrated, true peak <= -1.5
dBFS), `out/<film>/lines/*.wav` and `report.json` (per line: window, duration, speed, overflow,
the faster-whisper small.en transcript and its word error rate against `say`). The wavs stay out
of git (`video/vo/narration/out/` is ignored); the reports are committed.

## Mux

The picture master comes from `render.mjs` + `encode.sh` (pitch: `edl.mjs`), the music bed and UI
sound from `audio.mjs`, then `mux.sh --vo` ducks the bed under the voice (sidechain, about 8:1) and
loudness-normalises the mix to -16 LUFS:

```bash
node video/render/render.mjs --scene video/scenes/hero/index.html --cues ~/agenttoll/scratch/audio/hero.cues.json
node video/render/audio.mjs --cues ~/agenttoll/scratch/audio/hero.cues.json --out ~/agenttoll/scratch/audio/hero.wav
bash video/render/mux.sh --video ~/agenttoll/scratch/film-out/agenttoll-film-90s-picture.mp4 \
  --audio ~/agenttoll/scratch/audio/hero.wav --vo video/vo/narration/out/hero/voice.wav \
  --out ~/agenttoll/scratch/film-out/agenttoll-film-90s.mp4
# pitch: edl.mjs writes <out>.cues.json next to the picture; feed that to audio.mjs, then mux the same way
```

## Before upload: a person listens

Listen to all three mixes on laptop speakers and on earbuds. The voice must sit clearly over the
bed, the coin and thud SFX must not clip under it, and no line may be cut by a pitch join. If the
synthesized bed sounds thin, replace it with a licensed or CC0 track and keep only the 402 thud,
the logo riser and the refusal tone.

## Lines (generated: `narration.py --md`)

### hero (91.5 s)

| id | Start | End | Line (caption = speech) |
|---|---|---|---|
| h01 | 0:05.60 | 0:09.20 | Agents read your site all day. They pay nothing. |
| h02 | 0:09.35 | 0:13.80 | 8 agent requests, no price: $0.016 left on the table. |
| h03 | 0:14.30 | 0:17.30 | Same URL. A person gets the data, free. |
| h04 | 0:17.45 | 0:20.90 | An agent gets 402 Payment Required. |
| h05 | 0:21.05 | 0:25.60 | People: free. Agents: $0.002. |
| h06 | 0:26.75 | 0:32.00 | Solana leads x402: about $3.3M settled in one week. |
| h07 | 0:33.00 | 0:37.60 | The agent signs. The facilitator verifies. The origin answers. |
| h08 | 0:38.02 | 0:43.33 | With a funded wallet, USDC settles to your pay_to after the origin succeeds. |
| h09 | 0:44.75 | 0:47.10 | Claude gets a capped wallet. |
| h10 | 0:47.20 | 0:50.80 | It checks the price and caps, then pays $0.002. |
| h11 | 0:50.90 | 0:52.75 | The receipt says SIMULATED. |
| h12 | 0:52.90 | 0:57.30 | It lands on the founder's dashboard, simulated: no transaction exists. |
| h13 | 0:57.40 | 1:00.60 | Now a $0.05 tool, over the $0.01 per-call cap. |
| h14 | 1:01.00 | 1:03.00 | Refused before signing. |
| h15 | 1:03.40 | 1:08.40 | No money moved. The caps win, and Claude does not work around them. |
| h16 | 1:10.20 | 1:15.90 | MCP servers sell per tool. Discovery stays free; search_docs costs $0.005. |
| h17 | 1:16.50 | 1:19.60 | The plan: free open-source core, paid hosted edition. |
| h18 | 1:21.20 | 1:26.20 | 119 of 119 evals pass. Run them yourself. |
| h19 | 1:27.70 | 1:31.20 | Open source. One command, no wallet needed. |

### demo (171.2 s)

| id | Start | End | Line (caption = speech) |
|---|---|---|---|
| d01 | 0:00.30 | 0:04.60 | Hi, I'm Joseph's AI assistant. Let me show you AgentToll. |
| d02 | 0:06.40 | 0:09.40 | Every payment here is simulated. |
| d03 | 0:09.90 | 0:12.38 | One YAML file. Paid to your own pay_to. |
| d04 | 0:12.80 | 0:16.98 | A quote costs agents $0.002. Tools have prices too. |
| d05 | 0:17.40 | 0:19.40 | One command starts the stack. |
| d06 | 0:20.10 | 0:23.68 | A person opens the site through the gateway: free. |
| d07 | 0:24.10 | 0:27.50 | A browser gets the quote, with paid: false. |
| d08 | 0:28.00 | 0:31.78 | Claude-User gets 402 Payment Required. |
| d09 | 0:32.20 | 0:35.88 | The header decodes to a price: $0.002. |
| d10 | 0:36.30 | 0:39.60 | Plus network, asset and payTo. |
| d11 | 0:40.50 | 0:44.28 | Agents can read the price list first, for free. |
| d12 | 0:44.70 | 0:49.08 | Routes, tools and networks, all from the same YAML file. |
| d13 | 0:49.50 | 0:53.48 | The buyer CLI gets the 402, signs, and retries. |
| d14 | 0:53.90 | 0:57.68 | 200 OK. The receipt comes back in a header. |
| d15 | 0:58.10 | 1:01.68 | The dashboard gets the row: +$0.002. |
| d16 | 1:02.10 | 1:06.58 | Same simulated id on both sides. No funds moved. |
| d17 | 1:07.00 | 1:10.38 | Claude gets a capped wallet, and reads the price first. |
| d18 | 1:10.80 | 1:14.78 | $0.002 is under both caps, so Claude pays: simulated. |
| d19 | 1:15.20 | 1:19.40 | Next, a $0.05 tool. Claude is told: up to 10 cents. |
| d20 | 1:20.00 | 1:23.58 | The wallet refuses: the per-call cap is $0.01. |
| d21 | 1:24.00 | 1:27.18 | Nothing was signed. Claude did not work around it. |
| d22 | 1:27.60 | 1:30.58 | On the film stack: the same refusal, word for word. |
| d23 | 1:31.00 | 1:34.98 | MCP servers sell per tool; tools/list stays free. |
| d24 | 1:35.40 | 1:39.78 | An unpaid tool call gets a quote: $0.005. |
| d25 | 1:40.20 | 1:44.40 | Paid through pay-mcp, the tool gets its own dashboard row. |
| d26 | 1:45.00 | 1:49.78 | Recorded from the running dashboard: the buyer CLI pays every 2 s. |
| d27 | 1:50.20 | 1:53.00 | Each simulated payment updates the totals. |
| d28 | 1:53.90 | 1:57.38 | 19 payments: $0.034, all simulated. |
| d29 | 1:57.80 | 2:01.18 | By network: 100% Solana devnet. |
| d30 | 2:01.60 | 2:04.98 | The feed: 19 of 19 simulated. |
| d31 | 2:05.40 | 2:08.78 | Agent traffic you are not billing yet, by name. |
| d32 | 2:09.20 | 2:12.78 | Spendable: $0.00. It was all simulated. |
| d33 | 2:13.20 | 2:16.38 | Funds go to your pay_to. AgentToll holds nothing. |
| d34 | 2:16.80 | 2:19.60 | The same dashboard on a phone. |
| d35 | 2:20.20 | 2:23.98 | The same core runs as a Cloudflare Worker, in WebAssembly. |
| d36 | 2:24.40 | 2:29.40 | 21 parity tests check byte-identical quotes against the Rust gateway. |
| d37 | 2:30.00 | 2:33.78 | 119 of 119 evals pass. |
| d38 | 2:34.20 | 2:38.68 | Wired to the real PayAI and x402.org facilitators. |
| d39 | 2:39.10 | 2:43.08 | Both rejected the unfunded throwaway wallets, as expected. |
| d40 | 2:43.50 | 2:46.60 | A funded wallet is the only missing piece. |
| d41 | 2:47.35 | 2:50.65 | Open source. One command, no wallet needed. |

### pitch (156.65 s)

| id | Start | End | Line (caption = speech) |
|---|---|---|---|
| p01 | 0:01.60 | 0:05.45 | Hi, I'm Joseph's AI assistant. Let me show you AgentToll. |
| p02 | 0:05.60 | 0:09.20 | Agents read your site all day. They pay nothing. |
| p03 | 0:09.35 | 0:13.80 | 8 agent requests, no price: $0.016 left on the table. |
| p04 | 0:14.30 | 0:17.30 | Same URL. A person gets the data, free. |
| p05 | 0:17.45 | 0:20.90 | An agent gets 402 Payment Required. |
| p06 | 0:21.05 | 0:25.60 | People: free. Agents: $0.002. |
| p07 | 0:25.80 | 0:28.15 | Claude gets a capped wallet. |
| p08 | 0:28.25 | 0:31.85 | It checks the price and caps, then pays $0.002. |
| p09 | 0:31.95 | 0:33.80 | The receipt says SIMULATED. |
| p10 | 0:33.95 | 0:38.35 | It lands on the founder's dashboard, simulated: no transaction exists. |
| p11 | 0:38.45 | 0:41.65 | Now a $0.05 tool, over the $0.01 per-call cap. |
| p12 | 0:42.05 | 0:44.05 | Refused before signing. |
| p13 | 0:44.45 | 0:49.45 | No money moved. The caps win, and Claude does not work around them. |
| p14 | 0:51.25 | 0:56.95 | MCP servers sell per tool. Discovery stays free; search_docs costs $0.005. |
| p15 | 0:57.10 | 1:02.35 | Solana leads x402: about $3.3M settled in one week. |
| p16 | 1:02.52 | 1:07.83 | With a funded wallet, USDC settles to your pay_to after the origin succeeds. |
| p17 | 1:07.95 | 1:12.25 | Why now? PayAI batch settlement on Solana, Sep 30. |
| p18 | 1:12.45 | 1:17.25 | Cloudflare announced a gateway in July: waitlist-only, tied to its network. |
| p19 | 1:17.40 | 1:22.70 | Coinbase's Payments MCP already pays x402 on Solana. |
| p20 | 1:22.95 | 1:26.85 | The open, self-hosted version was not built. So we built it. |
| p21 | 1:27.75 | 1:31.15 | Who buys? Sellers whose product agents already use. |
| p22 | 1:31.45 | 1:33.75 | Say you run a small data API. |
| p23 | 1:34.05 | 1:37.85 | Agents call it all day, and none of them can sign up for a key. |
| p24 | 1:38.15 | 1:42.05 | Put AgentToll in front: each call quotes $0.002. |
| p25 | 1:42.35 | 1:45.85 | The agent pays in USDC, straight to your own pay_to. |
| p26 | 1:46.05 | 1:49.75 | A card can't bill $0.002. x402 can. |
| p27 | 1:50.05 | 1:53.45 | How we make money: a plan. No revenue yet. |
| p28 | 1:53.75 | 1:58.25 | The core is free. Hosted: a flat tier plus a fee on settled volume. |
| p29 | 1:58.55 | 2:02.25 | We charge for convenience, never by holding the seller's funds. |
| p30 | 2:03.15 | 2:07.45 | Distribution: we already ship landing pages to small businesses. |
| p31 | 2:07.75 | 2:10.75 | The plan: each client's pay_to is their own address. |
| p32 | 2:11.55 | 2:16.55 | 119 of 119 evals pass. Run them yourself. |
| p33 | 2:16.70 | 2:20.80 | What's next, as a plan: a funded devnet settlement, then mainnet. |
| p34 | 2:21.10 | 2:24.00 | A funded wallet is the only missing piece. |
| p35 | 2:24.80 | 2:28.80 | Joseph Clark builds AgentToll, at Clark Technology Ventures. |
| p36 | 2:29.05 | 2:32.50 | A solo builder, working with AI coding agents. |
| p37 | 2:32.85 | 2:36.35 | Open source. One command, no wallet needed. |

0 line(s) over 1.08x their window or overlapping
