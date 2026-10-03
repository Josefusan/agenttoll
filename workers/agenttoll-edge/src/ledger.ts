// Append-only revenue ledger (ARCHITECTURE.md §1.6) in Cloudflare D1, same columns as the
// gateway's SQLite table. Without a D1 binding the event is logged instead.

/** `settled`, `pending` (`settlement_pending`, confirming) or `unconfirmed` (settle timed out
 * after serving; the payment may have landed). */
export type SettleStatus = 'settled' | 'pending' | 'unconfirmed';

export interface RevenueEvent {
  /** Unix milliseconds. */
  ts: number;
  route: string;
  mcpTool: string | null;
  agentName: string | null;
  detectReason: string;
  /** CAIP-2. */
  network: string;
  asset: string;
  /** Atomic USDC as a decimal string (KB-AMT-01); stored as an INTEGER. */
  amountAtomic: string;
  payer: string | null;
  /** Chain signature; `SIMULATED-*` or `unconfirmed:*` otherwise. */
  txSignature: string;
  originStatus: number;
  latencyMs: number;
  status: SettleStatus;
}

/** Same table as migrations/0001 + 0002, applied lazily so `wrangler dev --local` and the
 * tests work on an empty database. */
export const SCHEMA = `CREATE TABLE IF NOT EXISTS revenue_events (
  id            INTEGER PRIMARY KEY,
  ts            INTEGER NOT NULL,
  route         TEXT NOT NULL,
  mcp_tool      TEXT,
  agent_name    TEXT,
  detect_reason TEXT NOT NULL,
  network       TEXT NOT NULL,
  asset         TEXT NOT NULL,
  amount_atomic INTEGER NOT NULL,
  payer         TEXT,
  tx_signature  TEXT NOT NULL,
  origin_status INTEGER NOT NULL,
  latency_ms    INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'settled',
  UNIQUE (network, tx_signature)
)`;

/** migrations/0002: a table created before the status column existed gains it here. */
const ADD_STATUS = `ALTER TABLE revenue_events ADD COLUMN status TEXT NOT NULL DEFAULT 'settled'`;

export class Ledger {
  private ready: Promise<void> | undefined;

  constructor(private readonly db: D1Database | undefined) {}

  private ensureSchema(): Promise<void> {
    const db = this.db;
    if (!db) return Promise.resolve();
    this.ready ??= (async () => {
      await db.prepare(SCHEMA).run();
      try {
        await db.prepare(ADD_STATUS).run();
      } catch {
        // the column is already there (fresh table or migration 0002 applied)
      }
    })();
    return this.ready;
  }

  /**
   * Records a settlement. Returns false for a duplicate `(network, tx_signature)`, which is
   * not stored again. Without D1 the event is logged and true is returned.
   */
  async record(event: RevenueEvent): Promise<boolean> {
    if (!this.db) {
      console.log(JSON.stringify({ ledger: 'revenue_event', ...event }));
      return true;
    }
    await this.ensureSchema();
    const result = await this.db
      .prepare(
        `INSERT OR IGNORE INTO revenue_events
         (ts, route, mcp_tool, agent_name, detect_reason, network, asset, amount_atomic, payer, tx_signature, origin_status, latency_ms, status)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`,
      )
      .bind(
        event.ts,
        event.route,
        event.mcpTool,
        event.agentName,
        event.detectReason,
        event.network,
        event.asset,
        Number(event.amountAtomic),
        event.payer,
        event.txSignature,
        event.originStatus,
        event.latencyMs,
        event.status,
      )
      .run();
    return result.meta.changes > 0;
  }

  /** Every row, oldest first. Used by the debug endpoint and tests. */
  async all(): Promise<Record<string, unknown>[]> {
    if (!this.db) return [];
    await this.ensureSchema();
    const { results } = await this.db
      .prepare('SELECT * FROM revenue_events ORDER BY id')
      .all<Record<string, unknown>>();
    return results;
  }
}
