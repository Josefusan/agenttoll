import { atomicToUsd } from "@/lib/format";
import { spendableAtomic, type Totals } from "@/lib/types";

export function CashOut({ totals, payoutsUrl }: { totals: Totals; payoutsUrl: string }) {
  const spendable = spendableAtomic(totals);
  const simulated = totals.simulated_atomic ?? 0;
  const unconfirmed = totals.unconfirmed_atomic ?? 0;
  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="label">Spendable USDC</div>
        {spendable === null ? (
          <>
            <div className="mt-1 text-lg font-medium text-ink-2">Unavailable</div>
            <p className="mt-1 text-xs text-ink-3 leading-snug">
              This gateway is too old to report simulated and unconfirmed totals, so the spendable amount cannot be shown. Upgrade the
              gateway.
            </p>
          </>
        ) : (
          <>
            <div className="num mt-1 text-2xl font-semibold tracking-tight">{atomicToUsd(spendable)}</div>
            {(simulated > 0 || unconfirmed > 0) && (
              <p className="mt-1 text-xs text-ink-3 leading-snug">
                {atomicToUsd(totals.revenue_atomic)} total
                {simulated > 0 && <> minus {atomicToUsd(simulated)} simulated (never touched a chain)</>}
                {unconfirmed > 0 && <> minus {atomicToUsd(unconfirmed)} unconfirmed (settle timed out)</>}.
              </p>
            )}
          </>
        )}
      </div>
      <p className="text-sm text-ink-2 leading-snug">
        Earnings settle straight into the <span className="font-mono text-[12.5px]">payTo</span> accounts in your price file. Nothing to
        withdraw, nothing to invoice.
      </p>
      <a
        href={payoutsUrl}
        target="_blank"
        rel="noreferrer noopener"
        className="inline-flex w-fit items-center gap-2 rounded-lg border border-accent-line bg-accent-soft px-3.5 py-2 text-sm font-medium text-accent-ink hover:bg-[rgba(34,166,173,0.22)] transition-colors"
      >
        How to cash out <span aria-hidden>↗</span>
      </a>
    </div>
  );
}
