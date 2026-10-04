#!/usr/bin/env python3
"""AgentToll black-box end-to-end eval suite. Python 3 standard library only.

Starts the demo origin, the SIMULATED facilitator and the gateway on private ports, runs every
case in evals/cases/*.json over real HTTP, tears the stack down, and writes
evals/results/latest.json and evals/results/latest.md. Exits 1 if any case fails.

    python3 evals/run.py                 # run everything
    python3 evals/run.py --only MCP-     # run cases whose id starts with MCP-
    python3 evals/run.py --list          # list case ids and promises

Binaries come from $EVAL_BIN_DIR, else $CARGO_TARGET_DIR/release, else <repo>/target/release,
else <repo>/target/debug. Pass --build to run cargo build first.
Ports: EVAL_GATEWAY_PORT (18402), EVAL_ADMIN_PORT (18403), EVAL_ORIGIN_PORT (14000),
EVAL_FACILITATOR_PORT (14020).

Payments are SIMULATED. Nothing here touches a chain or a funded wallet.
"""
from __future__ import annotations

import argparse
import base64
import copy
import datetime
import http.client
import json
import os
import pathlib
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
import uuid

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))

import checks  # noqa: E402  (custom checks that need more than a request and an expectation)
from checks import Fail, Skip  # noqa: E402

BINARIES = {
    "gateway": "agenttoll-gateway",
    "origin": "agenttoll-demo-origin",
    "facilitator": "agenttoll-mock-facilitator",
    "buyer": "agenttoll-buyer",
}
SOLANA_DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"
SOLANA_USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
BASE_SEPOLIA = "eip155:84532"
BASE_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
RAILS = {"solana": "solana:", "base": "eip155:"}
BASE_PAYTO = "0x000000000000000000000000000000000000dead"  # throwaway, nobody holds a key for it


# --------------------------------------------------------------------------- HTTP

class Response:
    def __init__(self, status: int, headers: dict, body: bytes):
        self.status = status
        self.headers = headers
        self.body = body
        self._json = None
        self._json_done = False

    @property
    def text(self) -> str:
        return self.body.decode("utf-8", "replace")

    @property
    def json(self):
        if not self._json_done:
            self._json_done = True
            try:
                self._json = json.loads(self.body)
            except (ValueError, UnicodeDecodeError):
                self._json = None
        return self._json

    def decoded_header(self, name: str):
        value = self.headers.get(name.lower())
        if value is None:
            return None
        try:
            return json.loads(base64.b64decode(value, validate=True))
        except (ValueError, TypeError):
            return None

    @property
    def challenge(self):
        return self.decoded_header("payment-required")

    @property
    def receipt(self):
        return self.decoded_header("payment-response")


def http_request(port: int, method: str, path: str, headers: dict | None = None,
                 body: bytes | None = None, timeout: float = 20) -> Response:
    """Sends the path exactly as given (no client-side normalization), so bypass attempts
    reach the gateway byte for byte."""
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=timeout)
    try:
        conn.putrequest(method, path, skip_accept_encoding=True)
        for k, v in (headers or {}).items():
            conn.putheader(k, v)
        if body is not None:
            conn.putheader("Content-Length", str(len(body)))
        conn.endheaders(body)
        r = conn.getresponse()
        data = r.read()
        return Response(r.status, {k.lower(): v for k, v in r.getheaders()}, data)
    finally:
        conn.close()


def b64json(obj) -> str:
    return base64.b64encode(json.dumps(obj, separators=(",", ":")).encode()).decode()


# --------------------------------------------------------------------------- stack

class Stack:
    def __init__(self, bin_dir: pathlib.Path):
        env = os.environ.get
        self.gw_port = int(env("EVAL_GATEWAY_PORT", "18402"))
        self.admin_port = int(env("EVAL_ADMIN_PORT", "18403"))
        self.origin_port = int(env("EVAL_ORIGIN_PORT", "14000"))
        self.fac_port = int(env("EVAL_FACILITATOR_PORT", "14020"))
        self.bin_dir = bin_dir
        self.tmp = pathlib.Path(tempfile.mkdtemp(prefix="agenttoll-evals-"))
        self.procs: dict[str, subprocess.Popen] = {}
        self.admin_token = secrets.token_hex(16)
        self.payto = ""
        self.buyer_keypair = self.tmp / "buyer.json"

    def bin(self, key: str) -> str:
        return str(self.bin_dir / BINARIES[key])

    def new_keypair(self, path: pathlib.Path) -> str:
        out = subprocess.run([self.bin("buyer"), "--new-solana-keypair", str(path)],
                             capture_output=True, text=True, check=True)
        return out.stdout.strip().splitlines()[-1].strip()

    def write_config(self) -> pathlib.Path:
        cfg = f"""origin: http://127.0.0.1:{self.origin_port}
listen: 127.0.0.1:{self.gw_port}
admin_listen: 127.0.0.1:{self.admin_port}
public_url: http://127.0.0.1:{self.gw_port}
detection: agents-only

networks:
  solana:
    network: "{SOLANA_DEVNET}"
    asset: "{SOLANA_USDC}"
    pay_to: "${{AGENTTOLL_SOLANA_PAYTO}}"
    facilitator: "http://127.0.0.1:{self.fac_port}"   # SIMULATED
  base:
    network: "{BASE_SEPOLIA}"
    asset: "{BASE_USDC}"
    pay_to: "{BASE_PAYTO}"
    facilitator: "http://127.0.0.1:{self.fac_port}"   # SIMULATED

timeouts:
  verify_ms: 5000
  settle_ms: 1000   # short, so the settle-timeout case does not wait the 20 s default

routes:
  - match: "GET /api/quote"
    price_usd: "0.002"
    description: "Live price quote"
  - match: "GET /api/*"
    price_usd: "0.001"
  - match: "GET /blog/*"
    price_usd: "0.001"
  - match: "/*"
    price_usd: "0"

mcp:
  endpoint: /mcp
  advertise_prices: true
  tools:
    search_docs: "0.005"
    generate_report: "0.05"
    broken_tool: "0.005"   # priced here, unknown to the origin: the origin answers with a JSON-RPC error

ledger:
  url: "sqlite://{self.tmp}/ledger.db"
"""
        path = self.tmp / "agenttoll.eval.yaml"
        path.write_text(cfg)
        return path

    def spawn(self, name: str, argv: list[str], env_extra: dict) -> None:
        log = open(self.tmp / f"{name}.log", "wb")
        env = {**os.environ, **env_extra}
        self.procs[name] = subprocess.Popen(argv, stdout=log, stderr=subprocess.STDOUT, env=env,
                                            cwd=str(self.tmp))

    def wait_port(self, name: str, port: int, path: str = "/") -> None:
        for _ in range(150):
            proc = self.procs[name]
            if proc.poll() is not None:
                raise RuntimeError(f"{name} exited early with {proc.returncode}:\n{self.log_tail(name)}")
            try:
                http_request(port, "GET", path, {"User-Agent": "eval-readiness"}, timeout=2)
                return
            except OSError:
                time.sleep(0.2)
        raise RuntimeError(f"{name} did not open port {port}:\n{self.log_tail(name)}")

    def log_tail(self, name: str, n: int = 25) -> str:
        try:
            return "\n".join((self.tmp / f"{name}.log").read_text(errors="replace").splitlines()[-n:])
        except OSError:
            return "(no log)"

    def start(self) -> None:
        for key in BINARIES:
            if not pathlib.Path(self.bin(key)).exists():
                raise RuntimeError(f"missing binary {self.bin(key)} (set EVAL_BIN_DIR or pass --build)")
        payto_path = self.tmp / "payto.json"
        self.payto = self.new_keypair(payto_path)
        self.new_keypair(self.buyer_keypair)
        config = self.write_config()
        self.spawn("origin", [self.bin("origin")], {"ORIGIN_LISTEN": f"127.0.0.1:{self.origin_port}"})
        self.spawn("facilitator", [self.bin("facilitator")],
                   {"MOCK_FACILITATOR_LISTEN": f"127.0.0.1:{self.fac_port}",
                    "MOCK_FACILITATOR_FAULTS": "1", "MOCK_FACILITATOR_SLOW_MS": "3000"})
        self.wait_port("origin", self.origin_port)
        self.wait_port("facilitator", self.fac_port, "/supported")
        self.spawn("gateway", [self.bin("gateway"), "--config", str(config)], {
            "AGENTTOLL_SOLANA_PAYTO": self.payto,
            "AGENTTOLL_ADMIN_TOKEN": self.admin_token,
            "RUST_LOG": "info",
        })
        self.wait_port("gateway", self.gw_port)

    def stop(self, keep: bool = False) -> None:
        for name in ("gateway", "facilitator", "origin"):
            p = self.procs.get(name)
            if p and p.poll() is None:
                p.terminate()
        for p in self.procs.values():
            try:
                p.wait(timeout=5)
            except subprocess.TimeoutExpired:
                p.kill()
        if not keep:
            shutil.rmtree(self.tmp, ignore_errors=True)


# --------------------------------------------------------------------------- run context

class Ctx:
    """Everything a case can see. `vars` feed `$name` references in case files."""

    def __init__(self, stack: Stack, ua: dict):
        self.stack = stack
        self.ua = ua
        self.vars = {
            "payto": stack.payto,
            "solana_network": SOLANA_DEVNET,
            "solana_usdc": SOLANA_USDC,
            "base_network": BASE_SEPOLIA,
            "base_usdc": BASE_USDC,
            "base_payto": BASE_PAYTO,
            "admin_token": stack.admin_token,
        }
        # Money the runner has seen settle (atomic USDC), for the ledger cross-checks.
        self.settled_atomic = 0
        self.settled_count = 0
        self.settled_by_network: dict[str, int] = {}
        self.settled_agents: set[str] = set()
        # Payments the gateway served without a settlement (settle timeout): ledger status unconfirmed.
        self.unconfirmed_atomic = 0
        self.unconfirmed_count = 0
        self.unconfirmed_by_network: dict[str, int] = {}
        self.steps: dict[str, dict] = {}

    # -- plumbing
    def redact(self, text: str) -> str:
        return text.replace(self.stack.admin_token, "***")

    def resolve(self, value):
        if isinstance(value, str) and value.startswith("$") and value[1:] in self.vars:
            return self.vars[value[1:]]
        if isinstance(value, list):
            return [self.resolve(v) for v in value]
        if isinstance(value, dict):
            return {k: self.resolve(v) for k, v in value.items()}
        return value

    def request(self, port: int, method: str, path: str, headers=None, body=None, timeout=20):
        return http_request(port, method, path, headers, body, timeout)

    def gw(self, method, path, **kw):
        return self.request(self.stack.gw_port, method, path, **kw)

    def admin_stats(self, wait_for=None, timeout=4.0) -> dict:
        """GET /admin/stats. `wait_for(stats) -> bool` polls, because unbilled rows are written
        off the request path."""
        deadline = time.time() + timeout
        while True:
            r = self.request(self.stack.admin_port, "GET", "/admin/stats",
                             {"Authorization": f"Bearer {self.stack.admin_token}"})
            if r.status != 200 or r.json is None:
                raise Fail(f"/admin/stats with the right token returned {r.status}")
            if wait_for is None or wait_for(r.json) or time.time() > deadline:
                return r.json
            time.sleep(0.15)

    def build_payment(self, spec: dict, prior: "Response"):
        """(PAYMENT-SIGNATURE header value, payload) built from the challenge in `prior`."""
        return build_payment(self, spec, prior)

    def note_settlement(self, resp: Response) -> None:
        receipt = resp.receipt
        if receipt and receipt.get("success") and str(receipt.get("transaction", "")).startswith("SIMULATED-"):
            amount = int(receipt.get("amount") or 0)
            self.settled_atomic += amount
            self.settled_count += 1
            net = receipt.get("network", "?")
            self.settled_by_network[net] = self.settled_by_network.get(net, 0) + amount


# --------------------------------------------------------------------------- matchers

def pointer(doc, ptr: str):
    """RFC 6901 lookup. Returns (found, value)."""
    if ptr in ("", "/"):
        return True, doc
    cur = doc
    for raw in ptr.lstrip("/").split("/"):
        key = raw.replace("~1", "/").replace("~0", "~")
        if isinstance(cur, list) and key.startswith("@"):
            # "@solana" / "@base": the entry for that rail, wherever it sits in the list
            prefix = RAILS.get(key[1:])
            hit = [e for e in cur if prefix and str(e.get("network", "")).startswith(prefix)]
            if not hit:
                return False, None
            cur = hit[0]
        elif isinstance(cur, list):
            try:
                cur = cur[int(key)]
            except (ValueError, IndexError):
                return False, None
        elif isinstance(cur, dict) and key in cur:
            cur = cur[key]
        else:
            return False, None
    return True, cur


def matches(found: bool, actual, expected, ctx: Ctx) -> str | None:
    """None when it matches, else a short reason."""
    expected = ctx.resolve(expected)
    if isinstance(expected, dict) and len(expected) >= 1 and set(expected) <= {
            "re", "absent", "exists", "in", "ne", "gte", "lte", "contains", "not_contains", "type"}:
        for op, arg in expected.items():
            if op == "absent":
                if found == bool(arg):
                    return "expected value to be absent" if arg else "expected value to be present"
            elif op == "exists":
                if found != bool(arg):
                    return "expected value to exist" if arg else "expected value to be missing"
            elif not found:
                return "value missing"
            elif op == "re" and not re.search(arg, str(actual)):
                return f"{actual!r} does not match /{arg}/"
            elif op == "in" and actual not in arg:
                return f"{actual!r} not in {arg!r}"
            elif op == "ne" and actual == arg:
                return f"value equals {arg!r} but must not"
            elif op == "gte" and not (isinstance(actual, (int, float)) and actual >= arg):
                return f"{actual!r} is not >= {arg}"
            elif op == "lte" and not (isinstance(actual, (int, float)) and actual <= arg):
                return f"{actual!r} is not <= {arg}"
            elif op == "contains" and arg not in str(actual):
                return f"{str(actual)[:80]!r} does not contain {arg!r}"
            elif op == "not_contains" and arg in str(actual):
                return f"value contains {arg!r} but must not"
            elif op == "type" and type(actual).__name__ != arg:
                return f"type {type(actual).__name__} is not {arg}"
        return None
    if not found:
        return "value missing"
    if actual != expected:
        return f"{actual!r} != {expected!r}"
    return None


# --------------------------------------------------------------------------- steps

def build_payment(ctx: Ctx, spec: dict, prior: Response):
    """Builds a PAYMENT-SIGNATURE payload from the challenge a previous step received.
    The signed part is a unique blob: the simulated facilitator checks shape only."""
    if "raw" in spec:
        return spec["raw"], None
    challenge = prior.challenge
    if not challenge:
        raise Fail("pay.from step has no decodable PAYMENT-REQUIRED header")
    which = spec.get("accept", "solana")  # the primary rail unless a case says otherwise
    if isinstance(which, str):  # a rail name, independent of quote order
        which = next((i for i, a in enumerate(challenge["accepts"])
                      if a["network"].startswith(RAILS[which])), None)
        if which is None:
            raise Fail(f"challenge offers no {spec['accept']} rail")
    accepted = copy.deepcopy(challenge["accepts"][which])
    for dotted, value in spec.get("tamper", {}).items():
        target = accepted
        parts = dotted.split(".")
        for p in parts[:-1]:
            target = target.setdefault(p, {})
        target[parts[-1]] = ctx.resolve(value)
    payload = {
        "x402Version": spec.get("version", 2),
        "resource": challenge.get("resource"),
        "accepted": accepted,
        "payload": spec.get("payload", {"transaction": "EVAL-" + uuid.uuid4().hex}),
    }
    for key in spec.get("drop", []):
        payload.pop(key, None)
    return b64json(payload), payload


def run_step(ctx: Ctx, step: dict) -> tuple[str, list[str]]:
    """Runs one request step. Returns (summary line, assertion notes)."""
    req = step["request"]
    headers = dict(req.get("headers", {}))
    agent = req.get("agent")
    if agent:
        headers["User-Agent"] = ctx.ua[agent]
        if agent.startswith("human-"):
            headers.setdefault("Accept-Language", "en-US,en;q=0.9")
            headers.setdefault("Sec-Fetch-Mode", "navigate")
            headers.setdefault("Accept", "text/html,application/xhtml+xml")
    path = req["path"]
    port = ctx.stack.gw_port
    base = req.get("base", "gateway")
    if base == "admin":
        port = ctx.stack.admin_port
    elif base == "facilitator":
        port = ctx.stack.fac_port
    auth = req.get("auth")
    if auth == "bearer":
        headers["Authorization"] = f"Bearer {ctx.stack.admin_token}"
    elif auth == "wrong":
        headers["Authorization"] = "Bearer " + "x" * len(ctx.stack.admin_token)
    elif auth == "empty":
        headers["Authorization"] = "Bearer "
    elif auth == "query":
        path += ("&" if "?" in path else "?") + "token=" + ctx.stack.admin_token

    body = None
    if "json" in req:
        doc = copy.deepcopy(req["json"])
        body_doc = doc
    else:
        doc = body_doc = None
    pay_note = ""
    pay = step.get("pay")
    if pay:
        if "reuse" in pay:
            header_value = ctx.steps[pay["reuse"]]["payment_header"]
            payload = None
        elif "raw" in pay:
            header_value, payload = pay["raw"], None
        else:
            prior = ctx.steps[pay["from"]]["response"]
            header_value, payload = build_payment(ctx, pay, prior)
        transport = pay.get("transport", "header")
        if transport == "header":
            headers["PAYMENT-SIGNATURE"] = header_value
        elif transport == "mcp-meta":
            if body_doc is None:
                raise Fail("mcp-meta transport needs request.json")
            if payload is None:
                payload = json.loads(base64.b64decode(header_value))
            body_doc.setdefault("params", {}).setdefault("_meta", {})["x402/payment"] = payload
        pay_note = f" +payment({transport})"
    if body_doc is not None:
        body = json.dumps(body_doc).encode()
        headers.setdefault("Content-Type", "application/json")
        headers.setdefault("Accept", "application/json, text/event-stream")
    elif "body" in req:
        body = req["body"].encode()

    resp = ctx.request(port, req.get("method", "GET"), path, headers, body)
    ctx.note_settlement(resp)
    record = {"response": resp, "payment_header": headers.get("PAYMENT-SIGNATURE")}
    if step.get("id"):
        ctx.steps[step["id"]] = record

    notes = assert_expect(ctx, resp, step.get("expect", {}))
    shown = ctx.redact(path)
    bits = [f"{req.get('method', 'GET')} {shown}"]
    if agent:
        bits.append(f"[{agent}]")
    bits.append(f"-> {resp.status}")
    if "x-agenttoll-verdict" in resp.headers:
        bits.append(f"verdict={resp.headers['x-agenttoll-verdict']}")
    ch = resp.challenge
    if ch and ch.get("accepts"):
        bits.append(f"quote={ch['accepts'][0].get('amount')}")
    rc = resp.receipt
    if rc:
        bits.append(f"receipt.tx={rc.get('transaction')}")
    return " ".join(bits) + pay_note, notes


def assert_expect(ctx: Ctx, resp: Response, expect: dict) -> list[str]:
    notes = []

    def need(ok_reason: str | None, what: str):
        if ok_reason is not None:
            raise Fail(ctx.redact(f"{what}: {ok_reason}"))
        notes.append(what)

    if "status" in expect:
        want = expect["status"]
        ok = resp.status in want if isinstance(want, list) else resp.status == want
        need(None if ok else f"got {resp.status}, want {want}", "status")
    for name, exp in expect.get("headers", {}).items():
        val = resp.headers.get(name.lower())
        need(matches(val is not None, val, exp, ctx), f"header {name}")
    for src, attr in (("json", "json"), ("challenge", "challenge"), ("receipt", "receipt")):
        for ptr, exp in expect.get(src, {}).items():
            doc = getattr(resp, attr)
            if doc is None:
                need(f"no decodable {src}" if not (isinstance(exp, dict) and exp.get("absent")) else None,
                     f"{src} {ptr}")
                continue
            found, val = pointer(doc, ptr)
            need(matches(found, val, exp, ctx), f"{src} {ptr}")
    if "body_contains" in expect:
        want = ctx.resolve(expect["body_contains"])
        need(None if want in resp.text else f"body lacks {want!r}", "body contains")
    if "body_not_contains" in expect:
        want = ctx.resolve(expect["body_not_contains"])
        need(None if want not in resp.text else "body contains a forbidden string", "body excludes")
    return notes


def run_case(ctx: Ctx, case: dict) -> dict:
    started = time.time()
    evidence: list[str] = []
    status, error = "pass", None
    try:
        for step in case["steps"]:
            if "check" in step:
                fn = getattr(checks, step["check"], None)
                if fn is None:
                    raise Fail(f"unknown check {step['check']!r}")
                result = fn(ctx, **ctx.resolve(step.get("args", {})))
                evidence.append(f"check {step['check']}: {result}")
            else:
                line, notes = run_step(ctx, step)
                evidence.append(line + (f" | ok: {', '.join(notes)}" if notes else ""))
    except Skip as e:
        status, error = "skip", ctx.redact(str(e))
    except Fail as e:
        status, error = "fail", ctx.redact(str(e))
    except Exception as e:  # a crashed case is a failed case, never a skipped one
        status, error = "fail", ctx.redact(f"{type(e).__name__}: {e}")
    return {
        "id": case["id"],
        "group": case.get("group", case["id"].split("-")[0]),
        "promise": case["promise"],
        "status": status,
        "evidence": [ctx.redact(e) for e in evidence] + ([f"{'SKIPPED' if status == 'skip' else 'FAILED'}: {error}"] if error else []),
        "seconds": round(time.time() - started, 3),
    }


# --------------------------------------------------------------------------- main

def load_cases() -> tuple[dict, list[dict]]:
    cases_dir = HERE / "cases"
    ua = json.loads((cases_dir / "vars.json").read_text())["ua"]
    cases: list[dict] = []
    for path in sorted(cases_dir.glob("[0-9]*.json")):
        batch = json.loads(path.read_text())
        for case in batch:
            case["file"] = path.name
        cases.extend(batch)
    ids = [c["id"] for c in cases]
    dupes = {i for i in ids if ids.count(i) > 1}
    if dupes:
        raise SystemExit(f"duplicate case ids: {sorted(dupes)}")
    return ua, cases


def find_bin_dir() -> pathlib.Path:
    candidates = []
    if os.environ.get("EVAL_BIN_DIR"):
        candidates.append(pathlib.Path(os.environ["EVAL_BIN_DIR"]))
    if os.environ.get("CARGO_TARGET_DIR"):
        candidates.append(pathlib.Path(os.environ["CARGO_TARGET_DIR"]) / "release")
    candidates += [ROOT / "target" / "release", ROOT / "target" / "debug"]
    for c in candidates:
        if all((c / name).exists() for name in BINARIES.values()):
            return c
    raise SystemExit("no directory holds all four binaries; set EVAL_BIN_DIR or pass --build\ntried: "
                     + ", ".join(str(c) for c in candidates))


def build() -> None:
    env = {**os.environ, "PATH": f"{pathlib.Path.home()}/.cargo/bin:" + os.environ["PATH"]}
    env.setdefault("CARGO_BUILD_JOBS", "2")
    pkgs = ["agenttoll-gateway", "agenttoll-demo-origin", "agenttoll-buyer", "agenttoll-mock-facilitator"]
    subprocess.run(["cargo", "build", "--release", *sum((["-p", p] for p in pkgs), [])],
                   cwd=ROOT, env=env, check=True)


def git_head() -> str:
    """Short commit, with a -dirty suffix if tracked sources changed.
    evals/results is excluded, because every run rewrites it."""
    try:
        head = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, capture_output=True,
                              text=True, check=True).stdout.strip()
        status = subprocess.run(["git", "status", "--porcelain", "--untracked-files=no", "--", ".",
                                 ":(exclude)evals/results"], cwd=ROOT, capture_output=True,
                                text=True, check=True).stdout.strip()
        return head + ("-dirty" if status else "")
    except (OSError, subprocess.CalledProcessError):
        return "unknown"


def write_results(results: list[dict], meta: dict) -> None:
    out = HERE / "results"
    out.mkdir(exist_ok=True)
    passed = sum(r["status"] == "pass" for r in results)
    skipped = sum(r["status"] == "skip" for r in results)
    failed = sum(r["status"] == "fail" for r in results)
    doc = {**meta, "total": len(results), "passed": passed, "skipped": skipped, "failed": failed,
           "cases": results}
    (out / "latest.json").write_text(json.dumps(doc, indent=2) + "\n")
    lines = [
        "# AgentToll eval results",
        "",
        f"Run: {meta['generated']} | commit {meta['commit']} | binaries {meta['bin_dir']} | {passed}/{len(results)} passed, {skipped} skipped, {failed} failed",
        "",
        "All payments in this run are SIMULATED (mock facilitator, `SIMULATED-` transaction ids). "
        "Nothing went on chain.",
        "",
        "| Case | Promise | Result | Evidence |",
        "|---|---|---|---|",
    ]
    for r in results:
        ev = "<br>".join(e.replace("|", "\\|") for e in r["evidence"])
        lines.append(f"| {r['id']} | {r['promise'].replace('|', '/')} | {r['status'].upper()} | {ev} |")
    (out / "latest.md").write_text("\n".join(lines) + "\n")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", help="run only case ids starting with this prefix (comma separated)")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--build", action="store_true", help="cargo build --release the four binaries first")
    ap.add_argument("--keep", action="store_true", help="keep the temp dir (logs, ledger) after the run")
    args = ap.parse_args()

    ua, cases = load_cases()
    if args.list:
        for c in cases:
            print(f"{c['id']:<10} {c['promise']}")
        print(f"{len(cases)} cases")
        return 0
    if args.only:
        prefixes = tuple(args.only.split(","))
        cases = [c for c in cases if c["id"].startswith(prefixes)]
    if args.build:
        build()
    stack = Stack(find_bin_dir())
    try:
        stack.start()
    except Exception as e:
        print(f"could not start the stack: {e}", file=sys.stderr)
        stack.stop(keep=True)
        print(f"logs kept in {stack.tmp}", file=sys.stderr)
        return 2
    ctx = Ctx(stack, ua)
    results = []
    try:
        for case in cases:
            r = run_case(ctx, case)
            results.append(r)
            print(f"{r['status'].upper():<4}  {r['id']:<9} {r['promise']}")
            if r["status"] != "pass":
                print("      " + r["evidence"][-1])
        discovery = ctx.gw("GET", "/.well-known/agenttoll.json").json or {}
        meta = {
            "generated": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M:%SZ"),
            "commit": git_head(),
            "bin_dir": (str(stack.bin_dir.relative_to(ROOT)) if stack.bin_dir.is_relative_to(ROOT) else str(stack.bin_dir)),
            "gateway_version": discovery.get("agenttoll"),
            "ports": {"gateway": stack.gw_port, "admin": stack.admin_port,
                      "origin": stack.origin_port, "facilitator": stack.fac_port},
            "simulated_only": True,
        }
    finally:
        stack.stop(keep=args.keep)
    if args.only:
        print("--only run: results files not written")
    else:
        write_results(results, meta)
    failed = [r for r in results if r["status"] == "fail"]
    skipped = [r for r in results if r["status"] == "skip"]
    print(f"\n{sum(r['status'] == 'pass' for r in results)}/{len(results)} passed, {len(skipped)} skipped ({', '.join(r['id'] for r in skipped) or 'none'}); results in evals/results/latest.{{json,md}}" if not args.only else "")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
