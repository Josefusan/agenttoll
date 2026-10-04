// Small UI strings with logic. No imports, so node --test can load it directly.

/** Subtitle for the settlements list. Simulated rows have no transaction, so no explorer link. */
export function settlementsSubtitle(simulatedInView: number, totalInView: number): string {
  if (totalInView > 0 && simulatedInView >= totalInView) {
    return "Newest first. These payments are simulated: no transaction exists, so there is no explorer link.";
  }
  if (simulatedInView > 0) {
    return "Newest first. Real settlements link to the explorer. Simulated rows have no link.";
  }
  return "Newest first. Links open the transaction on the explorer.";
}
