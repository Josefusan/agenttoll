//! x402 v2 wire types and the 402 challenge (KB-X402-01, KB-X402-06, KB-X402-07).
//! Hand-rolled on purpose: see DECISIONS.md 2026-10-02 (x402-axum pricing is body-blind).

use agenttoll_core::config::NetworkConfig;
use agenttoll_core::pricer::PriceTag;
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

pub const X402_VERSION: u8 = 2;
/// How long a quote stays payable. Solana blockhashes live ~60–90 s (KB-X402-07).
pub const MAX_TIMEOUT_SECONDS: u64 = 60;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentRequired {
    pub x402_version: u8,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub resource: ResourceInfo,
    pub accepts: Vec<PaymentRequirements>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceInfo {
    pub url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentRequirements {
    pub scheme: String,
    /// CAIP-2 (KB-SOL-01, KB-BASE-01).
    pub network: String,
    /// Atomic units as a decimal string. v2 field name; v1 called it `maxAmountRequired`.
    pub amount: String,
    pub asset: String,
    pub pay_to: String,
    pub max_timeout_seconds: u64,
    #[serde(default)]
    pub extra: Map<String, Value>,
}

/// A configured network with its scheme-specific `extra` resolved (fee payer etc.).
#[derive(Debug, Clone)]
pub struct QuoteNetwork {
    pub config: NetworkConfig,
    pub extra: Map<String, Value>,
}

impl QuoteNetwork {
    /// `fee_payer` is required for Solana networks (KB-X402-07) and ignored elsewhere.
    pub fn new(config: NetworkConfig, fee_payer: Option<String>) -> Result<QuoteNetwork, String> {
        let extra = match config.network.split_once(':').map(|(ns, _)| ns) {
            Some("solana") => {
                let fee_payer = fee_payer
                    .ok_or_else(|| format!("no Solana fee payer for {}", config.network))?;
                json!({ "feePayer": fee_payer })
            }
            // EIP-3009 domain of USDC (KB-BASE-01).
            Some("eip155") => json!({ "name": "USDC", "version": "2" }),
            _ => json!({}),
        };
        let Value::Object(extra) = extra else {
            unreachable!("json! object literal")
        };
        Ok(QuoteNetwork { config, extra })
    }

    pub fn requirements(&self, tag: &PriceTag) -> PaymentRequirements {
        PaymentRequirements {
            scheme: "exact".into(),
            network: self.config.network.clone(),
            amount: tag.amount.0.to_string(),
            asset: self.config.asset.clone(),
            pay_to: self.config.pay_to.clone(),
            max_timeout_seconds: MAX_TIMEOUT_SECONDS,
            extra: self.extra.clone(),
        }
    }
}

/// One `accepts[]` entry per configured network.
pub fn payment_required(
    networks: &[QuoteNetwork],
    tag: &PriceTag,
    url: String,
    error: &str,
) -> PaymentRequired {
    PaymentRequired {
        x402_version: X402_VERSION,
        error: Some(error.to_string()),
        resource: ResourceInfo {
            url,
            description: Some(
                tag.description
                    .clone()
                    .unwrap_or_else(|| tag.resource.clone()),
            ),
            mime_type: None,
        },
        accepts: networks.iter().map(|n| n.requirements(tag)).collect(),
    }
}

/// Header encoding for `PAYMENT-REQUIRED` / `PAYMENT-RESPONSE`: base64 of the JSON.
pub fn encode_header<T: Serialize>(value: &T) -> String {
    STANDARD.encode(serde_json::to_vec(value).expect("x402 types always serialize"))
}

pub fn decode_header<T: for<'de> Deserialize<'de>>(header: &str) -> Option<T> {
    let bytes = STANDARD.decode(header.trim()).ok()?;
    serde_json::from_slice(&bytes).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use agenttoll_core::money::Atomic;

    fn net(network: &str) -> NetworkConfig {
        NetworkConfig {
            network: network.into(),
            asset: "mint".into(),
            pay_to: "payto".into(),
            facilitator: "https://f.example".into(),
            fee_payer: None,
        }
    }

    #[test]
    fn solana_requires_fee_payer() {
        let sol = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
        assert!(QuoteNetwork::new(net(sol), None).is_err());
        let q = QuoteNetwork::new(net(sol), Some("FeePayer1".into())).unwrap();
        assert_eq!(q.extra["feePayer"], "FeePayer1");
        let base = QuoteNetwork::new(net("eip155:84532"), None).unwrap();
        assert_eq!(base.extra["name"], "USDC");
    }

    #[test]
    fn challenge_round_trips_through_the_header() {
        let nets = vec![
            QuoteNetwork::new(
                net("solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"),
                Some("Fee".into()),
            )
            .unwrap(),
            QuoteNetwork::new(net("eip155:84532"), None).unwrap(),
        ];
        let tag = PriceTag {
            amount: Atomic(2000),
            resource: "GET /api/quote".into(),
            description: None,
        };
        let pr = payment_required(
            &nets,
            &tag,
            "http://h/api/quote".into(),
            "PAYMENT-SIGNATURE header is required",
        );
        let decoded: PaymentRequired = decode_header(&encode_header(&pr)).unwrap();
        assert_eq!(decoded, pr);

        let raw: Value =
            serde_json::from_slice(&STANDARD.decode(encode_header(&pr)).unwrap()).unwrap();
        assert_eq!(raw["x402Version"], 2);
        assert_eq!(raw["accepts"][0]["amount"], "2000");
        assert_eq!(raw["accepts"][0]["payTo"], "payto");
        assert_eq!(raw["accepts"][0]["maxTimeoutSeconds"], 60);
        assert!(raw["accepts"][0].get("maxAmountRequired").is_none());
        assert_eq!(raw["resource"]["description"], "GET /api/quote");
    }

    #[test]
    fn decode_rejects_garbage() {
        assert!(decode_header::<PaymentRequired>("!!!").is_none());
        assert!(decode_header::<PaymentRequired>(&STANDARD.encode("{}")).is_none());
    }
}
