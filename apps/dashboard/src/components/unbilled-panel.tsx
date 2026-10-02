import { atomicToUsd, compactInt } from "@/lib/format";
import type { UnbilledRow } from "@/lib/types";

const DEFAULT_PRICE_ATOMIC = 2_000; // $0.002, the README example price

export function UnbilledPanel({ rows, total, medianPriceAtomic }: { rows: UnbilledRow[]; total: number; medianPriceAtomic: number | null }) {
  const price = medianPriceAtomic ?? DEFAULT_PRICE_ATOMIC;
  const priceNote = medianPriceAtomic ? "at your median route price" : "at $0.002 a request";

  if (rows.length === 0 && total === 0) {
    return <p className="text-sm text-ink-3 py-6 text-center">Every agent request is being billed.</p>;
  }

  const sorted = rows.slice().sort((a, b) => b.requests - a.requests);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-2 leading-snug">
        <span className="num font-semibold text-ink">{compactInt(total)}</span> agent requests reached routes with no price.
        That is about <span className="num font-semibold text-ink">{atomicToUsd(total * price)}</span> left on the table {priceNote}.
      </p>
      <ul className="flex flex-col gap-3">
        {sorted.slice(0, 5).map((r) => (
          <li key={`${r.agent}|${r.reason}`} className="rounded-lg border border-line bg-surface-2/60 px-3 py-2.5">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium truncate">{r.agent}</span>
              <span className="num text-ink-2 shrink-0">{compactInt(r.requests)} unbilled</span>
            </div>
            <p className="mt-1 text-xs text-ink-3 leading-snug">
              Price the routes {r.agent} reads to earn about {atomicToUsd(r.requests * price)} from these {compactInt(r.requests)}{" "}
              requests. Detected via <span className="font-mono">{r.reason}</span>.
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
