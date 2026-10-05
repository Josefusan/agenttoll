#!/usr/bin/env python3
"""Build the narration scripts (video/vo/narration/{hero,demo,pitch}.json) from the films' captions.

Captions are the subtitles of the narration: every spoken line is a burned-in caption, word for
word. "say" differs from "text" only in pronunciation spelling (lexicon of the voice engine, plus
the SAY overrides below). Times are absolute film time (the pitch's are cut time, after the EDL's
0.4 s blur dissolves).

    python3 video/vo/narration.py            # write the three scripts + print the pace table
    python3 video/vo/narration.py --check    # exit 1 if a line needs more than MAX_STRETCH x natural pace
    python3 video/vo/narration.py --md       # also print the VO_SCRIPT.md tables

The spoken form uses ~/agenttoll-vo/narrate.py's spoken() when it is importable (run with
~/agenttoll-vo/.venv/bin/python); otherwise "say" is the caption text plus the SAY overrides.
"""
import json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(HERE, 'narration')
VO_ENGINE = os.path.expanduser('~/agenttoll-vo')
# Kokoro af_heart at speed 1.0 takes about 0.232 s per syllable plus 0.19 s per pause mark
# (least squares over 30 measured takes, mean error 0.24 s). A line whose estimate is over its
# window by more than MAX_STRETCH would need narrate.py to speed it up past a natural pace.
SEC_PER_SYL, SEC_PER_PAUSE, SEC_OFFSET = 0.232, 0.19, -0.31
MAX_STRETCH = 1.08   # narrate.py may speed a line up to 1.08x; still a natural read

# caption text fragment -> spoken spelling, applied before the engine's lexicon
SAY = [
    ("Sep 30", "September thirtieth"),
    ("pay_to", "pay to"),          # "pay-to" was heard as "pay-do"
    ("payTo", "pay to"),
    ("PayAI and x402.org", "Pay A I, and x four oh two dot org"),   # a pause keeps the two names apart
]

try:
    sys.path.insert(0, VO_ENGINE)
    from narrate import spoken as _spoken   # noqa: E402
except Exception:   # no engine here: keep the caption text
    _spoken = None


def say_of(text):
    s = text
    for a, b in SAY:
        s = s.replace(a, b)
    return _spoken(s) if _spoken else s


def hero_cues(cut):
    """Hero caption cues; a cue with only='pitch' is in the pitch cut only, only='hero' in the hero only."""
    out = []
    for c in json.load(open(os.path.join(REPO, 'video/scenes/hero/captions.json'), encoding='utf-8')):
        if c['kind'] != 'caption':
            continue
        if c.get('only') and c['only'] != cut:
            continue
        out.append((c['start'], c['end'], c['text']))
    return out


def page_cues(rel):
    src = open(os.path.join(REPO, rel), encoding='utf-8').read()
    blk = src[src.index('AT.Caption({ cues: ['):]
    blk = blk[:blk.index('] });')]
    return [(float(a), float(b), t.replace("\\'", "'")) for a, b, _, t in
            re.findall(r"\{ at: ([\d.]+), end: ([\d.]+), text: (['\"])(.*?)\3", blk)]


def demo_cues():
    d = json.load(open(os.path.join(REPO, 'video/scenes/demo/captions.json'), encoding='utf-8'))
    start = {a['id']: a['start'] for a in d['acts']}
    cues = sorted((start[c['act']] + c['at'], start[c['act']] + c['end'], c['text']) for c in d['cues'])
    # demo.js ends a cue 0.42 s before the next one starts (never two pills at once): same window here
    out = []
    for i, (a, b, t) in enumerate(cues):
        if i + 1 < len(cues):
            b = min(b, cues[i + 1][0] - 0.42)
        out.append((round(a, 3), round(b, 3), t))
    return out, d['duration']


def pitch_cues():
    edl = json.load(open(os.path.join(REPO, 'video/scenes/pitch/EDL.json'), encoding='utf-8'))
    rows, off, problems = [], 0.0, []
    for k, s in enumerate(edl['segments']):
        xd = 0 if k == 0 else s.get('xfade', edl.get('xfade', 0))
        off -= xd
        cues = hero_cues('pitch') if s['scene'].endswith('hero/index.html') else page_cues(s['scene'])
        for a, b, t in cues:
            if s['from'] <= a < s['to']:
                if b > s['to'] + 1e-6:
                    problems.append(f"segment {k}: line runs past the segment end ({b} > {s['to']}): {t}")
                a2, b2 = a - s['from'] + off, min(b, s['to']) - s['from'] + off
                if k > 0 and a - s['from'] < xd:
                    problems.append(f"segment {k}: line starts inside the {xd} s dissolve: {t}")
                rows.append((round(a2, 3), round(b2, 3), t))
        off += s['to'] - s['from']
    return rows, round(off, 3), problems


def lines_of(prefix, cues):
    return [{'id': f'{prefix}{i:02d}', 'start': a, 'end': b, 'text': t, 'say': say_of(t)}
            for i, (a, b, t) in enumerate(sorted(cues), 1)]


def tc(s):
    cs = round(s * 100)
    return f"{cs // 6000}:{(cs % 6000) / 100:05.2f}"


def syllables(w):
    w = w.lower()
    n = len(re.findall(r"[aeiouy]+", w))
    if w.endswith('e') and n > 1 and not w.endswith('le'):
        n -= 1
    return max(1, n)


def est_seconds(say):
    """Estimated natural (speed 1.0) duration of a spoken line."""
    syl = sum(syllables(w) for w in re.findall(r"[A-Za-z0-9']+", say))
    return SEC_PER_SYL * syl + SEC_PER_PAUSE * len(re.findall(r"[,.:;?]", say)) + SEC_OFFSET


def main():
    check = '--check' in sys.argv
    os.makedirs(OUT, exist_ok=True)
    hero = lines_of('h', hero_cues('hero'))
    dcues, ddur = demo_cues()
    demo = lines_of('d', dcues)
    pc, pdur, problems = pitch_cues()
    pitch = lines_of('p', pc)
    films = {'hero': (hero, 91.5), 'demo': (demo, ddur), 'pitch': (pitch, pdur)}
    bad = []
    for name, (lines, dur) in films.items():
        json.dump(lines, open(os.path.join(OUT, f'{name}.json'), 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
        print(f"\n== {name}: {len(lines)} lines, film {dur} s")
        prev_end = -1
        for l in lines:
            win = l['end'] - l['start']
            est = est_seconds(l['say'])
            flag = ' FAST' if est > win * MAX_STRETCH else ''
            if l['start'] < prev_end - 1e-6:
                flag += ' OVERLAP'
            prev_end = l['end']
            if flag:
                bad.append((name, l['id'], l['text']))
            print(f"{l['id']} {l['start']:7.2f}-{l['end']:7.2f} {win:5.2f}s est {est:5.2f}s x{est / win:4.2f}{flag:9} {l['text']}")
    for p in problems:
        print('PITCH:', p)
    if '--md' in sys.argv:
        for name, (lines, dur) in films.items():
            print(f"\n### {name} ({dur} s)\n\n| id | Start | End | Line (caption = speech) |\n|---|---|---|---|")
            for l in lines:
                print(f"| {l['id']} | {tc(l['start'])} | {tc(l['end'])} | {l['text']} |")
    print(f"\n{len(bad)} line(s) over {MAX_STRETCH}x their window or overlapping")
    if check and (bad or problems):
        sys.exit(1)


if __name__ == '__main__':
    main()
