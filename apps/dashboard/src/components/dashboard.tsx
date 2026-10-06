"use client";

import { useEffect, useMemo, useState } from "react";
import { useLiveStats } from "@/hooks/use-live-stats";
import { agentLabel, atomicToUsd, compactInt } from "@/lib/format";
import { medianPriceAtomic, timeline } from "@/lib/merge";
import { settlementsSubtitle } from "@/lib/copy";
import { isSimulated, settlementStatus } from "@/lib/types";
import { Breakdown } from "./breakdown";
import { Badge, Card } from "./card";
import { CashOut } from "./cash-out";
import { DemoBanner } from "./demo-banner";
import { EmptyState, ErrorState } from "./empty-state";
import { Header } from "./header";
import { Kpi } from "./kpi";
import { LiveFeed } from "./live-feed";
import { NetworkSplit } from "./network-split";
import { RevenueChart } from "./revenue-chart";
import { UnbilledPanel } from "./unbilled-panel";

export function Dashboard({ payoutsUrl, gatewayUrl }: { payoutsUrl: string; gatewayUrl: string }) {
  const { load, feed, fresh, lastEventAt } = useLiveStats();
  const now = useNow(10_000, lastEventAt);

  const stats = load.kind === "ready" ? load.stats : null;
  const points = useMemo(() => (stats ? timeline(stats, now) : []), [stats, now]);
  const median = useMemo(() => (stats ? medianPriceAtomic(stats) : null), [stats]);
  const statusCounts = useMemo(() => {
    const counts = { settled: 0, pending: 0, unconfirmed: 0 };
    for (const e of stats?.recent ?? []) counts[settlementStatus(e)] += 1;
    return counts;
  }, [stats]);
  // Count of simulated rows in view only; money subtractions come from totals, never from `recent`.
  const simulatedInView = useMemo(() => (stats ? stats.recent.filter(isSimulated).length : 0), [stats]);
  const simulatedAtomic = stats?.totals.simulated_atomic ?? 0;

  return (
    <main className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 pb-12">
      <DemoBanner />
      <h1 className="sr-only">AgentToll revenue dashboard</h1>
      <Header feed={feed} lastEventAt={lastEventAt} now={now} />

      {load.kind === "loading" && <Skeleton />}
      {load.kind === "error" && <ErrorState error={load.error} />}

      {stats && stats.totals.payments === 0 && (
        <div className="flex flex-col gap-4">
          <EmptyState gatewayUrl={gatewayUrl} />
          {stats.totals.unbilled_agent_requests > 0 && (
            <Card title="Agent traffic you are not billing yet" subtitle="Agents already read your site. These requests hit routes without a price.">
              <UnbilledPanel rows={stats.unbilled} total={stats.totals.unbilled_agent_requests} medianPriceAtomic={median} />
            </Card>
          )}
        </div>
      )}

      {stats && stats.totals.payments > 0 && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Kpi
              label="Revenue from agents"
              value={atomicToUsd(stats.totals.revenue_atomic)}
              hero
              caveat={simulatedAtomic > 0 ? `Includes ${atomicToUsd(simulatedAtomic)} simulated` : undefined}
              hint="USDC, all networks, all time"
            />
            <Kpi label="Paid requests" value={compactInt(stats.totals.payments)} hint="Each one a 402 that got paid" />
            <Kpi label="Unique agents" value={compactInt(stats.totals.unique_agents)} hint="By detected agent name" />
            <Kpi
              label="Unbilled agent requests"
              value={compactInt(stats.totals.unbilled_agent_requests)}
              muted
              hint={stats.totals.unbilled_agent_requests > 0 ? "Revenue waiting for a price" : "Everything agents touch is priced"}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card
              className="lg:col-span-2"
              title="Revenue over time"
              subtitle={`Cumulative USDC. Curve covers the last ${compactInt(stats.recent.length)} settlements.`}
            >
              <RevenueChart points={points} />
            </Card>
            <Card title="By network" subtitle="Where agents chose to pay">
              <NetworkSplit rows={stats.by_network} status={statusCounts} />
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card title="By route" subtitle="What agents pay for">
              <Breakdown
                rows={stats.by_route.map((r) => ({ label: r.route, revenue_atomic: r.revenue_atomic, payments: r.payments, mono: true }))}
                emptyText="No priced routes have been paid yet."
              />
            </Card>
            <Card title="By agent" subtitle="Who is paying">
              <Breakdown
                rows={stats.by_agent.map((r) => ({ label: agentLabel(r.agent), revenue_atomic: r.revenue_atomic, payments: r.payments }))}
                emptyText="No agent has paid yet."
              />
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card
              className="lg:col-span-2"
              title="Live settlements"
              subtitle={settlementsSubtitle(simulatedInView, stats.recent.length)}
              action={
                simulatedInView > 0 ? (
                  <Badge tone="warn" title="Rows in this list that went through the local simulated facilitator. No on-chain transaction exists for them.">
                    {compactInt(simulatedInView)} of {compactInt(stats.recent.length)} simulated
                  </Badge>
                ) : undefined
              }
            >
              <LiveFeed events={stats.recent} fresh={fresh} now={now} />
            </Card>
            <div className="flex flex-col gap-4">
              <Card title="Agent traffic you are not billing yet" subtitle="Requests that reached routes without a price">
                <UnbilledPanel rows={stats.unbilled} total={stats.totals.unbilled_agent_requests} medianPriceAtomic={median} />
              </Card>
              <Card title="Cash out">
                <CashOut totals={stats.totals} payoutsUrl={payoutsUrl} />
              </Card>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

/** A clock that ticks slowly for "time ago" labels and jumps forward on each live event. */
function useNow(intervalMs: number, bump: number | null): number {
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return Math.max(tick, bump ?? 0);
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy aria-label="Loading revenue">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card h-[108px] animate-pulse" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card h-72 lg:col-span-2 animate-pulse" />
        <div className="card h-72 animate-pulse" />
      </div>
    </div>
  );
}
