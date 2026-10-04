#!/usr/bin/env python3
"""Negative controls for system1.py and judge.py: the detectors must fire on planted bad input."""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import judge as j
import system1 as s

M = "  # secret-scan: pattern-definition"  # lines that hold a planted fixture carry this marker
PEM = "-----BEGIN PRIVATE KEY-----"  # secret-scan: pattern-definition
ASSIGNED = "ADMIN_TOKEN=" + "a1b2c3d4e5f6a7b8c9"

planted = {
    "pem private key": PEM,
    "solana keypair json array": "[" + ",".join(["12"] * 64) + "]",
    "base58 secret key (87-88 chars)": "x = " + "5" * 88,
    "aws access key": "AKIA" + "A" * 16,
    "api key prefix": "sk-" + "a" * 30,
    "assigned secret": ASSIGNED,
    "hex private key (64)": "private_key 0x" + "ab" * 32,
}
fails = []


def need(cond, msg):
    if not cond:
        fails.append(msg)


# --- secret patterns
for label, text in planted.items():
    need(re.search(s.SECRET_PATTERNS[label], text), f"secret pattern did not fire: {label}")
for ok in ["BUYER_EVM_PRIVATE_KEY=\nNEXT=1", "BUYER_SOLANA_KEYPAIR=/ABSOLUTE/PATH/buyer.keypair.json", "ADMIN_TOKEN=<your token>"]:
    need(not re.search(s.SECRET_PATTERNS["assigned secret"], ok), f"secret pattern false positive: {ok!r}")

# --- check_secrets scans evals/judge/ (it used to skip the whole tree)
need(s.scan_text("evals/judge/README.md", "notes\n" + ASSIGNED + "\n"), "planted secret in evals/judge/README.md not flagged")
need(s.scan_text("evals/judge/results/test-output/cargo.txt", "log\n" + PEM + "\n"),
     "planted key in a captured log under evals/judge/results not flagged")
need(s.scan_text("evals/judge/judge.py", ASSIGNED + M), "marker honoured in a file that may not carry it")
need(not s.scan_text("evals/judge/selftest.py", PEM + M), "marked fixture in selftest.py was flagged")
need(not s.scan_text("evals/judge/system1.py", s.SECRET_PATTERNS["aws access key"] + M), "marked pattern line in system1.py was flagged")
hit = s.scan_text("evals/judge/README.md", "a\nb\n" + ASSIGNED)
need(hit and hit[0].startswith("evals/judge/README.md:3 ") and "a1b2c3d4" not in hit[0], f"hit format wrong or leaks the match: {hit}")

# --- forbidden claims: a negation must sit within a few words of the term
TERMS = ["Supabase", "customers", "revenue", "a live Worker"]
caught = [
    "We use Supabase for auth",
    "AgentToll stores the ledger in Supabase, the only database it needs.",
    "If you prefer, AgentToll can run on Supabase.",
    "It is yet another Supabase deployment.",
    "We do not hesitate to say that the whole stack is simple, fast, well tested and stores data in Supabase.",
    "We have 12 paying customers.",
    "The proxy generated $5k of revenue last month.",
]
clean = [
    "AgentToll does not use Supabase.",
    "We do not claim Web Bot Auth verification",
    "Supabase is not used anywhere.",
    "There is no revenue and no paying customers yet.",
    "Never claim a live Worker.",
]
for line in caught:
    need(s.forbidden_hits_in_line(TERMS, line), f"forbidden claim not caught: {line!r}")
for line in clean:
    need(not s.forbidden_hits_in_line(TERMS, line), f"negated line flagged: {line!r}")
need(not s.NEGATION.search("the only database it needs"), "'only' counted as a negation")
need(s.NEGATION.search("We do not claim Web Bot Auth verification"), "negation not recognised")

# --- demo payment lines
need(s.PAY_LINE.search("the demo paid $0.002") and s.DEMO_LINE.search("the demo paid $0.002"), "demo payment line not recognised")

# --- form limits and test counts parse the real submission and README (negative control: planted overflow)
ok, summary, details = s.check_form_limits()
need(ok is not None and "fields parsed" in summary, f"form_limits did not run: {summary}")
planted_form = "**Tagline** (limit 10)\n" + "x" * 20 + "\n\n**Next** (limit 5)\nok\n\n## End"
over = [m for m in re.finditer(r"\*\*([^*\n]+)\*\* \((?:public, )?limit (\d+)\)\n(.*?)(?=\n\n\*\*|\n## )", planted_form, re.S)
        if len(m.group(3).strip()) > int(m.group(2))]
need(len(over) == 1, "planted over-limit field not detected by the form_limits pattern")

# --- judge.py: packet leaves system1.json out by default, model ids come from the envelope
packet, used = j.build_packet(include_system1=False)
need("evals/judge/results/system1.json" not in used, "system1.json is in the packet by default")
need("evals/judge/results/system1.json" not in packet.split("===== git ls-files")[0], "system1.json text leaked into the packet")
packet2, used2 = j.build_packet(include_system1=True)
need(("evals/judge/results/system1.json" in used2) == (Path(j.ROOT / "evals/judge/results/system1.json").is_file()),
     "include_system1 does not add system1.json")
need(j.resolved_models({"modelUsage": {"claude-x-1": {"inputTokens": 1}}}) == ["claude-x-1"], "model id not read from modelUsage")
need(j.resolved_models({}) == [], "missing modelUsage not handled")
md = j.render_md({
    "generated_at": "t", "commit": "abc", "model": "sonnet", "judges_requested": 1, "judges_ok": 1,
    "resolved_models": ["claude-x-1"], "system1_in_packet": False, "packet_files": ["README.md"], "packet_chars": 1,
    "aggregate": {"weighted_total": 1, "total_by_judge": [1], "total_spread": 0, "mean_criterion_spread": 0, "disputed": [],
                  "per_criterion": {c: {"name": c, "weight": 1, "median": 1, "scores": [1], "spread": 0,
                                        "quotes_verified": 0, "quotes_total": 0} for c in j.IDS}},
    "judges": [{"_meta": {"judge": 1}, "biggest_weakness": "w", "top_improvements": ["a", "b", "c"]}],
})
need("claude-x-1" in md and "same model" in md and "system1.json" in md, "latest.md lacks resolved model, shared-model note or system1 choice")

print("selftest FAIL" if fails else "selftest OK", *fails, sep="\n")
sys.exit(1 if fails else 0)
