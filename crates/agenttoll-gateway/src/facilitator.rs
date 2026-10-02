//! Facilitator HTTP client: `POST /verify` and `POST /settle` with x402 v2 bodies
//! (KB-X402-06). The facilitator does the chain work, so this file is chain-agnostic.

use std::time::Duration;

use serde::Deserialize;
use serde_json::{Value, json};

use crate::x402::{PaymentRequirements, X402_VERSION};

/// `/verify` is read-only and fast; `/settle` waits for the chain.
const VERIFY_TIMEOUT: Duration = Duration::from_secs(5);
const SETTLE_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyResponse {
    pub is_valid: bool,
    #[serde(default)]
    pub invalid_reason: Option<String>,
    #[serde(default)]
    pub payer: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettleResponse {
    pub success: bool,
    /// Base58 signature on Solana, tx hash on EVM; `""` when nothing was broadcast.
    #[serde(default)]
    pub transaction: String,
    #[serde(default)]
    pub network: String,
    #[serde(default)]
    pub payer: Option<String>,
    #[serde(default)]
    pub error_reason: Option<String>,
}

impl SettleResponse {
    /// Settled, or broadcast and still confirming (`settlement_pending` is non-terminal and
    /// guarantees a transaction id, KB-X402-06).
    pub fn settled(&self) -> bool {
        (self.success || self.error_reason.as_deref() == Some("settlement_pending"))
            && !self.transaction.is_empty()
    }
}

#[derive(Debug, thiserror::Error)]
pub enum FacilitatorError {
    #[error("facilitator request failed: {0}")]
    Http(#[from] reqwest::Error),
    #[error("facilitator answered {status} with an unreadable body: {body}")]
    Body {
        status: reqwest::StatusCode,
        body: String,
    },
}

/// Sends `{x402Version, paymentPayload, paymentRequirements}` to `<facilitator>/<op>` and
/// parses the answer. Facilitators may answer a rejected payment with a 4xx that still
/// carries a well-formed body, so the body is parsed whatever the status.
async fn call<T: for<'de> Deserialize<'de>>(
    client: &reqwest::Client,
    facilitator: &str,
    op: &str,
    payload: &Value,
    requirements: &PaymentRequirements,
    timeout: Duration,
) -> Result<(T, Value), FacilitatorError> {
    let url = format!("{}/{op}", facilitator.trim_end_matches('/'));
    let body = json!({
        "x402Version": X402_VERSION,
        "paymentPayload": payload,
        "paymentRequirements": requirements,
    });
    let res = client
        .post(&url)
        .timeout(timeout)
        .json(&body)
        .send()
        .await?;
    let status = res.status();
    let text = res.text().await?;
    let raw: Value = serde_json::from_str(&text).map_err(|_| FacilitatorError::Body {
        status,
        body: truncate(&text),
    })?;
    let parsed = serde_json::from_value(raw.clone()).map_err(|_| FacilitatorError::Body {
        status,
        body: truncate(&text),
    })?;
    Ok((parsed, raw))
}

pub async fn verify(
    client: &reqwest::Client,
    facilitator: &str,
    payload: &Value,
    requirements: &PaymentRequirements,
) -> Result<VerifyResponse, FacilitatorError> {
    call(
        client,
        facilitator,
        "verify",
        payload,
        requirements,
        VERIFY_TIMEOUT,
    )
    .await
    .map(|(v, _)| v)
}

/// Returns the parsed response and the raw JSON, which is echoed to the buyer verbatim in
/// `PAYMENT-RESPONSE` so fields this gateway does not model (amount, extensions) survive.
pub async fn settle(
    client: &reqwest::Client,
    facilitator: &str,
    payload: &Value,
    requirements: &PaymentRequirements,
) -> Result<(SettleResponse, Value), FacilitatorError> {
    call(
        client,
        facilitator,
        "settle",
        payload,
        requirements,
        SETTLE_TIMEOUT,
    )
    .await
}

fn truncate(s: &str) -> String {
    s.chars().take(300).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settle(v: Value) -> SettleResponse {
        serde_json::from_value(v).unwrap()
    }

    #[test]
    fn settled_requires_a_transaction() {
        assert!(settle(json!({"success": true, "transaction": "sig", "network": "n"})).settled());
        assert!(!settle(json!({"success": true, "transaction": "", "network": "n"})).settled());
        assert!(
            !settle(
                json!({"success": false, "transaction": "sig", "errorReason": "insufficient_funds"})
            )
            .settled()
        );
        assert!(
            settle(
                json!({"success": false, "transaction": "sig", "errorReason": "settlement_pending"})
            )
            .settled()
        );
        assert!(
            !settle(
                json!({"success": false, "transaction": "", "errorReason": "settlement_pending"})
            )
            .settled()
        );
    }
}
