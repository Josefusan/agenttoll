#!/usr/bin/env python3
"""1) Extract the Claude-pays excerpts verbatim from docs/assets/claude-pays-transcript.md.
2) Write video/captures/manifest.json: every capture file with what it shows, how it was made,
   the exact command, size and sha256.
  python3 video/captures/tools/build_manifest.py
"""
import datetime, glob, hashlib, json, os, re

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
CAP = os.path.join(REPO, "video", "captures")
SRC = "docs/assets/claude-pays-transcript.md"


def claude_excerpts():
    md = open(os.path.join(REPO, SRC)).read()
    runs = []
    pieces = re.split(r"^## (Run \d+)\n", md, flags=re.M)
    header = pieces[0]
    for name, body in zip(pieces[1::2], pieces[2::2]):
        events = []
        prompt = re.search(r"\*\*Prompt\*\*\n\n> (.+?)\n", body).group(1)
        for m in re.finditer(r"\*\*(Tool call \d+: `([a-z_]+)`|Result \(error\)|Result|Claude)\*\*\n\n(.*?)(?=\n\*\*(?:Tool call|Result|Claude)|\n_Run \d+:|\Z)", body, flags=re.S):
            label, tool, text = m.group(1), m.group(2), m.group(3).strip()
            if text.startswith("```json"):
                text = text[len("```json"):].rsplit("```", 1)[0].strip()
                kind = "tool_call" if tool else ("tool_error" if "error" in label else "tool_result")
                ev = {"kind": kind, "json_text": text}
                if tool:
                    ev["tool"] = tool
            else:
                ev = {"kind": "claude_text", "markdown": text.split("\n\n---")[0].strip()}
            events.append(ev)
        footer = re.search(r"_(Run \d+: .+?)_", body)
        runs.append({"run": name, "prompt": prompt, "events": events, "footer": footer.group(1) if footer else None})
    banner = re.search(r"^> (\*\*SIMULATED\.\*\*.+)$", header, flags=re.M).group(1)
    session = re.search(r"_Session: (.+?)_", md).group(1)
    refusal = json.loads(next(e["json_text"] for r in runs for e in r["events"] if e["kind"] == "tool_error"))
    out = {
        "source": SRC,
        "note": "Verbatim excerpts. Gateway in this transcript was 127.0.0.1:28402 (an earlier real run), not the film stack's 8502. Paths were redacted by scripts/format-claude-transcript.py in the source.",
        "simulated_banner": banner,
        "session": session,
        "refusal": refusal,
        "runs": runs,
    }
    os.makedirs(os.path.join(CAP, "claude-pays"), exist_ok=True)
    with open(os.path.join(CAP, "claude-pays", "excerpts.json"), "w") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
        f.write("\n")


T = "python3 video/captures/tools/capture_terminal.py --bin-dir $CARGO_TARGET_DIR/debug "
D = "node video/captures/tools/dash_capture.mjs "
STACK = ("STACK_ONLY=1 GATEWAY_PORT=8502 ADMIN_PORT=8503 ORIGIN_PORT=4100 FACILITATOR_PORT=4120 "
         "CARGO_TARGET_DIR=$HOME/Hackathons/AgentToll-d8/target bash scripts/demo-local.sh  (build, config, keypairs, token), "
         "then CARGO_TARGET_DIR=$HOME/Hackathons/AgentToll-d8/target bash video/captures/tools/stack-clean.sh (same binaries/config, no curl probe, empty ledger)")
DASH = ("dashboard: apps/dashboard copied to ~/agenttoll-scratch/film-dash, NEXT_PUBLIC_GATEWAY_URL=http://127.0.0.1:8502 next build, "
        "AGENTTOLL_ADMIN_URL=http://127.0.0.1:8503 AGENTTOLL_ADMIN_TOKEN=\"$(cat .demo/admin-token)\" next start -H 127.0.0.1 -p 3502")

STATES = {
    "01-empty": "Empty ledger: 0 payments, 0 unbilled. The dashboard's onboarding card (3 steps).",
    "02-unbilled-no-payments": "Still 0 payments, after 7 crawler hits on free pages + 1 MCP discovery call: the 'Agent traffic you are not billing yet' card (ClaudeBot 3, GPTBot 2, CCBot 1, PerplexityBot 1, unknown/mcp-endpoint 1).",
    "03-one-payment": "After the first buyer CLI payment: $0.002, 1 paid request, 1 live-feed row with Solana devnet + Simulated badges, cash out $0.00 spendable.",
    "04-buyer-and-pay-mcp": "After the pay-mcp session (pay_and_fetch $0.002, search_docs $0.005, generate_report refused) and a $0.001 blog payment: 4 payments, $0.010, mcp search_docs row, chart starts.",
    "05-many-payments": "After the 30 s live recording (15 more buyer payments): 19 payments, $0.034 (all simulated), 14 unbilled, full chart, routes /api/quote, mcp:search_docs, /blog/*.",
}


def what(rel):
    name = os.path.basename(rel)
    if rel.startswith("terminal/"):
        j = json.load(open(os.path.join(CAP, rel)))
        return j.get("what"), j.get("command"), "Real run against the film stack (gateway :8502, SIMULATED facilitator :4120)."
    if rel.startswith("claude-pays/"):
        return "Verbatim Claude-pays excerpts (3 runs, refusal, banner) parsed from " + SRC, "python3 video/captures/tools/build_manifest.py", "Copied from the repo transcript of an earlier real claude -p run; not re-run for the film."
    if rel.startswith("origin/"):
        if name == "origin.json":
            return "Status, response headers and page text for each origin screenshot", D + "origin", "Real browser load through the gateway with a desktop Chrome UA."
        page = name.replace("origin-", "").replace(".png", "")
        return f"What a human browser sees at the gateway: {page} (1920x1080 @2x)", D + "origin", "Real browser load through the gateway with a desktop Chrome UA (200, no 402)."
    if rel.startswith("dashboard/"):
        if name == "dashboard-live-recording.json":
            return "Timing of the 15 buyer payments fired during the live recording, and paths of the webm/mp4 (outside git)", D + "record 30 $CARGO_TARGET_DIR/debug", "Real-time recording of the dashboard while real (SIMULATED) payments landed."
        for st, desc in STATES.items():
            if st in name:
                if name.startswith("panel-"):
                    el = name.split(st + "-")[1].replace(".png", "")
                    return f"{el} panel cropped from the @2x full-page shot. {desc}", "python3 video/captures/tools/crop_panels.py " + st, "Pixel crop of the real screenshot using the DOM box."
                if "mobile" in name:
                    kind = "boxes JSON" if name.endswith(".json") else ("full page" if "full" in name else "viewport")
                    return f"Mobile 390 px @3x, {kind}. {desc}", D + "mobile " + st, "Playwright against the live dashboard."
                if name.endswith(".boxes.json"):
                    return f"DOM bounding boxes (CSS px) of key elements + totals. {desc}", D + "shot " + st, "Playwright against the live dashboard."
                if "hover" in name:
                    return f"Cursor hovering the first row's Simulated badge (native tooltip not painted headless; exact title text in the boxes JSON). {desc}", D + f"shot {st} --hover-badge", "Playwright against the live dashboard."
                kind = "full page" if "-full" in name else "1920x1080 viewport"
                return f"Dashboard @2x, {kind}. {desc}", D + "shot " + st, "Playwright against the live dashboard."
    if rel.startswith("tools/"):
        return "Capture tooling (rerunnable)", None, "Source"
    return None, None, None


def main():
    claude_excerpts()
    files = []
    for p in sorted(glob.glob(os.path.join(CAP, "**", "*"), recursive=True)):
        if os.path.isdir(p) or p.endswith("manifest.json"):
            continue
        rel = os.path.relpath(p, CAP)
        w, cmd, how = what(rel)
        b = open(p, "rb").read()
        files.append({"path": rel, "what": w, "how": how, "command": cmd, "bytes": len(b), "sha256": hashlib.sha256(b).hexdigest()})
    rec = json.load(open(os.path.join(CAP, "dashboard", "dashboard-live-recording.json")))
    manifest = {
        "generated_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "stack": STACK,
        "dashboard": DASH,
        "ports": {"gateway": 8502, "admin": 8503, "origin": 4100, "facilitator_simulated": 4120, "dashboard": 3502},
        "simulated": "Every payment in these captures went through the local mock facilitator (demo/mock-facilitator). tx ids start with SIMULATED-. No funds moved; nothing touched a chain. Buyer and pay_to keypairs are throwaway, unfunded, in .demo/ (gitignored).",
        "secrets": "The admin token is read from .demo/admin-token inside commands and never printed; capture_terminal.py asserts it is absent from every output. Keypair files are never read into captures (only their public keys appear).",
        "redactions": "Absolute paths: repo root -> $REPO, home -> $HOME; pay-mcp spend file/keypair/temp dir -> $SPEND_FILE/$KEYPAIR/$WORKDIR. Nothing else is edited.",
        "outside_git": [
            {"path": rec["recordvideo_webm"].replace(os.path.expanduser("~"), "~"), "what": "Playwright recordVideo of the dashboard, 1920x1080 25 fps VP8, ~39 s, 15 payments every ~2 s", "bytes": rec["recordvideo_bytes"]},
            {"path": rec["screencast_mp4"].replace(os.path.expanduser("~"), "~"), "what": "Same session via CDP screencast (JPEG q95 frames, real timestamps) -> H.264 crf 14, 1920x1080 30 fps, ~34 s; sharper than the webm", "bytes": rec["screencast_bytes"]},
        ],
        "files": files,
    }
    with open(os.path.join(CAP, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(f"{len(files)} files")


if __name__ == "__main__":
    main()
