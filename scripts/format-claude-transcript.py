#!/usr/bin/env python3
"""Turn `claude -p --output-format stream-json --verbose` logs into a markdown transcript.

Usage: format-claude-transcript.py --gateway URL --model M --prompt P --run FILE [--prompt P --run FILE ...]
"""
import argparse, json, sys

ap = argparse.ArgumentParser()
ap.add_argument("--redact", action="append", default=[], help="VALUE=PLACEHOLDER, replace a local path with a placeholder; repeatable")
ap.add_argument("--gateway", required=True)
ap.add_argument("--model", required=True)
ap.add_argument("--prompt", action="append", required=True)
ap.add_argument("--run", action="append", required=True)
a = ap.parse_args()

# Longest values first so a path inside another path is replaced whole.
def redact(t):
    pairs = [r.split("=", 1) for r in a.redact]
    for val, ph in sorted(pairs, key=lambda p: len(p[0]), reverse=True):
        t = t.replace(val.rstrip("/"), ph)
    return t

def tool_text(block):
    c = block.get("content")
    if isinstance(c, list):
        return "\n".join(x.get("text", "") for x in c if isinstance(x, dict))
    return str(c)

def pretty(t):
    try:
        return json.dumps(json.loads(t), indent=2)
    except Exception:
        return t

out = []
w = out.append
w("# Claude pays, with simulated money\n")
w("> **SIMULATED.** Every payment below went through the local test facilitator (`demo/mock-facilitator`). "
  "Transaction ids start with `SIMULATED-`. No funds moved, nothing touched a chain, and the wallet holds no funds. "
  "The keypair is a throwaway generated for this run and is not committed.\n")
w("Gateway: `%s` (AgentToll in front of `demo/origin`). Caps: $0.01 per call, $0.25 per day. Network: Solana devnet (simulated settlement).\n" % a.gateway)
w("## How it was run\n")
w("Stack, in one shell:\n\n```bash\nSTACK_ONLY=1 bash scripts/demo-local.sh\n```\n")
w("Claude, in another (`scripts/claude-pays-demo.sh` does all of this and writes this file). "
  "`$KEYPAIR` and `$SPEND_FILE` are the throwaway key and a temp spend file, paths redacted. The MCP config is:\n")
w('```json\n{"mcpServers":{"agenttoll-pay":{"command":"node","args":["demo/pay-mcp/dist/index.js"],\n'
  ' "env":{"BUYER_SOLANA_KEYPAIR":"$KEYPAIR","PAY_MCP_NETWORK":"solana",\n'
  '  "BUYER_MAX_USD_PER_CALL":"0.01","BUYER_MAX_USD_PER_DAY":"0.25","PAY_MCP_SPEND_FILE":"$SPEND_FILE"}}}}\n```\n')
w("and each prompt runs as:\n")
w("```bash\nclaude -p \"<prompt>\" --model %s --mcp-config mcp.json --strict-mcp-config \\\n"
  "  --tools \"\" --allowedTools \"mcp__agenttoll-pay\" --no-session-persistence \\\n"
  "  --output-format stream-json --verbose\n```\n" % a.model)
w("`--tools \"\"` removes every built-in tool, so pay-mcp is the only thing Claude can use. "
  "Below, tool calls and results are shown as the CLI emitted them (results pretty-printed). "
  "The only edit is mechanical: the formatter replaces the spend-file, keypair, temp-directory and repo-root paths with `$SPEND_FILE`, `$KEYPAIR`, `$WORKDIR` and `$REPO`.\n")

for i, (prompt, path) in enumerate(zip(a.prompt, a.run), 1):
    w("---\n\n## Run %d\n" % i)
    w("**Prompt**\n\n> %s\n" % prompt)
    model_id = turns = dur = None
    n = 0
    for line in open(path):
        line = line.strip()
        if not line:
            continue
        ev = json.loads(line)
        t = ev.get("type")
        if t == "system" and ev.get("subtype") == "init":
            model_id = ev.get("model")
            servers = ", ".join("%s (%s)" % (s["name"], s["status"]) for s in ev.get("mcp_servers", []))
            w("_Session: model `%s`, MCP servers: %s_\n" % (model_id, servers))
        elif t == "assistant":
            for b in ev["message"]["content"]:
                if b["type"] == "text" and b["text"].strip():
                    w("**Claude**\n\n%s\n" % b["text"].strip())
                elif b["type"] == "tool_use":
                    n += 1
                    name = b["name"].replace("mcp__agenttoll-pay__", "")
                    w("**Tool call %d: `%s`**\n\n```json\n%s\n```\n" % (n, name, redact(json.dumps(b["input"], indent=2))))
        elif t == "user":
            c = ev["message"].get("content")
            if isinstance(c, list):
                for b in c:
                    if b.get("type") == "tool_result":
                        flag = " (error)" if b.get("is_error") else ""
                        w("**Result%s**\n\n```json\n%s\n```\n" % (flag, redact(pretty(tool_text(b)))))
        elif t == "result":
            turns, dur = ev.get("num_turns"), ev.get("duration_ms")
    if turns is not None:
        w("_Run %d: %s turns, %.1f s._\n" % (i, turns, (dur or 0) / 1000))
print(redact("\n".join(out)))
