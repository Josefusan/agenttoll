//! AgentToll gateway: a reverse proxy that lets humans through free and answers priced
//! agent requests with an x402 v2 challenge (ARCHITECTURE.md §1.1).

pub mod proxy;
pub mod supported;
pub mod x402;

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use agenttoll_core::config::Config;
use agenttoll_core::detector::{self, Context, RequestView, Verdict};
use agenttoll_core::headers;
use agenttoll_core::mcp;
use agenttoll_core::pricer::{PriceTag, Pricer};
use axum::Router;
use axum::body::{Body, to_bytes};
use axum::extract::{ConnectInfo, Request, State};
use axum::http::{HeaderValue, Method, StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde_json::json;

use crate::x402::QuoteNetwork;

/// MCP POST bodies are buffered for tool-name inspection, up to this size.
pub const MCP_BODY_LIMIT: usize = 1024 * 1024;

pub struct Gateway {
    pub config: Config,
    pricer: Pricer,
    networks: Vec<QuoteNetwork>,
    client: reqwest::Client,
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
        for (name, net) in &config.networks {
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
        Ok(Arc::new(Gateway {
            config,
            pricer,
            networks,
            client,
        }))
    }

    pub fn networks(&self) -> &[QuoteNetwork] {
        &self.networks
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
    let is_mcp = gw.pricer.is_mcp_endpoint(&path);

    // MCP POST bodies are buffered so the tool name can be priced; everything else streams.
    let (body, price) = if is_mcp && parts.method == Method::POST {
        let Ok(bytes) = to_bytes(body, MCP_BODY_LIMIT).await else {
            return (
                StatusCode::PAYLOAD_TOO_LARGE,
                "MCP request body exceeds 1 MiB",
            )
                .into_response();
        };
        match mcp::inspect(&bytes) {
            Ok(inspection) => (Body::from(bytes), gw.pricer.price_mcp(&inspection)),
            Err(e) => return jsonrpc_error(StatusCode::BAD_REQUEST, -32700, &e.to_string()),
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
        // Verify → forward → settle lands in D3. Until then a payment is refused, never
        // forwarded unverified.
        let error = if parts.headers.contains_key(headers::PAYMENT_SIGNATURE) {
            "payment verification is not enabled on this gateway yet"
        } else if parts.headers.contains_key(headers::X_PAYMENT) {
            "x402 v1 X-PAYMENT is not supported; pay with x402 v2 PAYMENT-SIGNATURE"
        } else {
            "PAYMENT-SIGNATURE header is required"
        };
        return challenge(&gw, &parts, tag, &verdict, error);
    }

    proxy::forward(&gw.client, &gw.config, parts, body, peer).await
}

fn challenge(
    gw: &Gateway,
    parts: &axum::http::request::Parts,
    tag: &PriceTag,
    verdict: &Verdict,
    error: &str,
) -> Response {
    let url = resource_url(gw, parts);
    let required = x402::payment_required(&gw.networks, tag, url, error);
    let mut res = (StatusCode::PAYMENT_REQUIRED, axum::Json(&required)).into_response();
    let h = res.headers_mut();
    h.insert(
        headers::PAYMENT_REQUIRED,
        HeaderValue::from_str(&x402::encode_header(&required)).expect("base64 is a valid header"),
    );
    if let Ok(reason) = HeaderValue::from_str(&verdict.reason) {
        h.insert("x-agenttoll-verdict", reason);
    }
    res
}

fn resource_url(gw: &Gateway, parts: &axum::http::request::Parts) -> String {
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

fn jsonrpc_error(status: StatusCode, code: i64, message: &str) -> Response {
    let body =
        json!({ "jsonrpc": "2.0", "id": null, "error": { "code": code, "message": message } });
    (status, axum::Json(body)).into_response()
}
