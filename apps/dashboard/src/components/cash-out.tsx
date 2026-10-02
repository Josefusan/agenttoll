import { atomicToUsd } from "@/lib/format";

export function CashOut({ revenueAtomic, simulatedAtomic, payoutsUrl }: { revenueAtomic: number; simulatedAtomic: number; payoutsUrl: string }) {
  const real = revenueAtomic - simulatedAtomic;
  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="label">Spendable USDC</div>
        <div className="num mt-1 text-2xl font-semibold tracking-tight">{atomicToUsd(real)}</div>
        {simulatedAtomic > 0 && (
          <p className="mt-1 text-xs text-ink-3">
            Excludes {atomicToUsd(simulatedAtomic)} from simulated payments, which never touched a chain.
          </p>
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
