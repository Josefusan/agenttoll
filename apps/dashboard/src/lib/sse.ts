// Server-side SSE proxy helper. No imports on purpose, so node --test can load it directly.

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

export const HEARTBEAT_MS = 5_000;

type ProxyOptions = {
  /** Aborts the upstream request when the browser goes away. */
  signal?: AbortSignal;
  /** Gap between keepalive comments while the upstream has not answered yet. */
  heartbeatMs?: number;
  /** Cleans an upstream error message before the browser sees it. */
  scrub?: (msg: string) => string;
};

/**
 * Answers the browser at once with an SSE comment frame, then connects upstream and pipes its
 * bytes through. Awaiting the upstream before responding made the first byte depend on the
 * gateway and the tunnel (20 to 45 s on a cold quick tunnel), so the dashboard sat on
 * "Connecting to gateway". Comment frames keep flowing until the upstream answers. A failure
 * after the stream has started is sent as an `event: error` frame, then the stream ends and
 * the browser retries after `retry:` ms.
 */
export function proxySse(open: (signal: AbortSignal) => Promise<Response>, opts: ProxyOptions = {}): Response {
  const enc = new TextEncoder();
  const abort = new AbortController();
  opts.signal?.addEventListener("abort", () => abort.abort());
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      const send = (chunk: string | Uint8Array) => {
        if (closed) return;
        try {
          ctrl.enqueue(typeof chunk === "string" ? enc.encode(chunk) : chunk);
        } catch {
          closed = true;
        }
      };
      const end = () => {
        if (closed) return;
        closed = true;
        try {
          ctrl.close();
        } catch {
          // already closed by the consumer
        }
      };
      const fail = (code: string, detail: string) => {
        send(`retry: 5000\n${sseError(code, detail)}`);
        end();
      };

      send(": connected\n\n");
      const beat = setInterval(() => send(": waiting for gateway\n\n"), opts.heartbeatMs ?? HEARTBEAT_MS);

      void (async () => {
        let upstream: Response;
        try {
          upstream = await open(abort.signal);
        } catch (err) {
          clearInterval(beat);
          const msg = err instanceof Error ? err.message : String(err);
          fail("gateway_unreachable", opts.scrub ? opts.scrub(msg) : msg);
          return;
        }
        clearInterval(beat);
        if (!upstream.ok || !upstream.body) {
          await upstream.body?.cancel().catch(() => {});
          fail("gateway_error", `Gateway answered ${upstream.status}`);
          return;
        }
        const reader = upstream.body.getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (closed) {
              await reader.cancel().catch(() => {});
              return;
            }
            send(value);
          }
          end();
        } catch {
          end();
        }
      })();
    },
    cancel() {
      closed = true;
      abort.abort();
    },
  });

  return new Response(stream, { status: 200, headers: SSE_HEADERS });
}

export function sseError(code: string, detail: string): string {
  return `event: error\ndata: ${JSON.stringify({ error: code, detail })}\n\n`;
}
