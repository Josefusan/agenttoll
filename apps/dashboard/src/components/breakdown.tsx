import { atomicToUsd, compactInt } from "@/lib/format";

export type BreakdownRow = { label: string; revenue_atomic: number; payments: number; mono?: boolean };

/** Single-hue horizontal bars: identity is carried by the label, magnitude by length. */
export function Breakdown({ rows, emptyText, max = 6 }: { rows: BreakdownRow[]; emptyText: string; max?: number }) {
  if (rows.length === 0) return <p className="text-sm text-ink-3 py-6 text-center">{emptyText}</p>;

  const shown = rows.slice(0, max);
  const rest = rows.slice(max);
  if (rest.length > 0) {
    shown.push({
      label: `Other (${rest.length})`,
      revenue_atomic: rest.reduce((s, r) => s + r.revenue_atomic, 0),
      payments: rest.reduce((s, r) => s + r.payments, 0),
    });
  }
  const top = Math.max(1, ...shown.map((r) => r.revenue_atomic));

  return (
    <ul className="flex flex-col gap-3">
      {shown.map((r) => (
        <li key={r.label} className="min-w-0">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className={`truncate ${r.mono ? "font-mono text-[13px]" : ""}`}>{r.label}</span>
            <span className="num shrink-0 text-ink">
              {atomicToUsd(r.revenue_atomic)}
              <span className="text-ink-3 ml-2 text-xs">{compactInt(r.payments)}×</span>
            </span>
          </div>
          <div className="mt-1.5 h-1.5 w-full rounded-full bg-surface-2 overflow-hidden" aria-hidden>
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-500"
              style={{ width: `${Math.max(2, (r.revenue_atomic / top) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
