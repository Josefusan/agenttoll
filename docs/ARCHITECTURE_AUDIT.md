# Architecture audit — AgentToll

`/production-architecture-audit AgentToll`, run 2026-10-05 by Command Code (DeepSeek V4.1 Flash).
Framework: [`skills/production-architecture-audit/`](../skills/production-architecture-audit/SKILL.md).
Read-only: nothing in the codebase was changed to produce this.

**Scope note.** The skill's worked example is Zevar i (`global_leads`, Campaigns / Leads / Senders /
Safety). This audit keeps AgentToll's own names and applies the ladder and the six pillars unchanged.

**Evidence base.** `ARCHITECTURE.md` §1.1–1.8, `Cargo.toml` (workspace), `crates/*/Cargo.toml` and
`crates/**/src/*.rs`, `workers/agenttoll-edge/` (source + `migrations/`), `apps/dashboard/src/**`,
`demo/pay-mcp/`, `evals/`, `docs/DECISIONS.md`. Every claim below cites a file.

---

## 1. Where this sits

**Level 2 — Modular monolith (domain modules).**

Ladder, verbatim: *"Code grouped into domains (Leads, Campaigns, Senders, Safety). Each domain owns its
tables, and other domains may only call its public interface, never its tables. Still one codebase, one
database, one deploy per unit."* Who it suits: *"The gold standard for a single team at Zevar i's size."*

Evidence:

- **The domain is a dependency-free crate.** `crates/agenttoll-core` — `detector`, `pricer`, `mcp`,
  `money`, `path`, `config` — declares only `globset, http, serde, serde_json, serde_yaml, thiserror`.
  It has **no `tokio`, no `reqwest`, no `rusqlite`**: no I/O, no infrastructure.
- **Adapters depend inward, never out.** `crates/agenttoll-gateway/Cargo.toml` depends on
  `agenttoll-core`; `agenttoll-core` depends on nothing of the gateway's.
- **One table, one owner.** The `revenue_events` / `request_log` SQL appears only in
  `crates/agenttoll-gateway/src/ledger.rs`. No other module — and neither the dashboard nor the Worker —
  issues it.
- **The presentation tier has no data access.** `apps/dashboard` reads `GET /admin/stats` and
  `GET /admin/events` over HTTP; the admin token is server-side only
  (`apps/dashboard/src/lib/gateway.ts:7`), never in the browser.
- **One deploy per unit:** one gateway binary (`:8402` / admin `:8403`), one dashboard, one Worker.

What would move it a rung: **Level 3**, database per service. For AgentToll that would be a regression,
not progress — see §5.

> Clean/hexagonal architecture and DDD are **not** separate rungs. `agenttoll-core` is exactly that: the
> hexagonal port that makes level 2 good, not a level of its own.

## 2. Gold standard vs floor

Floor is **Level 1** (one module owns a hot table's SQL; callers use functions). Gold standard for a
single team this size is **Level 2**. AgentToll is at Level 2, so the work is not "climb a rung" — it is
the ladder's three adoption changes:

| Adoption change | Status |
|---|---|
| **1. Group modules by domain, not by table** | **Met.** `agenttoll-core` is split by domain responsibility, not per table; the only table SQL is private to `ledger.rs`. |
| **2. Enforce the boundary with one mechanical rule** | **Half met.** The *core* boundary is enforced stronger than a lint rule: the crate has no I/O deps and must also compile to WebAssembly (`crates/agenttoll-core-wasm`), so the compiler refuses an infrastructure import. The *ledger* boundary has no equivalent guard — nothing stops a future module writing its own SQL against `revenue_events`. One CI grep ("`revenue_events` may only appear in `ledger.rs`") closes it. |
| **3. Expand/contract schema changes behind the module** | **Missing in the gateway.** The Worker has versioned migrations in git (`workers/agenttoll-edge/migrations/0001_revenue_events.sql`, `0002_revenue_status.sql`); the gateway's SQLite schema is an inline `CREATE TABLE IF NOT EXISTS` string in `ledger.rs` with no version table and no second step. |

## 3. Six-pillar scorecard

Scored per `references/audit-pillars.md`: three metrics × 1–5 each, pillar = sum (target ≥ 12/15), total
out of 90. Priority: **High** if pillar < 9, **Med** if 9–11, **Low** if ≥ 12.

| # | Pillar | Architecture Alignment | Operational Implementation | Failure Mode Preparedness | Pillar | Priority |
|---|---|---:|---:|---:|---:|---|
| 1 | Separation of Concerns | 5 | 5 | 4 | **14** | Low |
| 2 | Data Modeling & Persistence | 4 | 4 | 3 | **11** | Med |
| 3 | State Management | 4 | 4 | 4 | **12** | Low |
| 4 | APIs and Interfaces | 5 | 4 | 4 | **13** | Low |
| 5 | Data Migrations & Versioning | 2 | 3 | 2 | **7** | **High** |
| 6 | Scalability & Resilience | 3 | 3 | 4 | **10** | Med |
| | **Total Combined Architecture Score** | | | | **67 / 90** | |

### Pillar 1 — Separation of Concerns (14/15)

- **Alignment 5.** Different parts have non-overlapping responsibilities *and the split is structural*:
  UI carries zero business logic (it renders what `/admin/stats` returns), the domain crate carries zero
  infrastructure, and the gateway carries the orchestration. `agenttoll-core`'s dependency list is the
  proof, not a promise.
- **Operational 5.** In code today; `wasm32` compilation makes "core stays pure" a build-time invariant.
- **Failure 4** (not 5): the *ledger* boundary is convention. Only `ledger.rs` writes `revenue_events`
  today, but nothing mechanically prevents the next module from doing so.

### Pillar 2 — Data Modeling & Persistence (11/15)

- **Alignment 4.** Fact table plus a separate unpaid-traffic log; idempotency is a schema constraint,
  not application hope — `UNIQUE (network, tx_signature)` (`ledger.rs:140`). Not a 5 because analytics
  fields are computed at read time rather than pre-computed (acceptable at this volume).
- **Operational 4.** Schema is in code and applied at startup. Gap: `revenue_events` has **no index** —
  the only index defined is `request_log_ts` (`ledger.rs:154`) — yet the hot read is
  `ORDER BY ts DESC LIMIT 50`.
- **Failure 3.** One `Mutex<Connection>` serializes every write (`ledger.rs:52`). Correct today
  (single-statement inserts), but there is no documented transaction discipline for the first multi-stage
  mutation, and no cache tier in front of repeated reads.

### Pillar 3 — State Management (12/15)

The client is a read-only dashboard, so several criteria are satisfied by construction.

- **Alignment 4.** One source of truth: the `load` union in `apps/dashboard/src/hooks/use-live-stats.ts`.
  Money is never re-derived from the event list — `dashboard.tsx:32` states totals come from `totals`,
  never from `recent`.
- **Operational 4.** No client mutations exist to be made unpredictable; derived views are `useMemo`.
- **Failure 4.** Explicit cache-conflict handling: a lagging SSE subscriber skips events and the
  dashboard re-reads `/admin/stats` (`crates/agenttoll-gateway/src/admin.rs:94`), reconciled on a timer.

### Pillar 4 — APIs and Interfaces (13/15)

- **Alignment 5.** Formal contracts everywhere: x402 v2 headers (`crates/agenttoll-gateway/src/x402.rs`,
  KB-cited), a JSON admin API, and an MCP transport. Private metadata is filtered in both directions —
  payment headers are stripped before the origin sees them, and `EXTENSION-RESPONSES` is never forwarded
  to buyers (`docs/DECISIONS.md`).
- **Operational 4.** Contracts and validation are in code. Gap: **no volumetric rate limiting.** A grep
  for `rate.?limit` / `429` across `crates/` and `workers/` returns nothing, even though
  `references/audit-pillars.md` names "aggressive volumetric quotas" as a criterion.
- **Failure 4.** Idempotency is real — schema `UNIQUE` plus a claimed/released replay guard
  (`crates/agenttoll-gateway/src/pay.rs:38-65`) — and a malformed MCP body is rejected with 400 before it
  reaches the origin. Not a 5: there is no circuit breaker on the facilitator, only a timeout.

### Pillar 5 — Data Migrations & Versioning (7/15) — highest priority

- **Alignment 2.** No migration *design* for the gateway: the schema is one inline `CREATE TABLE IF NOT
  EXISTS` blob (`ledger.rs:128-155`). No version table, no numbered steps, no expand/contract sequence.
- **Operational 3.** The Worker does have versioned, git-committed migrations; the gateway does not.
- **Failure 2.** No rollback path. A bad schema change against a live SQLite file has no tested down.

### Pillar 6 — Scalability & Resilience (10/15)

- **Alignment 3.** Statelessness is only partial: the replay guard is an in-process
  `Mutex<HashMap<String, Instant>>` (`pay.rs:48`) and the event bus is an in-process
  `tokio::sync::broadcast` (`ledger.rs`), over one local SQLite file. A second gateway instance would not
  share a replay window, so the guard weakens exactly when you scale out. (The Worker's guard is
  per-isolate for the same reason; `docs/DECISIONS.md` already notes it should become a Durable Object.)
- **Operational 3.** One VPS under pm2; no autoscaling.
- **Failure 4.** This is where the system is genuinely strong: explicit facilitator timeouts
  (`lib.rs:53-54`, per-call timeout in `facilitator.rs`), `unconfirmed` recorded when `/settle` times out
  *after* the origin answered, no settlement on a non-2xx origin, and content withheld on any failure.
  Failure is isolated and degraded on purpose.

## 4. Remediation — failing criteria only

Ordered by pillar score. Each fix is one file where possible.

**Pillar 5 (7/15) — do this first.**

1. **Give the gateway a real migration path.** Replace the inline `SCHEMA` string with numbered SQL files
   alongside the Worker's (`crates/agenttoll-gateway/migrations/0001_revenue_events.sql`) plus a
   `schema_version` table, applied in order at startup. This turns an untracked schema into a reviewable,
   diffable artifact and gives rollback a place to live.
2. **Adopt expand/contract for the next change.** Add the column → write both → switch reads → drop the
   old column, each step a separate commit one release apart. With the boundary already in `ledger.rs`,
   each step touches one file.
3. **Test the rollback once.** Add a test that applies `0001` + `0002`, then runs the documented down path
   against a temp database. Untested rollback is not rollback.

**Pillar 6 (10/15).**

4. **Make the replay guard survive scale-out.** Move the 120-second window behind the ledger (a
   `seen_payments` table with a `UNIQUE` key and a TTL prune) so two instances share it; the ledger
   already runs a periodic prune (`PRUNE_EVERY`, `ledger.rs`). Until then, document that the gateway is
   single-instance by design.
5. **Add one circuit breaker on the facilitator.** A consecutive-failure count that opens for ~10 s stops
   a slow facilitator from consuming the request path with 30-second reads; today only a timeout does.

**Pillar 2 (11/15).**

6. **Add the missing index.** `CREATE INDEX IF NOT EXISTS revenue_events_ts ON revenue_events (ts);` in the
   same migration as fix 1 — the recent-settlements query and the chart both read by `ts`.

**One-metric gaps inside otherwise-passing pillars.**

7. **Close the ledger boundary mechanically** (Pillar 1, failure metric): one CI check that the string
   `revenue_events` appears only in `crates/agenttoll-gateway/src/ledger.rs`. One rule, as the ladder asks.
8. **Add a volumetric limit** (Pillar 4, operational metric): a per-IP/per-agent token bucket returning
   `429`, at least on the admin surface. The criterion is named in the framework and is entirely absent.

## 5. Do not do

**Do not move to Level 3 (microservices, database per service).** It is the rung above the gold standard
here, and it would make AgentToll worse:

- AgentToll has **one domain**. Splitting "detector" and "settler" into services converts today's
  in-process function calls into network hops with no independent team to justify them.
- The paid path is **one round trip plus one settlement**. At Level 3 that becomes a distributed
  transaction across a detector service, a paywall service and a ledger service — the exact consistency
  problem the current design avoids by keeping verify → forward → settle in one process.
- The dashboard's one query (`/admin/stats`) would become a fan-out across service APIs.
- The project is a **solo build with a 2026-10-12 deadline**. Level 3 would spend the remaining time on
  infrastructure that earns no judge points, against a framework whose own gold standard for this size is
  the level already reached.

The correct direction is horizontal work *inside* Level 2: fix Pillar 5, then Pillar 6 and Pillar 2.
