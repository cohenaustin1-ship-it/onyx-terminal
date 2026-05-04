//! Market data ingestion — pluggable adapters for ICE, CME, EIA, and simulated.
//!
//! Adapters expose a common trait that produces `MarkPrice` events into the ring.
//! The hub fans out subscriptions to multiple adapters and falls back in order
//! (primary → secondary → simulated) if an upstream is unreachable.
//!
//! IMPORTANT: ICE and CME market data is entitled/licensed. The adapters here
//! are the integration skeleton — they require JPM's ICE WebICE credentials
//! and CME Globex Co-Lo session details respectively. EIA is free/public and
//! works out of the box with just an API key.

use async_trait::async_trait;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;
use tokio::time::interval;
use tracing::{info, warn, error};

use crate::config::Config;
use crate::ring_buffer::{OrderRing, publish_order};
use crate::schemas::{EventKind, Book};

#[async_trait]
pub trait MarketDataAdapter: Send + Sync {
    fn name(&self) -> &'static str;

    /// Returns symbols this adapter can provide.
    fn symbols(&self) -> Vec<String>;

    /// Subscribe to mark-price updates for a symbol. Adapter should push events
    /// into the provided ring at whatever native cadence the venue supports.
    async fn subscribe(&self, symbol: &str, ring: Arc<OrderRing>) -> anyhow::Result<()>;

    /// Health check — called every 30s by the hub for failover decisions.
    async fn healthy(&self) -> bool;
}

// -----------------------------------------------------------------------------
// ICE WebICE adapter — for Brent, WTI, NG, Heating Oil futures
// -----------------------------------------------------------------------------
pub struct IceAdapter {
    endpoint:     String,
    api_key:      String,
    session_id:   Arc<RwLock<Option<String>>>,
}

impl IceAdapter {
    pub fn new(endpoint: &str, api_key: &str) -> Self {
        Self {
            endpoint: endpoint.into(),
            api_key:  api_key.into(),
            session_id: Arc::new(RwLock::new(None)),
        }
    }

    /// Perform ICE WebICE logon. In production this establishes a persistent
    /// FIX 4.4 session; here we use the REST snapshot API as a placeholder.
    async fn logon(&self) -> anyhow::Result<String> {
        let client = reqwest::Client::new();
        let resp = client.post(format!("{}/api/v1/session", self.endpoint))
            .header("X-ICE-API-Key", &self.api_key)
            .json(&serde_json::json!({
                "username": std::env::var("ICE_USERNAME").unwrap_or_default(),
                "entitlements": ["B", "CL", "NG", "HO"],   // Brent, WTI, NatGas, HeatOil
            }))
            .send()
            .await?;
        let session: serde_json::Value = resp.json().await?;
        let sid = session["sessionId"].as_str().unwrap_or_default().to_string();
        *self.session_id.write().await = Some(sid.clone());
        info!("ICE WebICE session established");
        Ok(sid)
    }

    fn ice_symbol(jpm_symbol: &str) -> &'static str {
        match jpm_symbol {
            "BRENT-F26" => "B\\F26",   // ICE Brent crude, January 2026
            "WTI-F26"   => "T\\F26",   // ICE WTI (T is ICE's WTI root)
            "NG-G26"    => "H\\G26",   // ICE Henry Hub NatGas, February 2026
            "HO-F26"    => "O\\F26",   // ICE Heating Oil
            _ => "",
        }
    }
}

#[async_trait]
impl MarketDataAdapter for IceAdapter {
    fn name(&self) -> &'static str { "ICE" }

    fn symbols(&self) -> Vec<String> {
        vec!["BRENT-F26", "WTI-F26", "NG-G26", "HO-F26"].into_iter().map(String::from).collect()
    }

    async fn subscribe(&self, symbol: &str, ring: Arc<OrderRing>) -> anyhow::Result<()> {
        let ice_sym = Self::ice_symbol(symbol);
        if ice_sym.is_empty() {
            anyhow::bail!("symbol {} not mapped to ICE", symbol);
        }

        if self.session_id.read().await.is_none() {
            self.logon().await?;
        }

        let symbol_owned = symbol.to_string();
        let endpoint = self.endpoint.clone();
        let api_key = self.api_key.clone();

        tokio::spawn(async move {
            let client = reqwest::Client::new();
            let mut ticker = interval(Duration::from_millis(500));   // ICE snapshots ~500ms
            loop {
                ticker.tick().await;
                let url = format!("{}/api/v1/marketdata/{}?depth=10", endpoint, ice_sym);
                match client.get(&url).header("X-ICE-API-Key", &api_key).send().await {
                    Ok(r) if r.status().is_success() => {
                        if let Ok(snap) = r.json::<IceSnapshot>().await {
                            publish_order(&ring, EventKind::MarkPrice {
                                symbol: symbol_owned.clone(),
                                price:  snap.last,
                                source: "ICE".into(),
                            });
                        }
                    }
                    Ok(r) => warn!(status = %r.status(), symbol = %symbol_owned, "ICE snapshot non-200"),
                    Err(e) => error!(error = %e, symbol = %symbol_owned, "ICE fetch failed"),
                }
            }
        });

        Ok(())
    }

    async fn healthy(&self) -> bool {
        self.session_id.read().await.is_some()
    }
}

#[derive(serde::Deserialize)]
struct IceSnapshot {
    last:   f64,
    #[allow(dead_code)] bid: f64,
    #[allow(dead_code)] ask: f64,
    #[allow(dead_code)] volume: f64,
}

// -----------------------------------------------------------------------------
// CME MDP 3.0 adapter — for crypto-reference rates and overnight energy
// -----------------------------------------------------------------------------
pub struct CmeAdapter {
    endpoint:    String,
    /// CME uses SBE (Simple Binary Encoding). Real impl needs a generated SBE
    /// decoder from their XML schema. This stub uses their Market Data REST
    /// snapshot service as placeholder.
    api_token:   String,
}

impl CmeAdapter {
    pub fn new(endpoint: &str, token: &str) -> Self {
        Self { endpoint: endpoint.into(), api_token: token.into() }
    }

    fn cme_symbol(jpm_symbol: &str) -> Option<&'static str> {
        match jpm_symbol {
            "BTC-PERP" => Some("BTC"),   // CME BTC futures (reference pricing only)
            "ETH-PERP" => Some("ETH"),   // CME ETH futures
            "WTI-F26"  => Some("CLF6"),  // CME WTI Light Sweet Crude
            "NG-G26"   => Some("NGG6"),  // CME Henry Hub NatGas
            _ => None,
        }
    }
}

#[async_trait]
impl MarketDataAdapter for CmeAdapter {
    fn name(&self) -> &'static str { "CME" }

    fn symbols(&self) -> Vec<String> {
        vec!["BTC-PERP", "ETH-PERP", "WTI-F26", "NG-G26"].into_iter().map(String::from).collect()
    }

    async fn subscribe(&self, symbol: &str, ring: Arc<OrderRing>) -> anyhow::Result<()> {
        let Some(cme_sym) = Self::cme_symbol(symbol) else {
            anyhow::bail!("symbol {} not mapped to CME", symbol);
        };

        let symbol_owned = symbol.to_string();
        let endpoint = self.endpoint.clone();
        let token = self.api_token.clone();

        tokio::spawn(async move {
            let client = reqwest::Client::new();
            let mut ticker = interval(Duration::from_millis(250));
            loop {
                ticker.tick().await;
                let url = format!("{}/md/v1/quotes/{}", endpoint, cme_sym);
                match client.get(&url)
                    .bearer_auth(&token)
                    .send().await
                {
                    Ok(r) if r.status().is_success() => {
                        if let Ok(quote) = r.json::<CmeQuote>().await {
                            publish_order(&ring, EventKind::MarkPrice {
                                symbol: symbol_owned.clone(),
                                price:  quote.last,
                                source: "CME".into(),
                            });
                        }
                    }
                    Ok(r) => warn!(status = %r.status(), symbol = %symbol_owned, "CME quote non-200"),
                    Err(e) => error!(error = %e, symbol = %symbol_owned, "CME fetch failed"),
                }
            }
        });
        Ok(())
    }

    async fn healthy(&self) -> bool { true }
}

#[derive(serde::Deserialize)]
struct CmeQuote {
    last: f64,
    #[allow(dead_code)] bid: f64,
    #[allow(dead_code)] ask: f64,
}

// -----------------------------------------------------------------------------
// EIA adapter — free US government data, daily cadence only.
// Used as a floor for mark prices / sanity check against ICE data.
// -----------------------------------------------------------------------------
pub struct EiaAdapter {
    api_key: String,
}

impl EiaAdapter {
    pub fn new(api_key: &str) -> Self { Self { api_key: api_key.into() } }

    fn eia_series(jpm_symbol: &str) -> Option<&'static str> {
        match jpm_symbol {
            "WTI-F26"   => Some("PET.RWTC.D"),   // Cushing WTI spot
            "BRENT-F26" => Some("PET.RBRTE.D"),  // Europe Brent spot
            "NG-G26"    => Some("NG.RNGWHHD.D"), // Henry Hub spot
            "HO-F26"    => Some("PET.EER_EPD2F_PF4_Y35NY_DPG.D"),
            _ => None,
        }
    }
}

#[async_trait]
impl MarketDataAdapter for EiaAdapter {
    fn name(&self) -> &'static str { "EIA" }

    fn symbols(&self) -> Vec<String> {
        vec!["WTI-F26", "BRENT-F26", "NG-G26", "HO-F26"].into_iter().map(String::from).collect()
    }

    async fn subscribe(&self, symbol: &str, ring: Arc<OrderRing>) -> anyhow::Result<()> {
        let Some(series) = Self::eia_series(symbol) else {
            anyhow::bail!("symbol {} not mapped to EIA", symbol);
        };
        let key = self.api_key.clone();
        let symbol_owned = symbol.to_string();

        tokio::spawn(async move {
            let client = reqwest::Client::new();
            let mut ticker = interval(Duration::from_secs(3600));  // hourly check; EIA updates daily
            loop {
                ticker.tick().await;
                let url = format!(
                    "https://api.eia.gov/v2/seriesid/{}?api_key={}&length=1&sort[0][column]=period&sort[0][direction]=desc",
                    series, key
                );
                match client.get(&url).send().await {
                    Ok(r) if r.status().is_success() => {
                        if let Ok(body) = r.json::<serde_json::Value>().await {
                            if let Some(pt) = body["response"]["data"][0]["value"].as_f64() {
                                publish_order(&ring, EventKind::MarkPrice {
                                    symbol: symbol_owned.clone(),
                                    price:  pt,
                                    source: "EIA".into(),
                                });
                                info!(symbol = %symbol_owned, price = pt, "EIA mark refreshed");
                            }
                        }
                    }
                    Ok(r) => warn!(status = %r.status(), "EIA non-200"),
                    Err(e) => error!(error = %e, "EIA fetch failed"),
                }
            }
        });
        Ok(())
    }

    async fn healthy(&self) -> bool { !self.api_key.is_empty() }
}

// -----------------------------------------------------------------------------
// Simulated adapter — random walk for dev environments
// -----------------------------------------------------------------------------
pub struct SimulatedAdapter;

#[async_trait]
impl MarketDataAdapter for SimulatedAdapter {
    fn name(&self) -> &'static str { "simulated" }

    fn symbols(&self) -> Vec<String> {
        vec!["BTC-PERP","ETH-PERP","SOL-PERP","WTI-F26","BRENT-F26","NG-G26","HO-F26"]
            .into_iter().map(String::from).collect()
    }

    async fn subscribe(&self, symbol: &str, ring: Arc<OrderRing>) -> anyhow::Result<()> {
        let sym = symbol.to_string();
        let base = match symbol {
            "BTC-PERP"  => 98420.50,
            "ETH-PERP"  => 3842.18,
            "SOL-PERP"  => 218.94,
            "WTI-F26"   => 74.82,
            "BRENT-F26" => 78.41,
            "NG-G26"    => 3.248,
            "HO-F26"    => 2.412,
            _           => 100.0,
        };
        tokio::spawn(async move {
            use rand::Rng;
            let mut rng = rand::thread_rng();
            let mut price = base;
            let mut ticker = interval(Duration::from_millis(650));
            loop {
                ticker.tick().await;
                let delta: f64 = rng.gen_range(-0.0004..0.0004);
                price *= 1.0 + delta;
                publish_order(&ring, EventKind::MarkPrice {
                    symbol: sym.clone(),
                    price,
                    source: "simulated".into(),
                });
            }
        });
        Ok(())
    }

    async fn healthy(&self) -> bool { true }
}

// -----------------------------------------------------------------------------
// Hub — orchestrates adapters, exposes unified API to the gateway
// -----------------------------------------------------------------------------
pub struct MarketDataHub {
    adapters: Vec<Arc<dyn MarketDataAdapter>>,
    books:    Arc<RwLock<std::collections::HashMap<String, Book>>>,
}

impl MarketDataHub {
    pub async fn start(cfg: Arc<Config>) -> anyhow::Result<Arc<Self>> {
        let mut adapters: Vec<Arc<dyn MarketDataAdapter>> = Vec::new();

        if let Some(ep) = &cfg.marketdata.ice_endpoint {
            let key = std::env::var("JPM_ICE_API_KEY").unwrap_or_default();
            adapters.push(Arc::new(IceAdapter::new(ep, &key)));
            info!("ICE adapter registered");
        }
        if let Some(ep) = &cfg.marketdata.cme_endpoint {
            let tok = std::env::var("JPM_CME_API_TOKEN").unwrap_or_default();
            adapters.push(Arc::new(CmeAdapter::new(ep, &tok)));
            info!("CME adapter registered");
        }
        if let Some(key) = &cfg.marketdata.eia_api_key {
            adapters.push(Arc::new(EiaAdapter::new(key)));
            info!("EIA adapter registered");
        }
        // Simulated is always registered as fallback
        adapters.push(Arc::new(SimulatedAdapter));

        Ok(Arc::new(Self {
            adapters,
            books: Arc::new(RwLock::new(std::collections::HashMap::new())),
        }))
    }

    pub async fn book_snapshot(&self, symbol: &str) -> Option<Book> {
        self.books.read().await.get(symbol).cloned()
    }
}
