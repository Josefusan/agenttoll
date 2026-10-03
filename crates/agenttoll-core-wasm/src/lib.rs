//! wasm-bindgen facade over `agenttoll-core`, so the Cloudflare Worker edition
//! (`workers/agenttoll-edge`) runs the very same config parser, detector, pricer, path
//! normalizer and MCP inspector as the Rust gateway. One source of truth: no rule lives
//! here, only adapters between JS values and core types.
//!
//! Build: `wasm-pack build crates/agenttoll-core-wasm --target web` (see the Worker's
//! `package.json`, script `build:wasm`).

use std::collections::BTreeMap;

use agenttoll_core::config::{Config, DetectionMode, McpChallenge};
use agenttoll_core::detector::{self, Context, Kind, RequestView, Verdict};
use agenttoll_core::mcp;
use agenttoll_core::path;
use agenttoll_core::pricer::{PriceTag, Pricer};
use http::{HeaderMap, HeaderName, HeaderValue, Method};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use wasm_bindgen::prelude::*;

/// A parsed `agenttoll.yaml` plus its compiled pricer.
#[wasm_bindgen]
pub struct Core {
    config: Config,
    pricer: Pricer,
}

/// JSON shape of a verdict crossing the WASM boundary.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VerdictJs {
    /// `human`, `agent` or `search-bot`.
    kind: String,
    agent: Option<String>,
    confidence: f32,
    reason: String,
}

impl From<Verdict> for VerdictJs {
    fn from(v: Verdict) -> Self {
        VerdictJs {
            kind: match v.kind {
                Kind::Human => "human",
                Kind::Agent => "agent",
                Kind::SearchBot => "search-bot",
            }
            .into(),
            agent: v.agent,
            confidence: v.confidence,
            reason: v.reason,
        }
    }
}

impl TryFrom<VerdictJs> for Verdict {
    type Error = String;
    fn try_from(v: VerdictJs) -> Result<Verdict, String> {
        let kind = match v.kind.as_str() {
            "human" => Kind::Human,
            "agent" => Kind::Agent,
            "search-bot" => Kind::SearchBot,
            other => return Err(format!("unknown verdict kind {other:?}")),
        };
        Ok(Verdict {
            kind,
            agent: v.agent,
            confidence: v.confidence,
            reason: v.reason,
        })
    }
}

/// JSON shape of a price tag: `amount` is the atomic USDC amount as a decimal string
/// (KB-AMT-01), exactly what the x402 `amount` field carries.
#[derive(Serialize)]
struct PriceTagJs {
    amount: String,
    resource: String,
    description: Option<String>,
}

impl From<PriceTag> for PriceTagJs {
    fn from(t: PriceTag) -> Self {
        PriceTagJs {
            amount: t.amount.0.to_string(),
            resource: t.resource,
            description: t.description,
        }
    }
}

fn to_json<T: Serialize>(value: &T) -> String {
    serde_json::to_string(value).expect("facade types always serialize")
}

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

fn method(m: &str) -> Result<Method, String> {
    Method::from_bytes(m.to_ascii_uppercase().as_bytes())
        .map_err(|_| format!("unknown HTTP method {m:?}"))
}

#[wasm_bindgen]
impl Core {
    /// Parses `yaml` (the `agenttoll.yaml` text). `env_json` is a JSON object of strings
    /// used for `${VAR}` expansion; a referenced-but-missing variable is an error.
    #[wasm_bindgen(constructor)]
    pub fn new(yaml: &str, env_json: &str) -> Result<Core, String> {
        let env: BTreeMap<String, String> = serde_json::from_str(env_json)
            .map_err(|e| format!("env must be a JSON object of strings: {e}"))?;
        let config = Config::parse(yaml, |name| env.get(name).cloned()).map_err(err)?;
        let pricer = Pricer::new(&config).map_err(err)?;
        Ok(Core { config, pricer })
    }

    pub fn origin(&self) -> String {
        self.config.origin.clone()
    }

    pub fn public_url(&self) -> Option<String> {
        self.config.public_url.clone()
    }

    pub fn preserve_host(&self) -> bool {
        self.config.preserve_host
    }

    /// `agents-only`, `all-requests` or `off`.
    pub fn detection(&self) -> String {
        match self.config.detection {
            DetectionMode::AgentsOnly => "agents-only",
            DetectionMode::AllRequests => "all-requests",
            DetectionMode::Off => "off",
        }
        .into()
    }

    pub fn charge_search_bots(&self) -> bool {
        self.config.charge_search_bots
    }

    /// JSON array of `{name, network, asset, payTo, facilitator, feePayer?}` in the order the
    /// gateway quotes them (sorted by local name, as `BTreeMap` iterates).
    pub fn networks_json(&self) -> String {
        let nets: Vec<_> = self
            .config
            .networks
            .iter()
            .map(|(name, n)| {
                json!({
                    "name": name,
                    "network": n.network,
                    "asset": n.asset,
                    "payTo": n.pay_to,
                    "facilitator": n.facilitator,
                    "feePayer": n.fee_payer,
                })
            })
            .collect();
        to_json(&nets)
    }

    pub fn mcp_endpoint(&self) -> Option<String> {
        self.config.mcp.as_ref().map(|m| m.endpoint.clone())
    }

    pub fn is_mcp_endpoint(&self, path: &str) -> bool {
        self.pricer.is_mcp_endpoint(path)
    }

    /// Prices a plain HTTP request: JSON `{amount, resource, description}` or `undefined`
    /// when free.
    pub fn price_route(&self, method_name: &str, raw_path: &str) -> Result<Option<String>, String> {
        let m = method(method_name)?;
        Ok(self
            .pricer
            .price_route(&m, raw_path)
            .map(|t| to_json(&PriceTagJs::from(t))))
    }

    /// Inspects and prices an MCP POST body: JSON `{amount, resource, description}` or
    /// `undefined` when free. Throws with the gateway's message when the body is malformed
    /// (the caller answers 400, never forwards).
    pub fn price_mcp(&self, body: &[u8]) -> Result<Option<String>, String> {
        let inspection = mcp::inspect(body).map_err(err)?;
        Ok(self
            .pricer
            .price_mcp(&inspection)
            .map(|t| to_json(&PriceTagJs::from(t))))
    }

    /// Classifies a request. `headers_json` is a JSON array of `[name, value]` pairs.
    /// Returns JSON `{kind, agent, confidence, reason}`.
    pub fn classify(
        &self,
        method_name: &str,
        raw_path: &str,
        headers_json: &str,
        is_mcp_endpoint: bool,
    ) -> Result<String, String> {
        let m = method(method_name)?;
        let pairs: Vec<(String, String)> = serde_json::from_str(headers_json)
            .map_err(|e| format!("headers must be a JSON array of pairs: {e}"))?;
        let mut headers = HeaderMap::new();
        for (name, value) in &pairs {
            if let (Ok(n), Ok(v)) = (
                HeaderName::from_bytes(name.as_bytes()),
                HeaderValue::from_bytes(value.as_bytes()),
            ) {
                headers.append(n, v);
            }
        }
        let verdict = detector::classify(
            &RequestView {
                method: &m,
                path: raw_path,
                headers: &headers,
            },
            &Context {
                is_mcp_endpoint,
                web_bot_auth: None,
            },
        );
        Ok(to_json(&VerdictJs::from(verdict)))
    }

    /// Whether a priced request with this verdict (JSON from [`Core::classify`]) must pay,
    /// under this config's `detection` mode and `charge_search_bots`.
    pub fn should_charge(&self, verdict_json: &str) -> Result<bool, String> {
        let v: VerdictJs = serde_json::from_str(verdict_json).map_err(err)?;
        let verdict = Verdict::try_from(v)?;
        Ok(detector::should_charge(
            self.config.detection,
            &verdict,
            self.config.charge_search_bots,
        ))
    }

    /// Facilitator call budgets: JSON `{verifyMs, settleMs}` (`timeouts.*` in the config).
    pub fn timeouts_json(&self) -> String {
        let t = &self.config.timeouts;
        to_json(&json!({ "verifyMs": t.verify_ms, "settleMs": t.settle_ms }))
    }

    /// The `mcp` section, or `undefined`: JSON `{endpoint, defaultToolPriceUsd, tools,
    /// advertisePrices, challenge}` with prices as USD strings and `challenge` either
    /// `mcp-native` or `http-402`.
    pub fn mcp_json(&self) -> Option<String> {
        self.config.mcp.as_ref().map(|m| {
            let tools: serde_json::Map<String, Value> = m
                .tools
                .iter()
                .map(|(name, price)| (name.clone(), json!(price.to_string())))
                .collect();
            to_json(&json!({
                "endpoint": m.endpoint,
                "defaultToolPriceUsd": m.default_tool_price_usd.to_string(),
                "tools": tools,
                "advertisePrices": m.advertise_prices,
                "challenge": match m.challenge {
                    McpChallenge::McpNative => "mcp-native",
                    McpChallenge::Http402 => "http-402",
                },
            }))
        })
    }

    /// Body of `GET /.well-known/agenttoll.json`, the same JSON the Rust gateway's
    /// `discovery` builds (lib.rs): every price and payment option so an agent can budget.
    pub fn discovery_json(&self) -> String {
        let networks: Vec<Value> = self
            .config
            .networks
            .values()
            .map(|n| json!({ "network": n.network, "scheme": "exact", "asset": n.asset, "payTo": n.pay_to }))
            .collect();
        let routes: Vec<Value> = self
            .config
            .routes
            .iter()
            .map(|r| json!({ "match": r.pattern, "priceUsd": r.price_usd.to_string(), "description": r.description }))
            .collect();
        let mcp = self.config.mcp.as_ref().map(|m| {
            let tools: serde_json::Map<String, Value> = m
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
        to_json(&json!({
            "agenttoll": env!("CARGO_PKG_VERSION"),
            "x402Version": 2,
            "detection": self.detection(),
            "networks": networks,
            "routes": routes,
            "mcp": mcp,
        }))
    }

    /// Rewrites a `tools/list` JSON response so each paid tool's description ends with its
    /// price (`mcp.advertise_prices`, paid-mcp-tools skill). Same text as the Rust gateway's
    /// `advertise_prices`. `undefined` when the body is not a tools/list result or there is
    /// no `mcp` section; the caller then passes the body through unchanged.
    pub fn advertise_prices(&self, body: &[u8]) -> Option<String> {
        let m = self.config.mcp.as_ref()?;
        let mut msg: Value = serde_json::from_slice(body).ok()?;
        for tool in msg.pointer_mut("/result/tools")?.as_array_mut()? {
            let Some(name) = tool.get("name").and_then(Value::as_str) else {
                continue;
            };
            let price = m
                .tools
                .get(name)
                .copied()
                .unwrap_or(m.default_tool_price_usd);
            if price.is_free() {
                continue;
            }
            let description = tool
                .get("description")
                .and_then(Value::as_str)
                .unwrap_or("");
            tool["description"] = json!(
                format!("{description} (Paid tool: ${price} USDC per call via x402.)").trim_start()
            );
        }
        Some(to_json(&msg))
    }
}

/// Canonical request path (see `agenttoll_core::path::normalize`).
#[wasm_bindgen]
pub fn normalize_path(raw: &str) -> String {
    path::normalize(raw)
}

/// Canonical JSON (compact, object keys sorted), as `serde_json::Value::to_string` prints
/// it in the Rust gateway. The replay key of a payment is the canonical JSON of its signed
/// `payload`, so re-encoding the same payment never dodges the guard. Errors when `json`
/// is not JSON.
#[wasm_bindgen]
pub fn canonical_json(json: &str) -> Result<String, String> {
    let value: Value = serde_json::from_str(json).map_err(err)?;
    Ok(sorted(value).to_string())
}

fn sorted(value: Value) -> Value {
    match value {
        Value::Object(map) => Value::Object(
            map.into_iter()
                .map(|(k, v)| (k, sorted(v)))
                .collect::<std::collections::BTreeMap<_, _>>()
                .into_iter()
                .collect(),
        ),
        Value::Array(items) => Value::Array(items.into_iter().map(sorted).collect()),
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const YAML: &str = include_str!("../../../agenttoll.example.yaml");
    const ENV: &str = r#"{"AGENTTOLL_SOLANA_PAYTO":"SoL","AGENTTOLL_BASE_PAYTO":"0x1"}"#;

    #[test]
    fn facade_round_trips_core_results() {
        let core = Core::new(YAML, ENV).unwrap();
        assert_eq!(core.detection(), "agents-only");
        let tag: serde_json::Value =
            serde_json::from_str(&core.price_route("GET", "/api/%71uote?x=1").unwrap().unwrap())
                .unwrap();
        assert_eq!(tag["amount"], "2000");
        assert_eq!(tag["resource"], "GET /api/quote");
        assert!(core.price_route("GET", "/about").unwrap().is_none());
        assert!(core.is_mcp_endpoint("/MCP/"));

        let mcp = core
            .price_mcp(br#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_docs"}}"#)
            .unwrap()
            .unwrap();
        assert!(mcp.contains("\"5000\""));
        assert!(core.price_mcp(b"{not json").is_err());

        let verdict = core
            .classify("GET", "/api/quote", r#"[["user-agent","ClaudeBot/1.0"]]"#, false)
            .unwrap();
        assert!(verdict.contains("\"ua:ClaudeBot\""));
        assert!(core.should_charge(&verdict).unwrap());
        let curl = core
            .classify("GET", "/api/quote", r#"[["user-agent","curl/8.9"]]"#, false)
            .unwrap();
        assert!(!core.should_charge(&curl).unwrap());

        let nets: serde_json::Value = serde_json::from_str(&core.networks_json()).unwrap();
        assert_eq!(nets[0]["name"], "base");
        assert_eq!(nets[1]["payTo"], "SoL");
        assert_eq!(normalize_path("/a//b/../c/"), "/a/c");
    }

    #[test]
    fn missing_env_is_an_error() {
        assert!(Core::new(YAML, "{}").is_err());
    }

    #[test]
    fn d4_semantics_cross_the_boundary() {
        let core = Core::new(YAML, ENV).unwrap();
        let t: Value = serde_json::from_str(&core.timeouts_json()).unwrap();
        assert_eq!(t["verifyMs"], 5000);
        assert_eq!(t["settleMs"], 20000);

        let mcp: Value = serde_json::from_str(&core.mcp_json().unwrap()).unwrap();
        assert_eq!(mcp["challenge"], "mcp-native");
        assert_eq!(mcp["tools"]["search_docs"], "0.005");

        let d: Value = serde_json::from_str(&core.discovery_json()).unwrap();
        assert_eq!(d["x402Version"], 2);
        assert_eq!(d["agenttoll"], env!("CARGO_PKG_VERSION"));
        assert_eq!(d["routes"][0]["priceUsd"], "0.002");
        assert_eq!(d["mcp"]["tools"]["search_docs"], "0.005");
        assert_eq!(d["networks"].as_array().unwrap().len(), 2);
        assert_eq!(d["networks"][0]["payTo"], "0x1");

        let list = br#"{"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":"search_docs","description":"Search the docs."},{"name":"ping","description":"Free."}]}}"#;
        let out: Value = serde_json::from_str(&core.advertise_prices(list).unwrap()).unwrap();
        assert_eq!(
            out["result"]["tools"][0]["description"],
            "Search the docs. (Paid tool: $0.005 USDC per call via x402.)"
        );
        assert_eq!(out["result"]["tools"][1]["description"], "Free.");
        assert!(core.advertise_prices(b"not json").is_none());
        assert!(core.advertise_prices(br#"{"result":{}}"#).is_none());

        assert_eq!(
            canonical_json("{ \"b\": [ {\"z\":1, \"a\":2} ], \"a\": \"x\" }").unwrap(),
            r#"{"a":"x","b":[{"a":2,"z":1}]}"#
        );
        assert!(canonical_json("{nope").is_err());
    }
}
