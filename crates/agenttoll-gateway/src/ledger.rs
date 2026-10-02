//! Append-only revenue ledger (ARCHITECTURE.md §1.6) in SQLite, the unbilled-agent request
//! log, and the in-process event bus the admin SSE feed subscribes to.

use std::sync::{Arc, Mutex};

use rusqlite::{Connection, params};
use serde::Serialize;
use tokio::sync::broadcast;

/// Settlements from AgentToll's local simulated facilitator start with this. They never
/// touched a chain and are always labelled as simulated.
pub const SIMULATED_PREFIX: &str = "SIMULATED-";
/// Settlements whose outcome is unknown (the facilitator timed out after the content was
/// served) are recorded under `unconfirmed:<payment hash>` instead of a chain signature.
pub const UNCONFIRMED_PREFIX: &str = "unconfirmed:";

/// How sure we are that the money moved.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SettleStatus {
    /// The facilitator reported success with a transaction.
    Settled,
    /// `settlement_pending`: broadcast, still confirming (KB-X402-06).
    Pending,
    /// `/settle` failed in transit after the origin answered; the payment may have landed.
    Unconfirmed,
}

impl SettleStatus {
    fn as_str(self) -> &'static str {
        match self {
            SettleStatus::Settled => "settled",
            SettleStatus::Pending => "pending",
            SettleStatus::Unconfirmed => "unconfirmed",
        }
    }

    fn parse(s: &str) -> SettleStatus {
        match s {
            "pending" => SettleStatus::Pending,
            "unconfirmed" => SettleStatus::Unconfirmed,
            _ => SettleStatus::Settled,
        }
    }
}

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
    pub simulated: bool,
    pub status: SettleStatus,
}

/// An agent or bot request that was not charged (free route, heuristic verdict, search bot).
/// Human requests are never logged.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnbilledRequest {
    pub ts: i64,
    pub route: String,
    pub agent_name: Option<String>,
    pub reason: String,
    pub status: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Default)]
pub struct Stats {
    pub totals: Totals,
    pub by_route: Vec<RouteStat>,
    pub by_agent: Vec<AgentStat>,
    pub by_network: Vec<NetworkStat>,
    pub unbilled: Vec<UnbilledStat>,
    pub recent: Vec<RevenueEvent>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Default)]
pub struct Totals {
    pub revenue_atomic: u64,
    pub payments: u64,
    pub unique_agents: u64,
    pub unbilled_agent_requests: u64,
    /// Part of `revenue_atomic` settled by the simulated facilitator (never on chain).
    pub simulated_atomic: u64,
    /// Part of `revenue_atomic` whose settlement is unknown (`status: unconfirmed`, not simulated).
    pub unconfirmed_atomic: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RouteStat {
    pub route: String,
    pub revenue_atomic: u64,
    pub payments: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AgentStat {
    pub agent: String,
    pub revenue_atomic: u64,
    pub payments: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct NetworkStat {
    pub network: String,
    pub revenue_atomic: u64,
    pub payments: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct UnbilledStat {
    pub agent: String,
    pub reason: String,
    pub requests: u64,
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
  status        TEXT NOT NULL DEFAULT 'settled',
  UNIQUE (network, tx_signature)
);
CREATE TABLE IF NOT EXISTS request_log (
  ts         INTEGER NOT NULL,
  route      TEXT NOT NULL,
  agent_name TEXT,
  reason     TEXT NOT NULL,
  status     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS request_log_ts ON request_log (ts);";

const RECENT_LIMIT: usize = 50;
/// Unbilled-request rows older than this are pruned.
const REQUEST_LOG_RETENTION_MS: i64 = 30 * 24 * 3600 * 1000;
/// Prune once every this many inserts.
const PRUNE_EVERY: u64 = 1000;

#[derive(Clone)]
pub struct Ledger {
    conn: Arc<Mutex<Connection>>,
    events: broadcast::Sender<RevenueEvent>,
    log_inserts: Arc<std::sync::atomic::AtomicU64>,
}

fn to_i64(n: u64) -> i64 {
    i64::try_from(n).unwrap_or(i64::MAX)
}

fn to_u64(n: i64) -> u64 {
    u64::try_from(n).unwrap_or(0)
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
            log_inserts: Arc::default(),
        })
    }

    async fn blocking<T: Send + 'static>(
        &self,
        f: impl FnOnce(&Connection) -> rusqlite::Result<T> + Send + 'static,
    ) -> anyhow::Result<T> {
        let conn = self.conn.clone();
        Ok(
            tokio::task::spawn_blocking(move || f(&conn.lock().expect("ledger mutex poisoned")))
                .await??,
        )
    }

    /// Records a settlement and publishes it. Returns false for a duplicate
    /// `(network, tx_signature)`, which is neither stored nor published again.
    pub async fn record(&self, event: RevenueEvent) -> anyhow::Result<bool> {
        let row = event.clone();
        let inserted = self
            .blocking(move |conn| {
                let n = conn.execute(
                    "INSERT OR IGNORE INTO revenue_events
                     (ts, route, mcp_tool, agent_name, detect_reason, network, asset, amount_atomic,
                      payer, tx_signature, origin_status, latency_ms, status)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
                    params![
                        row.ts,
                        row.route,
                        row.mcp_tool,
                        row.agent_name,
                        row.detect_reason,
                        row.network,
                        row.asset,
                        to_i64(row.amount_atomic),
                        row.payer,
                        row.tx_signature,
                        row.origin_status,
                        to_i64(row.latency_ms),
                        row.status.as_str(),
                    ],
                )?;
                Ok(n == 1)
            })
            .await?;
        if inserted {
            let _ = self.events.send(event); // no subscribers is fine
        }
        Ok(inserted)
    }

    /// Logs an agent request that was not charged, for the "not billing yet" report.
    /// Rows older than 30 days are pruned every thousand inserts, so a bot flood cannot grow
    /// the table without bound.
    pub async fn log_unbilled(&self, req: UnbilledRequest) -> anyhow::Result<()> {
        let n = self
            .log_inserts
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let prune_before =
            (n % PRUNE_EVERY == PRUNE_EVERY - 1).then_some(req.ts - REQUEST_LOG_RETENTION_MS);
        self.blocking(move |conn| {
            conn.execute(
                "INSERT INTO request_log (ts, route, agent_name, reason, status) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![req.ts, req.route, req.agent_name, req.reason, req.status],
            )?;
            if let Some(cutoff) = prune_before {
                conn.execute("DELETE FROM request_log WHERE ts < ?1", params![cutoff])?;
            }
            Ok(())
        })
        .await
    }

    pub fn subscribe(&self) -> broadcast::Receiver<RevenueEvent> {
        self.events.subscribe()
    }

    /// All settlements, oldest first.
    pub fn all(&self) -> anyhow::Result<Vec<RevenueEvent>> {
        let conn = self.conn.lock().expect("ledger mutex poisoned");
        Ok(query_events(&conn, "ORDER BY id", usize::MAX)?)
    }

    /// Aggregates for the admin API (contract in docs/ADMIN_API.md).
    pub async fn stats(&self) -> anyhow::Result<Stats> {
        self.blocking(|conn| {
            let (revenue, payments): (i64, i64) =
                conn.query_row("SELECT COALESCE(SUM(amount_atomic), 0), COUNT(*) FROM revenue_events", [], |r| {
                    Ok((r.get(0)?, r.get(1)?))
                })?;
            let unique_agents: i64 =
                conn.query_row("SELECT COUNT(DISTINCT agent_name) FROM revenue_events", [], |r| r.get(0))?;
            let unbilled_total: i64 = conn.query_row("SELECT COUNT(*) FROM request_log", [], |r| r.get(0))?;
            let (simulated, unconfirmed): (i64, i64) = conn.query_row(
                &format!(
                    "SELECT
                       COALESCE(SUM(CASE WHEN tx_signature LIKE '{SIMULATED_PREFIX}%' THEN amount_atomic END), 0),
                       COALESCE(SUM(CASE WHEN status = 'unconfirmed' AND tx_signature NOT LIKE '{SIMULATED_PREFIX}%'
                                         THEN amount_atomic END), 0)
                     FROM revenue_events"
                ),
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )?;

            let group = |column: &str| -> rusqlite::Result<Vec<(String, u64, u64)>> {
                let sql = format!(
                    "SELECT COALESCE({column}, 'unknown'), SUM(amount_atomic), COUNT(*) FROM revenue_events
                     GROUP BY 1 ORDER BY 2 DESC LIMIT 20"
                );
                let mut stmt = conn.prepare(&sql)?;
                let rows = stmt.query_map([], |r| Ok((r.get(0)?, to_u64(r.get(1)?), to_u64(r.get(2)?))))?;
                rows.collect()
            };
            let by_route = group("route")?
                .into_iter()
                .map(|(route, revenue_atomic, payments)| RouteStat { route, revenue_atomic, payments })
                .collect();
            let by_agent = group("agent_name")?
                .into_iter()
                .map(|(agent, revenue_atomic, payments)| AgentStat { agent, revenue_atomic, payments })
                .collect();
            let by_network = group("network")?
                .into_iter()
                .map(|(network, revenue_atomic, payments)| NetworkStat { network, revenue_atomic, payments })
                .collect();

            let mut stmt = conn.prepare(
                "SELECT COALESCE(agent_name, 'unknown'), reason, COUNT(*) FROM request_log
                 GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 20",
            )?;
            let unbilled = stmt
                .query_map([], |r| Ok(UnbilledStat { agent: r.get(0)?, reason: r.get(1)?, requests: to_u64(r.get(2)?) }))?
                .collect::<rusqlite::Result<_>>()?;

            let recent = query_events(conn, "ORDER BY id DESC", RECENT_LIMIT)?;

            Ok(Stats {
                totals: Totals {
                    revenue_atomic: to_u64(revenue),
                    payments: to_u64(payments),
                    unique_agents: to_u64(unique_agents),
                    unbilled_agent_requests: to_u64(unbilled_total),
                    simulated_atomic: to_u64(simulated),
                    unconfirmed_atomic: to_u64(unconfirmed),
                },
                by_route,
                by_agent,
                by_network,
                unbilled,
                recent,
            })
        })
        .await
    }
}

fn query_events(
    conn: &Connection,
    order: &str,
    limit: usize,
) -> rusqlite::Result<Vec<RevenueEvent>> {
    let sql = format!(
        "SELECT ts, route, mcp_tool, agent_name, detect_reason, network, asset, amount_atomic,
                payer, tx_signature, origin_status, latency_ms, status
         FROM revenue_events {order} LIMIT {}",
        to_i64(limit as u64)
    );
    let mut stmt = conn.prepare(&sql)?;
    stmt.query_map([], |r| {
        let tx_signature: String = r.get(9)?;
        Ok(RevenueEvent {
            ts: r.get(0)?,
            route: r.get(1)?,
            mcp_tool: r.get(2)?,
            agent_name: r.get(3)?,
            detect_reason: r.get(4)?,
            network: r.get(5)?,
            asset: r.get(6)?,
            amount_atomic: to_u64(r.get(7)?),
            payer: r.get(8)?,
            simulated: tx_signature.starts_with(SIMULATED_PREFIX),
            tx_signature,
            origin_status: r.get(10)?,
            latency_ms: to_u64(r.get(11)?),
            status: SettleStatus::parse(&r.get::<_, String>(12)?),
        })
    })?
    .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(sig: &str, agent: &str, route: &str, amount: u64) -> RevenueEvent {
        RevenueEvent {
            ts: 1,
            route: route.into(),
            mcp_tool: None,
            agent_name: Some(agent.into()),
            detect_reason: format!("ua:{agent}"),
            network: "solana:devnet".into(),
            asset: "mint".into(),
            amount_atomic: amount,
            payer: Some("payer".into()),
            simulated: sig.starts_with(SIMULATED_PREFIX),
            tx_signature: sig.into(),
            origin_status: 200,
            latency_ms: 12,
            status: SettleStatus::Settled,
        }
    }

    #[tokio::test]
    async fn records_once_per_signature_and_publishes() {
        let ledger = Ledger::open("sqlite::memory:").unwrap();
        let mut rx = ledger.subscribe();
        let a = event("sig1", "ClaudeBot", "GET /api/quote", 2000);
        assert!(ledger.record(a.clone()).await.unwrap());
        assert!(
            !ledger.record(a.clone()).await.unwrap(),
            "duplicate is ignored"
        );
        assert!(
            ledger
                .record(event("sig2", "ClaudeBot", "GET /api/quote", 2000))
                .await
                .unwrap()
        );
        assert_eq!(ledger.all().unwrap().len(), 2);
        assert_eq!(rx.recv().await.unwrap(), a);
        assert_eq!(rx.recv().await.unwrap().tx_signature, "sig2");
        assert!(rx.try_recv().is_err(), "duplicate is not re-published");
    }

    #[tokio::test]
    async fn stats_aggregate_revenue_and_unbilled_traffic() {
        let ledger = Ledger::open("sqlite::memory:").unwrap();
        ledger
            .record(event("s1", "ClaudeBot", "GET /api/quote", 2000))
            .await
            .unwrap();
        ledger
            .record(event("s2", "ClaudeBot", "GET /api/quote", 2000))
            .await
            .unwrap();
        ledger
            .record(event("SIMULATED-3", "GPTBot", "mcp:search_docs", 5000))
            .await
            .unwrap();
        for _ in 0..3 {
            let req = UnbilledRequest {
                ts: 1,
                route: "/blog/x".into(),
                agent_name: Some("GPTBot".into()),
                reason: "ua:GPTBot".into(),
                status: 200,
            };
            ledger.log_unbilled(req).await.unwrap();
        }

        let s = ledger.stats().await.unwrap();
        assert_eq!(
            s.totals,
            Totals {
                revenue_atomic: 9000,
                payments: 3,
                unique_agents: 2,
                unbilled_agent_requests: 3,
                simulated_atomic: 5000,
                unconfirmed_atomic: 0,
            }
        );
        assert_eq!(
            s.by_route[0],
            RouteStat {
                route: "mcp:search_docs".into(),
                revenue_atomic: 5000,
                payments: 1
            }
        );
        assert_eq!(
            s.by_agent[0],
            AgentStat {
                agent: "GPTBot".into(),
                revenue_atomic: 5000,
                payments: 1
            }
        );
        assert_eq!(
            s.by_agent[1],
            AgentStat {
                agent: "ClaudeBot".into(),
                revenue_atomic: 4000,
                payments: 2
            }
        );
        assert_eq!(
            s.by_network,
            vec![NetworkStat {
                network: "solana:devnet".into(),
                revenue_atomic: 9000,
                payments: 3
            }]
        );
        assert_eq!(
            s.unbilled,
            vec![UnbilledStat {
                agent: "GPTBot".into(),
                reason: "ua:GPTBot".into(),
                requests: 3
            }]
        );
        assert_eq!(s.recent.len(), 3);
        assert_eq!(s.recent[0].tx_signature, "SIMULATED-3", "newest first");
        assert!(s.recent[0].simulated);
        assert!(!s.recent[1].simulated);
    }

    #[test]
    fn rejects_unsupported_urls() {
        assert!(Ledger::open("postgres://x").is_err());
    }
}
