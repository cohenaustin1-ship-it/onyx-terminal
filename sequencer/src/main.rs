//! JPM Onyx Sequencer
//!
//! Sub-millisecond optimistic order sequencer sitting between the React
//! trading terminal and the permissioned Chainweb. Architecture:
//!
//!   WebSocket gateway (mTLS, X.509)
//!         │
//!         ▼
//!   Pre-validator (compliance cache, risk snapshot)
//!         │
//!         ▼
//!   LMAX-style ring buffer (lock-free, single-writer)
//!         │
//!         ├──► Matcher pool (per-instrument, CPU-pinned)
//!         │       │
//!         │       ▼
//!         │    Pact submit (batched, BFT-ordered)
//!         │
//!         └──► Fan-out: optimistic book deltas to all WS subscribers
//!
//! Hot-path SLO: <1ms p99 from TCP accept to optimistic ack.

use clap::Parser;
use std::sync::Arc;
use tokio::signal;
use tracing::{info, warn};

mod config;
mod consensus;
mod gateway;
mod marketdata;
mod matcher;
mod pact_client;
mod ring_buffer;
mod risk;
mod schemas;

use config::Config;

#[derive(Parser)]
#[command(name = "jpm-onyx-sequencer")]
#[command(about = "JPM Onyx order sequencer", long_about = None)]
struct Cli {
    /// Path to config file
    #[arg(short, long, default_value = "config/sequencer.toml")]
    config: String,

    /// Bind address for WebSocket gateway
    #[arg(short, long)]
    bind: Option<String>,

    /// Override log level
    #[arg(long, default_value = "info")]
    log_level: String,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();

    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::new(&cli.log_level))
        .json()
        .with_current_span(true)
        .init();

    info!("JPM Onyx Sequencer starting, build {}", env!("CARGO_PKG_VERSION"));

    let config = Arc::new(Config::load(&cli.config)?);
    if let Some(b) = cli.bind {
        info!(bind = %b, "bind override");
    }

    // 1. Spin up the lock-free ring buffer (LMAX Disruptor pattern)
    let ring = Arc::new(ring_buffer::OrderRing::new(config.ring_capacity));

    // 2. Spawn one matcher per instrument, pinned to its own core
    let matchers = matcher::spawn_pool(config.clone(), ring.clone()).await?;

    // 3. Start Pact submitter — drains matched fills, batches to Chainweb
    let pact = Arc::new(pact_client::PactClient::connect(&config.chainweb).await?);
    let _pact_task = tokio::spawn(pact_client::submit_loop(pact.clone(), ring.clone()));

    // 4. Start the HotStuff BFT consensus client (validator set of 21)
    let consensus = consensus::HotStuffClient::connect(&config.consensus).await?;
    let _consensus_task = tokio::spawn(consensus.run_loop(ring.clone()));

    // 5. Start ICE/CME market data ingestors for oracle price feeds
    let md = marketdata::MarketDataHub::start(config.clone()).await?;

    // 6. Start the WebSocket gateway (fast + final channels)
    let gateway = gateway::Gateway::new(config.clone(), ring.clone(), md.clone(), matchers.clone());
    let gateway_task = tokio::spawn(gateway.serve());

    info!("sequencer fully online — awaiting orders");

    // Graceful shutdown
    signal::ctrl_c().await?;
    warn!("shutdown signal received, draining...");
    gateway_task.abort();
    Ok(())
}
