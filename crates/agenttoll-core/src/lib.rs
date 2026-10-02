//! AgentToll core: config, human-vs-agent detection, pricing and MCP inspection.
//! Pure functions only. Network, disk and clock access live in `agenttoll-gateway`.

pub mod config;
pub mod detector;
pub mod mcp;
pub mod money;
pub mod path;
pub mod pricer;

/// x402 HTTP header names. HTTP header names are case-insensitive; `http` wants lowercase.
pub mod headers {
    /// v2 challenge, server to client with 402: base64 `PaymentRequired` (KB-X402-01).
    pub const PAYMENT_REQUIRED: &str = "payment-required";
    /// v2 payment, client to server: base64 `PaymentPayload` (KB-X402-01).
    pub const PAYMENT_SIGNATURE: &str = "payment-signature";
    /// v2 receipt, server to client: base64 `SettlementResponse` (KB-X402-01).
    pub const PAYMENT_RESPONSE: &str = "payment-response";
    /// v1 payment header, recognized only so detection treats v1 payers as agents.
    pub const X_PAYMENT: &str = "x-payment";
}
