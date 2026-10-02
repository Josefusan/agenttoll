//! End-to-end over real sockets: mock origin + mock facilitator + gateway (D2 acceptance:
//! agent UA gets 402 with a valid base64 PaymentRequired, browser UA gets 200).

use std::net::SocketAddr;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use agenttoll_core::config::Config;
use agenttoll_gateway::x402::{PaymentRequired, decode_header};
use agenttoll_gateway::{Gateway, router};
use axum::Json;
use axum::http::HeaderMap;
use axum::routing::{get, post};
use serde_json::{Value, json};

const CHROME: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const CLAUDEBOT: &str = "Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)";
const SOLANA_DEVNET: &str = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"; // KB-SOL-01

struct Harness {
    gateway: String,
    origin_hits: Arc<AtomicUsize>,
    http: reqwest::Client,
}

async fn serve(app: axum::Router) -> SocketAddr {
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

fn headers_json(h: &HeaderMap) -> Value {
    let map: serde_json::Map<String, Value> = h
        .iter()
        .map(|(k, v)| (k.to_string(), json!(v.to_str().unwrap_or(""))))
        .collect();
    Value::Object(map)
}

async fn start(pin_fee_payer: bool) -> Harness {
    let hits = Arc::new(AtomicUsize::new(0));
    let counter = hits.clone();
    let origin = axum::Router::new()
        .route("/", get(|| async { "home" }))
        .route(
            "/api/quote",
            get(move |h: HeaderMap| {
                let counter = counter.clone();
                async move {
                    counter.fetch_add(1, Ordering::SeqCst);
                    Json(json!({ "price": 142.0, "headers": headers_json(&h) }))
                }
            }),
        )
        .route(
            "/echo",
            get(|h: HeaderMap| async move { Json(headers_json(&h)) }),
        )
        .route(
            "/mcp",
            post(|body: String| async move { body }).get(|| async { "sse" }),
        );
    let origin = serve(origin).await;

    let facilitator = axum::Router::new().route("/supported", get(|| async {
        Json(json!({ "kinds": [
            { "x402Version": 1, "scheme": "exact", "network": "solana-devnet", "extra": { "feePayer": "WrongVersion" } },
            { "x402Version": 2, "scheme": "exact", "network": SOLANA_DEVNET, "extra": { "feePayer": "FacilitatorFeePayer111" } }
        ], "extensions": [], "signers": {} }))
    }));
    let facilitator = serve(facilitator).await;

    let pin = if pin_fee_payer {
        "    fee_payer: PinnedFeePayer111\n"
    } else {
        ""
    };
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
{pin}  base:
    network: "eip155:84532"
    asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
    pay_to: "0x0000000000000000000000000000000000000001"
    facilitator: "http://{facilitator}"
routes:
  - match: "GET /api/quote"
    price_usd: "0.002"
    description: "Live price quote"
  - match: "/blog/*"
    price_usd: "0.003"
  - match: "/*"
    price_usd: "0"
mcp:
  endpoint: /mcp
  tools:
    search_docs: "0.005"
"#
    );
    let config = Config::parse(&text, |_| None).unwrap();
    let gateway = serve(router(Gateway::new(config).await.unwrap())).await;
    Harness {
        gateway: format!("http://{gateway}"),
        origin_hits: hits,
        http: reqwest::Client::new(),
    }
}

impl Harness {
    async fn get(&self, path: &str, ua: &str, extra: &[(&str, &str)]) -> reqwest::Response {
        let mut req = self
            .http
            .get(format!("{}{path}", self.gateway))
            .header("user-agent", ua);
        if ua.starts_with("Mozilla/5.0 (Mac") {
            req = req
                .header("accept-language", "en-US")
                .header("sec-fetch-mode", "navigate");
        }
        for (k, v) in extra {
            req = req.header(*k, *v);
        }
        req.send().await.unwrap()
    }

    async fn mcp(&self, body: &str) -> reqwest::Response {
        self.http
            .post(format!("{}/mcp", self.gateway))
            .header("content-type", "application/json")
            .body(body.to_string())
            .send()
            .await
            .unwrap()
    }

    fn hits(&self) -> usize {
        self.origin_hits.load(Ordering::SeqCst)
    }
}

fn challenge(res: &reqwest::Response) -> PaymentRequired {
    let header = res
        .headers()
        .get("payment-required")
        .expect("PAYMENT-REQUIRED header")
        .to_str()
        .unwrap();
    decode_header(header).expect("PAYMENT-REQUIRED decodes to PaymentRequired")
}

#[tokio::test]
async fn human_gets_the_page_free() {
    let h = start(true).await;
    let res = h.get("/api/quote", CHROME, &[]).await;
    assert_eq!(res.status(), 200);
    assert!(res.headers().get("payment-required").is_none());
    let body: Value = res.json().await.unwrap();
    assert_eq!(body["price"], 142.0);
    assert_eq!(h.hits(), 1);
}

#[tokio::test]
async fn agent_gets_a_valid_402_and_never_reaches_the_origin() {
    let h = start(true).await;
    let res = h.get("/api/quote?symbol=SOL", CLAUDEBOT, &[]).await;
    assert_eq!(res.status(), 402);
    assert_eq!(res.headers()["x-agenttoll-verdict"], "ua:ClaudeBot");
    let pr = challenge(&res);
    assert_eq!(pr.x402_version, 2);
    assert!(
        pr.resource.url.ends_with("/api/quote?symbol=SOL"),
        "{}",
        pr.resource.url
    );
    assert_eq!(pr.resource.description.as_deref(), Some("Live price quote"));
    assert_eq!(
        pr.accepts.len(),
        2,
        "one accepts entry per configured network"
    );

    let base = pr
        .accepts
        .iter()
        .find(|a| a.network == "eip155:84532")
        .unwrap();
    assert_eq!(base.extra["name"], "USDC");
    let sol = pr
        .accepts
        .iter()
        .find(|a| a.network == SOLANA_DEVNET)
        .unwrap();
    assert_eq!(sol.scheme, "exact");
    assert_eq!(sol.amount, "2000"); // $0.002, KB-AMT-01
    assert_eq!(sol.asset, "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
    assert_eq!(sol.pay_to, "MerchantPayTo111");
    assert_eq!(sol.extra["feePayer"], "PinnedFeePayer111");

    // The JSON body carries the same challenge for clients that read bodies.
    let body: PaymentRequired = res.json().await.unwrap();
    assert_eq!(body, pr);
    assert_eq!(h.hits(), 0);
}

#[tokio::test]
async fn fee_payer_is_read_from_facilitator_supported() {
    let h = start(false).await;
    let pr = challenge(&h.get("/api/quote", CLAUDEBOT, &[]).await);
    let sol = pr
        .accepts
        .iter()
        .find(|a| a.network == SOLANA_DEVNET)
        .unwrap();
    assert_eq!(sol.extra["feePayer"], "FacilitatorFeePayer111");
}

#[tokio::test]
async fn agents_pass_free_routes_and_heuristic_agents_are_not_charged() {
    let h = start(true).await;
    assert_eq!(h.get("/", CLAUDEBOT, &[]).await.status(), 200);
    assert_eq!(h.get("/api/quote", "curl/8.9.1", &[]).await.status(), 200);
    assert_eq!(h.hits(), 1);
}

#[tokio::test]
async fn path_tricks_still_pay() {
    let h = start(true).await;
    for path in ["/api/%71uote", "/api//quote", "/api/quote/"] {
        assert_eq!(h.get(path, CLAUDEBOT, &[]).await.status(), 402, "{path}");
    }
    assert_eq!(h.hits(), 0);
}

#[tokio::test]
async fn unverified_payment_is_refused_not_forwarded() {
    let h = start(true).await;
    for (header, error) in [
        ("payment-signature", "not enabled"),
        ("x-payment", "v1 X-PAYMENT is not supported"),
    ] {
        let res = h
            .get("/api/quote", CLAUDEBOT, &[(header, "eyJmYWtlIjp0cnVlfQ==")])
            .await;
        assert_eq!(res.status(), 402, "{header}");
        assert!(challenge(&res).error.unwrap().contains(error), "{header}");
    }
    // A browser that attaches a payment header is an agent trying to pay: same refusal.
    let res = h
        .get("/api/quote", CHROME, &[("payment-signature", "e30=")])
        .await;
    assert_eq!(res.status(), 402);
    assert_eq!(h.hits(), 0);
}

#[tokio::test]
async fn origin_never_sees_spoofed_or_payment_headers() {
    let h = start(true).await;
    let res = h
        .get(
            "/echo",
            CHROME,
            &[
                ("x-agenttoll-paid", "1"),
                ("payment-signature", "e30="),
                ("connection", "x-hop"),
                ("x-hop", "1"),
            ],
        )
        .await;
    assert_eq!(res.status(), 200);
    let seen: Value = res.json().await.unwrap();
    for gone in ["x-agenttoll-paid", "payment-signature", "x-hop"] {
        assert!(seen.get(gone).is_none(), "origin saw {gone}: {seen}");
    }
    assert_eq!(seen["x-forwarded-for"], "127.0.0.1");
    assert!(
        seen["x-forwarded-host"]
            .as_str()
            .unwrap()
            .starts_with("127.0.0.1:")
    );
}

#[tokio::test]
async fn mcp_tools_priced_per_call_discovery_free() {
    let h = start(true).await;
    let list = h
        .mcp(r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#)
        .await;
    assert_eq!(list.status(), 200);
    assert!(
        list.text().await.unwrap().contains("tools/list"),
        "body replayed to origin intact"
    );

    let free_tool = h
        .mcp(r#"{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"ping_free"}}"#)
        .await;
    assert_eq!(free_tool.status(), 200);

    for path in ["/MCP", "/Mcp/"] {
        let res = h
            .http
            .post(format!("{}{path}", h.gateway))
            .header("content-type", "application/json")
            .body(
                r#"{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"search_docs"}}"#,
            )
            .send()
            .await
            .unwrap();
        assert_eq!(res.status(), 402, "{path} must be priced like /mcp");
    }

    let paid = h
        .mcp(r#"{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"search_docs"}}"#)
        .await;
    assert_eq!(paid.status(), 402);
    let pr = challenge(&paid);
    assert_eq!(pr.accepts[0].amount, "5000");
    assert_eq!(pr.resource.description.as_deref(), Some("mcp:search_docs"));
}

#[tokio::test]
async fn mcp_get_is_never_charged() {
    let h = start(true).await;
    assert_eq!(h.get("/mcp", CHROME, &[]).await.status(), 200);
    assert_eq!(h.get("/mcp", CLAUDEBOT, &[]).await.status(), 200);
}

#[tokio::test]
async fn malformed_and_oversized_mcp_bodies_are_rejected() {
    let h = start(true).await;
    assert_eq!(h.mcp("{not json").await.status(), 400);
    let big = format!(
        r#"{{"jsonrpc":"2.0","id":1,"method":"tools/list","pad":"{}"}}"#,
        "x".repeat(1024 * 1024)
    );
    assert_eq!(h.mcp(&big).await.status(), 413);
}
