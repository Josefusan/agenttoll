#!/usr/bin/env python3
"""Print the pitch cut's voiceover table (cut timecodes) from EDL.json and each scene's captions.

The pitch cut reuses hero shots, so its lines are the hero's captions inside each EDL segment,
shifted onto the cut timeline (0.4 s crossfades included), plus the pitch insert's own captions.
Run: python3 video/vo/pitch_vo.py   (paste the output into VO_SCRIPT.md after an EDL change)
"""
import json, os, re

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
edl = json.load(open(os.path.join(REPO, 'video/scenes/pitch/EDL.json')))

def hero_cues():
    return [(c['start'], c['end'], c['text']) for c in json.load(open(os.path.join(REPO, 'video/scenes/hero/captions.json'))) if c['kind'] == 'caption']

def page_cues(rel):
    src = open(os.path.join(REPO, rel), encoding='utf-8').read()
    blk = src[src.index('AT.Caption({ cues: ['):]
    return [(float(a), float(b), t.replace("\\'", "'")) for a, b, _, t in re.findall(r"\{ at: ([\d.]+), end: ([\d.]+), text: (['\"])(.*?)\3", blk)]

def tc(s):
    cs = round(s * 100)   # round once, so 119.996 prints 2:00.00, not 1:60.00
    return f"{cs // 6000}:{(cs % 6000) / 100:05.2f}"

rows, off = [], 0.0
for k, s in enumerate(edl['segments']):
    xd = 0 if k == 0 else s.get('xfade', edl.get('xfade', 0))
    off -= xd
    cues = hero_cues() if s['scene'].endswith('hero/index.html') else page_cues(s['scene'])
    for a, b, t in cues:
        if min(b, s['to']) - max(a, s['from']) >= 1.0:   # a line on screen for at least 1 s of the segment
            rows.append((max(a, s['from']) - s['from'] + off, min(b, s['to']) - s['from'] + off, t))
    off += s['to'] - s['from']
print(f"Render length {tc(off)} ({off:.2f} s).\n")
print('| Start | End | Line |\n|---|---|---|')
for a, b, t in rows:
    print(f"| {tc(a)} | {tc(b)} | {t} |")
