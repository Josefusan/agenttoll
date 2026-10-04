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
cue = re.compile(r"\{ at: ([\d.]+), end: ([\d.]+), text: (['\"])(.*?)\3")
out = [{'start': float(a), 'end': float(b), 'text': t.replace("\\'", "'"), 'kind': 'caption'} for a, b, _, t in cue.findall(block)]

TITLES = [  # (start, end, text, html fragment that must exist in index.html)
    (3.15, 5.4, 'Agents already use your product. Now you can bill them.', 'Agents already use your product. <span class="g">Now you can bill them.</span>'),
    (5.1, 9.2, 'Agents read. Founders pay.', "lines: ['Agents read.', { text: 'Founders pay.', grad: true }]"),
    (6.3, 9.2, 'Until now the choices were block them or absorb it.', 'Until now the choices were <b>block them</b> or <b>absorb it.</b>'),
    (38.45, 42.5, 'Funds go to your pay_to. AgentToll holds nothing.', "lines: ['Funds go to your pay_to.', { text: 'AgentToll holds nothing.', grad: true }]"),
    (77.9, 86.3, 'The repo grades itself.', "lines: ['The repo grades itself.']"),
    (81.4, 86.3, 'Talks to the real PayAI and x402.org facilitators. Settlement waits on funded devnet and testnet wallets.',
     'Talks to the real <b>PayAI</b> and <b>x402.org</b> facilitators.<br><span class="m">Settlement waits on funded devnet and testnet wallets.</span>'),
    (86.8, 90.0, 'Agents already use your product. Now you can bill them.', 'Agents already use your product. <span class="g">Now you can bill them.</span>'),
    (87.3, 90.0, 'github.com/Josefusan/agenttoll', "'github.com/Josefusan/agenttoll', 'repo'"),
    (87.6, 90.0, "COLOSSEUM CRYPTO WORLD'S FAIR", "\"COLOSSEUM CRYPTO WORLD'S FAIR\""),
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
