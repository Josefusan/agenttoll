"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { mergeEvent } from "@/lib/merge";
import { eventKey, isRevenueEvent, isStats, type Stats, type StatsError } from "@/lib/types";

export type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; stats: Stats }
  | { kind: "error"; error: StatsError };

export type FeedState = "connecting" | "live" | "offline";

const RECONCILE_MS = 30_000;
const FRESH_MS = 2_000;

export function useLiveStats() {
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [feed, setFeed] = useState<FeedState>("connecting");
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);
  const pending = useRef<Set<string>>(new Set());

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

  useEffect(() => {
    const es = new EventSource("/api/events");
    es.onopen = () => setFeed("live");
    es.onerror = () => setFeed(es.readyState === EventSource.CLOSED ? "offline" : "connecting");
    es.addEventListener("revenue", (msg: MessageEvent<string>) => {
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
      pending.current.add(key);
      setTimeout(() => {
        pending.current.delete(key);
        setFresh((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }, FRESH_MS);
    });
    return () => es.close();
  }, []);

  return { load, feed, fresh, lastEventAt, refresh };
}
