# Film copy (three films)

Status: DRAFT for Joseph to upload. Agents never upload, post or submit anything. These are the three
films Claude's film build produces, and the copy that goes with each:

| Film | Field in the form | Length rule |
|---|---|---|
| `agenttoll-pitch.mp4` | Presentation (pitch) video | 2:00 to 3:00 |
| `agenttoll-full-demo.mp4` | Product demo video | 3:00 at most |
| `agenttoll-film-90s.mp4` | (with a README GIF) | about 90 s |

Upload each to YouTube as **unlisted**, open the link in a private window to confirm it plays, then
paste the link in the Colosseum form and wherever `<FILM_URL>` appears in `POSTS.md`. Every title below
is 70 characters or fewer (count is shown); check it again before pasting. Payments shown are SIMULATED
on Solana devnet; no funds moved.

Narrator disclosure. Put this sentence, unchanged, in the description of **every** film:

> Narrated by an AI voice (Kokoro TTS) presented as Joseph's AI assistant. Payments shown are SIMULATED on Solana devnet; no funds moved.

Chapters below are timed against the final render: durations from `ffprobe` on the three MP4s, and
boundaries from each film's own `captions.json` / `EDL.json` and the hero `SHOTLIST.md`. YouTube
format: the first chapter is `0:00`, there are at least three, and each is at least 10 s long. Tag
Colosseum, x402, Solana and PayAI only because this is their tech and their hackathon.

---

## 1. `agenttoll-pitch.mp4` — pitch video (2:00 to 3:00)

**YouTube title (unlisted), 70 chars max (57):**

```
AgentToll: charge AI agents per request, keep humans free
```

**Description:**

```
AI agents read your site, your API, your MCP server all day. You pay for the bandwidth and the
content. They pay nothing. AgentToll is an open-source proxy that adds a third option to block or
absorb: let agents pay per request in USDC over x402, while people keep browsing free.

Built solo for the Colosseum Crypto World's Fair (Solana track, Base as a second rail). Devnet and
testnet only; no customers, no revenue yet.

Chapters:
0:00 The problem: agents read, founders pay
0:25 Using it: Claude pays, and the cap refuses
0:57 Why x402, and why Solana
1:07 Why now, who buys, and the business model (PLAN)
2:11 Proof, what's next and the founder card

Repo: github.com/Josefusan/agenttoll

Narrated by an AI voice (Kokoro TTS) presented as Joseph's AI assistant. Payments shown are SIMULATED on Solana devnet; no funds moved.
```

**Tags:** `x402, Solana, AI agents, agent payments, USDC, MCP, micropayments, Colosseum, devnet, open source`

**Thumbnail text (3 options, 5 words max each):**
- `Agents pay. People read free.` (5)
- `Charge agents, not people` (4)
- `Bill the bots, spare humans` (5)

**Colosseum text (next to the pitch video link):**
`AgentToll: an open-source paywall proxy that charges AI agents per request in USDC over x402 and keeps humans free. Solo build; devnet and testnet only; payments in this film are simulated.`

---

## 2. `agenttoll-full-demo.mp4` — technical demo (3:00 at most)

**YouTube title (unlisted), 70 chars max (52):**

```
AgentToll demo: agents pay in USDC, humans read free
```

**Description:**

```
A full walkthrough of AgentToll with `bash scripts/demo-local.sh`, one command and no wallet.
A person gets the page free. An AI crawler gets HTTP 402 with an x402 v2 quote. The buyer CLI pays
$0.002 in USDC and gets the data. An MCP client gets a native x402 challenge for a paid tool, and
`tools/list` shows each tool's price. The founder's dashboard ticks.

Payments in this demo are simulated by the facilitator that ships with the repo (SIMULATED- ids);
no funds moved and nothing went on chain. To take real devnet payments, see the README section
"Real devnet payments".

Chapters:
0:00 Cold open: one command, no wallet
0:20 Same URL, two answers: a human 200, an agent 402
0:40 A price list for agents
1:07 Claude pays, within caps
1:31 MCP servers sell per tool
1:45 The founder's dashboard
2:20 Same rules at the edge
2:34 Wired to real facilitators, and close

Repo: github.com/Josefusan/agenttoll

Narrated by an AI voice (Kokoro TTS) presented as Joseph's AI assistant. Payments shown are SIMULATED on Solana devnet; no funds moved.
```

**Tags:** `x402, Solana, MCP, AI agents, USDC, developer tools, payments, demo, Colosseum`

**Thumbnail text (3 options, 5 words max each):**
- `One command, no wallet` (4)
- `Claude pays an API call` (5)
- `402 in, data out` (4)

**Colosseum text (next to the demo video link):**
`Technical demo of the one-command stack: humans free, agents charged, x402 v2 over HTTP and the MCP-native transport, a founder dashboard. All payments simulated by the repo's facilitator; no funds moved.`

---

## 3. `agenttoll-film-90s.mp4` — 90-second film (with a README GIF)

**YouTube title (unlisted), 70 chars max (57):**

```
AgentToll in 90 seconds: bill AI agents, keep humans free
```

**Description:**

```
AgentToll in 90 seconds. Put an open-source proxy in front of a site, API or MCP server, set a price
per route or per tool in one YAML file, and AI agents pay per request in USDC over x402. People keep
browsing for free. Settlement only after your origin succeeds; funds go straight to the address you
name; AgentToll never holds them.

Solo build for the Colosseum Crypto World's Fair (Solana track). Devnet and testnet only; no
customers, no revenue yet. Payments shown are simulated by the facilitator that ships with the repo;
no funds moved.

Chapters:
0:00 Cold open: an agent gets a 402
0:13 The problem: agents read free
0:26 Why x402, why Solana, and how a payment flows
0:43 Using it: Claude pays (and the cap refuses)
1:08 MCP servers sell per tool
1:19 Proof, the plan, and close

Repo: github.com/Josefusan/agenttoll

Narrated by an AI voice (Kokoro TTS) presented as Joseph's AI assistant. Payments shown are SIMULATED on Solana devnet; no funds moved.
```

**Tags:** `x402, Solana, AI agents, USDC, micropayments, MCP, open source, Colosseum`

**Thumbnail text (3 options, 5 words max each):**
- `Agents pay, humans read free` (5)
- `Bill the bots` (3)
- `AgentToll in 90 seconds` (4)

**Colosseum text (next to the 90-second film link):**
`A 90-second version of the same idea: humans free, agents charged per request in USDC over x402, one YAML file, a live dashboard. Simulated payments; no funds moved.`

---

## Before uploading

- Chapter times are set against the final render; if a film is re-rendered, re-check them.
- Confirm the narrator disclosure sentence is in all three descriptions, unchanged.
- Confirm each film's on-screen label reads `simulated settlement, no funds moved` on every payment
  shot. The demo film avoids every word `DEMO_VIDEO.md` bans for variant B. The hero film — and the
  pitch cut, which reuses its segments — deliberately uses five of them (`settled`, `real payment`,
  `mainnet`) as the protocol, a conditional and the KB-MKT-01 market figure; the reasons are written
  out in `video/scenes/hero/SHOTLIST.md`, and every payment shot still carries the gold SIMULATED badge.
- Keep each title at 70 characters or fewer and each thumbnail line at 5 words or fewer.
- Upload unlisted, then replace `<FILM_URL>` in `POSTS.md` with the real links.
