#!/usr/bin/env python3
"""Run demo commands for real against a running local stack and save exact transcripts.

Every command runs through `bash -c` from the repo root with the prebuilt binaries on PATH,
so the `command` string in each JSON is exactly what was executed. stdout/stderr are kept
byte for byte (UTF-8 text plus base64 when the bytes are not valid UTF-8) with a sha256.
The only post-processing is path redaction (home directory -> $HOME, repo root -> $REPO),
listed per file in `redactions`. No secret is ever on a command line: the admin token is
read from the mode-600 file by the shell inside the command, and never echoed.

  python3 video/captures/tools/capture_terminal.py --bin-dir <target>/debug STEP [STEP...]
  python3 video/captures/tools/capture_terminal.py --list
"""
import argparse, base64, datetime, hashlib, json, os, subprocess, sys, time

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
OUT_DIR = os.path.join(REPO, "video", "captures", "terminal")
GW = "http://127.0.0.1:8502"
ADMIN = "http://127.0.0.1:8503"
HUMAN = "-A 'Mozilla/5.0 (Macintosh) Chrome/141' -H 'Accept-Language: en' -H 'Sec-Fetch-Mode: navigate'"  # same as scripts/demo-local.sh step 1
MCP = f"curl -s {GW}/mcp -H 'content-type: application/json' -d"

STEPS = {
    "human-get-quote": (
        "A human browser asks for /api/quote: free, 200 + the JSON body",
        f"curl -s -i {HUMAN} {GW}/api/quote"),
    "claude-user-402": (
        "Claude-User/1.0 asks for the same URL: 402 Payment Required with the full headers",
        f"curl -s -i -A 'Claude-User/1.0' {GW}/api/quote"),
    "claudebot-402": (
        "ClaudeBot asks for the same URL: 402 Payment Required with the full headers",
        f"curl -s -i -A 'Mozilla/5.0 (compatible; ClaudeBot/1.0)' {GW}/api/quote"),
    "gptbot-402": (
        "GPTBot asks for the same URL: 402 Payment Required with the full headers",
        f"curl -s -i -A 'Mozilla/5.0 (compatible; GPTBot/1.2)' {GW}/api/quote"),
    "payment-required-decoded": (
        "The PAYMENT-REQUIRED header from the 402, base64-decoded into the x402 quote",
        f"curl -s -D - -o /dev/null -A 'Claude-User/1.0' {GW}/api/quote | sed -n 's/^payment-required: //Ip' | tr -d '\\r' | base64 -d | python3 -m json.tool"),
    "well-known": (
        "The public price list agents read before spending",
        f"curl -s {GW}/.well-known/agenttoll.json | python3 -m json.tool"),
    "mcp-tools-list": (
        "MCP tools/list through the gateway: free discovery, prices in each description",
        MCP + " '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}' | python3 -m json.tool"),
    "mcp-search-docs-challenge": (
        "MCP tools/call search_docs without payment: MCP-native x402 challenge (isError + accepts)",
        MCP + " '{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"search_docs\",\"arguments\":{\"query\":\"x402\"}}}' | python3 -m json.tool"),
    "mcp-generate-report-challenge": (
        "MCP tools/call generate_report without payment: the $0.05 challenge the wallet later refuses",
        MCP + " '{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":{\"name\":\"generate_report\",\"arguments\":{}}}' | python3 -m json.tool"),
    "demo-config": (
        "The whole demo price file (no secrets in it: pay_to is an env placeholder)",
        "cat demo/agenttoll.demo.yaml"),
    "crawler-hits-free-pages": (
        "AI crawlers read free pages (price 0): served, and counted as unbilled agent traffic",
        "for ua in 'Mozilla/5.0 (compatible; ClaudeBot/1.0)' 'Mozilla/5.0 (compatible; ClaudeBot/1.0)' 'Mozilla/5.0 (compatible; ClaudeBot/1.0)' "
        "'Mozilla/5.0 (compatible; GPTBot/1.2)' 'Mozilla/5.0 (compatible; GPTBot/1.2)' 'Mozilla/5.0 (compatible; PerplexityBot/1.0)' 'CCBot/2.0'; "
        f"do curl -s -o /dev/null -w \"%{{http_code}}  $ua\\n\" -A \"$ua\" {GW}/; done"),
    "buyer-pay-1": (
        "The buyer CLI pays $0.002 for /api/quote (SIMULATED settlement): status, body, receipt",
        f"BUYER_SOLANA_KEYPAIR=.demo/buyer.json agenttoll-buyer {GW}/api/quote"),
    "buyer-pay-2": (
        "The buyer CLI pays again (second paid request)",
        f"BUYER_SOLANA_KEYPAIR=.demo/buyer.json agenttoll-buyer {GW}/api/quote"),
    "buyer-pay-blog": (
        "The buyer CLI pays $0.001 for a blog post (route GET /blog/*)",
        f"BUYER_SOLANA_KEYPAIR=.demo/buyer.json agenttoll-buyer {GW}/blog/hello"),
    "admin-stats": (
        "The founder's ledger from the admin API (token read from the mode-600 file inside the command, never printed)",
        f"curl -s -H \"Authorization: Bearer $(cat .demo/admin-token)\" {ADMIN}/admin/stats | python3 -m json.tool"),
}


def text_or_b64(b):
    try:
        return {"text": b.decode("utf-8")}
    except UnicodeDecodeError:
        return {"text": b.decode("utf-8", "replace"), "base64": base64.b64encode(b).decode()}


def redact(s, rules):
    for old, new in rules:
        s = s.replace(old, new)
    return s


def run(step, bin_dir, suffix=""):
    title, cmd = STEPS[step]
    env = dict(os.environ)
    env["PATH"] = bin_dir + os.pathsep + env["PATH"]
    started = datetime.datetime.now(datetime.timezone.utc)
    t0 = time.monotonic()
    p = subprocess.run(["bash", "-c", cmd], cwd=REPO, env=env, capture_output=True)
    ms = round((time.monotonic() - t0) * 1000, 1)
    home = os.path.expanduser("~")
    rules = [(REPO, "$REPO"), (home, "$HOME")]
    out, err = text_or_b64(p.stdout), text_or_b64(p.stderr)
    for d in (out, err):
        d["text"] = redact(d["text"], rules)
    secret = open(os.path.join(REPO, ".demo", "admin-token")).read().strip()
    for d in (out, err):
        assert secret not in d["text"], "admin token leaked into a capture"
    rec = {
        "id": step + suffix,
        "what": title,
        "command": cmd,
        "cwd": "$REPO",
        "path_prepend": "$CARGO_TARGET_DIR/debug (prebuilt agenttoll-* binaries)",
        "exit": p.returncode,
        "duration_ms": ms,
        "started_utc": started.isoformat(timespec="milliseconds"),
        "stdout": out["text"],
        "stderr": err["text"],
        "stdout_sha256": hashlib.sha256(p.stdout).hexdigest(),
        "stderr_sha256": hashlib.sha256(p.stderr).hexdigest(),
        "redactions": ["repo root -> $REPO", "home dir -> $HOME"] if any(r[0] in (p.stdout + p.stderr).decode("utf-8", "replace") for r in rules) else [],
        "simulated": "agenttoll-buyer" in cmd or step == "admin-stats",
    }
    if "base64" in out:
        rec["stdout_base64"] = out["base64"]
    if "base64" in err:
        rec["stderr_base64"] = err["base64"]
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(os.path.join(OUT_DIR, rec["id"] + ".json"), "w") as f:
        json.dump(rec, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(f"{rec['id']}: exit {p.returncode}, {ms} ms, {len(p.stdout)} B out")
    return rec


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bin-dir")
    ap.add_argument("--suffix", default="")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("steps", nargs="*")
    a = ap.parse_args()
    if a.list:
        for k, (t, c) in STEPS.items():
            print(f"{k}: {t}")
        return
    for s in a.steps:
        run(s, a.bin_dir, a.suffix)


if __name__ == "__main__":
    main()
