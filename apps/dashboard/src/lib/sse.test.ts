import assert from "node:assert/strict";
import { test } from "node:test";
import { SSE_HEADERS, proxySse } from "./sse.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function readUntil(res: Response, done: (text: string) => boolean, ms = 2000): Promise<string> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let text = "";
  const deadline = Date.now() + ms;
  while (!done(text)) {
    const left = deadline - Date.now();
    if (left <= 0) throw new Error(`timed out, got ${JSON.stringify(text)}`);
    const r = await Promise.race([reader.read(), sleep(left).then(() => null)]);
    if (!r || r.done) break;
    text += dec.decode(r.value);
  }
  await reader.cancel();
  return text;
}

test("sends a comment frame and keepalives before a slow upstream answers", async () => {
  let opened = false;
  const res = proxySse(
    async () => {
      await sleep(400);
      opened = true;
      return new Response("event: revenue\ndata: {}\n\n");
    },
    { heartbeatMs: 30 },
  );
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-accel-buffering"), "no");
  assert.equal(res.headers.get("cache-control"), "no-cache, no-transform");
  const early = await readUntil(res, (t) => t.split(": waiting").length > 2);
  assert.ok(early.startsWith(": connected\n\n"), early);
  assert.equal(opened, false, "first frames must not wait for the upstream");
});

test("passes upstream bytes through untouched after connecting", async () => {
  const body = 'event: revenue\ndata: {"a":1}\n\n';
  const res = proxySse(async () => new Response(body), { heartbeatMs: 1000 });
  const text = await readUntil(res, (t) => t.includes("event: revenue"));
  assert.equal(text, `: connected\n\n${body}`);
});

test("upstream failure becomes an error frame without leaking the admin url", async () => {
  const res = proxySse(async () => Promise.reject(new Error("connect ECONNREFUSED http://127.0.0.1:8403/admin/events")), {
    scrub: (m) => m.split("http://127.0.0.1:8403").join("<admin url>"),
  });
  const text = await readUntil(res, () => false);
  assert.match(text, /event: error/);
  assert.match(text, /gateway_unreachable/);
  assert.doesNotMatch(text, /127\.0\.0\.1/);
  assert.match(text, /retry: 5000/);
});

test("non-200 upstream becomes a gateway_error frame", async () => {
  const res = proxySse(async () => new Response("no", { status: 401 }));
  const text = await readUntil(res, () => false);
  assert.match(text, /Gateway answered 401/);
});

test("browser abort cancels the upstream request", async () => {
  const ac = new AbortController();
  let upstreamAborted = false;
  const res = proxySse(
    (signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          upstreamAborted = true;
          reject(new Error("aborted"));
        });
      }),
    { signal: ac.signal, heartbeatMs: 1000 },
  );
  const reader = res.body!.getReader();
  await reader.read();
  await reader.cancel();
  await sleep(20);
  assert.equal(upstreamAborted, true);
});

test("SSE_HEADERS content type", () => {
  assert.match(SSE_HEADERS["Content-Type"], /text\/event-stream/);
});
