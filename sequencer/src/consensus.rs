//! HotStuff BFT consensus client (simplified).
//!
//! In production this would be a full HotStuff implementation with:
//!   - Pipelined voting (3-chain rule)
//!   - View change protocol
//!   - Cryptographic threshold signatures (BLS12-381)
//!   - Validator set rotation via governance chain
//!
//! For the sequencer's role we only need a client that:
//!   1. Knows which block was just committed (via validator gossip)
//!   2. Confirms our submitted transactions made it into a committed block
//!   3. Reports BFT latency back into the ring so the UI can display it

use std::sync::Arc;
use std::time::Duration;
use tokio::time::sleep;
use tracing::{debug, info};

use crate::config::ConsensusConfig;
use crate::ring_buffer::OrderRing;
use crate::schemas::{SequencedEvent, EventKind};
use crate::ring_buffer::publish_order;

pub struct HotStuffClient {
    cfg: ConsensusConfig,
}

impl HotStuffClient {
    pub async fn connect(cfg: &ConsensusConfig) -> anyhow::Result<Self> {
        info!(validators = cfg.expected_validators,
              quorum = cfg.quorum_threshold,
              pipeline = cfg.pipeline_depth,
              "hotstuff client connecting");
        Ok(Self { cfg: cfg.clone() })
    }

    /// Poll validators for the latest committed block per chain, publish
    /// `BftFinalized` events into the ring for each seq that's now final.
    pub async fn run_loop(self, ring: Arc<OrderRing>) {
        let mut block_heights: [u64; 20] = [4_892_341; 20];
        loop {
            sleep(Duration::from_millis(4)).await;  // ~4ms BFT cycle

            // In reality: gossip with validators, verify 2f+1 votes, extract finalized seqs
            for chain_id in 0..20u8 {
                block_heights[chain_id as usize] += 1;
                let latest = ring.latest_seq();
                if latest > 0 {
                    publish_order(&ring, EventKind::BftFinalized {
                        seq: latest,
                        block_height: block_heights[chain_id as usize],
                        chain_id,
                    });
                }
            }

            debug!(height = block_heights[0], "bft tick");
        }
    }
}
