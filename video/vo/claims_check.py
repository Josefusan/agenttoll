#!/usr/bin/env python3
"""System-1 claim checks over the narration (= the burned-in captions) of all three films.

    python3 video/vo/claims_check.py            # after: python3 video/vo/narration.py

Reads video/vo/narration/{hero,demo,pitch}.json and, for every spoken line, applies:
  forbidden_claims   evals/judge/system1.py's terms and its negation-aware line rule (FAIL on a hit)
  simulated_labels   strict form: every payment line that is not explicitly about a real/funded
                     wallet has "simulat" within 6 lines either side (the repo rule also requires a
                     "demo" word, which captions rarely carry, so it would pass vacuously)
  banned_words       docs/launch/DEMO_VIDEO.md's words for the simulated variant (on-chain, settled,
                     live, real payment, transaction link, explorer, mainnet, revenue earned) and
                     "Bridge" (say "off-ramp partners"); reported for review, negations included
Exit 1 when forbidden_claims or simulated_labels fails.
"""
import json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, os.path.join(REPO, 'evals', 'judge'))
import system1 as s1  # noqa: E402

BANNED = re.compile(r"on-chain|\bsettled\b|\bsettles\b|\blive\b|real payment|transaction link|explorer|mainnet|revenue earned|\bbridge\b", re.I)
# a line about what a funded wallet / the plan would do, not about a payment in this film
CONDITIONAL = re.compile(r"\bfunded\b|\bplan\b|\bnext\b", re.I)
# lines that match the payment words but show no AgentToll payment in the film, each with its reason
NOT_A_FILM_PAYMENT = {
    'An agent gets 402 Payment Required.': 'the HTTP status name, no payment',
    'Why now? PayAI batch settlement on Solana, Sep 30.': 'market fact KB-SOL-03 on a WHY NOW card',
    "Coinbase's Payments MCP already pays x402 on Solana.": 'market fact KB-PAY-06 on a WHY NOW card',
    'The agent pays in USDC, straight to your own pay_to.': "the pitch's use case, under an EXAMPLE · not a customer badge",
    'The core is free. Hosted: a flat tier plus a fee on settled volume.': 'business model under a PLAN · no revenue yet badge',
}


def main():
    terms = s1.forbidden_terms()
    fails = 0
    for film in ('hero', 'demo', 'pitch'):
        lines = json.load(open(os.path.join(HERE, 'narration', f'{film}.json'), encoding='utf-8'))
        texts = [l['text'] for l in lines]
        hits = [f"{l['id']} [{t}] {l['text']}" for l in lines for t in s1.forbidden_hits_in_line(terms, l['text'])]
        pay, unlabeled, excused = 0, [], []
        for i, l in enumerate(lines):
            if l['text'] in NOT_A_FILM_PAYMENT and s1.PAY_LINE.search(l['text']):
                excused.append(f"{l['id']} {l['text']}  ({NOT_A_FILM_PAYMENT[l['text']]})")
                continue
            if s1.PAY_LINE.search(l['text']) and not s1.REAL_LINE.search(l['text']) and not CONDITIONAL.search(l['text']):
                pay += 1
                if not re.search(r'simulat', '\n'.join(texts[max(0, i - 6):i + 7]), re.I):
                    unlabeled.append(f"{l['id']} {l['text']}")
        banned = [f"{l['id']} {l['text']}" for l in lines if BANNED.search(l['text'])]
        print(f"\n== {film}: {len(lines)} spoken lines")
        print(f"forbidden_claims: {'PASS' if not hits else 'FAIL'} ({len(terms)} terms, {len(hits)} un-negated hits)", *hits, sep='\n  ')
        print(f"simulated_labels (strict): {'PASS' if not unlabeled else 'FAIL'} ({pay} payment lines, {len(unlabeled)} without 'simulat' within 6 lines)", *unlabeled, sep='\n  ')
        print(f"payment words that show no payment in the film (listed, not counted): {len(excused)}", *excused, sep='\n  ')
        print(f"banned-word scan, for review (negations and conditionals included): {len(banned)}", *banned, sep='\n  ')
        fails += bool(hits) + bool(unlabeled)
    print(f"\n{'PASS' if not fails else 'FAIL'}: {fails} rule failure(s)")
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
