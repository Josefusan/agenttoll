//! Reads a facilitator's `GET /supported` (KB-X402-06) to learn the Solana fee payer that
//! must be quoted in `extra.feePayer` (KB-X402-07). Never hardcoded: it differs per facilitator.

use std::time::Duration;

use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Deserialize)]
struct Supported {
    kinds: Vec<Kind>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Kind {
    x402_version: u8,
    scheme: String,
    network: String,
    #[serde(default)]
    extra: Option<Value>,
}

pub async fn fee_payer(
    client: &reqwest::Client,
    facilitator: &str,
    network: &str,
) -> Result<String, String> {
    let url = format!("{}/supported", facilitator.trim_end_matches('/'));
    let supported: Supported = client
        .get(&url)
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("GET {url}: {e}"))?
        .json()
        .await
        .map_err(|e| format!("GET {url}: unexpected body: {e}"))?;
    supported
        .kinds
        .iter()
        .find(|k| k.x402_version == 2 && k.scheme == "exact" && k.network == network)
        .and_then(|k| k.extra.as_ref()?.get("feePayer")?.as_str())
        .map(str::to_owned)
        .ok_or_else(|| format!("{url} lists no v2 exact feePayer for {network}"))
}
