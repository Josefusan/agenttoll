use std::net::SocketAddr;
use std::path::PathBuf;

use agenttoll_core::config::Config;
use agenttoll_gateway::{Gateway, admin, router};
use clap::Parser;

/// Shortest admin token accepted; anything shorter leaves the admin API off.
const MIN_ADMIN_TOKEN_LEN: usize = 24;

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
    let admin_listen = config.admin_listen;
    if config.public_url.is_none() {
        tracing::warn!(
            "public_url is unset: 402 quotes will build resource.url from the client's Host header"
        );
    }
    let gateway = Gateway::new(config).await?;
    for n in gateway.networks() {
        tracing::info!(network = %n.config.network, pay_to = %n.config.pay_to, facilitator = %n.config.facilitator, "quoting");
    }

    match std::env::var("AGENTTOLL_ADMIN_TOKEN") {
        Ok(token) if token.len() >= MIN_ADMIN_TOKEN_LEN => {
            let listener = tokio::net::TcpListener::bind(admin_listen).await?;
            let app = admin::router(gateway.ledger().clone(), token);
            tracing::info!(%admin_listen, "admin API up");
            tokio::spawn(async move {
                if let Err(e) = axum::serve(listener, app).await {
                    tracing::error!(error = %e, "admin API stopped");
                }
            });
        }
        Ok(_) => tracing::warn!(
            "AGENTTOLL_ADMIN_TOKEN is shorter than {MIN_ADMIN_TOKEN_LEN} characters: admin API off"
        ),
        Err(_) => tracing::warn!("AGENTTOLL_ADMIN_TOKEN is unset: admin API (dashboard) off"),
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
