// Mirrors the gateway admin API (ARCHITECTURE.md 1.2 and 1.6). snake_case on purpose.

export type RevenueEvent = {
  ts: number; // unix ms
  route: string;
  mcp_tool: string | null;
  agent_name: string | null;
  detect_reason: string;
  network: string; // CAIP-2
  asset: string;
  amount_atomic: number; // 6-decimal USDC base units; 2000 = $0.002
  payer: string | null;
  tx_signature: string;
  origin_status: number;
  latency_ms: number;
  simulated: boolean;
  /** settled = confirmed; pending = broadcast, confirming; unconfirmed = /settle timed out after serving. */
  status?: SettlementStatus;
};

export type SettlementStatus = "settled" | "pending" | "unconfirmed";

export function settlementStatus(e: RevenueEvent): SettlementStatus {
  if (e.status === "pending" || e.status === "unconfirmed") return e.status;
  if (e.tx_signature.startsWith("unconfirmed:")) return "unconfirmed";
  return "settled";
}

export function isSimulated(e: RevenueEvent): boolean {
  return e.simulated === true || e.tx_signature.startsWith("SIMULATED-");
}

/**
 * Explorer links only for payments that exist on chain: not simulated (flag or
 * SIMULATED- signature), not unconfirmed (flag or unconfirmed: signature).
 * Pending rows keep their link: the tx is broadcast and the explorer will show it.
 */
export function hasOnChainProof(e: RevenueEvent): boolean {
  return !isSimulated(e) && settlementStatus(e) !== "unconfirmed";
}

export type Totals = {
  revenue_atomic: number;
  payments: number;
  unique_agents: number;
  unbilled_agent_requests: number;
  /** Sum of all simulated payments, any status. Absent on gateways older than the D4 admin API. */
  simulated_atomic?: number;
  /** Sum of non-simulated payments with status "unconfirmed". Absent on older gateways. */
  unconfirmed_atomic?: number;
};

/**
 * USDC that actually landed in payTo accounts: revenue minus simulated minus unconfirmed.
 * null when the gateway does not report the two subtractions; never guess from `recent`.
 */
export function spendableAtomic(t: Totals): number | null {
  if (typeof t.simulated_atomic !== "number" || typeof t.unconfirmed_atomic !== "number") return null;
  return Math.max(0, t.revenue_atomic - t.simulated_atomic - t.unconfirmed_atomic);
}

export type RouteRow = { route: string; revenue_atomic: number; payments: number };
export type AgentRow = { agent: string; revenue_atomic: number; payments: number };
export type NetworkRow = { network: string; revenue_atomic: number; payments: number };
export type UnbilledRow = { agent: string; reason: string; requests: number };

export type Stats = {
  totals: Totals;
  by_route: RouteRow[];
  by_agent: AgentRow[];
  by_network: NetworkRow[];
  unbilled: UnbilledRow[];
  recent: RevenueEvent[];
};

export type StatsError = {
  error: "not_configured" | "gateway_unreachable" | "gateway_error";
  detail: string;
};

export function eventKey(e: RevenueEvent): string {
  return `${e.network}|${e.tx_signature}`;
}

export function isStats(x: unknown): x is Stats {
  if (typeof x !== "object" || x === null) return false;
  const s = x as Record<string, unknown>;
  return (
    typeof s.totals === "object" &&
    s.totals !== null &&
    Array.isArray(s.by_route) &&
    Array.isArray(s.by_agent) &&
    Array.isArray(s.by_network) &&
    Array.isArray(s.unbilled) &&
    Array.isArray(s.recent)
  );
}

export function isRevenueEvent(x: unknown): x is RevenueEvent {
  if (typeof x !== "object" || x === null) return false;
  const e = x as Record<string, unknown>;
  return (
    typeof e.ts === "number" &&
    typeof e.route === "string" &&
    typeof e.network === "string" &&
    typeof e.amount_atomic === "number" &&
    typeof e.tx_signature === "string"
  );
}
