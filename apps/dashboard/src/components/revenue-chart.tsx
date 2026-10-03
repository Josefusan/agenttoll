"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { atomicToUsd } from "@/lib/format";
import type { TimelinePoint } from "@/lib/merge";

export function RevenueChart({ points }: { points: TimelinePoint[] }) {
  if (points.length < 2) {
    return (
      <div className="h-56 flex items-center justify-center text-sm text-ink-3">
        The curve starts after the second settlement.
      </div>
    );
  }
  const span = points[points.length - 1].t - points[0].t;
  const fmtTick = (t: number) =>
    span > 36 * 3600_000
      ? new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" })
      : new Date(t).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="h-56 -mx-2">
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 600, height: 224 }}>
        <AreaChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="rev-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.32} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--line)" />
          <XAxis
            dataKey="t"
            type="number"
            domain={["dataMin", "dataMax"]}
            scale="time"
            tickFormatter={fmtTick}
            tick={{ fill: "var(--ink-3)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            minTickGap={48}
          />
          <YAxis
            dataKey="cumulative_atomic"
            tickFormatter={(v: number) => atomicToUsd(v)}
            tick={{ fill: "var(--ink-3)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={64}
            domain={[0, "auto"]}
          />
          <Tooltip
            cursor={{ stroke: "var(--line-strong)", strokeWidth: 1 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as TimelinePoint;
              return (
                <div className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs shadow-lg">
                  <div className="text-ink-3">{new Date(p.t).toLocaleString("en-US")}</div>
                  <div className="num mt-1 text-ink font-medium">{atomicToUsd(p.cumulative_atomic)} to date</div>
                  {p.payments > 0 && (
                    <div className="num text-ink-2">
                      +{atomicToUsd(p.bucket_atomic)} · {p.payments} payment{p.payments === 1 ? "" : "s"}
                    </div>
                  )}
                </div>
              );
            }}
          />
          <Area
            type="stepAfter"
            dataKey="cumulative_atomic"
            stroke="var(--accent)"
            strokeWidth={2}
            fill="url(#rev-fill)"
            isAnimationActive={false}
            activeDot={{ r: 4, fill: "var(--accent)", stroke: "var(--bg)", strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
