import { atomicToUsd, compactInt, networkInfo } from "@/lib/format";
import type { NetworkRow, SettlementStatus } from "@/lib/types";

const FAMILY_COLOR: Record<string, string> = {
  solana: "var(--accent)",
  base: "var(--base)",
  other: "var(--other)",
};

export type StatusCounts = Record<SettlementStatus, number>;

/** Two-segment (or more) share bar with a labeled legend: identity by label plus color, never color alone. */
export function NetworkSplit({ rows, status }: { rows: NetworkRow[]; status: StatusCounts }) {
  if (rows.length === 0) return <p className="text-sm text-ink-3 py-6 text-center">No settlements yet.</p>;
  const total = Math.max(1, rows.reduce((s, r) => s + r.revenue_atomic, 0));

  return (
    <div>
      <div className="flex h-3 w-full gap-0.5 rounded-full overflow-hidden" aria-hidden>
        {rows.map((r) => (
          <div
            key={r.network}
            className="h-full first:rounded-l-full last:rounded-r-full transition-[flex-basis] duration-500"
            style={{ flexBasis: `${(r.revenue_atomic / total) * 100}%`, background: FAMILY_COLOR[networkInfo(r.network).family] }}
          />
        ))}
      </div>
      <ul className="mt-4 flex flex-col gap-2.5">
        {rows.map((r) => {
          const info = networkInfo(r.network);
          const pct = Math.round((r.revenue_atomic / total) * 100);
          return (
            <li key={r.network} className="flex items-center justify-between gap-3 text-sm">
              <span className="flex items-center gap-2 min-w-0">
                <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: FAMILY_COLOR[info.family] }} aria-hidden />
                <span className="truncate">{info.label}</span>
                {info.testnet && <span className="text-[11px] text-ink-3">testnet</span>}
              </span>
              <span className="num shrink-0">
                {atomicToUsd(r.revenue_atomic)}
                <span className="text-ink-3 ml-2 text-xs">
                  {pct}% · {compactInt(r.payments)}×
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      <div className="mt-5 border-t border-line pt-4">
        <div className="label">Settlement health</div>
        <dl className="mt-2 grid grid-cols-3 gap-2 text-sm">
          <HealthCell label="Settled" value={status.settled} tone="text-good" />
          <HealthCell label="Pending" value={status.pending} tone="text-ink-2" />
          <HealthCell label="Unconfirmed" value={status.unconfirmed} tone={status.unconfirmed > 0 ? "text-danger" : "text-ink-2"} />
        </dl>
        <p className="mt-2 text-xs text-ink-3 leading-snug">Counted over the recent settlements shown below. Totals include every status.</p>
      </div>
    </div>
  );
}

function HealthCell({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface-2/60 px-3 py-2">
      <dt className="text-[11px] text-ink-3">{label}</dt>
      <dd className={`num text-lg font-semibold leading-tight ${tone}`}>{compactInt(value)}</dd>
    </div>
  );
}
