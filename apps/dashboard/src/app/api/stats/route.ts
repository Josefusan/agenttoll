import { NextResponse } from "next/server";
import { authHeaders, gatewayConfig } from "@/lib/gateway";
import { isStats, type StatsError } from "@/lib/types";

export const dynamic = "force-dynamic";

function fail(status: number, body: StatsError) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET() {
  const cfg = gatewayConfig();
  if (!cfg) {
    return fail(503, {
      error: "not_configured",
      detail: "Set AGENTTOLL_ADMIN_URL and AGENTTOLL_ADMIN_TOKEN in apps/dashboard/.env.local.",
    });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${cfg.url}/admin/stats`, {
      headers: authHeaders(cfg, { Accept: "application/json" }),
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
  } catch (err) {
    return fail(502, {
      error: "gateway_unreachable",
      detail: `Could not reach ${cfg.url}: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  if (!upstream.ok) {
    return fail(502, {
      error: "gateway_error",
      detail: `Gateway answered ${upstream.status} ${upstream.statusText}`,
    });
  }

  const body: unknown = await upstream.json();
  if (!isStats(body)) {
    return fail(502, { error: "gateway_error", detail: "Gateway stats did not match the admin API contract." });
  }
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
