//! Streaming forward to the origin with header hygiene (RFC 9110 §7.6.1, agenttoll-proxy-rust skill).

use std::net::IpAddr;

use agenttoll_core::config::Config;
use agenttoll_core::headers;
use axum::body::Body;
use axum::http::request::Parts;
use axum::http::{HeaderMap, HeaderName, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};

/// Hop-by-hop headers never cross a proxy.
const HOP_BY_HOP: &[&str] = &[
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "proxy-connection",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
];

/// Removes hop-by-hop headers, including any named in `Connection`.
pub fn strip_hop_by_hop(headers: &mut HeaderMap) {
    let listed: Vec<HeaderName> = headers
        .get_all(header::CONNECTION)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(','))
        .filter_map(|name| HeaderName::from_bytes(name.trim().as_bytes()).ok())
        .collect();
    for name in listed {
        headers.remove(name);
    }
    for name in HOP_BY_HOP {
        headers.remove(*name);
    }
}

/// Headers sent to the origin: hop-by-hop and payment headers removed, client-supplied
/// `x-agenttoll-*` dropped (only the gateway may assert payment), `X-Forwarded-*` set.
pub fn origin_request_headers(
    incoming: &HeaderMap,
    config: &Config,
    peer: Option<IpAddr>,
) -> HeaderMap {
    let mut h = incoming.clone();
    strip_hop_by_hop(&mut h);
    h.remove(headers::PAYMENT_SIGNATURE);
    h.remove(headers::X_PAYMENT);
    let spoofed: Vec<HeaderName> = h
        .keys()
        .filter(|k| k.as_str().starts_with("x-agenttoll-"))
        .cloned()
        .collect();
    for name in spoofed {
        h.remove(name);
    }

    let client_host = incoming.get(header::HOST).cloned();
    if !config.preserve_host {
        h.remove(header::HOST); // reqwest sets the origin's own host
    }
    if let Some(host) = client_host {
        h.insert("x-forwarded-host", host);
    }
    if !h.contains_key("x-forwarded-proto") {
        h.insert("x-forwarded-proto", HeaderValue::from_static("http"));
    }
    if let Some(ip) = peer {
        let mut chain: Vec<String> = incoming
            .get_all("x-forwarded-for")
            .iter()
            .filter_map(|v| v.to_str().ok())
            .map(str::to_owned)
            .collect();
        chain.push(ip.to_string());
        let chain = chain.join(", ");
        if let Ok(v) = HeaderValue::from_str(&chain) {
            h.insert("x-forwarded-for", v);
        }
    }
    h
}

/// Forwards the request to `config.origin` and streams the response back unchanged
/// (status, cookies, redirects, compression), minus hop-by-hop headers.
pub async fn forward(
    client: &reqwest::Client,
    config: &Config,
    parts: Parts,
    body: Body,
    peer: Option<IpAddr>,
) -> Response {
    let path_and_query = parts.uri.path_and_query().map_or("/", |pq| pq.as_str());
    let url = format!("{}{path_and_query}", config.origin.trim_end_matches('/'));
    let request = client
        .request(parts.method.clone(), url)
        .headers(origin_request_headers(&parts.headers, config, peer))
        .body(reqwest::Body::wrap_stream(body.into_data_stream()));

    let upstream = match request.send().await {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!(error = %e, "origin unreachable");
            return (StatusCode::BAD_GATEWAY, "origin unreachable").into_response();
        }
    };

    let status = upstream.status();
    let mut response_headers = upstream.headers().clone();
    strip_hop_by_hop(&mut response_headers);
    let mut res = Response::new(Body::from_stream(upstream.bytes_stream()));
    *res.status_mut() = status;
    *res.headers_mut() = response_headers;
    res
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(preserve_host: bool) -> Config {
        let text = format!(
            "origin: http://o:4000\nlisten: 0.0.0.0:8402\nadmin_listen: 127.0.0.1:8403\npreserve_host: {preserve_host}\n\
             networks:\n  s:\n    network: \"solana:x\"\n    asset: a\n    pay_to: p\n    facilitator: https://f\nroutes: []\n"
        );
        Config::parse(&text, |_| None).unwrap()
    }

    fn map(pairs: &[(&'static str, &str)]) -> HeaderMap {
        let mut h = HeaderMap::new();
        for (k, v) in pairs {
            h.append(*k, HeaderValue::from_str(v).unwrap());
        }
        h
    }

    #[test]
    fn strips_hop_by_hop_and_connection_listed() {
        let mut h = map(&[
            ("connection", "close, x-secret"),
            ("x-secret", "1"),
            ("upgrade", "h2c"),
            ("te", "trailers"),
            ("accept", "*/*"),
        ]);
        strip_hop_by_hop(&mut h);
        assert_eq!(h.len(), 1);
        assert!(h.contains_key("accept"));
    }

    #[test]
    fn origin_headers_drop_payment_and_spoofed_agenttoll_headers() {
        let incoming = map(&[
            ("host", "acme.dev"),
            ("payment-signature", "abc"),
            ("x-payment", "abc"),
            ("x-agenttoll-paid", "1"),
            ("X-AgentToll-Agent", "me"),
            ("x-forwarded-for", "1.1.1.1"),
            ("cookie", "a=b"),
        ]);
        let h =
            origin_request_headers(&incoming, &config(false), Some("10.0.0.9".parse().unwrap()));
        for gone in [
            "payment-signature",
            "x-payment",
            "x-agenttoll-paid",
            "x-agenttoll-agent",
            "host",
        ] {
            assert!(!h.contains_key(gone), "{gone} should be stripped");
        }
        assert_eq!(h["x-forwarded-host"], "acme.dev");
        assert_eq!(h["x-forwarded-for"], "1.1.1.1, 10.0.0.9");
        assert_eq!(h["x-forwarded-proto"], "http");
        assert_eq!(h["cookie"], "a=b");
    }

    #[test]
    fn preserve_host_keeps_client_host() {
        let h = origin_request_headers(&map(&[("host", "acme.dev")]), &config(true), None);
        assert_eq!(h["host"], "acme.dev");
    }
}
