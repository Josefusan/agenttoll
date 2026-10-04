-- Revenue ledger, ARCHITECTURE.md §1.6. Same columns as the Rust gateway's SQLite table.
-- Apply with `wrangler d1 migrations apply agenttoll-ledger` (the Worker also creates the
-- table lazily, so local dev and tests need no migration step).
CREATE TABLE IF NOT EXISTS revenue_events (
  id            INTEGER PRIMARY KEY,
  ts            INTEGER NOT NULL,   -- unix milliseconds
  route         TEXT NOT NULL,
  mcp_tool      TEXT,
  agent_name    TEXT,
  detect_reason TEXT NOT NULL,
  network       TEXT NOT NULL,      -- CAIP-2
  asset         TEXT NOT NULL,
  amount_atomic INTEGER NOT NULL,   -- 6-decimal USDC base units
  payer         TEXT,
  tx_signature  TEXT NOT NULL,
  origin_status INTEGER NOT NULL,
  latency_ms    INTEGER NOT NULL,
  UNIQUE (network, tx_signature)
);
