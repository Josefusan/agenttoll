//! Admin API for the dashboard (contract: docs/ADMIN_API.md). Served on `admin_listen`,
//! separate from the public listener, and always behind a bearer token.

use std::convert::Infallible;
use std::time::Duration;

use axum::Router;
use axum::extract::{Query, Request, State};
use axum::http::{StatusCode, header};
use axum::middleware::{self, Next};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Json, Response};
use axum::routing::get;
use futures_util::Stream;
use serde::Deserialize;
use tokio_stream::StreamExt;
use tokio_stream::wrappers::BroadcastStream;

use crate::ledger::Ledger;

#[derive(Clone)]
struct AdminState {
    ledger: Ledger,
    token: String,
}

/// Seconds between SSE keepalive comments on `/admin/events`. Short enough to stay under
/// typical proxy idle timeouts.
const KEEP_ALIVE_SECS: u64 = 10;

/// Shortest admin token accepted.
pub const MIN_TOKEN_LEN: usize = 24;

/// Fails for a token shorter than [`MIN_TOKEN_LEN`]: an empty token would match an empty
/// `Authorization` header.
pub fn router(ledger: Ledger, token: String) -> anyhow::Result<Router> {
    anyhow::ensure!(
        token.len() >= MIN_TOKEN_LEN,
        "admin token must be at least {MIN_TOKEN_LEN} characters"
    );
    let state = AdminState { ledger, token };
    Ok(Router::new()
        .route("/admin/stats", get(stats))
        .route("/admin/events", get(events))
        .route_layer(middleware::from_fn_with_state(state.clone(), require_token))
        .with_state(state))
}

#[derive(Deserialize)]
struct TokenQuery {
    token: Option<String>,
}

/// `Authorization: Bearer <token>`. `/admin/events` also takes `?token=` because browsers'
/// EventSource cannot set headers; nowhere else, so tokens stay out of access logs.
async fn require_token(
    State(state): State<AdminState>,
    Query(query): Query<TokenQuery>,
    req: Request,
    next: Next,
) -> Response {
    let bearer = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));
    let from_query = (req.uri().path() == "/admin/events")
        .then_some(query.token.as_deref())
        .flatten();
    let presented = bearer.or(from_query).unwrap_or("");
    if !constant_time_eq(presented.as_bytes(), state.token.as_bytes()) {
        return (StatusCode::UNAUTHORIZED, "admin token required").into_response();
    }
    next.run(req).await
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

async fn stats(State(state): State<AdminState>) -> Response {
    match state.ledger.stats().await {
        Ok(stats) => Json(stats).into_response(),
        Err(e) => {
            tracing::error!(error = %e, "admin stats failed");
            (StatusCode::INTERNAL_SERVER_ERROR, "stats unavailable").into_response()
        }
    }
}

async fn events(
    State(state): State<AdminState>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    // A lagging subscriber skips missed events; the dashboard re-reads /admin/stats anyway.
    let live = BroadcastStream::new(state.ledger.subscribe()).filter_map(|event| {
        let event = event.ok()?;
        Some(Ok(Event::default()
            .event("revenue")
            .json_data(&event)
            .ok()?))
    });
    // First frame goes out at once, so proxies and tunnels that hold a response until the
    // first body bytes (the dashboard through a quick tunnel) open the stream immediately.
    let hello = tokio_stream::once(Ok(Event::default().comment("connected")));
    Sse::new(hello.chain(live)).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(KEEP_ALIVE_SECS))
            .text("keepalive"),
    )
}

#[cfg(test)]
mod tests {
    use super::constant_time_eq;

    #[test]
    fn token_comparison() {
        assert!(constant_time_eq(b"secret", b"secret"));
        assert!(!constant_time_eq(b"secret", b"secreT"));
        assert!(!constant_time_eq(b"secret", b"secret!"));
        assert!(!constant_time_eq(b"", b"secret"));
    }
}
