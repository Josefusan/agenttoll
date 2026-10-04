// Server-side only: imported by route handlers, never by client components.

export type GatewayConfig = { url: string; token: string };

export function gatewayConfig(): GatewayConfig | null {
  const url = process.env.AGENTTOLL_ADMIN_URL?.replace(/\/+$/, "");
  const token = process.env.AGENTTOLL_ADMIN_TOKEN;
  if (!url || !token) return null;
  return { url, token };
}

export function authHeaders(cfg: GatewayConfig, extra: Record<string, string> = {}): HeadersInit {
  return { Authorization: `Bearer ${cfg.token}`, ...extra };
}
