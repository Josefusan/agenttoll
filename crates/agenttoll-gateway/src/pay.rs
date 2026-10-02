//! The paid path: verify → forward → settle (ARCHITECTURE.md §1.1, §1.4), for both payment
//! transports: the HTTP `PAYMENT-SIGNATURE` header (KB-X402-01) and the MCP-native
//! `params._meta["x402/payment"]` (KB-X402-05).
//!
//! Money rules enforced here:
//! - The facilitator is sent *our* quote, never the requirements the client echoes back.
//! - The origin is reached only after `/verify` says the payment is valid.
//! - `/settle` runs only after the origin succeeds; agents never pay for errors. For MCP a
//!   JSON-RPC error or a tool result with `isError: true` is a failure even on HTTP 200.
//! - The origin's content is released only after settlement succeeds. If `/settle` fails in
//!   transit (timeout) the outcome is unknown: the content is served, the payment stays
//!   claimed, and the ledger records it as `unconfirmed`, so a buyer is never charged
//!   without service and the founder never loses the trace (x402-protocol skill).
//! - A payment is bound to the resource it was quoted for, and accepted once per 120 s
//!   window (KB-X402-07 replay guard).

use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use agenttoll_core::detector::Verdict;
use agenttoll_core::headers;
use agenttoll_core::pricer::PriceTag;
use axum::body::{Body, Bytes, to_bytes};
use axum::http::request::Parts;
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde_json::{Value, json};

use crate::facilitator;
use crate::ledger::{RevenueEvent, SIMULATED_PREFIX, SettleStatus, UNCONFIRMED_PREFIX};
use crate::x402::{self, PaymentRequirements, X402_VERSION};
use crate::{Gateway, challenge, mcp_challenge};

/// Paid responses are buffered so content is withheld if settlement fails.
pub const PAID_RESPONSE_LIMIT: usize = 16 * 1024 * 1024;
const REPLAY_WINDOW: Duration = Duration::from_secs(120);
/// MCP-native metadata keys (KB-X402-05).
pub const MCP_PAYMENT_META: &str = "x402/payment";
pub const MCP_RESPONSE_META: &str = "x402/payment-response";

/// Remembers recently seen payments. A payment is claimed before verification and released
/// again if it was not consumed (invalid, origin error), so an honest retry works while a
/// concurrent or repeated replay is refused.
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

/// How the payment arrived, and therefore how refusals and receipts go back.
pub enum Transport {
    /// `PAYMENT-SIGNATURE` header; challenges are HTTP 402.
    Http,
    /// `params._meta["x402/payment"]` on a single `tools/call`; challenges are JSON-RPC tool
    /// results with `isError: true`. `id` is the JSON-RPC request id.
    Mcp { id: Value },
}

pub struct PaidRequest<'a> {
    pub parts: Parts,
    pub body: Body,
    pub peer: Option<IpAddr>,
    pub tag: &'a PriceTag,
    pub verdict: &'a Verdict,
    /// The decoded PaymentPayload.
    pub payload: Value,
    pub transport: Transport,
    /// The request is an MCP call, so JSON-RPC level failures count as failures.
    pub is_mcp: bool,
}

/// Decodes a `PAYMENT-SIGNATURE` header into a PaymentPayload.
pub fn decode_http_payment(header: &str) -> Option<Value> {
    x402::decode_header::<Value>(header)
}

/// For a single MCP `tools/call` carrying `params._meta["x402/payment"]`, returns the
/// payload, the JSON-RPC id, and the body with the payment removed (the origin never sees it).
pub fn extract_mcp_payment(body: &[u8]) -> Option<(Value, Value, Bytes)> {
    let mut msg: Value = serde_json::from_slice(body).ok()?;
    if msg.get("method")?.as_str()? != "tools/call" {
        return None;
    }
    let id = msg.get("id").cloned().unwrap_or(Value::Null);
    let meta = msg.get_mut("params")?.get_mut("_meta")?.as_object_mut()?;
    let payload = meta.remove(MCP_PAYMENT_META)?;
    if meta.is_empty() {
        msg["params"].as_object_mut()?.remove("_meta");
    }
    let stripped = serde_json::to_vec(&msg).ok()?;
    Some((payload, id, Bytes::from(stripped)))
}

pub async fn handle_paid(gw: &Gateway, req: PaidRequest<'_>) -> Response {
    let started = Instant::now();
    let PaidRequest {
        parts,
        body,
        peer,
        tag,
        verdict,
        payload,
        transport,
        is_mcp,
    } = req;
    let refuse = |error: &str| match &transport {
        Transport::Http => challenge(gw, &parts, tag, verdict, error),
        Transport::Mcp { id } => mcp_challenge(gw, &parts, tag, verdict, error, id.clone()),
    };
    let malformed = |error: &str| match &transport {
        Transport::Http => (StatusCode::BAD_REQUEST, error.to_string()).into_response(),
        Transport::Mcp { id } => crate::jsonrpc_error(StatusCode::OK, id.clone(), -32602, error),
    };

    // 1. Shape. Malformed is a client error (400 on HTTP, -32602 on MCP).
    if payload.get("x402Version").and_then(Value::as_u64) != Some(u64::from(X402_VERSION)) {
        return refuse("only x402Version 2 payments are accepted");
    }
    let Some(accepted) = payload
        .get("accepted")
        .cloned()
        .and_then(|a| serde_json::from_value::<PaymentRequirements>(a).ok())
    else {
        return malformed("payment has no valid `accepted` requirements");
    };
    // The signed part identifies the payment; header encodings of it may vary.
    let Some(replay_key) = payload.get("payload").map(Value::to_string) else {
        return malformed("payment has no `payload`");
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
    // A payment names the resource it was quoted for; it cannot be spent on another one.
    if let Some(url) = payload.pointer("/resource/url").and_then(Value::as_str)
        && url != crate::resource_url(gw, &parts)
    {
        return refuse("payment was made for a different resource");
    }

    // 3. Replay guard.
    if !gw.replay.claim(&replay_key) {
        return refuse("duplicate_settlement");
    }
    let facilitator_url = network.config.facilitator.as_str();

    // 4. Verify before the origin sees anything.
    let timeouts = &gw.config.timeouts;
    let verify_timeout = Duration::from_millis(timeouts.verify_ms);
    let verified =
        match facilitator::verify(&gw.client, facilitator_url, &payload, &ours, verify_timeout)
            .await
        {
            Ok(v) => v,
            Err(e) => {
                gw.replay.release(&replay_key);
                tracing::warn!(error = %e, "facilitator verify failed");
                return (StatusCode::BAD_GATEWAY, "payment facilitator unavailable")
                    .into_response();
            }
        };
    if !verified.is_valid {
        gw.replay.release(&replay_key);
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
    let (origin_parts, origin_body) = origin.into_parts();
    let Ok(content) = to_bytes(origin_body, PAID_RESPONSE_LIMIT).await else {
        gw.replay.release(&replay_key);
        return (
            StatusCode::BAD_GATEWAY,
            "origin response too large or interrupted; payment not settled",
        )
            .into_response();
    };
    let content_type = origin_parts
        .headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let failed = !origin_status.is_success() || (is_mcp && mcp_failed(content_type, &content));
    if failed {
        // Not settled, so the payment was not consumed: let the agent retry it.
        gw.replay.release(&replay_key);
        tracing::info!(status = %origin_status, "origin did not succeed; payment not settled");
        return Response::from_parts(origin_parts, Body::from(content));
    }

    // 6. Settle. Content is released only on success, or when the outcome is unknown.
    let settle_timeout = Duration::from_millis(timeouts.settle_ms);
    let record = |tx_signature: String, status: SettleStatus, payer: Option<String>| RevenueEvent {
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
        payer: payer.or_else(|| verified.payer.clone()),
        simulated: tx_signature.starts_with(SIMULATED_PREFIX),
        tx_signature,
        origin_status: origin_status.as_u16(),
        latency_ms: started.elapsed().as_millis() as u64,
        status,
    };
    let (event, receipt) = match facilitator::settle(
        &gw.client,
        facilitator_url,
        &payload,
        &ours,
        settle_timeout,
    )
    .await
    {
        Ok((settled, raw)) if settled.settled() => {
            let status = if settled.success {
                SettleStatus::Settled
            } else {
                SettleStatus::Pending
            };
            (
                record(settled.transaction.clone(), status, settled.payer.clone()),
                Some(raw),
            )
        }
        Ok((settled, raw)) => {
            let mut res = refuse(
                settled
                    .error_reason
                    .as_deref()
                    .unwrap_or("settlement failed"),
            );
            res.headers_mut()
                .insert(headers::PAYMENT_RESPONSE, receipt_header(&raw));
            return res;
        }
        Err(e) => {
            // Keep the replay claim: this payment may have been consumed.
            tracing::error!(error = %e, "settle outcome unknown; serving content, recording as unconfirmed");
            (
                record(
                    format!("{UNCONFIRMED_PREFIX}{}", short_hash(&replay_key)),
                    SettleStatus::Unconfirmed,
                    None,
                ),
                None,
            )
        }
    };

    // 7. Record and publish. A ledger failure must not take back content that was paid for.
    tracing::info!(tx = %event.tx_signature, network = %event.network, amount = %tag.amount, status = ?event.status, simulated = event.simulated, "payment recorded");
    if let Err(e) = gw.ledger.record(event).await {
        tracing::error!(error = %e, "ledger write failed");
    }

    // 8. Release the content with the receipt: always as a header, and for MCP-native also
    //    inside the JSON-RPC result where MCP clients look for it.
    let content = match (&transport, &receipt) {
        (Transport::Mcp { .. }, Some(raw)) if content_type.starts_with("application/json") => {
            attach_mcp_receipt(&content, raw.clone()).unwrap_or(content)
        }
        _ => content,
    };
    let mut res = Response::from_parts(origin_parts, Body::from(content));
    if let Some(raw) = &receipt {
        res.headers_mut()
            .insert(headers::PAYMENT_RESPONSE, receipt_header(raw));
    }
    res.headers_mut().remove(header::CONTENT_LENGTH); // recomputed from the buffered body
    res
}

fn receipt_header(raw: &Value) -> HeaderValue {
    HeaderValue::from_str(&x402::encode_header(raw)).expect("base64 is a valid header")
}

/// Stable short id for a payment whose settlement signature is unknown.
fn short_hash(key: &str) -> String {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    key.hash(&mut h);
    format!("{:016x}", h.finish())
}

/// True when an MCP origin answered with a JSON-RPC error or a failed tool result. Reads a
/// plain JSON body, or the first `data:` event of an SSE body.
fn mcp_failed(content_type: &str, content: &[u8]) -> bool {
    let message: Option<Value> = if content_type.starts_with("text/event-stream") {
        std::str::from_utf8(content)
            .ok()
            .and_then(|s| s.lines().find_map(|l| l.strip_prefix("data:")))
            .and_then(|d| serde_json::from_str(d.trim()).ok())
    } else {
        serde_json::from_slice(content).ok()
    };
    let Some(message) = message else {
        return false; // not JSON-RPC (plain HTTP success); HTTP status already checked
    };
    let messages = match message {
        Value::Array(items) => items,
        other => vec![other],
    };
    messages.iter().any(|m| {
        m.get("error").is_some() || m.pointer("/result/isError") == Some(&Value::Bool(true))
    })
}

/// Inserts the settlement response at `result._meta["x402/payment-response"]`.
fn attach_mcp_receipt(content: &[u8], receipt: Value) -> Option<Bytes> {
    let mut msg: Value = serde_json::from_slice(content).ok()?;
    let result = msg.get_mut("result")?.as_object_mut()?;
    let meta = result.entry("_meta").or_insert_with(|| json!({}));
    meta.as_object_mut()?
        .insert(MCP_RESPONSE_META.into(), receipt);
    serde_json::to_vec(&msg).ok().map(Bytes::from)
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

    #[test]
    fn extracts_and_strips_mcp_payment() {
        let body = br#"{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"search_docs","_meta":{"x402/payment":{"x402Version":2}}}}"#;
        let (payload, id, stripped) = extract_mcp_payment(body).unwrap();
        assert_eq!(payload, json!({"x402Version": 2}));
        assert_eq!(id, json!(7));
        let stripped: Value = serde_json::from_slice(&stripped).unwrap();
        assert!(stripped["params"].get("_meta").is_none(), "{stripped}");
        assert_eq!(stripped["params"]["name"], "search_docs");

        let other_meta = br#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"a","_meta":{"progressToken":1,"x402/payment":{}}}}"#;
        let (_, _, stripped) = extract_mcp_payment(other_meta).unwrap();
        let stripped: Value = serde_json::from_slice(&stripped).unwrap();
        assert_eq!(stripped["params"]["_meta"], json!({"progressToken": 1}));

        assert!(
            extract_mcp_payment(
                br#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"a"}}"#
            )
            .is_none()
        );
        assert!(extract_mcp_payment(br#"{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{"_meta":{"x402/payment":{}}}}"#).is_none());
        assert!(extract_mcp_payment(b"[1,2]").is_none());
    }

    #[test]
    fn detects_mcp_failures() {
        assert!(mcp_failed(
            "application/json",
            br#"{"jsonrpc":"2.0","id":1,"error":{"code":-1,"message":"x"}}"#
        ));
        assert!(mcp_failed(
            "application/json",
            br#"{"jsonrpc":"2.0","id":1,"result":{"isError":true,"content":[]}}"#
        ));
        assert!(mcp_failed(
            "text/event-stream",
            b"event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":1,\"error\":{}}\n\n"
        ));
        assert!(!mcp_failed(
            "application/json",
            br#"{"jsonrpc":"2.0","id":1,"result":{"isError":false,"content":[]}}"#
        ));
        assert!(!mcp_failed("text/plain", b"ok"));
    }

    #[test]
    fn attaches_receipt_to_result_meta() {
        let out = attach_mcp_receipt(
            br#"{"jsonrpc":"2.0","id":1,"result":{"content":[]}}"#,
            json!({"success": true}),
        )
        .unwrap();
        let out: Value = serde_json::from_slice(&out).unwrap();
        assert_eq!(
            out["result"]["_meta"]["x402/payment-response"]["success"],
            true
        );
        assert!(attach_mcp_receipt(b"not json", json!({})).is_none());
    }
}
