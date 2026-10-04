//! SIMULATED x402 facilitator for demos and development without funded wallets.
//!
//! It speaks the facilitator API (KB-X402-06) but never touches a chain: `/verify` checks the
//! request shape only, and `/settle` returns a transaction id starting with `SIMULATED-`,
//! which the gateway ledger, dashboard and buyer all label as simulated. Never point a
//! production gateway at it.
//!
//! Fault knobs, for the eval suite only. They are off unless `MOCK_FACILITATOR_FAULTS=1`.
//! When on, a payment whose `paymentPayload.payload.mock` is `"verify_fail"` is rejected by
//! `/verify`, and one whose value is `"settle_timeout"` makes `/settle` sleep for
//! `MOCK_FACILITATOR_SLOW_MS` (default 3000) before answering, so a gateway with a shorter
//! settle budget gives up and records the payment as unconfirmed.

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

/// A fault a payment asks for with `paymentPayload.payload.mock`.
#[derive(Debug, PartialEq)]
enum Fault {
    VerifyFail,
    SettleTimeout,
}

fn requested_fault(body: &Value) -> Option<Fault> {
    match body["paymentPayload"]["payload"]["mock"].as_str()? {
        "verify_fail" => Some(Fault::VerifyFail),
        "settle_timeout" => Some(Fault::SettleTimeout),
        _ => None,
    }
}

fn faults_enabled() -> bool {
    std::env::var("MOCK_FACILITATOR_FAULTS").is_ok_and(|v| v == "1")
}

fn slow_ms() -> u64 {
    std::env::var("MOCK_FACILITATOR_SLOW_MS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(3000)
}

async fn verify(Json(body): Json<Value>) -> Json<Value> {
    verify_with(faults_enabled(), &body)
}

fn verify_with(faults: bool, body: &Value) -> Json<Value> {
    if faults && requested_fault(body) == Some(Fault::VerifyFail) {
        return Json(json!({ "isValid": false, "invalidReason": "mock_verify_failure" }));
    }
    match invalid_reason(body) {
        Some(reason) => Json(json!({ "isValid": false, "invalidReason": reason })),
        None => Json(json!({ "isValid": true, "payer": "SIMULATED-BUYER" })),
    }
}

async fn settle(Json(body): Json<Value>) -> Json<Value> {
    if faults_enabled() && requested_fault(&body) == Some(Fault::SettleTimeout) {
        tokio::time::sleep(std::time::Duration::from_millis(slow_ms())).await;
    }
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
    fn fault_knobs_are_off_unless_enabled() {
        // SAFETY: no other test in this binary reads or writes this variable.
        unsafe { std::env::remove_var("MOCK_FACILITATOR_FAULTS") };
        assert!(!faults_enabled());
        unsafe { std::env::set_var("MOCK_FACILITATOR_FAULTS", "0") };
        assert!(!faults_enabled());
        unsafe { std::env::set_var("MOCK_FACILITATOR_FAULTS", "1") };
        assert!(faults_enabled());
        unsafe { std::env::remove_var("MOCK_FACILITATOR_FAULTS") };
    }

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
    fn fault_knobs_are_read_from_the_payload_and_gated() {
        let with = |mock: &str| json!({ "x402Version": 2, "paymentPayload": { "payload": { "mock": mock } },
            "paymentRequirements": { "amount": "2000", "payTo": "p", "network": "n" } });
        assert_eq!(requested_fault(&with("verify_fail")), Some(Fault::VerifyFail));
        assert_eq!(requested_fault(&with("settle_timeout")), Some(Fault::SettleTimeout));
        assert_eq!(requested_fault(&with("other")), None);
        assert_eq!(requested_fault(&json!({ "paymentPayload": { "payload": {} } })), None);
        let Json(on) = verify_with(true, &with("verify_fail"));
        assert_eq!(on["isValid"], false);
        assert_eq!(on["invalidReason"], "mock_verify_failure");
        let Json(off) = verify_with(false, &with("verify_fail"));
        assert_eq!(off["isValid"], true, "knobs are ignored unless enabled");
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
