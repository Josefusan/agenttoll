//! SIMULATED x402 facilitator for demos and development without funded wallets.
//!
//! It speaks the facilitator API (KB-X402-06) but never touches a chain: `/verify` checks the
//! request shape only, and `/settle` returns a transaction id starting with `SIMULATED-`,
//! which the gateway ledger, dashboard and buyer all label as simulated. Never point a
//! production gateway at it.

use std::time::{SystemTime, UNIX_EPOCH};

use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::{Value, json};

const SOLANA_DEVNET: &str = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"; // KB-SOL-01
const BASE_SEPOLIA: &str = "eip155:84532"; // KB-BASE-01
/// Prefix the gateway uses to mark simulated settlements (ledger::SIMULATED_PREFIX).
const SIMULATED_PREFIX: &str = "SIMULATED-";

#[tokio::main]
async fn main() {
    let addr = std::env::var("MOCK_FACILITATOR_LISTEN").unwrap_or_else(|_| "127.0.0.1:4020".into());
    // A syntactically valid Solana pubkey so buyers can build the transaction; nobody holds it.
    let fee_payer = bs58::encode(random_bytes::<32>()).into_string();
    let app = Router::new()
        .route("/supported", get(move || supported(fee_payer.clone())))
        .route("/verify", post(verify))
        .route("/settle", post(settle));
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .expect("bind MOCK_FACILITATOR_LISTEN");
    eprintln!(
        "SIMULATED facilitator on http://{addr}: no chain, no money, settlements are labelled {SIMULATED_PREFIX}*"
    );
    axum::serve(listener, app).await.expect("serve");
}

async fn supported(fee_payer: String) -> Json<Value> {
    Json(json!({
        "kinds": [
            { "x402Version": 2, "scheme": "exact", "network": SOLANA_DEVNET, "extra": { "feePayer": fee_payer } },
            { "x402Version": 2, "scheme": "exact", "network": BASE_SEPOLIA }
        ],
        "extensions": [],
        "signers": {}
    }))
}

/// Shape check only: a real facilitator simulates the transaction on chain.
fn invalid_reason(body: &Value) -> Option<&'static str> {
    if body["x402Version"] != 2 {
        return Some("invalid_x402_version");
    }
    if !body["paymentPayload"]["payload"].is_object() {
        return Some("invalid_payload");
    }
    let req = &body["paymentRequirements"];
    if req["amount"].as_str().is_none()
        || req["payTo"].as_str().is_none()
        || req["network"].as_str().is_none()
    {
        return Some("invalid_payment_requirements");
    }
    None
}

async fn verify(Json(body): Json<Value>) -> Json<Value> {
    match invalid_reason(&body) {
        Some(reason) => Json(json!({ "isValid": false, "invalidReason": reason })),
        None => Json(json!({ "isValid": true, "payer": "SIMULATED-BUYER" })),
    }
}

async fn settle(Json(body): Json<Value>) -> Json<Value> {
    let network = body["paymentRequirements"]["network"].clone();
    if let Some(reason) = invalid_reason(&body) {
        return Json(
            json!({ "success": false, "transaction": "", "network": network, "errorReason": reason }),
        );
    }
    let tx = format!("{SIMULATED_PREFIX}{}", hex(&random_bytes::<12>()));
    eprintln!(
        "simulated settle {} {} on {} -> {tx}",
        body["paymentRequirements"]["amount"], body["paymentRequirements"]["asset"], network
    );
    Json(json!({
        "success": true,
        "transaction": tx,
        "network": network,
        "payer": "SIMULATED-BUYER",
        "amount": body["paymentRequirements"]["amount"],
    }))
}

/// Non-cryptographic randomness is fine here: ids only need to be unique per run.
fn random_bytes<const N: usize>() -> [u8; N] {
    use std::hash::{BuildHasher, Hasher};
    let mut out = [0u8; N];
    let seed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_nanos());
    for (i, chunk) in out.chunks_mut(8).enumerate() {
        let mut h = std::collections::hash_map::RandomState::new().build_hasher();
        h.write_u128(seed);
        h.write_usize(i);
        chunk.copy_from_slice(&h.finish().to_le_bytes()[..chunk.len()]);
    }
    out
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shape_checks() {
        let good = json!({ "x402Version": 2, "paymentPayload": { "payload": {} }, "paymentRequirements": { "amount": "2000", "payTo": "p", "network": "n" } });
        assert_eq!(invalid_reason(&good), None);
        assert_eq!(
            invalid_reason(&json!({ "x402Version": 1 })),
            Some("invalid_x402_version")
        );
        assert_eq!(
            invalid_reason(&json!({ "x402Version": 2, "paymentPayload": {} })),
            Some("invalid_payload")
        );
    }

    #[test]
    fn ids_are_unique_and_valid_pubkey_length() {
        assert_ne!(random_bytes::<12>(), random_bytes::<12>());
        assert_eq!(
            bs58::decode(bs58::encode(random_bytes::<32>()).into_string())
                .into_vec()
                .unwrap()
                .len(),
            32
        );
    }
}
