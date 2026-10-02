//! Route and MCP tool pricing. Routes are `"[METHOD ]/glob"`, first match wins, unmatched
//! requests are free. Paths are canonicalized with [`crate::path::normalize`] before matching.

use std::collections::BTreeMap;

use globset::{Glob, GlobMatcher};
use http::Method;

use crate::config::{Config, ConfigError};
use crate::mcp::McpInspection;
use crate::money::Atomic;
use crate::path::normalize;

/// What a request costs and what it is buying. Only produced for non-zero prices.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PriceTag {
    pub amount: Atomic,
    /// The route pattern that matched (`GET /api/quote`) or `mcp:<tool>[+<tool>...]`.
    pub resource: String,
    pub description: Option<String>,
}

#[derive(Debug)]
struct Route {
    pattern: String,
    method: Option<Method>,
    glob: GlobMatcher,
    price: Atomic,
    description: Option<String>,
}

#[derive(Debug)]
struct McpPrices {
    endpoint: String,
    default: Atomic,
    tools: BTreeMap<String, Atomic>,
}

#[derive(Debug)]
pub struct Pricer {
    routes: Vec<Route>,
    mcp: Option<McpPrices>,
}

impl Pricer {
    pub fn new(config: &Config) -> Result<Pricer, ConfigError> {
        let routes = config
            .routes
            .iter()
            .map(|r| {
                let (method, glob) = parse_pattern(&r.pattern)?;
                Ok(Route {
                    pattern: r.pattern.clone(),
                    method,
                    glob,
                    price: r.price_usd,
                    description: r.description.clone(),
                })
            })
            .collect::<Result<_, ConfigError>>()?;
        let mcp = config.mcp.as_ref().map(|m| McpPrices {
            endpoint: normalize(&m.endpoint),
            default: m.default_tool_price_usd,
            tools: m.tools.clone(),
        });
        Ok(Pricer { routes, mcp })
    }

    /// True when `path` is the configured MCP endpoint (or below it).
    pub fn is_mcp_endpoint(&self, path: &str) -> bool {
        let Some(mcp) = &self.mcp else { return false };
        let path = normalize(path);
        path == mcp.endpoint || path.starts_with(&format!("{}/", mcp.endpoint))
    }

    /// Prices a plain HTTP request. `None` means free.
    pub fn price_route(&self, method: &Method, path: &str) -> Option<PriceTag> {
        let path = normalize(path);
        let route = self
            .routes
            .iter()
            .find(|r| r.method.as_ref().is_none_or(|m| m == method) && r.glob.is_match(&path))?;
        (!route.price.is_free()).then(|| PriceTag {
            amount: route.price,
            resource: route.pattern.clone(),
            description: route.description.clone(),
        })
    }

    /// Prices an inspected MCP body: the sum of its `tools/call` prices. `None` means free.
    /// Returns `None` too when no `mcp` section is configured.
    pub fn price_mcp(&self, inspection: &McpInspection) -> Option<PriceTag> {
        let mcp = self.mcp.as_ref()?;
        let mut total = Atomic::ZERO;
        let mut names = Vec::new();
        for call in &inspection.tool_calls {
            let price = call
                .as_ref()
                .and_then(|n| mcp.tools.get(n))
                .copied()
                .unwrap_or(mcp.default);
            // Saturate rather than wrap: an absurd batch should cost more, never less.
            total = total.checked_add(price).unwrap_or(Atomic(u64::MAX));
            names.push(call.as_deref().unwrap_or("?").to_string());
        }
        (!total.is_free()).then(|| PriceTag {
            amount: total,
            resource: format!("mcp:{}", names.join("+")),
            description: None,
        })
    }
}

fn parse_pattern(pattern: &str) -> Result<(Option<Method>, GlobMatcher), ConfigError> {
    let invalid = |why: &str| ConfigError::Invalid(format!("route {pattern:?}: {why}"));
    let (method, path) = match pattern.trim().split_once(char::is_whitespace) {
        Some((m, p)) => {
            let method = Method::from_bytes(m.to_ascii_uppercase().as_bytes())
                .map_err(|_| invalid("unknown HTTP method"))?;
            (Some(method), p.trim())
        }
        None => (None, pattern.trim()),
    };
    if !path.starts_with('/') {
        return Err(invalid("path must start with /"));
    }
    let glob = Glob::new(path).map_err(|e| invalid(&e.to_string()))?;
    Ok((method, glob.compile_matcher()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::inspect;

    fn pricer() -> Pricer {
        let text = include_str!("../../../agenttoll.example.yaml");
        let config = Config::parse(text, |_| Some("payto".into())).unwrap();
        Pricer::new(&config).unwrap()
    }

    fn amount(tag: Option<PriceTag>) -> u64 {
        tag.map_or(0, |t| t.amount.0)
    }

    #[test]
    fn routes_first_match_wins() {
        let p = pricer();
        let cases = [
            (Method::GET, "/api/quote", 2000),
            (Method::GET, "/api/other", 1000),
            (Method::GET, "/api/v1/deep/path", 1000),
            (Method::GET, "/blog/hello", 1000),
            (Method::GET, "/", 0),
            (Method::GET, "/about", 0),
            (Method::POST, "/api/quote", 0), // GET-only routes
            (Method::HEAD, "/api/quote", 0),
        ];
        for (m, path, want) in cases {
            assert_eq!(amount(p.price_route(&m, path)), want, "{m} {path}");
        }
    }

    #[test]
    fn tag_carries_route_and_description() {
        let tag = pricer().price_route(&Method::GET, "/api/quote").unwrap();
        assert_eq!(tag.resource, "GET /api/quote");
        assert_eq!(tag.description.as_deref(), Some("Live price quote"));
    }

    #[test]
    fn path_tricks_do_not_escape_a_price() {
        let p = pricer();
        for path in [
            "/api/%71uote",
            "/api//quote",
            "/api/quote/",
            "/blog/../api/quote",
            "/x/%2e%2e/api/quote",
        ] {
            assert_eq!(amount(p.price_route(&Method::GET, path)), 2000, "{path}");
        }
    }

    #[test]
    fn mcp_endpoint_detection() {
        let p = pricer();
        assert!(p.is_mcp_endpoint("/mcp"));
        assert!(p.is_mcp_endpoint("/mcp/"));
        assert!(p.is_mcp_endpoint("/mcp/session"));
        assert!(!p.is_mcp_endpoint("/mcpx"));
        assert!(!p.is_mcp_endpoint("/api/mcp"));
    }

    #[test]
    fn mcp_tool_prices() {
        let p = pricer();
        let price = |body: &str| amount(p.price_mcp(&inspect(body.as_bytes()).unwrap()));
        let call = |n: &str| {
            format!(r#"{{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{{"name":"{n}"}}}}"#)
        };

        assert_eq!(price(&call("search_docs")), 5000);
        assert_eq!(price(&call("generate_report")), 50_000);
        assert_eq!(price(&call("unlisted_tool")), 0); // default_tool_price_usd is "0"
        assert_eq!(
            price(r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#),
            0
        );
        assert_eq!(
            price(&format!(
                "[{},{}]",
                call("search_docs"),
                call("generate_report")
            )),
            55_000
        );

        let tag = p
            .price_mcp(&inspect(call("search_docs").as_bytes()).unwrap())
            .unwrap();
        assert_eq!(tag.resource, "mcp:search_docs");
    }

    #[test]
    fn default_tool_price_applies_to_unknown_and_nameless_calls() {
        let text = include_str!("../../../agenttoll.example.yaml").replace(
            "default_tool_price_usd: \"0\"",
            "default_tool_price_usd: \"0.01\"",
        );
        let p = Pricer::new(&Config::parse(&text, |_| Some("x".into())).unwrap()).unwrap();
        let unknown =
            inspect(br#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"zzz"}}"#)
                .unwrap();
        let nameless = inspect(br#"{"jsonrpc":"2.0","id":1,"method":"tools/call"}"#).unwrap();
        assert_eq!(amount(p.price_mcp(&unknown)), 10_000);
        assert_eq!(amount(p.price_mcp(&nameless)), 10_000);
    }

    #[test]
    fn methods_are_case_insensitive_in_patterns() {
        assert_eq!(parse_pattern("get /a").unwrap().0, Some(Method::GET));
        assert!(parse_pattern("/*").unwrap().0.is_none());
        assert!(parse_pattern("GET api").is_err());
        assert!(parse_pattern("G@T /a").is_err());
    }
}
