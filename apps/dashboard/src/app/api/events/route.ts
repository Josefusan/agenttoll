import { authHeaders, gatewayConfig } from "@/lib/gateway";
import { SSE_HEADERS, proxySse, sseError } from "@/lib/sse";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Streams the gateway's /admin/events SSE feed to the browser, adding the bearer
 * token server-side. The browser gets a comment frame immediately (see lib/sse.ts), then
 * the gateway's bytes pass through untouched.
 */
export async function GET(request: Request) {
  const cfg = gatewayConfig();
  if (!cfg) {
    return new Response(sseError("not_configured", "AGENTTOLL_ADMIN_URL / AGENTTOLL_ADMIN_TOKEN are not set."), {
      status: 503,
      headers: SSE_HEADERS,
    });
  }

  return proxySse(
    (signal) =>
      fetch(`${cfg.url}/admin/events`, {
        headers: authHeaders(cfg, { Accept: "text/event-stream" }),
        cache: "no-store",
        signal,
      }),
    { signal: request.signal, scrub: (msg) => msg.split(cfg.url).join("<admin url>") },
  );
}
