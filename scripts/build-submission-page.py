#!/usr/bin/env python3
"""Build docs/launch/submission-form.html from docs/COLOSSEUM_SUBMISSION.md.

Stdlib only. The field regex below is copied from evals/judge/system1.py's check_form_limits()
(see FIELD_RE and its comment); the script also imports that module to print the two lists
side by side so the page can never silently disagree with System-1.

Fields whose heading has no "(limit N)" parenthetical (for example the go-to-market field) are
listed under "Not auto-counted" with their raw text and a plain character count.

    python3 scripts/build-submission-page.py
"""
from __future__ import annotations

import html
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "docs/COLOSSEUM_SUBMISSION.md"
OUT = ROOT / "docs/launch/submission-form.html"

# Copied verbatim from evals/judge/system1.py, check_form_limits(). Keep them in sync; the
# import below prints System-1's own rows so a drift shows up immediately.
FIELD_RE = re.compile(r"\*\*([^*\n]+)\*\* \((?:public, )?limit (\d+)\)\n(.*?)(?=\n\n\*\*|\n## )", re.S)
ANY_FIELD_RE = re.compile(r"\*\*([^*\n]+)\*\* \(([^)\n]*)\)\n(.*?)(?=\n\n\*\*|\n## |\Z)", re.S)


def parse(text: str):
    counted, counted_spans = [], []
    for m in FIELD_RE.finditer(text):
        counted.append((m.group(1).strip(), int(m.group(2)), m.group(3).strip()))
        counted_spans.append((m.start(), m.end()))
    names = {c[0] for c in counted}
    counted_head = re.compile(r"^\s*(?:public, )?limit \d+\s*$")
    uncounted = []
    for m in ANY_FIELD_RE.finditer(text):
        if m.group(1).strip() in names:
            continue
        if counted_head.match(m.group(2)):
            continue
        uncounted.append((m.group(1).strip(), m.group(3).strip()))
    return counted, uncounted


def esc(s: str) -> str:
    return html.escape(s, quote=True)


def card(name: str, body: str, limit: int) -> str:
    n = len(body)
    cls = "over" if n > limit else "ok"
    return f"""    <article class="card">
      <div class="head">
        <span class="name">{esc(name)}</span>
        <span class="count {cls}">{n}/{limit}{" OVER" if n > limit else ""}</span>
        <button type="button">Copy</button>
      </div>
      <textarea readonly rows="6">{esc(body)}</textarea>
    </article>"""


def uncounted_card(name: str, body: str) -> str:
    return f"""    <article class="card dim">
      <div class="head">
        <span class="name">{esc(name)}</span>
        <span class="count">{len(body)} chars (no limit parsed)</span>
        <button type="button">Copy</button>
      </div>
      <textarea readonly rows="5">{esc(body)}</textarea>
    </article>"""


def build(counted, uncounted) -> str:
    cards = "\n".join(card(n, b, lim) for n, lim, b in counted)
    extra = "\n".join(uncounted_card(n, b) for n, b in uncounted) or "    <p class=\"empty\">None.</p>"
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AgentToll submission form answers</title>
<style>
  :root {{ --bg:#f6f6fb; --card:#ffffff; --ink:#17142b; --muted:#5b5878; --line:#e2e0ee; --accent:#6D28D9; --ok:#0f7a52; --over:#c02626; }}
  @media (prefers-color-scheme: dark) {{
    :root {{ --bg:#0E0C24; --card:#171436; --ink:#F5F4FF; --muted:#A9A6C9; --line:#2b2750; --accent:#2DD4BF; --ok:#34D399; --over:#FB7185; }}
  }}
  * {{ box-sizing:border-box; }}
  body {{ margin:0; background:var(--bg); color:var(--ink);
    font:16px/1.5 "Inter","Helvetica Neue",Arial,system-ui,-apple-system,sans-serif; }}
  main {{ max-width:980px; margin:0 auto; padding:40px 24px 96px; }}
  h1 {{ font-size:30px; margin:0 0 6px; }}
  .lede {{ color:var(--muted); margin:0 0 28px; }}
  h2 {{ font-size:20px; margin:40px 0 14px; }}
  .card {{ background:var(--card); border:1px solid var(--line); border-radius:14px; padding:16px 18px; margin:0 0 16px; }}
  .card.dim {{ opacity:.92; }}
  .head {{ display:flex; align-items:center; gap:12px; margin-bottom:10px; flex-wrap:wrap; }}
  .name {{ font-weight:700; }}
  .count {{ margin-left:auto; font-variant-numeric:tabular-nums; color:var(--muted); font-size:14px; }}
  .count.ok {{ color:var(--ok); }}
  .count.over {{ color:var(--over); font-weight:800; }}
  button {{ border:1px solid var(--line); background:transparent; color:var(--accent);
    font:inherit; font-weight:700; font-size:14px; padding:6px 14px; border-radius:999px; cursor:pointer; }}
  button:hover {{ border-color:var(--accent); }}
  button.done {{ color:var(--ok); border-color:var(--ok); }}
  textarea {{ width:100%; border:1px solid var(--line); border-radius:10px; background:var(--bg);
    color:var(--ink); font:14px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace; padding:12px; resize:vertical; }}
  .empty {{ color:var(--muted); }}
</style>
</head>
<body>
<main>
  <h1>AgentToll submission form answers</h1>
  <p class="lede">Generated from <code>docs/COLOSSEUM_SUBMISSION.md</code>. Counts use the same regex as
    <code>evals/judge/system1.py</code> (<code>check_form_limits</code>). Paste with the Copy button.</p>

  <h2>Form fields</h2>
{cards}

  <h2>Not auto-counted</h2>
{extra}
</main>
<script>
  document.querySelectorAll('.card').forEach(function (c) {{
    var btn = c.querySelector('button');
    var ta = c.querySelector('textarea');
    if (!btn || !ta) return;
    btn.addEventListener('click', function () {{
      var done = function () {{
        btn.textContent = 'Copied'; btn.classList.add('done');
        setTimeout(function () {{ btn.textContent = 'Copy'; btn.classList.remove('done'); }}, 1400);
      }};
      if (navigator.clipboard && navigator.clipboard.writeText) {{
        navigator.clipboard.writeText(ta.value).then(done, function () {{ ta.select(); document.execCommand('copy'); done(); }});
      }} else {{ ta.select(); document.execCommand('copy'); done(); }}
    }});
  }});
</script>
</body>
</html>
"""


def system1_check():
    sys.path.insert(0, str(ROOT / "evals/judge"))
    import system1  # noqa: E402  (the module whose regex we mirror)
    ok, summary, details = system1.check_form_limits()
    return ok, summary, [d.strip() for d in details]


def main() -> int:
    text = SRC.read_text(encoding="utf-8")
    counted, uncounted = parse(text)
    OUT.write_text(build(counted, uncounted), encoding="utf-8")

    print(f"wrote {OUT.relative_to(ROOT)}")
    print(f"counted fields: {len(counted)}  not auto-counted: {len(uncounted)}")

    ok, summary, s1_rows = system1_check()

    print("BUILDER")
    over = 0
    builder_rows = []
    for name, limit, body in counted:
        row = f"{len(body)}/{limit} {name}"
        builder_rows.append(row)
        is_over = len(body) > limit
        over += is_over
        print(f"  {'OVER' if is_over else 'OK':4s} {row}")

    print("SYSTEM-1")
    print(f"  system1[{'PASS' if ok else 'FAIL'}] {summary}")
    for row in s1_rows:
        print(f"  {row}")

    if uncounted:
        print("NOT AUTO-COUNTED")
        for name, body in uncounted:
            print(f"  {len(body):4d} chars  {name}")

    print(f"  over limit: {over}")
    if builder_rows != s1_rows:
        print("MISMATCH: builder rows differ from System-1 rows")
        print(f"  builder: {builder_rows}")
        print(f"  system1: {s1_rows}")
        return 1
    print("OK: every counted field matches System-1's rows")
    return 0


if __name__ == "__main__":
    sys.exit(main())
