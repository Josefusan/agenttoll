//! End to end over real sockets: verify → forward → settle against a mock facilitator whose
//! answers each test controls, for both payment transports (HTTP header and MCP-native),
//! plus the admin API, the unbilled-traffic log, discovery and MCP price advertising.

use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use agenttoll_core::config::Config;
use agenttoll_gateway::x402::{PaymentRequired, decode_header, encode_header};
use agenttoll_gateway::{Gateway, admin, router};
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::{Value, json};

const CLAUDEBOT: &str = "Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)";
const SOLANA_DEVNET: &str = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const BASE_SEPOLIA: &str = "eip155:84532";

#[derive(Default)]
struct Facilitator {
    reject_verify: AtomicBool,
    fail_settle: AtomicBool,
    slow_settle: AtomicBool,
    verify_calls: AtomicUsize,
    settle_calls: AtomicUsize,
    last_settle: Mutex<Option<Value>>,
}

struct Harness {
    url: String,
    gateway: Arc<Gateway>,
    fac: Arc<Facilitator>,
    origin_hits: Arc<AtomicUsize>,
    /// Last JSON-RPC body the origin's /mcp endpoint received.
    mcp_seen: Arc<Mutex<Option<Value>>>,
    http: reqwest::Client,
}

async fn serve(app: Router) -> SocketAddr {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(
            listener,
            app.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await
        .unwrap();
    });
    addr
}

async fn verify(
    State(f): State<Arc<Facilitator>>,
    Json(body): Json<Value>,
) -> (StatusCode, Json<Value>) {
    f.verify_calls.fetch_add(1, Ordering::SeqCst);
    assert_eq!(body["x402Version"], 2);
    if f.reject_verify.load(Ordering::SeqCst) {
        // Facilitators may reject with a 4xx that still carries a well-formed body.
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "isValid": false, "invalidReason": "insufficient_funds" })),
        );
    }
    (
        StatusCode::OK,
        Json(json!({ "isValid": true, "payer": "BuyerWallet111" })),
    )
}

async fn settle(State(f): State<Arc<Facilitator>>, Json(body): Json<Value>) -> Json<Value> {
    f.settle_calls.fetch_add(1, Ordering::SeqCst);
    if f.slow_settle.load(Ordering::SeqCst) {
        // Longer than the gateway's settle budget in this harness (500 ms).
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
    }
    let network = body["paymentRequirements"]["network"].clone();
    *f.last_settle.lock().unwrap() = Some(body);
    if f.fail_settle.load(Ordering::SeqCst) {
        return Json(
            json!({ "success": false, "transaction": "", "network": network, "errorReason": "transaction_failed" }),
        );
    }
    let n = f.settle_calls.load(Ordering::SeqCst);
    Json(
        json!({ "success": true, "transaction": format!("5igSettled{n}"), "network": network, "payer": "BuyerWallet111", "amount": "2000" }),
    )
}

async fn start() -> Harness {
    let hits = Arc::new(AtomicUsize::new(0));
    let counter = hits.clone();
    let mcp_seen = Arc::new(Mutex::new(None));
    let seen = mcp_seen.clone();
    let origin = Router::new()
        .route(
            "/api/quote",
            get(move |h: HeaderMap| {
                let counter = counter.clone();
                async move {
                    counter.fetch_add(1, Ordering::SeqCst);
                    let seen: serde_json::Map<String, Value> = h
                        .iter()
                        .map(|(k, v)| (k.to_string(), json!(v.to_str().unwrap_or(""))))
                        .collect();
                    Json(json!({ "price": 142.0, "headers": seen }))
                }
            }),
        )
        .route(
            "/api/fail",
            get(|| async { (StatusCode::INTERNAL_SERVER_ERROR, "origin down") }),
        )
        .route(
            "/api/other",
            get(|| async { Json(json!({ "other": true })) }),
        )
        .route("/", get(|| async { "home" }))
        .route(
            "/mcp",
            post(move |Json(body): Json<Value>| {
                let seen = seen.clone();
                async move { mcp_origin_response(body, &seen) }
            }),
        );
    let origin = serve(origin).await;

    let fac = Arc::new(Facilitator::default());
    let facilitator = Router::new()
        .route("/verify", post(verify))
        .route("/settle", post(settle))
        .with_state(fac.clone());
    let facilitator = serve(facilitator).await;

    let text = format!(
        r#"origin: http://{origin}
listen: 127.0.0.1:0
admin_listen: 127.0.0.1:0
networks:
  solana:
    network: "{SOLANA_DEVNET}"
    asset: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
    pay_to: "MerchantPayTo111"
    facilitator: "http://{facilitator}"
    fee_payer: "FeePayer111"
  base:
    network: "{BASE_SEPOLIA}"
    asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
    pay_to: "0x0000000000000000000000000000000000000001"
    facilitator: "http://{facilitator}"
routes:
  - match: "GET /api/*"
    price_usd: "0.002"
mcp:
  endpoint: /mcp
  advertise_prices: true
  tools:
    search_docs: "0.005"
    broken_tool: "0.005"
    sse_ok: "0.005"
    sse_broken: "0.005"
    gzip_ok: "0.005"
    gzip_broken: "0.005"
    wrong_id: "0.005"
ledger:
  url: "sqlite::memory:"
timeouts:
  settle_ms: 500
"#
    );
    let gateway = Gateway::new(Config::parse(&text, |_| None).unwrap())
        .await
        .unwrap();
    let addr = serve(router(gateway.clone())).await;
    Harness {
        url: format!("http://{addr}"),
        gateway,
        fac,
        origin_hits: hits,
        mcp_seen,
        http: reqwest::Client::new(),
    }
}

impl Harness {
    async fn get(&self, path: &str, payment: Option<&str>) -> reqwest::Response {
        let mut req = self
            .http
            .get(format!("{}{path}", self.url))
            .header("user-agent", CLAUDEBOT);
        if let Some(p) = payment {
            req = req.header("payment-signature", p);
        }
        req.send().await.unwrap()
    }

    /// Fetches the quote for `path` and builds a payment header answering it on `network`.
    async fn pay_for(&self, path: &str, network: &str, tamper: impl Fn(&mut Value)) -> String {
        let res = self.get(path, None).await;
        assert_eq!(res.status(), 402);
        let quote: PaymentRequired =
            decode_header(res.headers()["payment-required"].to_str().unwrap()).unwrap();
        let mut accepted =
            serde_json::to_value(quote.accepts.iter().find(|a| a.network == network).unwrap())
                .unwrap();
        tamper(&mut accepted);
        encode_header(&json!({
            "x402Version": 2,
            "resource": quote.resource,
            "accepted": accepted,
            "payload": { "transaction": signed_tx() }
        }))
    }

    fn calls(&self) -> (usize, usize, usize) {
        (
            self.fac.verify_calls.load(Ordering::SeqCst),
            self.origin_hits.load(Ordering::SeqCst),
            self.fac.settle_calls.load(Ordering::SeqCst),
        )
    }
}

fn payment_response(res: &reqwest::Response) -> Value {
    decode_header(res.headers()["payment-response"].to_str().unwrap())
        .expect("PAYMENT-RESPONSE decodes")
}

#[tokio::test]
async fn paid_request_is_verified_forwarded_settled_and_recorded() {
    let h = start().await;
    let mut feed = h.gateway.ledger().subscribe();
    let payment = h.pay_for("/api/quote", SOLANA_DEVNET, |_| {}).await;

    let res = h.get("/api/quote", Some(&payment)).await;
    assert_eq!(res.status(), 200);
    let receipt = payment_response(&res);
    assert_eq!(receipt["success"], true);
    assert_eq!(receipt["transaction"], "5igSettled1");
    assert_eq!(
        receipt["amount"], "2000",
        "facilitator fields pass through verbatim"
    );

    let body: Value = res.json().await.unwrap();
    assert_eq!(body["price"], 142.0);
    assert_eq!(body["headers"]["x-agenttoll-paid"], "1");
    assert_eq!(body["headers"]["x-agenttoll-agent"], "ClaudeBot");
    assert_eq!(body["headers"]["x-agenttoll-payer"], "BuyerWallet111");
    assert!(body["headers"].get("payment-signature").is_none());
    assert_eq!(h.calls(), (1, 1, 1));

    // The facilitator settled against our quote.
    let settled = h.fac.last_settle.lock().unwrap().clone().unwrap();
    assert_eq!(settled["paymentRequirements"]["payTo"], "MerchantPayTo111");
    assert_eq!(settled["paymentRequirements"]["amount"], "2000");
    assert_eq!(
        settled["paymentRequirements"]["extra"]["feePayer"],
        "FeePayer111"
    );

    let rows = h.gateway.ledger().all().unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].amount_atomic, 2000);
    assert_eq!(rows[0].network, SOLANA_DEVNET);
    assert_eq!(rows[0].tx_signature, "5igSettled1");
    assert_eq!(rows[0].agent_name.as_deref(), Some("ClaudeBot"));
    assert_eq!(rows[0].route, "GET /api/*");
    assert_eq!(
        feed.try_recv().unwrap().tx_signature,
        "5igSettled1",
        "live feed got the event"
    );
}

#[tokio::test]
async fn base_sepolia_payment_works_too() {
    let h = start().await;
    let payment = h.pay_for("/api/quote", BASE_SEPOLIA, |_| {}).await;
    let res = h.get("/api/quote", Some(&payment)).await;
    assert_eq!(res.status(), 200);
    let settled = h.fac.last_settle.lock().unwrap().clone().unwrap();
    assert_eq!(settled["paymentRequirements"]["network"], BASE_SEPOLIA);
    assert_eq!(settled["paymentRequirements"]["extra"]["name"], "USDC");
    assert_eq!(h.gateway.ledger().all().unwrap()[0].network, BASE_SEPOLIA);
}

#[tokio::test]
async fn origin_error_is_never_settled_and_payment_can_be_retried() {
    let h = start().await;
    let payment = h.pay_for("/api/fail", SOLANA_DEVNET, |_| {}).await;
    let res = h.get("/api/fail", Some(&payment)).await;
    assert_eq!(res.status(), 500, "origin status passes through");
    assert_eq!(h.fac.settle_calls.load(Ordering::SeqCst), 0);
    assert!(h.gateway.ledger().all().unwrap().is_empty());

    // Not consumed, so the same payment is not a replay.
    assert_eq!(h.get("/api/fail", Some(&payment)).await.status(), 500);
    assert_eq!(h.fac.verify_calls.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn invalid_payment_never_reaches_the_origin() {
    let h = start().await;
    h.fac.reject_verify.store(true, Ordering::SeqCst);
    let payment = h.pay_for("/api/quote", SOLANA_DEVNET, |_| {}).await;
    let res = h.get("/api/quote", Some(&payment)).await;
    assert_eq!(res.status(), 402);
    let quote: PaymentRequired =
        decode_header(res.headers()["payment-required"].to_str().unwrap()).unwrap();
    assert_eq!(quote.error.as_deref(), Some("insufficient_funds"));
    assert_eq!(h.calls(), (1, 0, 0));
}

#[tokio::test]
async fn tampered_quotes_are_refused_before_verify() {
    let h = start().await;
    let tampers = [
        ("amount", "1"),               // cheaper than quoted
        ("payTo", "AttackerWallet"),   // pay yourself
        ("asset", "FakeMint"),         // worthless token
        ("network", "solana:mainnet"), // a network we did not offer
    ];
    for (field, value) in tampers {
        let payment = h
            .pay_for("/api/quote", SOLANA_DEVNET, |a| a[field] = json!(value))
            .await;
        let res = h.get("/api/quote", Some(&payment)).await;
        assert_eq!(res.status(), 402, "{field}");
    }
    assert_eq!(h.calls(), (0, 0, 0));
}

#[tokio::test]
async fn replayed_payment_is_refused() {
    let h = start().await;
    let payment = h.pay_for("/api/quote", SOLANA_DEVNET, |_| {}).await;
    assert_eq!(h.get("/api/quote", Some(&payment)).await.status(), 200);
    let replay = h.get("/api/quote", Some(&payment)).await;
    assert_eq!(replay.status(), 402);
    let quote: PaymentRequired =
        decode_header(replay.headers()["payment-required"].to_str().unwrap()).unwrap();
    assert_eq!(quote.error.as_deref(), Some("duplicate_settlement"));
    assert_eq!(h.calls(), (1, 1, 1));
}

#[tokio::test]
async fn failed_settlement_withholds_the_content() {
    let h = start().await;
    h.fac.fail_settle.store(true, Ordering::SeqCst);
    let payment = h.pay_for("/api/quote", SOLANA_DEVNET, |_| {}).await;
    let res = h.get("/api/quote", Some(&payment)).await;
    assert_eq!(res.status(), 402);
    assert_eq!(payment_response(&res)["success"], false);
    let body = res.text().await.unwrap();
    assert!(!body.contains("142"), "origin content leaked: {body}");
    assert!(h.gateway.ledger().all().unwrap().is_empty());
}

#[tokio::test]
async fn malformed_payment_headers_are_client_errors() {
    let h = start().await;
    assert_eq!(
        h.get("/api/quote", Some("%%%not-base64")).await.status(),
        400
    );
    let no_accepted = encode_header(&json!({ "x402Version": 2, "payload": {} }));
    assert_eq!(h.get("/api/quote", Some(&no_accepted)).await.status(), 400);
    assert_eq!(h.calls(), (0, 0, 0));
}

static NONCE: AtomicUsize = AtomicUsize::new(0);

/// A fresh stand-in for a signed transaction, so separate payments never look like replays.
fn signed_tx() -> String {
    format!("dHgt{}", NONCE.fetch_add(1, Ordering::SeqCst))
}

/// Minimal MCP origin: records each request body, answers tools/list and tools/call.
fn mcp_origin(body: Value, seen: &Mutex<Option<Value>>) -> Value {
    *seen.lock().unwrap() = Some(body.clone());
    let id = body["id"].clone();
    let result = match (
        body["method"].as_str(),
        body.pointer("/params/name").and_then(Value::as_str),
    ) {
        (Some("tools/list"), _) => json!({ "tools": [
            { "name": "search_docs", "description": "Search the docs." },
            { "name": "ping", "description": "Free." }
        ]}),
        (Some("tools/call"), Some("broken_tool")) => {
            json!({ "isError": true, "content": [{ "type": "text", "text": "tool crashed" }] })
        }
        (Some("tools/call"), Some(name)) => {
            json!({ "content": [{ "type": "text", "text": format!("{name} ok") }] })
        }
        _ => json!({}),
    };
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

impl Harness {
    async fn mcp(&self, body: Value) -> reqwest::Response {
        self.http
            .post(format!("{}/mcp", self.url))
            .json(&body)
            .send()
            .await
            .unwrap()
    }

    /// MCP-native flow: call the tool unpaid, take the challenge from `structuredContent`,
    /// and retry with `params._meta["x402/payment"]`.
    async fn pay_tool(&self, tool: &str) -> reqwest::Response {
        let call = json!({ "jsonrpc": "2.0", "id": 9, "method": "tools/call", "params": { "name": tool, "arguments": {} } });
        let challenge: Value = self.mcp(call.clone()).await.json().await.unwrap();
        assert_eq!(challenge["result"]["isError"], true, "{challenge}");
        let required = &challenge["result"]["structuredContent"];
        let accepted = required["accepts"]
            .as_array()
            .unwrap()
            .iter()
            .find(|a| a["network"] == SOLANA_DEVNET)
            .unwrap();
        let mut paid = call;
        paid["params"]["_meta"] = json!({ "x402/payment": {
            "x402Version": 2,
            "resource": required["resource"],
            "accepted": accepted,
            "payload": { "transaction": signed_tx() }
        }});
        self.mcp(paid).await
    }

    async fn wait_for_unbilled(&self) -> agenttoll_gateway::ledger::Stats {
        for _ in 0..50 {
            let stats = self.gateway.ledger().stats().await.unwrap();
            if stats.totals.unbilled_agent_requests > 0 {
                return stats;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        panic!("unbilled request was never logged");
    }
}

#[tokio::test]
async fn settle_timeout_serves_content_and_records_it_unconfirmed() {
    let h = start().await;
    h.fac.slow_settle.store(true, Ordering::SeqCst);
    let payment = h.pay_for("/api/quote", SOLANA_DEVNET, |_| {}).await;
    let res = h.get("/api/quote", Some(&payment)).await;
    assert_eq!(res.status(), 200, "buyer may have paid, so they are served");
    assert!(
        res.headers().get("payment-response").is_none(),
        "no receipt we cannot vouch for"
    );
    assert!(res.text().await.unwrap().contains("142"));

    let rows = h.gateway.ledger().all().unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(
        rows[0].status,
        agenttoll_gateway::ledger::SettleStatus::Unconfirmed
    );
    assert!(rows[0].tx_signature.starts_with("unconfirmed:"));

    // The payment stays claimed: it may have been consumed.
    let again = h.get("/api/quote", Some(&payment)).await;
    assert_eq!(again.status(), 402);
}

#[tokio::test]
async fn a_payment_is_bound_to_its_resource() {
    let h = start().await;
    let payment = h.pay_for("/api/quote", SOLANA_DEVNET, |_| {}).await;
    let res = h.get("/api/other", Some(&payment)).await; // same price, different resource
    assert_eq!(res.status(), 402);
    let quote: PaymentRequired =
        decode_header(res.headers()["payment-required"].to_str().unwrap()).unwrap();
    assert_eq!(
        quote.error.as_deref(),
        Some("payment was made for a different resource")
    );
    assert_eq!(h.calls(), (0, 0, 0));
}

#[tokio::test]
async fn re_encoding_a_payment_does_not_dodge_the_replay_guard() {
    let h = start().await;
    let payment = h.pay_for("/api/quote", SOLANA_DEVNET, |_| {}).await;
    assert_eq!(h.get("/api/quote", Some(&payment)).await.status(), 200);
    let decoded: Value = decode_header(&payment).unwrap();
    let pretty = base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        serde_json::to_string_pretty(&decoded).unwrap(),
    );
    assert_ne!(pretty, payment);
    assert_eq!(h.get("/api/quote", Some(&pretty)).await.status(), 402);
    assert_eq!(h.calls(), (1, 1, 1));
}

#[tokio::test]
async fn mcp_native_payment_is_settled_and_receipted_in_meta() {
    let h = start().await;
    let res = h.pay_tool("search_docs").await;
    assert_eq!(res.status(), 200);
    assert!(res.headers().get("payment-response").is_some());
    let body: Value = res.json().await.unwrap();
    assert_eq!(body["result"]["content"][0]["text"], "search_docs ok");
    let receipt = &body["result"]["_meta"]["x402/payment-response"];
    assert_eq!(receipt["success"], true, "{body}");

    // The origin never saw the payment.
    let seen = h.mcp_seen.lock().unwrap().clone().unwrap();
    assert!(seen["params"].get("_meta").is_none(), "{seen}");

    let settled = h.fac.last_settle.lock().unwrap().clone().unwrap();
    assert_eq!(settled["paymentRequirements"]["amount"], "5000");
    let rows = h.gateway.ledger().all().unwrap();
    assert_eq!(rows[0].mcp_tool.as_deref(), Some("search_docs"));
    assert_eq!(rows[0].route, "mcp:search_docs");
}

#[tokio::test]
async fn failed_mcp_tool_is_never_settled() {
    let h = start().await;
    let res = h.pay_tool("broken_tool").await;
    assert_eq!(res.status(), 200);
    let body: Value = res.json().await.unwrap();
    assert_eq!(body["result"]["isError"], true);
    assert_eq!(h.fac.settle_calls.load(Ordering::SeqCst), 0);
    assert!(h.gateway.ledger().all().unwrap().is_empty());
}

#[tokio::test]
async fn tools_list_advertises_prices() {
    let h = start().await;
    let res = h
        .mcp(json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" }))
        .await;
    let body: Value = res.json().await.unwrap();
    let tools = body["result"]["tools"].as_array().unwrap();
    assert!(
        tools[0]["description"]
            .as_str()
            .unwrap()
            .contains("$0.005 USDC per call"),
        "{body}"
    );
    assert_eq!(tools[1]["description"], "Free.");
}

#[tokio::test]
async fn discovery_lists_every_price() {
    let h = start().await;
    let d: Value = h
        .http
        .get(format!("{}/.well-known/agenttoll.json", h.url))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(d["x402Version"], 2);
    assert_eq!(d["routes"][0]["priceUsd"], "0.002");
    assert_eq!(d["mcp"]["tools"]["search_docs"], "0.005");
    assert_eq!(d["networks"].as_array().unwrap().len(), 2);
}

#[tokio::test]
async fn agent_traffic_on_free_routes_is_logged_humans_are_not() {
    let h = start().await;
    h.http
        .get(format!("{}/", h.url))
        .header("user-agent", "Mozilla/5.0 (Macintosh) Chrome/141")
        .header("accept-language", "en")
        .header("sec-fetch-mode", "navigate")
        .send()
        .await
        .unwrap();
    assert_eq!(h.get("/", None).await.status(), 200);
    let stats = h.wait_for_unbilled().await;
    assert_eq!(
        stats.totals.unbilled_agent_requests, 1,
        "only the agent is logged"
    );
    assert_eq!(stats.unbilled[0].agent, "ClaudeBot");
}

#[tokio::test]
async fn admin_api_requires_its_token_and_streams_payments() {
    let h = start().await;
    let token = "test-admin-token-0123456789";
    let admin = format!(
        "http://{}",
        serve(admin::router(h.gateway.ledger().clone(), token.into()).unwrap()).await
    );

    let denied = h
        .http
        .get(format!("{admin}/admin/stats"))
        .send()
        .await
        .unwrap();
    assert_eq!(denied.status(), 401);
    let wrong = h
        .http
        .get(format!("{admin}/admin/stats"))
        .bearer_auth("nope")
        .send()
        .await
        .unwrap();
    assert_eq!(wrong.status(), 401);

    let mut stream = h
        .http
        .get(format!("{admin}/admin/events?token={token}"))
        .send()
        .await
        .unwrap();
    assert_eq!(stream.status(), 200);
    // The first frame is a comment sent right away, before any payment exists.
    let hello = tokio::time::timeout(std::time::Duration::from_secs(2), stream.chunk())
        .await
        .expect("initial SSE frame within 2s")
        .unwrap()
        .unwrap();
    assert!(
        String::from_utf8_lossy(&hello).starts_with(": connected"),
        "{hello:?}"
    );
    let payment = h.pay_for("/api/quote", SOLANA_DEVNET, |_| {}).await;
    assert_eq!(h.get("/api/quote", Some(&payment)).await.status(), 200);

    let mut seen = String::new();
    while !seen.contains("event: revenue") {
        let chunk = tokio::time::timeout(std::time::Duration::from_secs(2), stream.chunk())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        seen.push_str(&String::from_utf8_lossy(&chunk));
    }
    assert!(seen.contains("\"status\":\"settled\""), "{seen}");

    let stats: Value = h
        .http
        .get(format!("{admin}/admin/stats"))
        .bearer_auth(token)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(stats["totals"]["revenue_atomic"], 2000);
    assert_eq!(stats["by_agent"][0]["agent"], "ClaudeBot");
    assert_eq!(stats["recent"][0]["simulated"], false);
}

/// Wraps [`mcp_origin`] in the transports real MCP servers use: `sse_*` tools answer as an
/// SSE stream with a progress notification first; `gzip_*` tools answer gzip-compressed.
fn mcp_origin_response(body: Value, seen: &Mutex<Option<Value>>) -> axum::response::Response {
    use axum::response::IntoResponse;
    let tool = body
        .pointer("/params/name")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let mut message = mcp_origin(body, seen);
    if tool == "wrong_id" {
        message["id"] = json!(12345);
    }
    if tool.ends_with("_broken") {
        message["result"] =
            json!({ "isError": true, "content": [{ "type": "text", "text": "tool crashed" }] });
    }
    if tool.starts_with("sse_") {
        let note = json!({ "jsonrpc": "2.0", "method": "notifications/message", "params": { "level": "info", "data": "working" } });
        let text = format!("event: message\ndata: {note}\n\nevent: message\ndata: {message}\n\n");
        return ([("content-type", "text/event-stream")], text).into_response();
    }
    if tool.starts_with("gzip_") {
        use std::io::Write;
        let mut enc = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        enc.write_all(message.to_string().as_bytes()).unwrap();
        return (
            [
                ("content-type", "application/json"),
                ("content-encoding", "gzip"),
            ],
            enc.finish().unwrap(),
        )
            .into_response();
    }
    Json(message).into_response()
}

#[tokio::test]
async fn sse_tool_error_after_a_notification_is_not_settled() {
    let h = start().await;
    let res = h.pay_tool("sse_broken").await;
    assert_eq!(res.status(), 200);
    assert_eq!(
        h.fac.settle_calls.load(Ordering::SeqCst),
        0,
        "a crashed tool is never charged"
    );
    assert!(h.gateway.ledger().all().unwrap().is_empty());
}

#[tokio::test]
async fn sse_tool_success_after_a_notification_is_settled() {
    let h = start().await;
    let res = h.pay_tool("sse_ok").await;
    assert_eq!(res.status(), 200);
    assert!(res.headers().get("payment-response").is_some());
    assert_eq!(h.fac.settle_calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn compressed_tool_response_is_never_settled_and_never_served_unpaid() {
    let h = start().await;
    // A compressed success cannot be verified: withheld, not settled, not served.
    let res = h.pay_tool("gzip_ok").await;
    assert_eq!(res.status(), 502);
    assert!(!res.text().await.unwrap().contains("ok"));
    // A compressed failure cannot be proven a failure either: also withheld.
    assert_eq!(h.pay_tool("gzip_broken").await.status(), 502);
    assert_eq!(h.fac.settle_calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn float_id_echoed_as_integer_is_settled_not_leaked() {
    let h = start().await;
    let call = json!({ "jsonrpc": "2.0", "id": 9, "method": "tools/call", "params": { "name": "search_docs" } });
    let challenge: Value = h.mcp(call).await.json().await.unwrap();
    let required = &challenge["result"]["structuredContent"];
    let payment = json!({ "x402Version": 2, "resource": required["resource"], "accepted": required["accepts"][0],
        "payload": { "transaction": signed_tx() } });
    // Raw body so the id stays `9.0`; the mock origin (serde) echoes it back as 9.0 or 9.
    let body = format!(
        r#"{{"jsonrpc":"2.0","id":9.0,"method":"tools/call","params":{{"name":"search_docs","_meta":{{"x402/payment":{payment}}}}}}}"#
    );
    let res = h
        .http
        .post(format!("{}/mcp", h.url))
        .header("content-type", "application/json")
        .body(body)
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200);
    assert_eq!(
        h.fac.settle_calls.load(Ordering::SeqCst),
        1,
        "served content is always paid for"
    );
}

#[tokio::test]
async fn unverifiable_2xx_mcp_content_is_withheld() {
    let h = start().await;
    // The paid call is id 9; the origin answers a different id, so nothing proves success.
    let call = json!({ "jsonrpc": "2.0", "id": 9, "method": "tools/call", "params": { "name": "wrong_id" } });
    let challenge: Value = h.mcp(call.clone()).await.json().await.unwrap();
    let required = &challenge["result"]["structuredContent"];
    let mut paid = call;
    paid["params"]["_meta"] = json!({ "x402/payment": {
        "x402Version": 2, "resource": required["resource"], "accepted": required["accepts"][0],
        "payload": { "transaction": signed_tx() } } });
    let res = h.mcp(paid).await;
    assert_eq!(res.status(), 502);
    assert!(
        !res.text().await.unwrap().contains("wrong_id ok"),
        "no free content"
    );
    assert_eq!(h.fac.settle_calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn paid_mcp_forwards_ask_for_uncompressed_responses() {
    let h = start().await;
    let call = json!({ "jsonrpc": "2.0", "id": 9, "method": "tools/call", "params": { "name": "search_docs" } });
    let challenge: Value = h.mcp(call.clone()).await.json().await.unwrap();
    let required = &challenge["result"]["structuredContent"];
    let mut paid = call;
    paid["params"]["_meta"] = json!({ "x402/payment": {
        "x402Version": 2, "resource": required["resource"], "accepted": required["accepts"][0],
        "payload": { "transaction": signed_tx() } } });
    let res = h
        .http
        .post(format!("{}/mcp", h.url))
        .header("accept-encoding", "gzip")
        .json(&paid)
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200);
    assert_eq!(h.fac.settle_calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn an_mcp_payment_is_bound_to_its_tool() {
    let h = start().await;
    // Quote search_docs, then present that payment on broken_tool (same price).
    let call = json!({ "jsonrpc": "2.0", "id": 9, "method": "tools/call", "params": { "name": "search_docs" } });
    let challenge: Value = h.mcp(call).await.json().await.unwrap();
    let required = &challenge["result"]["structuredContent"];
    assert!(
        required["resource"]["url"]
            .as_str()
            .unwrap()
            .ends_with("/mcp#mcp:search_docs"),
        "{required}"
    );
    let other = json!({ "jsonrpc": "2.0", "id": 10, "method": "tools/call", "params": { "name": "broken_tool", "_meta": { "x402/payment": {
        "x402Version": 2, "resource": required["resource"], "accepted": required["accepts"][0],
        "payload": { "transaction": signed_tx() } } } } });
    let res: Value = h.mcp(other).await.json().await.unwrap();
    assert_eq!(res["result"]["isError"], true);
    assert_eq!(
        res["result"]["structuredContent"]["error"],
        "payment was made for a different resource"
    );
    assert_eq!(h.fac.verify_calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn header_payment_on_mcp_never_leaks_a_body_payment_to_the_origin() {
    let h = start().await;
    let call = json!({ "jsonrpc": "2.0", "id": 9, "method": "tools/call", "params": { "name": "search_docs" } });
    let challenge: Value = h.mcp(call.clone()).await.json().await.unwrap();
    let required = &challenge["result"]["structuredContent"];
    let payment = json!({ "x402Version": 2, "resource": required["resource"], "accepted": required["accepts"][0],
        "payload": { "transaction": signed_tx() } });
    let mut body = call;
    body["params"]["_meta"] = json!({ "x402/payment": payment.clone() });
    let res = h
        .http
        .post(format!("{}/mcp", h.url))
        .header("payment-signature", encode_header(&payment))
        .json(&body)
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200);
    let seen = h.mcp_seen.lock().unwrap().clone().unwrap();
    assert!(seen["params"].get("_meta").is_none(), "{seen}");
}

#[tokio::test]
async fn admin_query_token_only_works_for_events_and_short_tokens_are_refused() {
    let h = start().await;
    assert!(admin::router(h.gateway.ledger().clone(), String::new()).is_err());
    assert!(admin::router(h.gateway.ledger().clone(), "short".into()).is_err());
    let token = "test-admin-token-0123456789";
    let admin = format!(
        "http://{}",
        serve(admin::router(h.gateway.ledger().clone(), token.into()).unwrap()).await
    );
    let via_query = h
        .http
        .get(format!("{admin}/admin/stats?token={token}"))
        .send()
        .await
        .unwrap();
    assert_eq!(via_query.status(), 401);
}

#[tokio::test]
async fn stats_separate_simulated_and_unconfirmed_money() {
    let h = start().await;
    let payment = h.pay_for("/api/quote", SOLANA_DEVNET, |_| {}).await;
    assert_eq!(h.get("/api/quote", Some(&payment)).await.status(), 200);
    h.fac.slow_settle.store(true, Ordering::SeqCst);
    let payment = h.pay_for("/api/other", SOLANA_DEVNET, |_| {}).await;
    assert_eq!(h.get("/api/other", Some(&payment)).await.status(), 200);
    let t = h.gateway.ledger().stats().await.unwrap().totals;
    assert_eq!(t.revenue_atomic, 4000);
    assert_eq!(t.unconfirmed_atomic, 2000);
    assert_eq!(t.simulated_atomic, 0);
}
