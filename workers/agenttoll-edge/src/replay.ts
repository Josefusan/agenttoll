// Replay guard (KB-X402-07 duplicate_settlement rule). Mirrors `ReplayGuard` in
// crates/agenttoll-gateway/src/pay.rs: a payment header is claimed before verification and
// released again if the payment was not consumed (invalid, origin error), so an honest retry
// works while a concurrent or repeated replay is refused.
//
// Limit: the map lives in one isolate. Cloudflare runs many isolates (one per colo, more under
// load), so a replay that lands on another isolate is caught only by the facilitator's own
// nonce rules. KV cannot close this gap (eventually consistent); a Durable Object could, and
// is the documented follow-up.

const REPLAY_WINDOW_MS = 120_000;

export class ReplayGuard {
  private readonly seen = new Map<string, number>();

  /** True if `key` was not claimed in the last window; claims it. */
  claim(key: string, now = Date.now()): boolean {
    for (const [k, at] of this.seen) {
      if (now - at >= REPLAY_WINDOW_MS) this.seen.delete(k);
    }
    if (this.seen.has(key)) return false;
    this.seen.set(key, now);
    return true;
  }

  release(key: string): void {
    this.seen.delete(key);
  }
}
