#!/usr/bin/env python3
"""LLM-as-judge harness for AgentToll (stdlib only).

Assembles a packet from the repo, asks N independent judges (headless Claude CLI)
to score it against evals/judge/rubric.md, aggregates, and writes
evals/judge/results/latest.json and latest.md.

Usage: python3 evals/judge/judge.py [--judges 3] [--model sonnet] [--dry-run]
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import datetime as dt
import json
import os
import re
import statistics
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
RESULTS = HERE / "results"
CLAUDE = os.environ.get("CLAUDE_BIN", str(Path.home() / ".local/bin/claude"))

CRITERIA = [
    ("product_quality", "Product quality", 20),
    ("innovation", "Innovation potential", 15),
    ("solana_fit", "Solana track fit", 15),
    ("technical_depth", "Technical depth", 15),
    ("demo_clarity", "Demo clarity", 15),
    ("why_now", "Why now and market", 10),
    ("honesty", "Honesty of claims", 10),
]
IDS = [c[0] for c in CRITERIA]

LENSES = [
    "You are a Colosseum team reviewer who funds startups. Weigh product quality and innovation hardest.",
    "You are a Solana track judge and protocol engineer. Weigh Solana fit and technical depth hardest.",
    "You are an auditor whose only job is to find claims the packet cannot back up. Weigh honesty hardest.",
]

SYSTEM = """You are one independent judge of a hackathon submission. Be skeptical.
Rules:
- Score only what the packet shows. A doc saying something works is not proof.
- Penalize unverifiable claims: a claim with no command output, file path, test count tied to output, or cited source counts against the project.
- A simulated payment is not an on-chain payment. If any doc blurs them, cap honesty at 4.
- Quote evidence verbatim from the packet (short quotes, 1 to 3 per criterion). Never invent a quote.
- Do not reward length, polish or hype.
- You have no tools. Do not ask questions. Output strict JSON only, no markdown fence, no prose."""


def sh(args, **kw):
    return subprocess.run(args, capture_output=True, text=True, cwd=ROOT, **kw)


def build_packet() -> tuple[str, list[str]]:
    parts, used = [], []

    def add(rel: str, label: str | None = None):
        p = ROOT / rel
        if p.is_file():
            parts.append(f"\n===== FILE: {rel} =====\n{p.read_text(encoding='utf-8', errors='replace')}")
            used.append(rel)

    add("README.md")
    add("docs/COLOSSEUM_SUBMISSION.md")
    for p in sorted((ROOT / "docs/launch").glob("*.md")):
        add(str(p.relative_to(ROOT)))
    add("docs/USE_CASES.md")
    add("evals/results/latest.md")
    add("evals/judge/results/system1.json")
    tree = sh(["git", "ls-files"]).stdout
    parts.append(f"\n===== git ls-files (tree) =====\n{tree}")
    used.append("git ls-files")
    return "".join(parts), used


def build_prompt(packet: str, rubric: str, lens: str) -> str:
    return (
        f"{lens}\n\n# RUBRIC\n{rubric}\n\n# PACKET\n{packet}\n\n# TASK\n"
        f"Score every criterion id in {IDS}. Return only the JSON object described under 'Required output'. "
        "Scores are integers 1 to 10. Include 'evidence' (verbatim quotes), 'reason', "
        "'biggest_weakness' (one sentence) and 'top_improvements' (exactly 3 concrete, actionable changes)."
    )


def extract_json(text: str):
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    i, j = text.find("{"), text.rfind("}")
    if i >= 0 and j > i:
        return json.loads(text[i : j + 1])
    raise ValueError("no JSON object in output")


def validate(obj) -> None:
    if not isinstance(obj, dict) or "scores" not in obj:
        raise ValueError("missing scores")
    for cid in IDS:
        s = obj["scores"].get(cid)
        if not isinstance(s, dict) or not isinstance(s.get("score"), (int, float)) or not 1 <= s["score"] <= 10:
            raise ValueError(f"bad score for {cid}")
    if not isinstance(obj.get("biggest_weakness"), str):
        raise ValueError("missing biggest_weakness")
    imps = obj.get("top_improvements")
    if not isinstance(imps, list) or len(imps) < 3:
        raise ValueError("need 3 improvements")


def run_judge(idx: int, prompt: str, model: str, timeout: int) -> dict:
    env = {k: v for k, v in os.environ.items() if k != "ANTHROPIC_API_KEY"}
    last_err = ""
    for attempt in (1, 2):
        try:
            with tempfile.TemporaryDirectory() as td:
                p = subprocess.run(
                    [CLAUDE, "-p", "--model", model, "--tools", "", "--no-session-persistence",
                     "--append-system-prompt", SYSTEM, "--output-format", "json"],
                    input=prompt, capture_output=True, text=True, timeout=timeout, env=env, cwd=td,
                )
            if p.returncode != 0:
                raise RuntimeError(f"claude exit {p.returncode}: {p.stderr[-300:] or p.stdout[-300:]}")
            envelope = json.loads(p.stdout)
            if envelope.get("is_error"):
                raise RuntimeError(f"claude error: {str(envelope.get('result'))[:300]}")
            obj = extract_json(envelope["result"])
            validate(obj)
            obj["_meta"] = {
                "judge": idx, "attempt": attempt, "cost_usd": envelope.get("total_cost_usd"),
                "duration_ms": envelope.get("duration_ms"),
            }
            return obj
        except Exception as e:  # noqa: BLE001
            last_err = f"{type(e).__name__}: {e}"
    return {"_error": last_err, "_meta": {"judge": idx}}


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", s.replace("`", "").replace("*", "")).strip().lower()


def aggregate(judges: list[dict], packet: str) -> dict:
    ok = [j for j in judges if "_error" not in j]
    pn = norm(packet)
    per, total_by_judge = {}, []
    for cid, name, w in CRITERIA:
        scores = [float(j["scores"][cid]["score"]) for j in ok]
        quotes = [(q, norm(q) in pn) for j in ok for q in j["scores"][cid].get("evidence", []) if isinstance(q, str)]
        per[cid] = {
            "name": name, "weight": w, "median": statistics.median(scores), "scores": scores,
            "spread": max(scores) - min(scores),
            "quotes_total": len(quotes), "quotes_verified": sum(1 for _, v in quotes if v),
        }
    for j in ok:
        total_by_judge.append(sum(j["scores"][cid]["score"] / 10 * w for cid, _, w in CRITERIA))
    weighted = sum(per[cid]["median"] / 10 * w for cid, _, w in CRITERIA)
    return {
        "per_criterion": per,
        "weighted_total": round(weighted, 1),
        "total_by_judge": [round(t, 1) for t in total_by_judge],
        "total_spread": round(max(total_by_judge) - min(total_by_judge), 1) if total_by_judge else None,
        "mean_criterion_spread": round(statistics.mean(per[c]["spread"] for c in IDS), 2),
        "disputed": [c for c in IDS if per[c]["spread"] >= 3],
    }


def render_md(res: dict) -> str:
    a = res["aggregate"]
    L = [
        "# LLM-as-judge results", "",
        f"Run: {res['generated_at']}. Commit: `{res['commit']}`. Judges: {res['judges_ok']}/{res['judges_requested']} returned valid JSON. Model: `{res['model']}`.",
        "Judges are skeptical, see `rubric.md`. Scores are model opinions on the packet, not ground truth.", "",
        f"**Weighted total (median per criterion): {a['weighted_total']} / 100**. "
        f"Per-judge totals: {a['total_by_judge']}. Spread: {a['total_spread']}. Mean criterion spread: {a['mean_criterion_spread']}.", "",
        "| Criterion | Weight | Median | Judge scores | Spread | Quotes verified |", "|---|---|---|---|---|---|",
    ]
    for cid in IDS:
        c = a["per_criterion"][cid]
        L.append(f"| {c['name']} | {c['weight']} | {c['median']:g} | {', '.join(f'{s:g}' for s in c['scores'])} | {c['spread']:g} | {c['quotes_verified']}/{c['quotes_total']} |")
    if a["disputed"]:
        L += ["", "Disputed (spread of 3 or more): " + ", ".join(a["disputed"]) + "."]
    L += ["", "## Biggest weakness per judge", ""]
    for j in res["judges"]:
        if "_error" in j:
            L.append(f"- Judge {j['_meta']['judge']}: FAILED, {j['_error']}")
        else:
            L.append(f"- Judge {j['_meta']['judge']}: {j['biggest_weakness']}")
    L += ["", "## Top improvements per judge", ""]
    for j in res["judges"]:
        if "_error" in j:
            continue
        L.append(f"Judge {j['_meta']['judge']}:")
        L += [f"{n}. {t}" for n, t in enumerate(j["top_improvements"][:3], 1)]
        L.append("")
    L += ["## Packet", "", "Files: " + ", ".join(f"`{u}`" for u in res["packet_files"]) + f". Size: {res['packet_chars']} characters."]
    return "\n".join(L) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--judges", type=int, default=3)
    ap.add_argument("--model", default="sonnet")
    ap.add_argument("--timeout", type=int, default=900)
    ap.add_argument("--dry-run", action="store_true", help="build the packet and prompt, call no model")
    a = ap.parse_args()

    rubric = (HERE / "rubric.md").read_text(encoding="utf-8")
    missing = [c for c in IDS if c not in rubric]
    if missing:
        sys.exit(f"rubric.md is missing criterion ids: {missing}")
    packet, used = build_packet()
    prompts = [build_prompt(packet, rubric, LENSES[i % len(LENSES)]) for i in range(a.judges)]
    if a.dry_run:
        print(f"packet {len(packet)} chars from {used}; prompt {len(prompts[0])} chars; {a.judges} judges")
        return 0
    with cf.ThreadPoolExecutor(max_workers=a.judges) as ex:
        judges = list(ex.map(lambda t: run_judge(t[0] + 1, t[1], a.model, a.timeout), enumerate(prompts)))
    ok = [j for j in judges if "_error" not in j]
    if not ok:
        print(json.dumps([j.get("_error") for j in judges], indent=1))
        sys.exit("no judge returned valid JSON")
    commit = sh(["git", "rev-parse", "--short", "HEAD"]).stdout.strip()
    res = {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "commit": commit, "model": a.model, "judges_requested": a.judges, "judges_ok": len(ok),
        "lenses": LENSES[: a.judges], "packet_files": used, "packet_chars": len(packet),
        "aggregate": aggregate(judges, packet), "judges": judges,
    }
    RESULTS.mkdir(exist_ok=True)
    (RESULTS / "latest.json").write_text(json.dumps(res, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (RESULTS / "latest.md").write_text(render_md(res), encoding="utf-8")
    print(f"weighted_total={res['aggregate']['weighted_total']} judges_ok={len(ok)}/{a.judges}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
