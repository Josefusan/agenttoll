"""Custom checks for cases that need more than one request and one expectation.

Each function is called as check(ctx, **args) from a case step `{"check": "<name>", "args": {...}}`.
It returns a short evidence string, or raises Fail. Black box only: everything goes through the
public HTTP port, the admin API, the buyer CLI binary or the facilitator's public endpoints.
"""
from __future__ import annotations

import http.client
import json
import os
import re
import subprocess
import time
from decimal import Decimal

GPTBOT = "Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)"


class Fail(AssertionError):
    pass


class Skip(Exception):
    """The case could not run for a reason outside the product (for example the public devnet RPC
    is unreachable). Reported as SKIP with the reason, never as PASS, and it does not fail the run."""


def _need(cond, msg):
    if not cond:
        raise Fail(msg)


def _tool_call(name: str, call_id=1):
    return json.dumps({"jsonrpc": "2.0", "id": call_id, "method": "tools/call",
                       "params": {"name": name, "arguments": {"query": "x402"}}}).encode()


def _agent_get(ctx, path):
    return ctx.gw("GET", path, headers={"User-Agent": GPTBOT})


def _mcp_post(ctx, name):
    return ctx.gw("POST", "/mcp", headers={"User-Agent": "mcp-client/1.0", "Content-Type": "application/json",
                                           "Accept": "application/json, text/event-stream"},
                  body=_tool_call(name))


# ------------------------------------------------------------------ x402 challenge

def fee_payer_matches_facilitator(ctx):
    """Solana extra.feePayer in the quote is the fee payer the facilitator advertises on /supported."""
    sup = ctx.request(ctx.stack.fac_port, "GET", "/supported")
    _need(sup.status == 200 and sup.json, f"facilitator /supported returned {sup.status}")
    kinds = [k for k in sup.json["kinds"] if str(k.get("network", "")).startswith("solana:")]
    _need(kinds, "facilitator advertises no Solana kind")
    expected = kinds[0]["extra"]["feePayer"]
    sol = [a for a in _agent_get(ctx, "/api/quote").challenge["accepts"] if a["network"].startswith("solana:")]
    _need(sol, "quote has no Solana entry")
    got = sol[0]["extra"].get("feePayer")
    _need(got == expected, f"quote feePayer {got!r} != facilitator feePayer {expected!r}")
    _need(re.fullmatch(r"[1-9A-HJ-NP-Za-km-z]{32,44}", got or ""), f"feePayer {got!r} is not base58")
    return f"quote extra.feePayer == facilitator /supported feePayer ({got[:6]}...)"


def price_math(ctx):
    """Atomic amount in each quote is price_usd * 1e6, for HTTP routes and MCP tools, using the
    prices the gateway itself publishes on /.well-known/agenttoll.json."""
    disc = ctx.gw("GET", "/.well-known/agenttoll.json").json
    routes = {r["match"]: r["priceUsd"] for r in disc["routes"]}
    seen = []
    for path, pattern in (("/api/quote", "GET /api/quote"), ("/blog/agent-economy", "GET /blog/*"),
                          ("/api/fail", "GET /api/*")):
        want = int(Decimal(routes[pattern]) * 10**6)
        got = int(_agent_get(ctx, path).challenge["accepts"][0]["amount"])  # same on every rail
        _need(got == want, f"{path}: quote {got} != {routes[pattern]} USD * 1e6 = {want}")
        seen.append(f"{path} {routes[pattern]} USD -> {got}")
    for tool, price in disc["mcp"]["tools"].items():
        want = int(Decimal(price) * 10**6)
        ch = _mcp_post(ctx, tool).challenge
        got = int(ch["accepts"][0]["amount"])
        _need(got == want, f"tool {tool}: quote {got} != {price} USD * 1e6 = {want}")
        seen.append(f"mcp {tool} {price} USD -> {got}")
    return "; ".join(seen)


def challenge_deterministic(ctx):
    """Same request, same requirements, so a client can retry with a payment it already built."""
    a = _agent_get(ctx, "/api/quote").challenge["accepts"]
    b = _agent_get(ctx, "/api/quote").challenge["accepts"]
    _need(a == b, "two challenges for the same request differ")
    return "two consecutive challenges have identical accepts[]"


def mcp_text_equals_structured(ctx):
    """MCP-native challenge: content[0].text is the same PaymentRequired JSON as structuredContent."""
    r = _mcp_post(ctx, "search_docs")
    result = (r.json or {}).get("result", {})
    text = json.loads(result["content"][0]["text"])
    _need(text == result["structuredContent"], "content[0].text differs from structuredContent")
    _need(text == r.challenge, "PAYMENT-REQUIRED header differs from structuredContent")
    return "content[0].text == structuredContent == PAYMENT-REQUIRED header"


# ------------------------------------------------------------------ buyer CLI

NETWORK_ERROR = re.compile(r"error sending request|connection (refused|reset|closed)|timed? ?out|dns error|"
                           r"failed to lookup|network is unreachable|tcp connect|too many requests|\b429\b", re.I)


def _run_buyer_once(ctx, url, *extra):
    env = {**os.environ,
           "BUYER_SOLANA_KEYPAIR": str(ctx.stack.buyer_keypair),
           "SOLANA_RPC_URL": os.environ.get("EVAL_SOLANA_RPC", "https://api.devnet.solana.com")}
    env.pop("BUYER_EVM_PRIVATE_KEY", None)
    return subprocess.run([ctx.stack.bin("buyer"), url, *extra], capture_output=True, text=True,
                          env=env, timeout=90, cwd=ctx.stack.tmp)


def _run_buyer(ctx, url, *extra):
    """Runs the buyer CLI. A failure that looks like a devnet RPC network error is retried once
    (after 2 s, and only if the ledger did not move). If it fails the same way again the case is
    SKIPPED with the reason: an unreachable public RPC says nothing about AgentToll."""
    before = ctx.admin_stats()["totals"]["payments"]
    try:
        out = _run_buyer_once(ctx, url, *extra)
    except subprocess.TimeoutExpired:
        out = subprocess.CompletedProcess([], 124, "", "timed out waiting for the buyer CLI (devnet RPC)")
    for attempt in (1, 2):
        if out.returncode == 0 or not NETWORK_ERROR.search(out.stderr):
            return out
        if ctx.admin_stats()["totals"]["payments"] != before:
            return out  # the ledger moved, so this is not a clean pre-payment network error
        if attempt == 1:
            time.sleep(2)
            try:
                out = _run_buyer_once(ctx, url, *extra)
            except subprocess.TimeoutExpired:
                out = subprocess.CompletedProcess([], 124, "", "timed out waiting for the buyer CLI (devnet RPC)")
    rpc = os.environ.get("EVAL_SOLANA_RPC", "https://api.devnet.solana.com")
    raise Skip(f"Solana devnet RPC unreachable after one retry ({rpc}); buyer stderr: {out.stderr.strip()[-160:]!r}")


def buyer_paid_flow(ctx):
    """The shipped buyer CLI pays /api/quote through the gateway and the simulated facilitator."""
    before = ctx.admin_stats()["totals"]
    out = _run_buyer(ctx, f"http://127.0.0.1:{ctx.stack.gw_port}/api/quote")
    _need(out.returncode == 0, f"buyer exited {out.returncode}: {out.stderr.strip()[-300:]}")
    text = out.stdout
    _need(re.search(r"^status: 200", text, re.M), f"buyer status line missing: {text[:200]!r}")
    tx = re.search(r"^tx:\s+(\S+)", text, re.M)
    _need(tx and tx.group(1).startswith("SIMULATED-"), f"tx is not SIMULATED-: {tx and tx.group(1)}")
    _need("SIMULATED settlement" in text, "buyer did not label the settlement as simulated")
    _need('"paid":true' in text.replace(" ", ""), "origin did not see the payment header (paid != true)")
    _need('"agent":"AgentToll-Buyer"' in text.replace(" ", ""), "origin was not told the agent name")
    net = re.search(r"^paid:\s+true on (\S+)", text, re.M)
    after = ctx.admin_stats()["totals"]
    _need(after["payments"] == before["payments"] + 1, f"payments {before['payments']} -> {after['payments']}")
    _need(after["revenue_atomic"] == before["revenue_atomic"] + 2000,
          f"revenue {before['revenue_atomic']} -> {after['revenue_atomic']}, want +2000")
    ctx.settled_atomic += 2000
    ctx.settled_count += 1
    if net:
        ctx.settled_by_network[net.group(1)] = ctx.settled_by_network.get(net.group(1), 0) + 2000
    return f"buyer CLI: status 200, tx {tx.group(1)}, ledger +1 payment, +2000 atomic"


def buyer_cap_refusal(ctx):
    """The buyer refuses a quote above its own per-call cap and spends nothing."""
    before = ctx.admin_stats()["totals"]
    out = _run_buyer(ctx, f"http://127.0.0.1:{ctx.stack.gw_port}/api/quote", "--max-usd-per-call", "0.001")
    _need(out.returncode != 0, "buyer paid or exited 0 although the quote (0.002) is above its cap (0.001)")
    _need("skipping quote" in out.stderr, f"no refusal message in stderr: {out.stderr.strip()[-200:]!r}")
    after = ctx.admin_stats()["totals"]
    _need(after["revenue_atomic"] == before["revenue_atomic"] and after["payments"] == before["payments"],
          "ledger changed although the buyer refused")
    return f"buyer exit {out.returncode}, 'skipping quote' on stderr, ledger unchanged"


# ------------------------------------------------------------------ admin API

def admin_events_query_token(ctx, expect_status=200):
    """/admin/events accepts ?token= (EventSource cannot set headers) and answers as an SSE stream."""
    conn = http.client.HTTPConnection("127.0.0.1", ctx.stack.admin_port, timeout=6)
    try:
        conn.request("GET", f"/admin/events?token={ctx.stack.admin_token}")
        r = conn.getresponse()
        ctype = r.getheader("content-type", "")
        _need(r.status == expect_status, f"/admin/events?token= returned {r.status}")
        _need(ctype.startswith("text/event-stream"), f"content-type {ctype!r}")
        return f"200 {ctype}"
    finally:
        conn.close()


# ------------------------------------------------------------------ unbilled traffic log

def _unbilled(stats, agent, reason=None):
    return sum(u["requests"] for u in stats["unbilled"]
               if u["agent"] == agent and (reason is None or u["reason"] == reason))


def unbilled_crawlers(ctx, agent="Bytespider", hits=4, path="/"):
    """Crawler visits to free pages are not charged but are counted, per agent and rule."""
    ua = f"Mozilla/5.0 (compatible; {agent}/1.0)"
    base = _unbilled(ctx.admin_stats(), agent)
    for _ in range(hits):
        r = ctx.gw("GET", path, headers={"User-Agent": ua})
        _need(r.status == 200 and "payment-required" not in r.headers, f"free page answered {r.status}")
    stats = ctx.admin_stats(wait_for=lambda s: _unbilled(s, agent) >= base + hits)
    got = _unbilled(stats, agent, f"ua:{agent}")
    _need(_unbilled(stats, agent) == base + hits,
          f"unbilled count for {agent}: {base} + {hits} expected, found {_unbilled(stats, agent)}")
    _need(got >= hits, f"no ua:{agent} row")
    return f"{hits} {agent} hits on {path}: served free, logged as unbilled (ua:{agent}) = {got}"


def human_not_logged(ctx):
    """Humans are never written to the unbilled log."""
    chrome = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
              "Chrome/141.0.0.0 Safari/537.36")
    hdr = {"User-Agent": chrome, "Accept-Language": "en-US,en;q=0.9", "Sec-Fetch-Mode": "navigate"}
    base = ctx.admin_stats()["totals"]["unbilled_agent_requests"]
    for p in ("/", "/blog/agent-economy", "/api/quote", "/", "/blog/x", "/api/quote"):
        _need(ctx.gw("GET", p, headers=hdr).status == 200, f"human got non-200 on {p}")
    time.sleep(0.8)  # unbilled rows are written off the request path
    stats = ctx.admin_stats()
    _need(stats["totals"]["unbilled_agent_requests"] == base,
          f"unbilled count moved {base} -> {stats['totals']['unbilled_agent_requests']} after human traffic")
    _need(not any("human" in u["reason"] for u in stats["unbilled"]), "a human verdict reason is in the log")
    return f"6 human requests served free; unbilled_agent_requests stays {base}"


def search_bot_logged(ctx):
    """A search bot (free by default) is served and logged, not charged."""
    ua = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"
    base = _unbilled(ctx.admin_stats(), "Googlebot")
    r = ctx.gw("GET", "/blog/agent-economy", headers={"User-Agent": ua})
    _need(r.status == 200 and "payment-required" not in r.headers, f"Googlebot got {r.status}")
    stats = ctx.admin_stats(wait_for=lambda s: _unbilled(s, "Googlebot") > base)
    _need(_unbilled(stats, "Googlebot") > base, "Googlebot visit was not logged")
    return f"Googlebot on a priced blog route: 200 free, logged (count {base} -> {_unbilled(stats, 'Googlebot')})"


# ------------------------------------------------------------------ ledger and stats

def ledger_matches_observed(ctx):
    """Revenue in /admin/stats equals exactly what the runner saw settle. Every refused,
    replayed, tampered, failed-origin and facilitator-down attempt added nothing."""
    t = ctx.admin_stats()["totals"]
    want_atomic = ctx.settled_atomic + ctx.unconfirmed_atomic
    want_count = ctx.settled_count + ctx.unconfirmed_count
    _need(t["revenue_atomic"] == want_atomic,
          f"ledger revenue {t['revenue_atomic']} != observed settled {ctx.settled_atomic} + unconfirmed {ctx.unconfirmed_atomic}")
    _need(t["payments"] == want_count, f"ledger payments {t['payments']} != observed {want_count}")
    return (f"ledger revenue_atomic={t['revenue_atomic']} payments={t['payments']} == observed settled "
            f"({ctx.settled_atomic}, {ctx.settled_count}) + unconfirmed ({ctx.unconfirmed_atomic}, {ctx.unconfirmed_count})")


def simulated_separated(ctx):
    """Simulated money is reported separately and is never mistaken for settled chain money."""
    t = ctx.admin_stats()["totals"]
    _need({"simulated_atomic", "unconfirmed_atomic"} <= set(t), "totals lacks simulated/unconfirmed fields")
    _need(t["simulated_atomic"] == ctx.settled_atomic > 0,
          f"simulated_atomic {t['simulated_atomic']} != observed simulated settlements {ctx.settled_atomic}")
    _need(t["unconfirmed_atomic"] == ctx.unconfirmed_atomic,
          f"unconfirmed_atomic is {t['unconfirmed_atomic']}, observed {ctx.unconfirmed_atomic}")
    real = t["revenue_atomic"] - t["simulated_atomic"] - t["unconfirmed_atomic"]
    _need(real == 0, f"{real} atomic counted as real money in a simulated run")
    return (f"simulated_atomic={t['simulated_atomic']} + unconfirmed_atomic={t['unconfirmed_atomic']} "
            f"(only the settle-timeout case) = revenue_atomic={t['revenue_atomic']}; real (neither)=0")


def recent_all_labelled(ctx):
    """Every settled row carries simulated=true, a SIMULATED- id, status settled. The only other rows
    are the settle-timeout case's: status unconfirmed, an unconfirmed: id, never flagged simulated."""
    recent = ctx.admin_stats()["recent"]
    _need(recent, "no recent events")
    unconfirmed = 0
    for e in recent:
        if e["status"] == "unconfirmed":
            unconfirmed += 1
            _need(e["tx_signature"].startswith("unconfirmed:") and e["simulated"] is False,
                  f"unconfirmed row {e['tx_signature']!r} simulated={e['simulated']}")
            continue
        _need(e["simulated"] is True, f"row {e['tx_signature']} not flagged simulated")
        _need(e["tx_signature"].startswith("SIMULATED-"), f"row tx {e['tx_signature']!r} lacks SIMULATED-")
        _need(e["status"] == "settled", f"row status {e['status']}")
    _need(unconfirmed <= ctx.unconfirmed_count, f"{unconfirmed} unconfirmed rows, runner caused {ctx.unconfirmed_count}")
    return (f"{len(recent) - unconfirmed} recent rows simulated=true, SIMULATED- tx, status settled; "
            f"{unconfirmed} unconfirmed (settle-timeout case only)")


def failures_not_in_ledger(ctx):
    """Routes whose paid attempts failed (origin 5xx, MCP tool error) have no revenue rows."""
    stats = ctx.admin_stats()
    routes = {r["route"] for r in stats["by_route"]}
    bad = routes & {"GET /api/*", "mcp:broken_tool"}
    _need(not bad, f"revenue recorded for failed routes: {sorted(bad)}")
    return f"by_route {sorted(routes)} has no GET /api/* (origin 500) or mcp:broken_tool (tool error)"


def by_network_both(ctx):
    stats = ctx.admin_stats()
    nets = {n["network"]: n["revenue_atomic"] for n in stats["by_network"]}
    observed = dict(ctx.settled_by_network)
    for net, amount in ctx.unconfirmed_by_network.items():
        observed[net] = observed.get(net, 0) + amount
    for net, amount in observed.items():
        _need(nets.get(net) == amount, f"by_network[{net}]={nets.get(net)} != observed {amount}")
    _need(len(nets) >= 2, f"expected revenue on both rails, got {nets}")
    return f"by_network {nets} matches observed per-network totals"


def mcp_tool_recorded(ctx):
    stats = ctx.admin_stats()
    tools = {e["mcp_tool"] for e in stats["recent"] if e.get("mcp_tool")}
    _need({"search_docs", "generate_report"} <= tools, f"mcp tools in ledger: {sorted(tools)}")
    return f"ledger records per-tool MCP revenue: {sorted(tools)}"


def agents_attributed(ctx):
    stats = ctx.admin_stats()
    agents = {a["agent"] for a in stats["by_agent"]}
    _need({"GPTBot", "AgentToll-Buyer"} <= agents, f"by_agent {sorted(agents)}")
    return f"by_agent attributes revenue to {sorted(agents)}"


# ------------------------------------------------------------------ fault injection

def settle_timeout_unconfirmed(ctx):
    """The facilitator accepts /verify but /settle outlasts the gateway's settle budget (the eval
    config sets 1000 ms; the SIMULATED facilitator sleeps longer when the payment asks for it).
    The outcome is unknown, so the buyer is served and the ledger records the payment as
    unconfirmed, with no receipt and an unconfirmed: id. The payment stays claimed."""
    quote = _agent_get(ctx, "/api/quote")
    spec = {"payload": {"transaction": "EVAL-settle-timeout", "mock": "settle_timeout"}}
    header, payload = ctx.build_payment(spec, quote)
    before = ctx.admin_stats()["totals"]
    paid = ctx.gw("GET", "/api/quote", headers={"User-Agent": GPTBOT, "PAYMENT-SIGNATURE": header})
    _need(paid.status == 200, f"settle timeout: got {paid.status}, want 200 (content served)")
    _need("SOL/USD" in paid.text, "settle timeout: content was not served")
    _need("payment-response" not in paid.headers, "settle timeout: a receipt was returned for an unknown outcome")
    stats = ctx.admin_stats()
    t = stats["totals"]
    _need(t["unconfirmed_atomic"] == before["unconfirmed_atomic"] + 2000,
          f"unconfirmed_atomic {before['unconfirmed_atomic']} -> {t['unconfirmed_atomic']}, want +2000")
    _need(t["payments"] == before["payments"] + 1, f"payments {before['payments']} -> {t['payments']}")
    row = stats["recent"][0]
    _need(row["status"] == "unconfirmed", f"ledger row status {row['status']!r}, want 'unconfirmed'")
    _need(row["tx_signature"].startswith("unconfirmed:"), f"ledger tx {row['tx_signature']!r} lacks unconfirmed:")
    _need(row["simulated"] is False, "an unconfirmed row must not be flagged simulated (no SIMULATED- id was issued)")
    again = ctx.gw("GET", "/api/quote", headers={"User-Agent": GPTBOT, "PAYMENT-SIGNATURE": header})
    _need(again.status == 402 and "SOL/USD" not in again.text,
          f"replay of the unconfirmed payment: got {again.status}, want 402 without content")
    amount = int(payload["accepted"]["amount"])
    ctx.unconfirmed_atomic += amount
    ctx.unconfirmed_count += 1
    net = payload["accepted"]["network"]
    ctx.unconfirmed_by_network[net] = ctx.unconfirmed_by_network.get(net, 0) + amount
    return (f"settle timeout: 200 with content, no receipt, ledger row status=unconfirmed tx={row['tx_signature'][:20]}..., "
            f"unconfirmed_atomic +{amount}, replay -> 402")


def stop_facilitator(ctx):
    """Stops the facilitator process this run started (never anything else)."""
    p = ctx.stack.procs["facilitator"]
    p.terminate()
    p.wait(timeout=5)
    return "simulated facilitator stopped"
