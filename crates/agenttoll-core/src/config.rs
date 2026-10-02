//! `agenttoll.yaml`: schema, `${VAR}` expansion and validation. Parsing is pure; the caller
//! supplies the file text and an environment lookup.

use std::collections::BTreeMap;
use std::net::SocketAddr;

use serde::Deserialize;
use serde_yaml::Value;

use crate::money::Atomic;
use crate::pricer::Pricer;

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Config {
    /// Base URL of the protected site or API, e.g. `http://localhost:4000`.
    pub origin: String,
    pub listen: SocketAddr,
    pub admin_listen: SocketAddr,
    /// Public base URL quoted as `resource.url` in 402 challenges, e.g. `https://acme.dev`.
    /// Defaults to `http://<Host header>`.
    #[serde(default)]
    pub public_url: Option<String>,
    /// Forward the client's `Host` header to the origin. Off by default: hosted origins
    /// (Vercel, Netlify) route by Host, so the origin's own host is sent and the client's
    /// goes in `X-Forwarded-Host`.
    #[serde(default)]
    pub preserve_host: bool,
    #[serde(default)]
    pub detection: DetectionMode,
    /// Charge search crawlers (Googlebot, bingbot) like AI agents. Off by default so
    /// search indexing is never paywalled.
    #[serde(default)]
    pub charge_search_bots: bool,
    /// Keyed by a local name (`solana`, `base`); one `accepts[]` entry is quoted per network.
    pub networks: BTreeMap<String, NetworkConfig>,
    /// First match wins. Unmatched requests are free.
    pub routes: Vec<RouteConfig>,
    #[serde(default)]
    pub mcp: Option<McpConfig>,
    #[serde(default)]
    pub ledger: LedgerConfig,
    #[serde(default)]
    pub timeouts: Timeouts,
}

/// Facilitator call budgets. `/verify` is read-only and fast; `/settle` waits for the chain.
/// Both stay well inside a Solana blockhash lifetime (~60-90 s, KB-X402-07).
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields, default)]
pub struct Timeouts {
    pub verify_ms: u64,
    pub settle_ms: u64,
}

impl Default for Timeouts {
    fn default() -> Self {
        Self {
            verify_ms: 5_000,
            settle_ms: 20_000,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DetectionMode {
    /// Charge confident agents only; humans and uncertain traffic pass free.
    #[default]
    AgentsOnly,
    /// Charge every priced request, human or not (pure API monetization).
    AllRequests,
    /// Never charge; classify and log only.
    Off,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NetworkConfig {
    /// CAIP-2 chain id, e.g. `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` (KB-SOL-01).
    pub network: String,
    /// Token mint or contract address of USDC on that chain.
    pub asset: String,
    /// The founder's receiving account. Funds go straight here (non-custodial).
    pub pay_to: String,
    /// Facilitator base URL exposing `/verify` and `/settle` (KB-X402-04).
    pub facilitator: String,
    /// Solana fee payer quoted in `extra.feePayer` (KB-X402-07). When unset, the gateway
    /// reads it from the facilitator's `GET /supported` at startup.
    #[serde(default)]
    pub fee_payer: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RouteConfig {
    /// `"[METHOD ]/path/glob"`, e.g. `"GET /api/*"` or `"/*"`.
    #[serde(rename = "match")]
    pub pattern: String,
    pub price_usd: Atomic,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct McpConfig {
    pub endpoint: String,
    #[serde(default)]
    pub default_tool_price_usd: Atomic,
    #[serde(default)]
    pub tools: BTreeMap<String, Atomic>,
    /// Rewrite `tools/list` responses to show each tool's price (paid-mcp-tools skill).
    #[serde(default)]
    pub advertise_prices: bool,
    /// How an unpaid `tools/call` is challenged (KB-X402-05).
    #[serde(default)]
    pub challenge: McpChallenge,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum McpChallenge {
    /// JSON-RPC tool result with `isError: true` and PaymentRequired in
    /// `structuredContent`, which MCP clients understand. Batches fall back to HTTP 402.
    #[default]
    McpNative,
    /// HTTP 402 with `PAYMENT-REQUIRED`, for HTTP-level x402 clients.
    #[serde(rename = "http-402")]
    Http402,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LedgerConfig {
    pub url: String,
}

impl Default for LedgerConfig {
    fn default() -> Self {
        Self {
            url: "sqlite://agenttoll.db".into(),
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("invalid YAML: {0}")]
    Yaml(#[from] serde_yaml::Error),
    #[error("environment variable {0} is referenced in the config but not set")]
    MissingEnv(String),
    #[error("unterminated ${{...}} in {0:?}")]
    UnterminatedVar(String),
    #[error("{0}")]
    Invalid(String),
}

impl Config {
    /// Parses config text, expanding `${VAR}` in string values through `env`.
    pub fn parse(text: &str, env: impl Fn(&str) -> Option<String>) -> Result<Config, ConfigError> {
        let mut tree: Value = serde_yaml::from_str(text)?;
        expand_tree(&mut tree, &env)?;
        let config: Config = serde_yaml::from_value(tree)?;
        config.validate()?;
        Ok(config)
    }

    fn validate(&self) -> Result<(), ConfigError> {
        let invalid = |msg: String| Err(ConfigError::Invalid(msg));
        if !(self.origin.starts_with("http://") || self.origin.starts_with("https://")) {
            return invalid(format!(
                "origin {:?} must start with http:// or https://",
                self.origin
            ));
        }
        if self.networks.is_empty() {
            return invalid("at least one entry under `networks` is required".into());
        }
        for (name, n) in &self.networks {
            let Some((namespace, reference)) = n.network.split_once(':') else {
                return invalid(format!(
                    "networks.{name}.network {:?} is not a CAIP-2 id",
                    n.network
                ));
            };
            if namespace.is_empty() || reference.is_empty() {
                return invalid(format!(
                    "networks.{name}.network {:?} is not a CAIP-2 id",
                    n.network
                ));
            }
            for (field, value) in [
                ("asset", &n.asset),
                ("pay_to", &n.pay_to),
                ("facilitator", &n.facilitator),
            ] {
                if value.trim().is_empty() {
                    return invalid(format!("networks.{name}.{field} is empty"));
                }
            }
            if !n.facilitator.starts_with("https://") && !n.facilitator.starts_with("http://") {
                return invalid(format!(
                    "networks.{name}.facilitator must be an http(s) URL"
                ));
            }
        }
        if let Some(url) = &self.public_url
            && !(url.starts_with("http://") || url.starts_with("https://"))
        {
            return invalid(format!(
                "public_url {url:?} must start with http:// or https://"
            ));
        }
        if let Some(mcp) = &self.mcp
            && !mcp.endpoint.starts_with('/')
        {
            return invalid(format!("mcp.endpoint {:?} must start with /", mcp.endpoint));
        }
        Pricer::new(self)?;
        Ok(())
    }
}

fn expand_tree(
    value: &mut Value,
    env: &impl Fn(&str) -> Option<String>,
) -> Result<(), ConfigError> {
    match value {
        Value::String(s) => *s = expand_str(s, env)?,
        Value::Sequence(items) => {
            for item in items {
                expand_tree(item, env)?;
            }
        }
        Value::Mapping(map) => {
            for (_, v) in map.iter_mut() {
                expand_tree(v, env)?;
            }
        }
        Value::Tagged(tagged) => expand_tree(&mut tagged.value, env)?,
        Value::Null | Value::Bool(_) | Value::Number(_) => {}
    }
    Ok(())
}

/// Replaces every `${NAME}` with `env(NAME)`. A missing variable is an error, never "".
fn expand_str(s: &str, env: &impl Fn(&str) -> Option<String>) -> Result<String, ConfigError> {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(start) = rest.find("${") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        let end = after
            .find('}')
            .ok_or_else(|| ConfigError::UnterminatedVar(s.to_string()))?;
        let name = &after[..end];
        out.push_str(&env(name).ok_or_else(|| ConfigError::MissingEnv(name.to_string()))?);
        rest = &after[end + 1..];
    }
    out.push_str(rest);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    const EXAMPLE: &str = include_str!("../../../agenttoll.example.yaml");

    fn env(name: &str) -> Option<String> {
        match name {
            "AGENTTOLL_SOLANA_PAYTO" => Some("SoLPayTo1111111111111111111111111111111111".into()),
            "AGENTTOLL_BASE_PAYTO" => Some("0x0000000000000000000000000000000000000001".into()),
            _ => None,
        }
    }

    #[test]
    fn example_config_parses() {
        let c = Config::parse(EXAMPLE, env).unwrap();
        assert_eq!(c.detection, DetectionMode::AgentsOnly);
        assert_eq!(
            c.networks["solana"].pay_to,
            "SoLPayTo1111111111111111111111111111111111"
        );
        assert_eq!(c.routes[0].pattern, "GET /api/quote");
        assert_eq!(c.routes[0].price_usd, Atomic(2000));
        let mcp = c.mcp.unwrap();
        assert_eq!(mcp.tools["generate_report"], Atomic(50_000));
        assert_eq!(c.ledger.url, "sqlite://agenttoll.db");
    }

    #[test]
    fn missing_env_is_an_error() {
        let err = Config::parse(EXAMPLE, |_| None).unwrap_err();
        assert!(
            matches!(err, ConfigError::MissingEnv(ref v) if v.starts_with("AGENTTOLL_")),
            "{err}"
        );
    }

    #[test]
    fn expansion_handles_text_around_vars() {
        let env = |n: &str| (n == "A").then(|| "x".to_string());
        assert_eq!(
            expand_str("pre-${A}-mid-${A}", &env).unwrap(),
            "pre-x-mid-x"
        );
        assert_eq!(expand_str("no vars", &env).unwrap(), "no vars");
        assert!(matches!(
            expand_str("${A", &env),
            Err(ConfigError::UnterminatedVar(_))
        ));
    }

    #[test]
    fn env_values_cannot_inject_yaml() {
        let env = |_: &str| Some("x\nroutes: []".to_string());
        let text = EXAMPLE.replace("${AGENTTOLL_BASE_PAYTO}", "0xabc");
        let c = Config::parse(&text, env).unwrap();
        assert_eq!(c.networks["solana"].pay_to, "x\nroutes: []");
        assert!(!c.routes.is_empty());
    }

    fn minimal(extra: &str) -> String {
        format!(
            "origin: http://localhost:4000\nlisten: 0.0.0.0:8402\nadmin_listen: 127.0.0.1:8403\n\
             networks:\n  solana:\n    network: \"solana:devnet\"\n    asset: mint\n    pay_to: me\n    \
             facilitator: https://f.example\n{extra}"
        )
    }

    #[test]
    fn minimal_config_defaults() {
        let c = Config::parse(&minimal("routes: []\n"), |_| None).unwrap();
        assert_eq!(c.detection, DetectionMode::AgentsOnly);
        assert!(!c.charge_search_bots);
        assert!(c.mcp.is_none());
    }

    #[test]
    fn rejects_invalid_configs() {
        let cases = [
            minimal("routes: []\nsurprise: 1\n"), // unknown key
            minimal("routes:\n  - match: \"GET /a\"\n    price_usd: 0.002\n"), // float price
            minimal("routes:\n  - match: \"GET /a\"\n    price_usd: \"-1\"\n"), // negative
            minimal("routes:\n  - match: \"api/*\"\n    price_usd: \"1\"\n"), // no leading /
            minimal("routes:\n  - match: \"GET /a[\"\n    price_usd: \"1\"\n"), // bad glob
            minimal("routes: []\ndetection: sometimes\n"), // bad mode
            minimal("routes: []\nmcp:\n  endpoint: mcp\n"), // bad endpoint
            minimal("routes: []\n").replace("solana:devnet", "devnet"), // not CAIP-2
            minimal("routes: []\n").replace("pay_to: me", "pay_to: \"\""), // empty pay_to
            minimal("routes: []\n").replace("http://localhost:4000", "localhost"), // bad origin
        ];
        for (i, text) in cases.iter().enumerate() {
            assert!(
                Config::parse(text, |_| None).is_err(),
                "case {i} should fail:\n{text}"
            );
        }
    }
}
