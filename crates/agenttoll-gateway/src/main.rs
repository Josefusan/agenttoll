use std::net::SocketAddr;
use std::path::PathBuf;

use agenttoll_core::config::Config;
use agenttoll_gateway::{Gateway, router};
use clap::Parser;

/// AgentToll gateway: charge AI agents per request, keep humans free.
#[derive(Parser)]
#[command(version)]
struct Args {
    /// Path to agenttoll.yaml.
    #[arg(long, default_value = "agenttoll.yaml")]
    config: PathBuf,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();
    let _ = dotenvy::dotenv();
    let args = Args::parse();

    let text = std::fs::read_to_string(&args.config)
        .map_err(|e| anyhow::anyhow!("reading {}: {e}", args.config.display()))?;
    let config = Config::parse(&text, |name| std::env::var(name).ok())?;
    let listen = config.listen;
    if config.public_url.is_none() {
        tracing::warn!(
            "public_url is unset: 402 quotes will build resource.url from the client's Host header"
        );
    }
    let gateway = Gateway::new(config).await?;
    for n in gateway.networks() {
        tracing::info!(network = %n.config.network, pay_to = %n.config.pay_to, extra = %serde_json::Value::Object(n.extra.clone()), "quoting");
    }

    let listener = tokio::net::TcpListener::bind(listen).await?;
    tracing::info!(%listen, origin = %gateway.config.origin, "agenttoll gateway up");
    axum::serve(
        listener,
        router(gateway).into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await?;
    Ok(())
}
