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

pub fn router(ledger: Ledger, token: String) -> Router {
    let state = AdminState { ledger, token };
    Router::new()
        .route("/admin/stats", get(stats))
        .route("/admin/events", get(events))
        .route_layer(middleware::from_fn_with_state(state.clone(), require_token))
        .with_state(state)
}

#[derive(Deserialize)]
struct TokenQuery {
    token: Option<String>,
}

/// `Authorization: Bearer <token>`, or `?token=` because browsers' EventSource cannot set
/// headers.
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
    let presented = bearer.or(query.token.as_deref()).unwrap_or("");
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
    let stream = BroadcastStream::new(state.ledger.subscribe()).filter_map(|event| {
        let event = event.ok()?;
        Some(Ok(Event::default()
            .event("revenue")
            .json_data(&event)
            .ok()?))
    });
    Sse::new(stream).keep_alive(KeepAlive::new().interval(Duration::from_secs(15)))
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
