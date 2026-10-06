/**
 * A slim, always-on honesty banner for the live demo deployment.
 *
 * Why always visible: `apps/dashboard/.env.example` defines no demo-mode flag, so there is nothing to
 * read the label from. Of the two options the task allowed — show when any simulated settlement is
 * present, or always — "always" is the simpler one and it is also the correct one here: the banner
 * does not depend on stats being loaded, so it never appears a moment late or disappears on a fresh
 * ledger, which is exactly when a judge first opens the page. It is static markup, so it adds no
 * layout shift. If the dashboard is ever deployed for real, gate this behind a NEXT_PUBLIC_* flag.
 */
export function DemoBanner() {
  return (
    <div
      role="note"
      aria-label="Demo notice: payments are SIMULATED on Solana devnet, no funds moved"
      className="-mx-4 sm:-mx-6 lg:-mx-8 border-b border-[rgba(224,168,74,0.4)] bg-warn-soft px-4 sm:px-6 lg:px-8 py-2 text-center text-xs leading-snug text-ink-2 sm:text-[13px]"
    >
      Demo · <span className="font-semibold text-warn">SIMULATED</span> payments on Solana devnet · no funds moved
    </div>
  );
}
