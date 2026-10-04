//! AgentToll gateway: a reverse proxy that lets humans through free and answers priced
//! agent requests with an x402 v2 challenge, then verifies and settles their payments
//! (ARCHITECTURE.md §1.1).

pub mod admin;
pub mod facilitator;
pub mod ledger;
pub mod pay;
pub mod proxy;
pub mod supported;
pub mod x402;

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use agenttoll_core::config::{Config, DetectionMode, McpChallenge};
use agenttoll_core::detector::{self, Context, Kind, RequestView, Verdict};
use agenttoll_core::headers;
use agenttoll_core::mcp;
use agenttoll_core::pricer::{PriceTag, Pricer};
use axum::Router;
use axum::body::{Body, Bytes, to_bytes};
use axum::extract::{ConnectInfo, Request, State};
use axum::http::{HeaderValue, Method, StatusCode, header};
use axum::response::{IntoResponse, Json, Response};
use serde_json::{Map, Value, json};

use crate::ledger::{Ledger, UnbilledRequest};
use crate::pay::{PaidRequest, ReplayGuard, Transport};
use crate::x402::QuoteNetwork;

/// MCP POST bodies are buffered for tool-name inspection, up to this size.
pub const MCP_BODY_LIMIT: usize = 1024 * 1024;
/// Machine-readable price list for agents planning spend. AgentToll's own format.
pub const DISCOVERY_PATH: &str = "/.well-known/agenttoll.json";

pub struct Gateway {
    pub config: Config,
    pricer: Pricer,
    networks: Vec<QuoteNetwork>,
    client: reqwest::Client,
    ledger: Ledger,
    replay: ReplayGuard,
}

impl Gateway {
    /// Builds the gateway, resolving each Solana network's fee payer from its facilitator
    /// unless the config pins one.
    pub async fn new(config: Config) -> anyhow::Result<Arc<Gateway>> {
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(5))
            .read_timeout(Duration::from_secs(30))
            .build()?;
        let pricer = Pricer::new(&config)?;

        let mut networks = Vec::new();
        for (name, net) in config.networks_in_quote_order() {
            let fee_payer = match (&net.fee_payer, net.network.starts_with("solana:")) {
                (Some(pinned), _) => Some(pinned.clone()),
                (None, true) => Some(
                    supported::fee_payer(&client, &net.facilitator, &net.network)
                        .await
                        .map_err(|e| anyhow::anyhow!("networks.{name}: {e}"))?,
                ),
                (None, false) => None,
            };
            networks.push(QuoteNetwork::new(net.clone(), fee_payer).map_err(anyhow::Error::msg)?);
        }
        let ledger = Ledger::open(&config.ledger.url)?;
        Ok(Arc::new(Gateway {
            config,
            pricer,
            networks,
            client,
            ledger,
            replay: ReplayGuard::default(),
        }))
    }

    pub fn networks(&self) -> &[QuoteNetwork] {
        &self.networks
    }

    pub fn ledger(&self) -> &Ledger {
        &self.ledger
    }
}

pub fn router(gateway: Arc<Gateway>) -> Router {
    Router::new().fallback(handle).with_state(gateway)
}

async fn handle(State(gw): State<Arc<Gateway>>, req: Request) -> Response {
    let peer = req
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|c| c.0.ip());
    let (parts, body) = req.into_parts();
    let path = parts.uri.path().to_owned();
    if parts.method == Method::GET && path == DISCOVERY_PATH {
        return discovery(&gw);
    }
    let is_mcp = gw.pricer.is_mcp_endpoint(&path);

    // MCP POST bodies are buffered so the tool name can be priced; everything else streams.
    let mut mcp_body: Option<Bytes> = None;
    let (body, price) = if is_mcp && parts.method == Method::POST {
        let Ok(bytes) = to_bytes(body, MCP_BODY_LIMIT).await else {
            return (
                StatusCode::PAYLOAD_TOO_LARGE,
                "MCP request body exceeds 1 MiB",
            )
                .into_response();
        };
        match mcp::inspect(&bytes) {
            Ok(inspection) => {
                let price = gw.pricer.price_mcp(&inspection);
                mcp_body = Some(bytes.clone());
                (Body::from(bytes), price)
            }
            Err(e) => {
                return jsonrpc_error(StatusCode::BAD_REQUEST, Value::Null, -32700, &e.to_string());
            }
        }
    } else if is_mcp {
        // GET (SSE stream) or DELETE (session end) on the MCP endpoint: nothing to price, and
        // a route catch-all must not charge it (paid-mcp-tools skill).
        (body, None)
    } else {
        (body, gw.pricer.price_route(&parts.method, &path))
    };

    let verdict = detector::classify(
        &RequestView {
            method: &parts.method,
            path: &path,
            headers: &parts.headers,
        },
        &Context {
            is_mcp_endpoint: is_mcp,
            web_bot_auth: None,
        },
    );
    let charge = price.as_ref().filter(|_| {
        detector::should_charge(gw.config.detection, &verdict, gw.config.charge_search_bots)
    });

    tracing::info!(
        method = %parts.method,
        path = %path,
        verdict = %verdict.reason,
        agent = verdict.agent.as_deref().unwrap_or("-"),
        price = %price.as_ref().map_or_else(|| "free".to_string(), |t| t.amount.to_string()),
        charged = charge.is_some(),
    );

    if let Some(tag) = charge {
        return charge_request(&gw, parts, body, peer, tag, &verdict, mcp_body).await;
    }

    let advertise = mcp_body.as_deref().is_some_and(is_tools_list)
        && gw.config.mcp.as_ref().is_some_and(|m| m.advertise_prices);
    let mut res = proxy::forward(
        &gw.client,
        &gw.config,
        parts,
        body,
        peer,
        Default::default(),
    )
    .await;
    if verdict.kind != Kind::Human {
        log_unbilled(&gw, &path, &verdict, res.status().as_u16());
    }
    if advertise {
        res = advertise_prices(&gw, res).await;
    }
    res
}

async fn charge_request(
    gw: &Gateway,
    parts: axum::http::request::Parts,
    body: Body,
    peer: Option<std::net::IpAddr>,
    tag: &PriceTag,
    verdict: &Verdict,
    mcp_body: Option<Bytes>,
) -> Response {
    let mcp_call_ids = mcp_body.as_deref().map(pay::tool_call_ids);
    let paid = |parts, body, payload, transport| PaidRequest {
        parts,
        body,
        peer,
        tag,
        verdict,
        payload,
        transport,
        mcp_call_ids: mcp_call_ids.clone(),
    };

    // HTTP transport: PAYMENT-SIGNATURE header (KB-X402-01). A second, MCP-native payment
    // in the body is removed so the origin never sees payment material.
    if let Some(value) = parts.headers.get(headers::PAYMENT_SIGNATURE) {
        let Some(payload) = value.to_str().ok().and_then(pay::decode_http_payment) else {
            return (
                StatusCode::BAD_REQUEST,
                "PAYMENT-SIGNATURE is not base64-encoded JSON",
            )
                .into_response();
        };
        let (parts, body) = match mcp_body.as_deref().and_then(pay::extract_mcp_payment) {
            Some((_, _, stripped)) => {
                let mut parts = parts;
                parts.headers.remove(header::CONTENT_LENGTH);
                (parts, Body::from(stripped))
            }
            None => (parts, body),
        };
        return pay::handle_paid(gw, paid(parts, body, payload, Transport::Http)).await;
    }
    // MCP-native transport: params._meta["x402/payment"] (KB-X402-05). The origin gets the
    // body with the payment removed.
    if let Some((payload, id, stripped)) = mcp_body.as_deref().and_then(pay::extract_mcp_payment) {
        // The body shrank, so the client's Content-Length no longer describes it.
        let mut parts = parts;
        parts.headers.remove(header::CONTENT_LENGTH);
        return pay::handle_paid(
            gw,
            paid(parts, Body::from(stripped), payload, Transport::Mcp { id }),
        )
        .await;
    }
    if parts.headers.contains_key(headers::X_PAYMENT) {
        return challenge(
            gw,
            &parts,
            tag,
            verdict,
            "x402 v1 X-PAYMENT is not supported; pay with x402 v2 PAYMENT-SIGNATURE",
        );
    }
    let native = gw
        .config
        .mcp
        .as_ref()
        .is_some_and(|m| m.challenge == McpChallenge::McpNative);
    if native && let Some(id) = mcp_body.as_deref().and_then(single_tool_call_id) {
        return mcp_challenge(
            gw,
            &parts,
            tag,
            verdict,
            "payment required: retry with params._meta[\"x402/payment\"]",
            id,
        );
    }
    challenge(
        gw,
        &parts,
        tag,
        verdict,
        "PAYMENT-SIGNATURE header is required",
    )
}

/// HTTP 402 with `PAYMENT-REQUIRED` (KB-X402-01) and the same PaymentRequired as JSON body.
pub(crate) fn challenge(
    gw: &Gateway,
    parts: &axum::http::request::Parts,
    tag: &PriceTag,
    verdict: &Verdict,
    error: &str,
) -> Response {
    let required = x402::payment_required(&gw.networks, tag, resource_url(gw, parts, tag), error);
    let mut res = (StatusCode::PAYMENT_REQUIRED, Json(&required)).into_response();
    challenge_headers(&mut res, &required, verdict);
    res
}

/// MCP-native challenge (KB-X402-05): a JSON-RPC tool result with `isError: true` carrying
/// PaymentRequired in `structuredContent` and as JSON text in `content[0]`.
pub(crate) fn mcp_challenge(
    gw: &Gateway,
    parts: &axum::http::request::Parts,
    tag: &PriceTag,
    verdict: &Verdict,
    error: &str,
    id: Value,
) -> Response {
    let required = x402::payment_required(&gw.networks, tag, resource_url(gw, parts, tag), error);
    let text = serde_json::to_string(&required).expect("x402 types always serialize");
    let body = json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": { "isError": true, "structuredContent": required, "content": [{ "type": "text", "text": text }] }
    });
    let mut res = (StatusCode::OK, Json(body)).into_response();
    challenge_headers(&mut res, &required, verdict);
    res
}

fn challenge_headers(res: &mut Response, required: &x402::PaymentRequired, verdict: &Verdict) {
    let h = res.headers_mut();
    h.insert(
        headers::PAYMENT_REQUIRED,
        HeaderValue::from_str(&x402::encode_header(required)).expect("base64 is a valid header"),
    );
    if let Ok(reason) = HeaderValue::from_str(&verdict.reason) {
        h.insert("x-agenttoll-verdict", reason);
    }
}

/// The URL a quote is for. MCP tools share one endpoint, so the tool goes in the fragment:
/// a payment echoing `resource` is then bound to that tool, not just to `/mcp`.
pub(crate) fn resource_url(
    gw: &Gateway,
    parts: &axum::http::request::Parts,
    tag: &PriceTag,
) -> String {
    let base = base_resource_url(gw, parts);
    match tag.resource.starts_with("mcp:") {
        true => format!("{base}#{}", tag.resource),
        false => base,
    }
}

fn base_resource_url(gw: &Gateway, parts: &axum::http::request::Parts) -> String {
    let path_and_query = parts.uri.path_and_query().map_or("/", |pq| pq.as_str());
    match &gw.config.public_url {
        Some(base) => format!("{}{path_and_query}", base.trim_end_matches('/')),
        None => {
            let host = parts
                .headers
                .get(header::HOST)
                .and_then(|h| h.to_str().ok())
                .unwrap_or("localhost");
            format!("http://{host}{path_and_query}")
        }
    }
}

pub(crate) fn jsonrpc_error(status: StatusCode, id: Value, code: i64, message: &str) -> Response {
    let body = json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } });
    (status, Json(body)).into_response()
}

/// The JSON-RPC id of a body that is exactly one `tools/call` request.
fn single_tool_call_id(body: &[u8]) -> Option<Value> {
    let msg: Value = serde_json::from_slice(body).ok()?;
    (msg.get("method")?.as_str()? == "tools/call")
        .then(|| msg.get("id").cloned().unwrap_or(Value::Null))
}

fn is_tools_list(body: &[u8]) -> bool {
    serde_json::from_slice::<Value>(body)
        .is_ok_and(|m| m.get("method").and_then(Value::as_str) == Some("tools/list"))
}

/// Agent traffic that was not charged feeds the "not billing yet" report. Humans are never
/// logged. Written off the request path.
fn log_unbilled(gw: &Gateway, path: &str, verdict: &Verdict, status: u16) {
    let ledger = gw.ledger.clone();
    let req = UnbilledRequest {
        ts: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| d.as_millis() as i64),
        route: agenttoll_core::path::normalize(path),
        agent_name: verdict.agent.clone(),
        reason: verdict.reason.clone(),
        status,
    };
    tokio::spawn(async move {
        if let Err(e) = ledger.log_unbilled(req).await {
            tracing::warn!(error = %e, "request log write failed");
        }
    });
}

/// Appends each paid tool's price to its `tools/list` description so agents can plan spend
/// (paid-mcp-tools skill, `mcp.advertise_prices`). JSON responses only; anything else passes.
async fn advertise_prices(gw: &Gateway, res: Response) -> Response {
    let Some(mcp_config) = &gw.config.mcp else {
        return res;
    };
    let is_json = res
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|t| t.starts_with("application/json"));
    if !is_json {
        return res;
    }
    let (mut parts, body) = res.into_parts();
    let Ok(bytes) = to_bytes(body, MCP_BODY_LIMIT).await else {
        return (StatusCode::BAD_GATEWAY, "MCP response too large").into_response();
    };
    let rewritten = serde_json::from_slice::<Value>(&bytes)
        .ok()
        .and_then(|mut msg| {
            for tool in msg.pointer_mut("/result/tools")?.as_array_mut()? {
                let Some(name) = tool.get("name").and_then(Value::as_str) else {
                    continue;
                };
                let price = mcp_config
                    .tools
                    .get(name)
                    .copied()
                    .unwrap_or(mcp_config.default_tool_price_usd);
                if price.is_free() {
                    continue;
                }
                let description = tool
                    .get("description")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                tool["description"] = json!(
                    format!("{description} (Paid tool: ${price} USDC per call via x402.)")
                        .trim_start()
                );
            }
            serde_json::to_vec(&msg).ok()
        });
    parts.headers.remove(header::CONTENT_LENGTH);
    Response::from_parts(
        parts,
        Body::from(rewritten.unwrap_or_else(|| bytes.to_vec())),
    )
}

/// `GET /.well-known/agenttoll.json`: every price and payment option, so an agent can budget
/// before it calls anything.
fn discovery(gw: &Gateway) -> Response {
    let networks: Vec<Value> = gw
        .networks
        .iter()
        .map(|n| json!({ "network": n.config.network, "scheme": "exact", "asset": n.config.asset, "payTo": n.config.pay_to }))
        .collect();
    let routes: Vec<Value> = gw
        .config
        .routes
        .iter()
        .map(|r| json!({ "match": r.pattern, "priceUsd": r.price_usd.to_string(), "description": r.description }))
        .collect();
    let mcp = gw.config.mcp.as_ref().map(|m| {
        let tools: Map<String, Value> = m
            .tools
            .iter()
            .map(|(name, price)| (name.clone(), json!(price.to_string())))
            .collect();
        json!({
            "endpoint": m.endpoint,
            "tools": tools,
            "defaultToolPriceUsd": m.default_tool_price_usd.to_string(),
            "paymentTransports": ["http-402", "mcp-native"],
        })
    });
    let detection = match gw.config.detection {
        DetectionMode::AgentsOnly => "agents-only",
        DetectionMode::AllRequests => "all-requests",
        DetectionMode::Off => "off",
    };
    Json(json!({
        "agenttoll": env!("CARGO_PKG_VERSION"),
        "x402Version": x402::X402_VERSION,
        "detection": detection,
        "networks": networks,
        "routes": routes,
        "mcp": mcp,
    }))
    .into_response()
}
