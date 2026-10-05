#!/usr/bin/env python3
"""Write captions.json from index.html so the guardrail input never drifts from the film.

Captions: every cue of the AT.Caption block (Loom-style pills).
Titles: the headline-sized on-screen claims; each must appear verbatim in index.html.
Run: python3 video/scenes/hero/captions.py
"""
import json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(HERE, 'index.html'), encoding='utf-8').read()

block = src[src.index('AT.Caption({ cues: ['):]
block = block[:block.index('] });')]
consts = {k: float(v) for k, v in re.findall(r"const (M5|P6|R2|CL) = ([\d.]+);", src)}
num = lambda e: eval(e, {}, dict(consts))  # cue times are numbers or "M5 + 1.3" style offsets
cue = re.compile(r"\{ at: ([\w. +]+?), end: ([\w. +]+?), text: (['\"])(.*?)\3")
out = [{'start': round(num(a), 3), 'end': round(num(b), 3), 'text': t.replace("\\'", "'"), 'kind': 'caption'} for a, b, _, t in cue.findall(block)]

TITLES = [  # (start, end, text, html fragment that must exist in index.html)
    (2.5, 5.9, 'Agents already use your product. Now you can bill them.', 'Agents already use your product. <span class="g">Now you can bill them.</span>'),
    (5.1, 8.9, 'Agents read. Founders pay.', "lines: ['Agents read.', { text: 'Founders pay.', grad: true }]"),
    (6.3, 8.9, 'Until now the choices were block them or absorb it.', 'Until now the choices were <b>block them</b> or <b>absorb it.</b>'),
    (7.85, 9.0, '7 agent reads · $0 billed', "'<i></i>7 agent reads · $0 billed'"),
    (26.05, 28.2, "x402: the web's 402 status code, finally paid.", "lines: [\"x402: the web's 402 status code,\", { text: 'finally paid.', grad: true }]"),
    (28.2, 33.0, '≈ $3.3M USDC settled over x402 on Solana in one week. Solana took the top spot for agent payments.',
     'USDC settled over x402 on Solana in one week. <span class="m">Solana took the top spot for agent payments.</span>'),
    (29.0, 33.0, 'KB-SOL-03 PayAI batch settlement: a mainnet path for sub-cent traffic', 'PayAI batch settlement: a mainnet path for sub-cent traffic'),
    (29.35, 33.0, 'KB-SOL-02 The agent only holds USDC: the facilitator pays the fee', 'The agent only holds USDC: the facilitator pays the fee'),
    (32.3, 44.3, '03 HOW A REAL PAYMENT FLOWS', "text: 'HOW A REAL PAYMENT FLOWS'"),
    (40.45, 44.3, 'Funds go to your pay_to. AgentToll holds nothing.', "lines: ['Funds go to your pay_to.', { text: 'AgentToll holds nothing.', grad: true }]"),
    (76.3, 80.4, 'HOW AGENTTOLL MAKES MONEY. Open-source core: Free. MIT, self-hosted, non-custodial. No take rate in the gateway. Hosted edition: Flat tier + volume fee. A fee on settled volume, billed off-chain. pay_to stays the founder\'s. PLAN · NO REVENUE YET',
     '<div class="hv g">Flat tier + volume fee</div><div class="tx">A fee on settled volume, billed off-chain.'),
    (79.8, 87.2, 'The repo grades itself. Run it yourself.', "lines: ['The repo grades itself.', { text: 'Run it yourself.', grad: true }]"),
    (82.6, 87.2, 'Talks to the real PayAI and x402.org facilitators. Settlement waits on funded devnet and testnet wallets.',
     'Talks to the real <b>PayAI</b> and <b>x402.org</b> facilitators.<br><span class="m">Settlement waits on funded devnet and testnet wallets.</span>'),
    (86.9, 91.5, 'Agents already use your product. Now you can bill them.', 'Agents already use your product. <span class="g">Now you can bill them.</span>'),
    (87.3, 91.5, 'github.com/Josefusan/agenttoll', "'github.com/Josefusan/agenttoll', 'repo'"),
    (87.6, 91.5, 'Run it: KEEP=1 bash scripts/demo-local.sh', '<b>Run it:</b> KEEP=1 bash scripts/demo-local.sh'),
    (87.85, 91.5, 'Devnet and testnet only. Every payment in this film was simulated.', "'Devnet and testnet only. Every payment in this film was simulated.'"),
    (88.1, 91.5, "COLOSSEUM CRYPTO WORLD'S FAIR", "\"COLOSSEUM CRYPTO WORLD'S FAIR\""),
]
for a, b, text, frag in TITLES:
    assert frag in src, 'title not found in index.html: ' + text
    out.append({'start': a, 'end': b, 'text': text, 'kind': 'title'})
out.sort(key=lambda c: (c['start'], c['kind']))
for c in out:
    if c['kind'] == 'caption':
        words = len(c['text'].split())
        assert c['end'] - c['start'] >= 0.35 * words - 1e-9, f"too fast to read ({words} words): {c['text']}"
json.dump(out, open(os.path.join(HERE, 'captions.json'), 'w', encoding='utf-8'), indent=2, ensure_ascii=False)
print(f"captions.json: {sum(c['kind'] == 'caption' for c in out)} captions, {sum(c['kind'] == 'title' for c in out)} titles")
