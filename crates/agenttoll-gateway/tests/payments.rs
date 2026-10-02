//! D3 end to end: verify → forward → settle against a mock facilitator whose answers each
//! test controls. Proves the money rules in `pay.rs` over real sockets.

use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use agenttoll_core::config::Config;
use agenttoll_gateway::x402::{PaymentRequired, decode_header, encode_header};
use agenttoll_gateway::{Gateway, router};
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
    verify_calls: AtomicUsize,
    settle_calls: AtomicUsize,
    last_settle: Mutex<Option<Value>>,
}

struct Harness {
    url: String,
    gateway: Arc<Gateway>,
    fac: Arc<Facilitator>,
    origin_hits: Arc<AtomicUsize>,
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
ledger:
  url: "sqlite::memory:"
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
            "accepted": accepted,
            "payload": { "transaction": "cGFydGlhbGx5LXNpZ25lZA==" }
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
