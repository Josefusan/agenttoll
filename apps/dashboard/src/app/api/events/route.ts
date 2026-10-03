import { authHeaders, gatewayConfig } from "@/lib/gateway";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

/**
 * Streams the gateway's /admin/events SSE feed to the browser, adding the bearer
 * token server-side. Bytes pass through untouched, so `event: revenue` frames and
 * heartbeat comments arrive exactly as the gateway emitted them.
 */
export async function GET(request: Request) {
  const cfg = gatewayConfig();
  if (!cfg) {
    return new Response(sseError("not_configured", "AGENTTOLL_ADMIN_URL / AGENTTOLL_ADMIN_TOKEN are not set."), {
      status: 503,
      headers: SSE_HEADERS,
    });
  }

  const controller = new AbortController();
  request.signal.addEventListener("abort", () => controller.abort());

  let upstream: Response;
  try {
    upstream = await fetch(`${cfg.url}/admin/events`, {
      headers: authHeaders(cfg, { Accept: "text/event-stream" }),
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (err) {
    return new Response(sseError("gateway_unreachable", scrub(err, cfg.url)), {
      status: 502,
      headers: SSE_HEADERS,
    });
  }

  if (!upstream.ok || !upstream.body) {
    await upstream.body?.cancel();
    return new Response(sseError("gateway_error", `Gateway answered ${upstream.status}`), {
      status: 502,
      headers: SSE_HEADERS,
    });
  }

  return new Response(upstream.body, { status: 200, headers: SSE_HEADERS });
}

/** Error text for the browser: never includes the admin URL. */
function scrub(err: unknown, adminUrl: string): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.split(adminUrl).join("<admin url>");
}

function sseError(code: string, detail: string): string {
  return `event: error\ndata: ${JSON.stringify({ error: code, detail })}\n\n`;
}
