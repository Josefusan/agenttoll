//! Demo origin: the founder's site that AgentToll sits in front of. A homepage and blog for
//! humans, a JSON API and an MCP endpoint for agents, and a failing route to prove that
//! agents are never charged for origin errors.

use std::time::{SystemTime, UNIX_EPOCH};

use axum::extract::Path;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{Html, IntoResponse};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::{Value, json};

#[tokio::main]
async fn main() {
    let addr = std::env::var("ORIGIN_LISTEN").unwrap_or_else(|_| "127.0.0.1:4000".into());
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .expect("bind ORIGIN_LISTEN");
    println!("demo origin listening on http://{addr}");
    axum::serve(listener, app()).await.expect("serve");
}

fn app() -> Router {
    Router::new()
        .route("/", get(home))
        .route("/blog/{slug}", get(blog))
        .route("/api/quote", get(quote))
        .route("/api/fail", get(fail))
        .route("/mcp", post(mcp))
}

async fn home() -> Html<&'static str> {
    Html(concat!(
        "<!doctype html><html lang=en><head><meta charset=utf-8><title>Acme Data</title></head>",
        "<body><h1>Acme Data</h1><p>Humans read this page for free.</p>",
        "<p><a href=/blog/agent-economy>Read the blog</a></p></body></html>"
    ))
}

async fn blog(Path(slug): Path<String>) -> Html<String> {
    let slug: String = slug
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
        .collect();
    Html(format!(
        "<!doctype html><html lang=en><head><meta charset=utf-8><title>{slug}</title></head>\
         <body><h1>{slug}</h1><p>A blog post agents pay a tenth of a cent to read.</p></body></html>"
    ))
}

/// Paid data. Echoes the headers AgentToll adds so the demo can show them.
async fn quote(headers: HeaderMap) -> Json<Value> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let header = |name: &str| {
        headers
            .get(name)
            .and_then(|v| v.to_str().ok())
            .map(str::to_owned)
    };
    Json(json!({
        "symbol": "SOL/USD",
        "price": 140.0 + (now % 600) as f64 / 100.0,
        "as_of": now,
        "paid": header("x-agenttoll-paid").is_some(),
        "agent": header("x-agenttoll-agent"),
    }))
}

async fn fail() -> impl IntoResponse {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({ "error": "origin is down on purpose" })),
    )
}

/// Minimal MCP Streamable HTTP server: JSON responses only, no sessions.
async fn mcp(Json(req): Json<Value>) -> impl IntoResponse {
    let id = req.get("id").cloned();
    let method = req.get("method").and_then(Value::as_str).unwrap_or("");
    let result = match method {
        "initialize" => json!({
            "protocolVersion": "2025-06-18",
            "capabilities": { "tools": {} },
            "serverInfo": { "name": "acme-data", "version": "0.1.0" }
        }),
        "tools/list" => json!({ "tools": [
            tool("search_docs", "Search Acme's documentation."),
            tool("generate_report", "Generate a market report."),
            tool("ping_free", "A free tool."),
        ]}),
        "tools/call" => {
            let name = req
                .pointer("/params/name")
                .and_then(Value::as_str)
                .unwrap_or("");
            let query = req
                .pointer("/params/arguments/query")
                .and_then(Value::as_str)
                .unwrap_or("");
            let text = match name {
                "search_docs" => format!("3 results for {query:?}: install, configure, pricing."),
                "generate_report" => "SOL demand from agents rose 40% week over week.".into(),
                "ping_free" => "pong".into(),
                _ => {
                    return rpc_error(id, -32602, &format!("unknown tool {name:?}"))
                        .into_response();
                }
            };
            json!({ "content": [{ "type": "text", "text": text }], "isError": false })
        }
        m if m.starts_with("notifications/") => return StatusCode::ACCEPTED.into_response(),
        "ping" => json!({}),
        _ => return rpc_error(id, -32601, "method not found").into_response(),
    };
    Json(json!({ "jsonrpc": "2.0", "id": id, "result": result })).into_response()
}

fn tool(name: &str, description: &str) -> Value {
    json!({
        "name": name,
        "description": description,
        "inputSchema": { "type": "object", "properties": { "query": { "type": "string" } } }
    })
}

fn rpc_error(id: Option<Value>, code: i64, message: &str) -> Json<Value> {
    Json(json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } }))
}
