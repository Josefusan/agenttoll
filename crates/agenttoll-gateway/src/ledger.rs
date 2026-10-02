//! Append-only revenue ledger (ARCHITECTURE.md §1.6) in SQLite, plus the in-process event
//! bus the dashboard's SSE feed subscribes to (D4).

use std::sync::{Arc, Mutex};

use rusqlite::{Connection, params};
use serde::Serialize;
use tokio::sync::broadcast;

/// One settled payment. Amounts are atomic USDC (KB-AMT-01).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RevenueEvent {
    /// Unix milliseconds.
    pub ts: i64,
    pub route: String,
    pub mcp_tool: Option<String>,
    pub agent_name: Option<String>,
    pub detect_reason: String,
    /// CAIP-2.
    pub network: String,
    pub asset: String,
    pub amount_atomic: u64,
    pub payer: Option<String>,
    pub tx_signature: String,
    pub origin_status: u16,
    pub latency_ms: u64,
}

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS revenue_events (
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
  UNIQUE (network, tx_signature)
);";

#[derive(Clone)]
pub struct Ledger {
    conn: Arc<Mutex<Connection>>,
    events: broadcast::Sender<RevenueEvent>,
}

impl Ledger {
    /// `url` is `sqlite://<path>` or `sqlite::memory:`.
    pub fn open(url: &str) -> anyhow::Result<Ledger> {
        let conn = match url.strip_prefix("sqlite://") {
            Some(path) => Connection::open(path)?,
            None if url == "sqlite::memory:" => Connection::open_in_memory()?,
            None => anyhow::bail!(
                "ledger.url {url:?}: only sqlite://<path> and sqlite::memory: are supported"
            ),
        };
        conn.execute_batch("PRAGMA journal_mode = WAL;")?;
        conn.execute_batch(SCHEMA)?;
        let (events, _) = broadcast::channel(256);
        Ok(Ledger {
            conn: Arc::new(Mutex::new(conn)),
            events,
        })
    }

    /// Records a settlement and publishes it. Returns false for a duplicate
    /// `(network, tx_signature)`, which is neither stored nor published again.
    pub async fn record(&self, event: RevenueEvent) -> anyhow::Result<bool> {
        let conn = self.conn.clone();
        let row = event.clone();
        let inserted = tokio::task::spawn_blocking(move || -> rusqlite::Result<bool> {
            let conn = conn.lock().expect("ledger mutex poisoned");
            let n = conn.execute(
                "INSERT OR IGNORE INTO revenue_events
                 (ts, route, mcp_tool, agent_name, detect_reason, network, asset, amount_atomic,
                  payer, tx_signature, origin_status, latency_ms)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                params![
                    row.ts,
                    row.route,
                    row.mcp_tool,
                    row.agent_name,
                    row.detect_reason,
                    row.network,
                    row.asset,
                    i64::try_from(row.amount_atomic).unwrap_or(i64::MAX),
                    row.payer,
                    row.tx_signature,
                    row.origin_status,
                    i64::try_from(row.latency_ms).unwrap_or(i64::MAX),
                ],
            )?;
            Ok(n == 1)
        })
        .await??;
        if inserted {
            let _ = self.events.send(event); // no subscribers is fine
        }
        Ok(inserted)
    }

    pub fn subscribe(&self) -> broadcast::Receiver<RevenueEvent> {
        self.events.subscribe()
    }

    /// All rows, oldest first. For tests and the admin API.
    pub fn all(&self) -> anyhow::Result<Vec<RevenueEvent>> {
        let conn = self.conn.lock().expect("ledger mutex poisoned");
        let mut stmt = conn.prepare(
            "SELECT ts, route, mcp_tool, agent_name, detect_reason, network, asset, amount_atomic,
                    payer, tx_signature, origin_status, latency_ms
             FROM revenue_events ORDER BY id",
        )?;
        let rows = stmt
            .query_map([], |r| {
                Ok(RevenueEvent {
                    ts: r.get(0)?,
                    route: r.get(1)?,
                    mcp_tool: r.get(2)?,
                    agent_name: r.get(3)?,
                    detect_reason: r.get(4)?,
                    network: r.get(5)?,
                    asset: r.get(6)?,
                    amount_atomic: r.get::<_, i64>(7)?.max(0) as u64,
                    payer: r.get(8)?,
                    tx_signature: r.get(9)?,
                    origin_status: r.get(10)?,
                    latency_ms: r.get::<_, i64>(11)?.max(0) as u64,
                })
            })?
            .collect::<Result<_, _>>()?;
        Ok(rows)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(sig: &str) -> RevenueEvent {
        RevenueEvent {
            ts: 1,
            route: "GET /api/quote".into(),
            mcp_tool: None,
            agent_name: Some("ClaudeBot".into()),
            detect_reason: "ua:ClaudeBot".into(),
            network: "solana:devnet".into(),
            asset: "mint".into(),
            amount_atomic: 2000,
            payer: Some("payer".into()),
            tx_signature: sig.into(),
            origin_status: 200,
            latency_ms: 12,
        }
    }

    #[tokio::test]
    async fn records_once_per_signature_and_publishes() {
        let ledger = Ledger::open("sqlite::memory:").unwrap();
        let mut rx = ledger.subscribe();
        assert!(ledger.record(event("sig1")).await.unwrap());
        assert!(
            !ledger.record(event("sig1")).await.unwrap(),
            "duplicate is ignored"
        );
        assert!(ledger.record(event("sig2")).await.unwrap());
        assert_eq!(ledger.all().unwrap(), vec![event("sig1"), event("sig2")]);
        assert_eq!(rx.recv().await.unwrap().tx_signature, "sig1");
        assert_eq!(rx.recv().await.unwrap().tx_signature, "sig2");
        assert!(rx.try_recv().is_err(), "duplicate is not re-published");
    }

    #[test]
    fn rejects_unsupported_urls() {
        assert!(Ledger::open("postgres://x").is_err());
    }
}
