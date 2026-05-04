//! Sequencer configuration loader

use serde::Deserialize;
use std::path::Path;

#[derive(Debug, Clone, Deserialize)]
pub struct Config {
    pub bind:           String,
    pub tls_cert:       String,
    pub tls_key:        String,
    pub ring_capacity:  usize,
    pub instruments:    Vec<InstrumentConfig>,
    pub chainweb:       ChainwebConfig,
    pub consensus:      ConsensusConfig,
    pub marketdata:     MarketDataConfig,
    pub compliance:     ComplianceConfig,
}

#[derive(Debug, Clone, Deserialize)]
pub struct InstrumentConfig {
    pub id:           String,        // "BTC-PERP", "WTI-F26"
    pub class:        String,        // "crypto" | "energy"
    pub chain_id:     u8,            // Chainweb chain ID
    pub tick_size:    f64,
    pub lot_size:     f64,
    pub max_leverage: u8,
    pub cpu_pin:      Option<usize>, // core to pin matcher to
}

#[derive(Debug, Clone, Deserialize)]
pub struct ChainwebConfig {
    pub nodes:          Vec<String>,   // JPM validator endpoints
    pub network_id:     String,        // "jpm-onyx-mainnet"
    pub submit_timeout: u64,           // ms
    pub batch_size:     usize,
    pub batch_window:   u64,           // ms
}

#[derive(Debug, Clone, Deserialize)]
pub struct ConsensusConfig {
    pub validator_endpoints: Vec<String>,
    pub expected_validators: usize,
    pub quorum_threshold:    usize,    // 2f+1 for BFT
    pub pipeline_depth:      usize,    // HotStuff pipeline
}

#[derive(Debug, Clone, Deserialize)]
pub struct MarketDataConfig {
    pub ice_endpoint:  Option<String>,
    pub cme_endpoint:  Option<String>,
    pub eia_api_key:   Option<String>,
    pub fallback:      String,        // "simulated" for dev
}

#[derive(Debug, Clone, Deserialize)]
pub struct ComplianceConfig {
    pub lei_cache_ttl:    u64,        // seconds
    pub prevalidate_url:  String,     // http endpoint for compliance service
    pub surveillance_url: String,
}

impl Config {
    pub fn load<P: AsRef<Path>>(path: P) -> anyhow::Result<Self> {
        let settings = config::Config::builder()
            .add_source(config::File::with_name(path.as_ref().to_str().unwrap()))
            .add_source(config::Environment::with_prefix("JPM_ONYX").separator("__"))
            .build()?;
        Ok(settings.try_deserialize()?)
    }
}
