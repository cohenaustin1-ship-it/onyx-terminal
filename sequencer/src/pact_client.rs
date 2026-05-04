//! Pact client — batches ring buffer events and submits them to the Chainweb
//! validator set for BFT finalization.

use std::sync::Arc;
use std::time::Duration;
use tokio::time::interval;
use tracing::{debug, error, info};

use crate::config::ChainwebConfig;
use crate::ring_buffer::{OrderRing, ConsumerCursor};
use crate::schemas::{EventKind, SequencedEvent};

pub struct PactClient {
    cfg:    ChainwebConfig,
    http:   reqwest::Client,
    cursor: Arc<ConsumerCursor>,
}

impl PactClient {
    pub async fn connect(cfg: &ChainwebConfig) -> anyhow::Result<Self> {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_millis(cfg.submit_timeout))
            .build()?;
        info!(nodes = ?cfg.nodes, "pact client ready");
        Ok(Self {
            cfg: cfg.clone(),
            http,
            cursor: Arc::new(ConsumerCursor::new("pact")),
        })
    }

    pub async fn submit_batch(&self, chain_id: u8, events: &[SequencedEvent]) -> anyhow::Result<String> {
        // Build a Pact exec payload: (order-book.place-order ...) for each event.
        // In production we'd sign with the sequencer's Ed25519 key (registered
        // as an admin keyset on every instrument chain).
        let code = events.iter()
            .filter_map(|e| event_to_pact_call(&e.kind))
            .collect::<Vec<_>>()
            .join("\n");

        let endpoint = format!("{}/chainweb/0.0/{}/chain/{}/pact/api/v1/send",
                               self.cfg.nodes[0], self.cfg.network_id, chain_id);
        let body = serde_json::json!({
            "cmds": [{
                "hash": blake2_hash(&code),
                "sigs": [],  // signed by sequencer key in production
                "cmd": serde_json::to_string(&serde_json::json!({
                    "networkId":    self.cfg.network_id,
                    "payload":      { "exec": { "code": code, "data": {} } },
                    "meta":         {
                        "chainId":    chain_id.to_string(),
                        "sender":     "jpm-onyx-sequencer",
                        "gasLimit":   150000,
                        "gasPrice":   0.00000001,
                        "ttl":        600,
                        "creationTime": chrono::Utc::now().timestamp(),
                    },
                    "signers":      [],
                    "nonce":        uuid::Uuid::new_v4().to_string(),
                }))?
            }]
        });

        let response = self.http.post(&endpoint).json(&body).send().await?;
        let text = response.text().await?;
        debug!(chain_id, events = events.len(), "batch submitted");
        Ok(text)
    }
}

fn event_to_pact_call(kind: &EventKind) -> Option<String> {
    match kind {
        EventKind::OrderPlaced { order_id, lei, desk, symbol, side, kind, price, stop_price, size, leverage, tif, reduce_only, post_only, client_oid: _ } => {
            let side_s  = match side  { crate::schemas::Side::Buy => "buy", crate::schemas::Side::Sell => "sell" };
            let kind_s  = format!("{:?}", kind).to_lowercase();
            let tif_s   = format!("{:?}", tif);
            let price_s = price.map(|p| p.to_string()).unwrap_or("0.0".into());
            let stop_s  = stop_price.map(|p| p.to_string()).unwrap_or("0.0".into());
            Some(format!(
                "(jpm-onyx.order-book.place-order \"{}\" \"{}\" \"{}\" \"{}\" \"{}\" \"{}\" {} {} {} {} \"{}\" {} {} 0)",
                order_id, lei, desk, symbol, side_s, kind_s,
                price_s, stop_s, size, leverage, tif_s, reduce_only, post_only,
            ))
        }
        EventKind::OrderCancelled { order_id, lei } => {
            Some(format!("(jpm-onyx.order-book.cancel-order \"{}\")", order_id))
        }
        _ => None,
    }
}

fn blake2_hash(s: &str) -> String {
    use blake2::{Blake2b512, Digest};
    let mut h = Blake2b512::new();
    h.update(s.as_bytes());
    format!("{:x}", h.finalize())
}

/// Background task: drain ring events into batched Pact submissions.
pub async fn submit_loop(client: Arc<PactClient>, ring: Arc<OrderRing>) {
    let mut ticker = interval(Duration::from_millis(client.cfg.batch_window));
    let mut next_seq = 0u64;
    let mut buffer: Vec<SequencedEvent> = Vec::with_capacity(client.cfg.batch_size);

    loop {
        ticker.tick().await;
        let latest = ring.latest_seq();

        while next_seq <= latest && buffer.len() < client.cfg.batch_size {
            if let Some(ev) = ring.try_read(next_seq) {
                buffer.push(ev);
                next_seq += 1;
            } else {
                break;
            }
        }

        if buffer.is_empty() { continue; }

        // Group by chain (derived from symbol)
        let mut by_chain: std::collections::HashMap<u8, Vec<SequencedEvent>> = Default::default();
        for ev in buffer.drain(..) {
            let chain = chain_for_event(&ev).unwrap_or(0);
            by_chain.entry(chain).or_default().push(ev);
        }
        for (chain, events) in by_chain {
            if let Err(e) = client.submit_batch(chain, &events).await {
                error!(chain, error = %e, "batch submit failed");
            }
        }
    }
}

fn chain_for_event(ev: &SequencedEvent) -> Option<u8> {
    match &ev.kind {
        EventKind::OrderPlaced { symbol, .. } => Some(chain_for_symbol(symbol)),
        EventKind::OrderCancelled { .. }      => None,  // cancel goes to the chain that has the order
        _ => None,
    }
}

fn chain_for_symbol(symbol: &str) -> u8 {
    match symbol {
        "BTC-PERP"  => 3,
        "ETH-PERP"  => 4,
        "SOL-PERP"  => 5,
        "WTI-F26" | "BRENT-F26" => 10,
        "NG-G26"    => 11,
        "HO-F26"    => 12,
        _ => 0,
    }
}
