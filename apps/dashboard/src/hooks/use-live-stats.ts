"use client";

import { useCallback, useEffect, useState } from "react";
import { mergeEvent } from "@/lib/merge";
import { eventKey, isRevenueEvent, isStats, type Stats, type StatsError } from "@/lib/types";

export type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; stats: Stats }
  | { kind: "error"; error: StatsError };

export type FeedState = "connecting" | "live" | "reconnecting" | "offline";

// Some proxies (Cloudflare quick tunnels) buffer SSE, so the feed may stay silent behind them;
// a short reconcile keeps the dashboard current anyway.
const RECONCILE_MS = 5_000;
const FRESH_MS = 2_000;
const BACKOFF_START_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;

export function useLiveStats() {
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [feed, setFeed] = useState<FeedState>("connecting");
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/stats", { cache: "no-store" });
      const body: unknown = await res.json();
      if (res.ok && isStats(body)) {
        setLoad({ kind: "ready", stats: body });
      } else {
        const err = body as Partial<StatsError>;
        setLoad({
          kind: "error",
          error: {
            error: err.error ?? "gateway_error",
            detail: err.detail ?? `Unexpected ${res.status} from /api/stats`,
          },
        });
      }
    } catch (e) {
      setLoad({
        kind: "error",
        error: { error: "gateway_unreachable", detail: e instanceof Error ? e.message : String(e) },
      });
    }
  }, []);

  useEffect(() => {
    const kick = setTimeout(() => void refresh(), 0);
    const t = setInterval(() => void refresh(), RECONCILE_MS);
    return () => {
      clearTimeout(kick);
      clearInterval(t);
    };
  }, [refresh]);

  // EventSource retries on its own while the server is up, but a closed socket
  // (gateway restart, 502 from the proxy) ends it for good. Reopen with backoff,
  // and re-fetch stats on each reopen so nothing missed during the gap is lost.
  useEffect(() => {
    let es: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let backoff = BACKOFF_START_MS;
    let stopped = false;

    const onRevenue = (msg: MessageEvent<string>) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(msg.data);
      } catch {
        return;
      }
      if (!isRevenueEvent(parsed)) return;
      const key = eventKey(parsed);
      setLastEventAt(Date.now());
      setLoad((prev) => (prev.kind === "ready" ? { kind: "ready", stats: mergeEvent(prev.stats, parsed) } : prev));
      setFresh((prev) => new Set(prev).add(key));
      setTimeout(() => {
        setFresh((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }, FRESH_MS);
    };

    const open = (first: boolean) => {
      if (stopped) return;
      es = new EventSource("/api/events");
      es.onopen = () => {
        backoff = BACKOFF_START_MS;
        setFeed("live");
        if (!first) void refresh();
      };
      es.onerror = () => {
        if (!es) return;
        if (es.readyState === EventSource.CLOSED) {
          es.close();
          es = null;
          setFeed(backoff >= BACKOFF_MAX_MS ? "offline" : "reconnecting");
          timer = setTimeout(() => open(false), backoff);
          backoff = Math.min(BACKOFF_MAX_MS, backoff * 2);
        } else {
          setFeed("reconnecting");
        }
      };
      es.addEventListener("revenue", onRevenue);
    };

    open(true);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      es?.close();
    };
  }, [refresh]);

  return { load, feed, fresh, lastEventAt, refresh };
}
