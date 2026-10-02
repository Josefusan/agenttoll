//! The paid path: verify → forward → settle (ARCHITECTURE.md §1.1, §1.4).
//!
//! Money rules enforced here:
//! - The facilitator is sent *our* quote, never the requirements the client echoes back.
//! - The origin is reached only after `/verify` says the payment is valid.
//! - `/settle` runs only after the origin answers 2xx; agents never pay for errors.
//! - The origin's content is released only after settlement succeeds.
//! - A payment header is accepted once per 120 s window (KB-X402-07 replay guard).

use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use agenttoll_core::detector::Verdict;
use agenttoll_core::pricer::PriceTag;
use axum::body::{Body, to_bytes};
use axum::http::request::Parts;
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use serde_json::Value;

use crate::facilitator;
use crate::ledger::RevenueEvent;
use crate::x402::{self, PaymentRequirements, X402_VERSION};
use crate::{Gateway, challenge};

/// Paid responses are buffered so content is withheld if settlement fails.
pub const PAID_RESPONSE_LIMIT: usize = 16 * 1024 * 1024;
const REPLAY_WINDOW: Duration = Duration::from_secs(120);

/// Remembers recently seen payment headers. A header is claimed before verification and
/// released again if the payment was not consumed (invalid, origin error), so an honest
/// retry works while a concurrent or repeated replay is refused.
#[derive(Default)]
pub struct ReplayGuard {
    seen: Mutex<HashMap<String, Instant>>,
}

impl ReplayGuard {
    /// True if `key` was not claimed in the last window; claims it.
    pub fn claim(&self, key: &str) -> bool {
        let now = Instant::now();
        let mut seen = self.seen.lock().expect("replay mutex poisoned");
        seen.retain(|_, at| now.duration_since(*at) < REPLAY_WINDOW);
        if seen.contains_key(key) {
            return false;
        }
        seen.insert(key.to_owned(), now);
        true
    }

    pub fn release(&self, key: &str) {
        self.seen.lock().expect("replay mutex poisoned").remove(key);
    }
}

pub struct PaidRequest<'a> {
    pub parts: Parts,
    pub body: Body,
    pub peer: Option<IpAddr>,
    pub tag: &'a PriceTag,
    pub verdict: &'a Verdict,
    /// Raw `PAYMENT-SIGNATURE` header value.
    pub header: String,
}

pub async fn handle_paid(gw: &Gateway, req: PaidRequest<'_>) -> Response {
    let started = Instant::now();
    let PaidRequest {
        parts,
        body,
        peer,
        tag,
        verdict,
        header,
    } = req;
    let refuse = |error: &str| challenge(gw, &parts, tag, verdict, error);

    // 1. Decode. Malformed is a client error (400), per the v2 HTTP transport.
    let Some(payload) = x402::decode_header::<Value>(&header) else {
        return (
            StatusCode::BAD_REQUEST,
            "PAYMENT-SIGNATURE is not base64-encoded JSON",
        )
            .into_response();
    };
    if payload.get("x402Version").and_then(Value::as_u64) != Some(u64::from(X402_VERSION)) {
        return refuse("only x402Version 2 payments are accepted");
    }
    let Some(accepted) = payload
        .get("accepted")
        .cloned()
        .and_then(|a| serde_json::from_value::<PaymentRequirements>(a).ok())
    else {
        return (
            StatusCode::BAD_REQUEST,
            "PAYMENT-SIGNATURE has no valid `accepted` requirements",
        )
            .into_response();
    };

    // 2. The payment must answer the quote we would issue for this exact request.
    let Some(network) = gw
        .networks
        .iter()
        .find(|n| n.config.network == accepted.network)
    else {
        return refuse("payment network is not offered for this resource");
    };
    let ours = network.requirements(tag);
    let matches = accepted.scheme == ours.scheme
        && accepted.amount == ours.amount
        && accepted.asset == ours.asset
        && accepted.pay_to == ours.pay_to;
    if !matches {
        return refuse("payment does not match this resource's price quote");
    }

    // 3. Replay guard.
    if !gw.replay.claim(&header) {
        return refuse("duplicate_settlement");
    }
    let facilitator_url = network.config.facilitator.as_str();

    // 4. Verify before the origin sees anything.
    let verified = match facilitator::verify(&gw.client, facilitator_url, &payload, &ours).await {
        Ok(v) => v,
        Err(e) => {
            gw.replay.release(&header);
            tracing::warn!(error = %e, "facilitator verify failed");
            return (StatusCode::BAD_GATEWAY, "payment facilitator unavailable").into_response();
        }
    };
    if !verified.is_valid {
        gw.replay.release(&header);
        return refuse(
            verified
                .invalid_reason
                .as_deref()
                .unwrap_or("payment is invalid"),
        );
    }

    // 5. Forward, telling the origin who paid.
    let mut gateway_headers = HeaderMap::new();
    gateway_headers.insert("x-agenttoll-paid", HeaderValue::from_static("1"));
    for (name, value) in [
        ("x-agenttoll-agent", verdict.agent.as_deref()),
        ("x-agenttoll-payer", verified.payer.as_deref()),
    ] {
        if let Some(v) = value.and_then(|v| HeaderValue::from_str(v).ok()) {
            gateway_headers.insert(name, v);
        }
    }
    let origin = crate::proxy::forward(
        &gw.client,
        &gw.config,
        parts.clone(),
        body,
        peer,
        gateway_headers,
    )
    .await;
    let origin_status = origin.status();
    if !origin_status.is_success() {
        // Not settled, so the payment was not consumed: let the agent retry it.
        gw.replay.release(&header);
        tracing::info!(status = %origin_status, "origin did not succeed; payment not settled");
        return origin;
    }
    let (origin_parts, origin_body) = origin.into_parts();
    let Ok(content) = to_bytes(origin_body, PAID_RESPONSE_LIMIT).await else {
        gw.replay.release(&header);
        return (
            StatusCode::BAD_GATEWAY,
            "origin response too large or interrupted; payment not settled",
        )
            .into_response();
    };

    // 6. Settle. Content is released only on success.
    let (settled, raw) =
        match facilitator::settle(&gw.client, facilitator_url, &payload, &ours).await {
            Ok(r) => r,
            Err(e) => {
                tracing::error!(error = %e, "facilitator settle failed; content withheld");
                return (
                    StatusCode::BAD_GATEWAY,
                    "payment settlement failed; you were not served",
                )
                    .into_response();
            }
        };
    let payment_response =
        HeaderValue::from_str(&x402::encode_header(&raw)).expect("base64 is a valid header");
    if !settled.settled() {
        let mut res = refuse(
            settled
                .error_reason
                .as_deref()
                .unwrap_or("settlement failed"),
        );
        res.headers_mut()
            .insert(agenttoll_core::headers::PAYMENT_RESPONSE, payment_response);
        return res;
    }

    // 7. Record and publish. A ledger failure must not take back content that was paid for.
    let event = RevenueEvent {
        ts: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| d.as_millis() as i64),
        route: tag.resource.clone(),
        mcp_tool: tag.resource.strip_prefix("mcp:").map(str::to_owned),
        agent_name: verdict.agent.clone(),
        detect_reason: verdict.reason.clone(),
        network: ours.network.clone(),
        asset: ours.asset.clone(),
        amount_atomic: tag.amount.0,
        payer: settled.payer.clone().or(verified.payer),
        tx_signature: settled.transaction.clone(),
        origin_status: origin_status.as_u16(),
        latency_ms: started.elapsed().as_millis() as u64,
    };
    tracing::info!(tx = %event.tx_signature, network = %event.network, amount = %tag.amount, "settled");
    if let Err(e) = gw.ledger.record(event).await {
        tracing::error!(error = %e, "ledger write failed");
    }

    let mut res = Response::from_parts(origin_parts, Body::from(content));
    res.headers_mut()
        .insert(agenttoll_core::headers::PAYMENT_RESPONSE, payment_response);
    res.headers_mut().remove(axum::http::header::CONTENT_LENGTH); // recomputed from the buffered body
    res
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replay_guard_claims_once_and_releases() {
        let g = ReplayGuard::default();
        assert!(g.claim("a"));
        assert!(!g.claim("a"));
        assert!(g.claim("b"));
        g.release("a");
        assert!(g.claim("a"));
    }
}
