import { agentLabel } from "./format";
import { eventKey, type RevenueEvent, type Stats } from "./types";

const RECENT_CAP = 200;

/** Fold a live SSE event into the last snapshot. Idempotent on (network, tx_signature). */
export function mergeEvent(stats: Stats, ev: RevenueEvent): Stats {
  const key = eventKey(ev);
  if (stats.recent.some((r) => eventKey(r) === key)) return stats;

  const agent = agentLabel(ev.agent_name);
  const agentSeen = stats.by_agent.some((a) => a.agent === agent);

  return {
    totals: {
      ...stats.totals,
      revenue_atomic: stats.totals.revenue_atomic + ev.amount_atomic,
      payments: stats.totals.payments + 1,
      unique_agents: stats.totals.unique_agents + (agentSeen ? 0 : 1),
    },
    by_route: upsert(stats.by_route, "route", ev.route, ev.amount_atomic),
    by_agent: upsert(stats.by_agent, "agent", agent, ev.amount_atomic),
    by_network: upsert(stats.by_network, "network", ev.network, ev.amount_atomic),
    unbilled: stats.unbilled,
    recent: [ev, ...stats.recent].slice(0, RECENT_CAP),
  };
}

type Row<K extends string> = { [P in K]: string } & { revenue_atomic: number; payments: number };

function upsert<K extends string>(rows: Row<K>[], key: K, value: string, amount: number): Row<K>[] {
  const idx = rows.findIndex((r) => r[key] === value);
  if (idx === -1) {
    const fresh = { [key]: value, revenue_atomic: amount, payments: 1 } as Row<K>;
    return sortDesc([...rows, fresh]);
  }
  const next = rows.slice();
  const cur = next[idx];
  next[idx] = { ...cur, revenue_atomic: cur.revenue_atomic + amount, payments: cur.payments + 1 };
  return sortDesc(next);
}

function sortDesc<T extends { revenue_atomic: number }>(rows: T[]): T[] {
  return rows.sort((a, b) => b.revenue_atomic - a.revenue_atomic);
}

export type TimelinePoint = { t: number; cumulative_atomic: number; bucket_atomic: number; payments: number };

/**
 * Cumulative revenue curve ending at the headline total. Only `recent` is known
 * event-by-event, so the curve starts at (total - sum(recent)) and climbs from there.
 */
export function timeline(stats: Stats, now: number): TimelinePoint[] {
  const events = stats.recent.slice().sort((a, b) => a.ts - b.ts);
  if (events.length === 0) return [];

  const first = events[0].ts;
  const span = Math.max(now - first, 60_000);
  const bucketMs = pickBucket(span);
  const start = Math.floor(first / bucketMs) * bucketMs;
  const end = Math.floor(now / bucketMs) * bucketMs;
  const buckets = Math.min(240, Math.floor((end - start) / bucketMs) + 1);

  const recentSum = events.reduce((s, e) => s + e.amount_atomic, 0);
  let running = Math.max(0, stats.totals.revenue_atomic - recentSum);

  const points: TimelinePoint[] = [];
  let i = 0;
  for (let b = 0; b < buckets; b++) {
    const t = start + b * bucketMs;
    let bucket = 0;
    let n = 0;
    while (i < events.length && events[i].ts < t + bucketMs) {
      bucket += events[i].amount_atomic;
      n += 1;
      i += 1;
    }
    running += bucket;
    points.push({ t, cumulative_atomic: running, bucket_atomic: bucket, payments: n });
  }
  return points;
}

function pickBucket(spanMs: number): number {
  const minute = 60_000;
  if (spanMs <= 30 * minute) return 15_000;
  if (spanMs <= 3 * 60 * minute) return minute;
  if (spanMs <= 48 * 60 * minute) return 15 * minute;
  if (spanMs <= 14 * 24 * 60 * minute) return 60 * minute;
  return 24 * 60 * minute;
}

/** Median paid price across routes, used to size the unbilled opportunity. */
export function medianPriceAtomic(stats: Stats): number | null {
  const prices = stats.by_route
    .filter((r) => r.payments > 0)
    .map((r) => Math.round(r.revenue_atomic / r.payments))
    .sort((a, b) => a - b);
  if (prices.length === 0) return null;
  const mid = Math.floor(prices.length / 2);
  return prices.length % 2 ? prices[mid] : Math.round((prices[mid - 1] + prices[mid]) / 2);
}
