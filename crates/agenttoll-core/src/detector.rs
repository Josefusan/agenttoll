//! Human vs agent classification (ARCHITECTURE.md §1.3, agent-detection skill, KB-DET-01).
//! Ordered rules, first match wins. When unsure, the answer is "human": a missed agent costs
//! a fraction of a cent, a paywalled human costs the founder a customer.

use http::{HeaderMap, Method};

use crate::config::DetectionMode;
use crate::headers;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Human,
    Agent,
    /// Search indexers. Free unless `charge_search_bots` is set.
    SearchBot,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Verdict {
    pub kind: Kind,
    /// Display name, e.g. `ClaudeBot` or the Web Bot Auth signer.
    pub agent: Option<String>,
    /// 0.0 to 1.0. Heuristic agent verdicts stay below [`CHARGE_CONFIDENCE`].
    pub confidence: f32,
    /// Machine-readable rule that fired, e.g. `ua:ClaudeBot`. Logged and shown on the dashboard.
    pub reason: String,
}

/// Agent verdicts at or above this confidence are charged in `agents-only` mode.
pub const CHARGE_CONFIDENCE: f32 = 0.8;

/// The parts of a request the detector reads. Borrowed from the gateway's request.
pub struct RequestView<'a> {
    pub method: &'a Method,
    pub path: &'a str,
    pub headers: &'a HeaderMap,
}

/// Context the gateway resolves before classifying (IO lives in the gateway, not here).
#[derive(Default)]
pub struct Context<'a> {
    /// The request targets the MCP endpoint (see `Pricer::is_mcp_endpoint`).
    pub is_mcp_endpoint: bool,
    /// Signer name when the gateway has verified a Web Bot Auth signature on this request.
    pub web_bot_auth: Option<&'a str>,
}

/// Self-identified AI agents and AI crawlers, matched case-insensitively as UA substrings.
/// More specific names come before names they contain.
const AI_AGENTS: &[&str] = &[
    "Claude-SearchBot",
    "Claude-User",
    "ClaudeBot",
    "anthropic-ai",
    "ChatGPT-User",
    "OAI-SearchBot",
    "GPTBot",
    "Perplexity-User",
    "PerplexityBot",
    "Google-Extended",
    "Applebot-Extended",
    "meta-externalagent",
    "meta-externalfetcher",
    "MistralAI-User",
    "DuckAssistBot",
    "cohere-ai",
    "CCBot",
    "Bytespider",
    "Amazonbot",
];

/// Search indexers. Checked after AI agents so `Applebot-Extended` is not caught by `Applebot`.
const SEARCH_BOTS: &[&str] = &[
    "Googlebot",
    "bingbot",
    "DuckDuckBot",
    "Applebot",
    "YandexBot",
    "Baiduspider",
    "Slurp",
];

/// HTTP libraries and automation tools: likely agents, but UA-only and unverified.
const TOOL_TOKENS: &[&str] = &[
    "curl/",
    "wget/",
    "python-requests",
    "python-urllib",
    "python-httpx",
    "aiohttp",
    "node-fetch",
    "undici",
    "axios/",
    "go-http-client",
    "okhttp",
    "java/",
    "libwww-perl",
    "httpie",
    "scrapy",
    "headlesschrome",
    "phantomjs",
];

pub fn classify(req: &RequestView<'_>, ctx: &Context<'_>) -> Verdict {
    let agent = |name: Option<&str>, confidence: f32, reason: String| Verdict {
        kind: Kind::Agent,
        agent: name.map(str::to_owned),
        confidence,
        reason,
    };

    // 1. Trying to pay: only agents do that. KB-X402-01 (v2), plus the v1 header.
    if req.headers.contains_key(headers::PAYMENT_SIGNATURE)
        || req.headers.contains_key(headers::X_PAYMENT)
    {
        return agent(None, 1.0, "payment-header".into());
    }
    // 2. MCP clients are agents by definition.
    if ctx.is_mcp_endpoint {
        return agent(None, 1.0, "mcp-endpoint".into());
    }
    // 3. Cryptographically verified bot (Web Bot Auth, verified by the gateway).
    if let Some(signer) = ctx.web_bot_auth {
        return agent(Some(signer), 0.99, format!("web-bot-auth:{signer}"));
    }

    let ua = req
        .headers
        .get(http::header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .trim();
    let ua_lower = ua.to_ascii_lowercase();
    let find = |list: &[&'static str]| {
        list.iter()
            .copied()
            .find(|t| ua_lower.contains(&t.to_ascii_lowercase()))
    };

    // 4. Self-declared AI agents, then search bots.
    if let Some(name) = find(AI_AGENTS) {
        return agent(Some(name), 0.95, format!("ua:{name}"));
    }
    if let Some(name) = find(SEARCH_BOTS) {
        return Verdict {
            kind: Kind::SearchBot,
            agent: Some(name.into()),
            confidence: 0.95,
            reason: format!("ua:{name}"),
        };
    }

    // 5. Heuristics. Confidence stays below CHARGE_CONFIDENCE so agents-only mode never
    //    charges on a guess.
    if ua.is_empty() {
        return agent(None, 0.6, "heuristic:no-user-agent".into());
    }
    if let Some(token) = find(TOOL_TOKENS) {
        let name = token.trim_end_matches('/');
        return agent(Some(name), 0.7, format!("heuristic:tool-ua:{name}"));
    }
    let has = |h: &str| req.headers.contains_key(h);
    if ua.starts_with("Mozilla/") && !has("accept-language") && !has("sec-fetch-mode") {
        return agent(None, 0.5, "heuristic:browser-ua-missing-headers".into());
    }

    // 6. Default.
    Verdict {
        kind: Kind::Human,
        agent: None,
        confidence: 0.9,
        reason: "default:human".into(),
    }
}

/// Whether a priced request with this verdict must pay before it reaches the origin.
pub fn should_charge(mode: DetectionMode, verdict: &Verdict, charge_search_bots: bool) -> bool {
    match mode {
        DetectionMode::Off => false,
        DetectionMode::AllRequests => true,
        DetectionMode::AgentsOnly => match verdict.kind {
            Kind::Agent => verdict.confidence >= CHARGE_CONFIDENCE,
            Kind::SearchBot => charge_search_bots,
            Kind::Human => false,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use http::HeaderValue;

    const CHROME: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
    const SAFARI_IOS: &str = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1";
    const SAFARI_MAC: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15";
    const FIREFOX: &str = "Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0";
    const EDGE: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0";
    const CHROME_ANDROID: &str = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
    const SAMSUNG: &str = "Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36";
    const HEADLESS: &str = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36";

    /// Headers a real browser sends on a top-level navigation.
    fn browser(ua: &str) -> Vec<(&'static str, String)> {
        vec![
            ("user-agent", ua.into()),
            ("accept", "text/html,application/xhtml+xml,*/*;q=0.8".into()),
            ("accept-language", "en-US,en;q=0.9".into()),
            ("sec-fetch-mode", "navigate".into()),
        ]
    }

    fn ua(ua: &str) -> Vec<(&'static str, String)> {
        vec![("user-agent", ua.into()), ("accept", "*/*".into())]
    }

    struct Case {
        name: &'static str,
        method: Method,
        headers: Vec<(&'static str, String)>,
        mcp: bool,
        web_bot_auth: Option<&'static str>,
        kind: Kind,
        agent: Option<&'static str>,
        reason: &'static str,
        charged: bool, // in agents-only mode on a priced route
    }

    fn case(
        name: &'static str,
        headers: Vec<(&'static str, String)>,
        kind: Kind,
        agent: Option<&'static str>,
        reason: &'static str,
        charged: bool,
    ) -> Case {
        Case {
            name,
            method: Method::GET,
            headers,
            mcp: false,
            web_bot_auth: None,
            kind,
            agent,
            reason,
            charged,
        }
    }

    fn with(
        mut h: Vec<(&'static str, String)>,
        k: &'static str,
        v: &str,
    ) -> Vec<(&'static str, String)> {
        h.push((k, v.into()));
        h
    }

    fn cases() -> Vec<Case> {
        use Kind::*;
        let mut v = vec![
            // Humans: never charged.
            case(
                "chrome desktop",
                browser(CHROME),
                Human,
                None,
                "default:human",
                false,
            ),
            case(
                "safari ios",
                browser(SAFARI_IOS),
                Human,
                None,
                "default:human",
                false,
            ),
            case(
                "safari mac",
                browser(SAFARI_MAC),
                Human,
                None,
                "default:human",
                false,
            ),
            case(
                "firefox",
                browser(FIREFOX),
                Human,
                None,
                "default:human",
                false,
            ),
            case("edge", browser(EDGE), Human, None, "default:human", false),
            case(
                "chrome android",
                browser(CHROME_ANDROID),
                Human,
                None,
                "default:human",
                false,
            ),
            case(
                "samsung internet",
                browser(SAMSUNG),
                Human,
                None,
                "default:human",
                false,
            ),
            case(
                "browser xhr without sec-fetch",
                vec![
                    ("user-agent", CHROME.into()),
                    ("accept-language", "de".into()),
                ],
                Human,
                None,
                "default:human",
                false,
            ),
            case(
                "unknown app with language",
                vec![
                    ("user-agent", "MyRssReader/2.1".into()),
                    ("accept-language", "en".into()),
                ],
                Human,
                None,
                "default:human",
                false,
            ),
            // Declared AI agents: charged.
            case(
                "gptbot",
                ua(
                    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)",
                ),
                Agent,
                Some("GPTBot"),
                "ua:GPTBot",
                true,
            ),
            case(
                "oai-searchbot",
                ua("Mozilla/5.0 (compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)"),
                Agent,
                Some("OAI-SearchBot"),
                "ua:OAI-SearchBot",
                true,
            ),
            case(
                "chatgpt-user",
                ua("Mozilla/5.0 (compatible; ChatGPT-User/1.0; +https://openai.com/bot)"),
                Agent,
                Some("ChatGPT-User"),
                "ua:ChatGPT-User",
                true,
            ),
            case(
                "claudebot",
                ua("Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)"),
                Agent,
                Some("ClaudeBot"),
                "ua:ClaudeBot",
                true,
            ),
            case(
                "claude-user",
                ua("Claude-User/1.0"),
                Agent,
                Some("Claude-User"),
                "ua:Claude-User",
                true,
            ),
            case(
                "claude-searchbot",
                ua("Mozilla/5.0 (compatible; Claude-SearchBot/1.0)"),
                Agent,
                Some("Claude-SearchBot"),
                "ua:Claude-SearchBot",
                true,
            ),
            case(
                "perplexitybot",
                ua(
                    "Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
                ),
                Agent,
                Some("PerplexityBot"),
                "ua:PerplexityBot",
                true,
            ),
            case(
                "ccbot",
                ua("CCBot/2.0 (https://commoncrawl.org/faq/)"),
                Agent,
                Some("CCBot"),
                "ua:CCBot",
                true,
            ),
            case(
                "bytespider",
                ua(
                    "Mozilla/5.0 (Linux; Android 5.0) AppleWebKit/537.36 (compatible; Bytespider; spider-feedback@bytedance.com)",
                ),
                Agent,
                Some("Bytespider"),
                "ua:Bytespider",
                true,
            ),
            case(
                "amazonbot",
                ua(
                    "Mozilla/5.0 (compatible; Amazonbot/0.1; +https://developer.amazon.com/support/amazonbot)",
                ),
                Agent,
                Some("Amazonbot"),
                "ua:Amazonbot",
                true,
            ),
            case(
                "google-extended",
                ua("Google-Extended"),
                Agent,
                Some("Google-Extended"),
                "ua:Google-Extended",
                true,
            ),
            case(
                "applebot-extended beats applebot",
                ua("Mozilla/5.0 (compatible; Applebot-Extended/0.1)"),
                Agent,
                Some("Applebot-Extended"),
                "ua:Applebot-Extended",
                true,
            ),
            case(
                "bot ua with full browser headers",
                browser("Mozilla/5.0 (compatible; ClaudeBot/1.0)"),
                Agent,
                Some("ClaudeBot"),
                "ua:ClaudeBot",
                true,
            ),
            case(
                "case-insensitive ua",
                ua("gptbot/1.0"),
                Agent,
                Some("GPTBot"),
                "ua:GPTBot",
                true,
            ),
            // Search bots: free by default.
            case(
                "googlebot",
                ua("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"),
                SearchBot,
                Some("Googlebot"),
                "ua:Googlebot",
                false,
            ),
            case(
                "bingbot",
                ua("Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)"),
                SearchBot,
                Some("bingbot"),
                "ua:bingbot",
                false,
            ),
            // Heuristic agents: classified, logged, not charged in agents-only.
            case(
                "curl",
                ua("curl/8.9.1"),
                Agent,
                Some("curl"),
                "heuristic:tool-ua:curl",
                false,
            ),
            case(
                "python-requests",
                ua("python-requests/2.32.3"),
                Agent,
                Some("python-requests"),
                "heuristic:tool-ua:python-requests",
                false,
            ),
            case(
                "node-fetch",
                ua("node-fetch/1.0 (+https://github.com/bitinn/node-fetch)"),
                Agent,
                Some("node-fetch"),
                "heuristic:tool-ua:node-fetch",
                false,
            ),
            case(
                "headless chrome",
                ua(HEADLESS),
                Agent,
                Some("headlesschrome"),
                "heuristic:tool-ua:headlesschrome",
                false,
            ),
            case(
                "no user agent",
                vec![],
                Agent,
                None,
                "heuristic:no-user-agent",
                false,
            ),
            case(
                "browser ua missing browser headers",
                ua(CHROME),
                Agent,
                None,
                "heuristic:browser-ua-missing-headers",
                false,
            ),
            // Payment and protocol signals: always agents.
            case(
                "payment-signature header",
                with(browser(CHROME), "payment-signature", "e30="),
                Agent,
                None,
                "payment-header",
                true,
            ),
            case(
                "v1 x-payment header",
                with(ua("curl/8"), "x-payment", "e30="),
                Agent,
                None,
                "payment-header",
                true,
            ),
        ];
        v.push(Case {
            mcp: true,
            method: Method::POST,
            ..case("mcp post", ua("node"), Agent, None, "mcp-endpoint", true)
        });
        v.push(Case {
            mcp: true,
            ..case(
                "mcp from a browser ua",
                browser(CHROME),
                Agent,
                None,
                "mcp-endpoint",
                true,
            )
        });
        v.push(Case {
            web_bot_auth: Some("chatgpt.com"),
            ..case(
                "web bot auth",
                browser(CHROME),
                Agent,
                Some("chatgpt.com"),
                "web-bot-auth:chatgpt.com",
                true,
            )
        });
        v
    }

    #[test]
    fn detection_table() {
        let all = cases();
        assert!(
            all.len() >= 20,
            "acceptance criteria require 20+ detector cases"
        );
        for c in all {
            let mut headers = HeaderMap::new();
            for (k, val) in &c.headers {
                headers.append(*k, HeaderValue::from_str(val).unwrap());
            }
            let req = RequestView {
                method: &c.method,
                path: "/api/quote",
                headers: &headers,
            };
            let ctx = Context {
                is_mcp_endpoint: c.mcp,
                web_bot_auth: c.web_bot_auth,
            };
            let v = classify(&req, &ctx);
            assert_eq!(v.kind, c.kind, "{}: {v:?}", c.name);
            assert_eq!(v.agent.as_deref(), c.agent, "{}", c.name);
            assert_eq!(v.reason, c.reason, "{}", c.name);
            assert_eq!(
                should_charge(DetectionMode::AgentsOnly, &v, false),
                c.charged,
                "{}: {v:?}",
                c.name
            );
            assert!(!should_charge(DetectionMode::Off, &v, true), "{}", c.name);
            assert!(
                should_charge(DetectionMode::AllRequests, &v, false),
                "{}",
                c.name
            );
        }
    }

    #[test]
    fn search_bots_charged_only_when_opted_in() {
        let v = Verdict {
            kind: Kind::SearchBot,
            agent: Some("Googlebot".into()),
            confidence: 0.95,
            reason: "ua:Googlebot".into(),
        };
        assert!(!should_charge(DetectionMode::AgentsOnly, &v, false));
        assert!(should_charge(DetectionMode::AgentsOnly, &v, true));
    }

    #[test]
    fn no_browser_is_ever_charged_in_agents_only() {
        for ua in [
            CHROME,
            SAFARI_IOS,
            SAFARI_MAC,
            FIREFOX,
            EDGE,
            CHROME_ANDROID,
            SAMSUNG,
        ] {
            // With and without the full navigation header set.
            for headers in [browser(ua), vec![("user-agent", ua.to_string())]] {
                let mut map = HeaderMap::new();
                for (k, v) in &headers {
                    map.append(*k, HeaderValue::from_str(v).unwrap());
                }
                let req = RequestView {
                    method: &Method::GET,
                    path: "/",
                    headers: &map,
                };
                let v = classify(&req, &Context::default());
                assert!(
                    !should_charge(DetectionMode::AgentsOnly, &v, false),
                    "{ua}: {v:?}"
                );
            }
        }
    }
}
