//! Demo buyer: fetches an AgentToll-protected URL, pays the 402 quote with testnet USDC on
//! the chosen network (Solana devnet or Base Sepolia), and prints the data and the receipt.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use agenttoll_core::money::Atomic;
use alloy_signer_local::PrivateKeySigner;
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use clap::{Parser, ValueEnum};
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_keypair::Keypair;
use solana_signer::Signer;
use x402_chain_eip155::V2Eip155ExactClient;
use x402_chain_solana::V2SolanaExactClient;
use x402_reqwest::{ReqwestWithPayments, ReqwestWithPaymentsBuild, X402Client};
use x402_types::scheme::client::{PaymentCandidate, PaymentSelector};

/// Self-declared agent identity, so the gateway's detector quotes a price (agent-detection skill).
const USER_AGENT: &str = concat!(
    "AgentToll-Buyer/",
    env!("CARGO_PKG_VERSION"),
    " (+https://github.com/Josefusan/agenttoll)"
);

/// Settlements from AgentToll's local simulated facilitator (demo/mock-facilitator).
const SIMULATED_PREFIX: &str = "SIMULATED-";

#[derive(Clone, Copy, PartialEq, Eq, ValueEnum)]
enum Network {
    /// Solana devnet USDC (primary).
    Solana,
    /// Base Sepolia USDC (backup rail).
    Base,
}

#[derive(Parser)]
#[command(version, about = "Pay an AgentToll-protected URL with testnet USDC")]
struct Args {
    /// URL behind the AgentToll gateway, e.g. http://localhost:8402/api/quote
    url: Option<String>,
    #[arg(long, value_enum, default_value = "solana")]
    network: Network,
    /// Refuse any quote above this many USD per call.
    #[arg(long, env = "BUYER_MAX_USD_PER_CALL", default_value = "0.01")]
    max_usd_per_call: String,
    /// Solana keypair file (JSON byte array, as written by `solana-keygen`).
    #[arg(
        long,
        env = "BUYER_SOLANA_KEYPAIR",
        default_value = "./buyer.keypair.json"
    )]
    solana_keypair: PathBuf,
    #[arg(
        long,
        env = "SOLANA_RPC_URL",
        default_value = "https://api.devnet.solana.com"
    )]
    solana_rpc: String,
    /// Hex private key for Base Sepolia. Read from the environment only, never a flag.
    #[arg(skip = std::env::var("BUYER_EVM_PRIVATE_KEY").ok())]
    evm_private_key: Option<String>,
    /// Write a fresh Solana devnet keypair to this path (mode 600), print its address, exit.
    #[arg(long, value_name = "PATH")]
    new_solana_keypair: Option<PathBuf>,
}

/// Picks the first quote on the requested network that is within the per-call cap.
struct CappedSelector {
    namespace: &'static str,
    max_atomic: u128,
}

/// USDC on the networks the buyer pays on (KB-SOL-01, KB-BASE-01). The cap is in 6-decimal
/// USDC units, so a quote in any other asset is refused rather than mis-capped.
const USDC_ASSETS: &[&str] = &[
    "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", // Solana devnet
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // Solana mainnet
    "0x036CbD53842c5426634e7929541eC2318f3dCF7e",   // Base Sepolia
    "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",   // Base mainnet
];

impl PaymentSelector for CappedSelector {
    fn select<'a>(&self, candidates: &'a [PaymentCandidate]) -> Option<&'a PaymentCandidate> {
        candidates.iter().find(|c| {
            let amount: u128 = c.amount.to_string().parse().unwrap_or(u128::MAX);
            let usdc = USDC_ASSETS.iter().any(|a| a.eq_ignore_ascii_case(&c.asset));
            let ok = c.chain_id.namespace() == self.namespace && usdc && amount <= self.max_atomic;
            if !ok {
                eprintln!(
                    "skipping quote {} {} on {} (cap {} atomic)",
                    c.amount, c.asset, c.chain_id, self.max_atomic
                );
            }
            ok
        })
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let _ = dotenvy::dotenv();
    let args = Args::parse();

    if let Some(path) = &args.new_solana_keypair {
        return new_keypair(path);
    }
    let url = args
        .url
        .clone()
        .ok_or_else(|| anyhow::anyhow!("URL is required"))?;
    let max_atomic = u128::from(args.max_usd_per_call.parse::<Atomic>()?.0);

    let (client, namespace) = match args.network {
        Network::Solana => {
            let keypair = read_keypair(&args.solana_keypair)?;
            eprintln!("buyer {} on Solana devnet", keypair.pubkey());
            let rpc = Arc::new(RpcClient::new(args.solana_rpc.clone()));
            (
                X402Client::new().register(V2SolanaExactClient::new(Arc::new(keypair), rpc)),
                "solana",
            )
        }
        Network::Base => {
            let key = args
                .evm_private_key
                .as_deref()
                .ok_or_else(|| anyhow::anyhow!("set BUYER_EVM_PRIVATE_KEY for --network base"))?;
            let signer: PrivateKeySigner = key.parse()?;
            eprintln!("buyer {} on Base Sepolia", signer.address());
            (
                X402Client::new().register(V2Eip155ExactClient::new(Arc::new(signer))),
                "eip155",
            )
        }
    };
    let client = client.with_selector(CappedSelector {
        namespace,
        max_atomic,
    });
    let http = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .build()?
        .with_payments(client)
        .build();

    let res = http.get(&url).send().await?;
    let status = res.status();
    let receipt = res
        .headers()
        .get("payment-response")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| STANDARD.decode(v).ok())
        .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok());
    let body = res.text().await?;

    println!("status: {status}");
    println!("body:   {body}");
    match receipt {
        Some(r) => {
            let tx = r["transaction"].as_str().unwrap_or("");
            println!(
                "paid:   {} on {}",
                r["success"],
                r["network"].as_str().unwrap_or("?")
            );
            println!("tx:     {tx}");
            if tx.starts_with(SIMULATED_PREFIX) {
                println!(
                    "note:   SIMULATED settlement from a local test facilitator; nothing went on chain"
                );
            } else if !tx.is_empty() {
                println!("view:   {}", explorer(args.network, tx));
            }
        }
        None if status.is_success() => println!("paid:   nothing (free for this client)"),
        None => anyhow::bail!("request failed with {status} and no payment receipt"),
    }
    Ok(())
}

fn explorer(network: Network, tx: &str) -> String {
    match network {
        Network::Solana => format!("https://explorer.solana.com/tx/{tx}?cluster=devnet"), // KB-SOL-01
        Network::Base => format!("https://sepolia.basescan.org/tx/{tx}"),
    }
}

fn read_keypair(path: &Path) -> anyhow::Result<Keypair> {
    let text = std::fs::read_to_string(path)
        .map_err(|e| anyhow::anyhow!("reading {}: {e}", path.display()))?;
    let bytes: Vec<u8> = serde_json::from_str(&text)?;
    Keypair::try_from(bytes.as_slice())
        .map_err(|e| anyhow::anyhow!("{}: not a Solana keypair: {e}", path.display()))
}

fn new_keypair(path: &Path) -> anyhow::Result<()> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    let keypair = Keypair::new();
    let bytes: Vec<u8> = keypair.to_bytes().to_vec();
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)?;
    file.write_all(serde_json::to_string(&bytes)?.as_bytes())?;
    println!("{}", keypair.pubkey());
    eprintln!(
        "wrote {} (mode 600). Devnet only: fund it at https://faucet.circle.com",
        path.display()
    );
    Ok(())
}
