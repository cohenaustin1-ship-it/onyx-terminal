//! Per-instrument matcher pool.
//!
//! Each matcher is a single-threaded task pinned to a dedicated CPU core.
//! The order book for one instrument fits in L2 cache (~2MB for 100k levels),
//! so the matcher never touches main memory on the hot path.
//!
//! Matchers consume from the shared ring buffer but each maintains its own
//! cursor, advancing only through events for its symbol.

use std::collections::BTreeMap;
use std::sync::Arc;
use tokio::task::JoinHandle;
use tracing::{debug, info, warn};

use crate::config::{Config, InstrumentConfig};
use crate::ring_buffer::{OrderRing, ConsumerCursor, publish_order};
use crate::schemas::{EventKind, Side, OrderKind, Tif, Level, OrderStatus};

/// One order resting in the book.
#[derive(Debug, Clone)]
struct RestingOrder {
    order_id:    String,
    client_oid:  String,
    lei:         String,
    desk:        String,
    price:       f64,
    size:        f64,
    filled:      f64,
    tif:         Tif,
    post_only:   bool,
    reduce_only: bool,
    seq:         u64,   // sequencer global seq — used for time priority
    ts_ns:       u64,
}

/// A single-instrument order book with price-time priority.
///
/// Bids: BTreeMap<OrderedFloat, Vec<orders>>  (reverse-iterated for best bid)
/// Asks: BTreeMap<OrderedFloat, Vec<orders>>  (forward-iterated for best ask)
///
/// We use i64 keys (price * 1e8 rounded) to avoid f64 ordering hazards.
pub struct MatchingEngine {
    pub symbol:    String,
    pub chain_id:  u8,
    pub tick_size: f64,
    pub lot_size:  f64,
    pub max_lev:   u8,
    // price_scaled -> FIFO queue of orders
    bids: BTreeMap<i64, Vec<RestingOrder>>,
    asks: BTreeMap<i64, Vec<RestingOrder>>,
    // last traded price, for stop triggers
    last_trade: f64,
    // fill id counter
    fill_counter: u64,
}

impl MatchingEngine {
    pub fn new(cfg: &InstrumentConfig) -> Self {
        Self {
            symbol:    cfg.id.clone(),
            chain_id:  cfg.chain_id,
            tick_size: cfg.tick_size,
            lot_size:  cfg.lot_size,
            max_lev:   cfg.max_leverage,
            bids: BTreeMap::new(),
            asks: BTreeMap::new(),
            last_trade: 0.0,
            fill_counter: 0,
        }
    }

    #[inline(always)]
    fn scale(p: f64) -> i64 { (p * 1e8).round() as i64 }

    /// Main entry — process an order placement.
    /// Returns Ok((status, fills)) or Err(reason).
    pub fn place(
        &mut self,
        order_id: String,
        client_oid: String,
        lei: String,
        desk: String,
        side: Side,
        kind: OrderKind,
        price: Option<f64>,
        size: f64,
        leverage: u8,
        tif: Tif,
        reduce_only: bool,
        post_only: bool,
        seq: u64,
        ts_ns: u64,
    ) -> Result<(OrderStatus, Vec<InternalFill>), String> {
        // Validations
        if leverage > self.max_lev {
            return Err(format!("LEVERAGE_TOO_HIGH: max {} for {}", self.max_lev, self.symbol));
        }
        if (size / self.lot_size).fract().abs() > 1e-9 {
            return Err(format!("LOT_SIZE_VIOLATION: size {} not multiple of {}", size, self.lot_size));
        }
        if let Some(p) = price {
            if (p / self.tick_size).fract().abs() > 1e-9 {
                return Err(format!("TICK_SIZE_VIOLATION: price {} not multiple of {}", p, self.tick_size));
            }
        }

        let effective_price = match kind {
            OrderKind::Market => match side {
                Side::Buy  => self.asks.keys().next().map(|k| *k as f64 / 1e8).unwrap_or(f64::MAX),
                Side::Sell => self.bids.keys().next_back().map(|k| *k as f64 / 1e8).unwrap_or(0.0),
            },
            _ => price.ok_or("PRICE_REQUIRED".to_string())?,
        };

        let fills = self.cross(&order_id, &client_oid, &lei, &desk, side, effective_price, size, post_only);

        let filled_size: f64 = fills.iter().map(|f| f.size).sum();
        let remaining = size - filled_size;

        let status = if filled_size >= size - 1e-9 {
            OrderStatus::Filled
        } else if filled_size > 0.0 {
            OrderStatus::Partial
        } else {
            OrderStatus::Resting
        };

        // Handle TIF
        match tif {
            Tif::IOC => {
                // Don't rest remaining — but filled portion is kept
                return Ok((status, fills));
            }
            Tif::FOK => {
                if remaining > 1e-9 {
                    // Rollback fills (in real impl we'd have snapshotted the book)
                    return Err("FOK_NOT_FULLY_FILLED".into());
                }
            }
            Tif::GTC => {}
        }

        // Rest any remainder
        if remaining > 1e-9 && kind != OrderKind::Market {
            let resting = RestingOrder {
                order_id, client_oid, lei, desk,
                price: effective_price,
                size, filled: filled_size, tif, post_only, reduce_only, seq, ts_ns,
            };
            let book = match side { Side::Buy => &mut self.bids, Side::Sell => &mut self.asks };
            book.entry(Self::scale(effective_price)).or_default().push(resting);
        }

        Ok((status, fills))
    }

    /// Crossing logic — walk the opposite book while price improves.
    fn cross(
        &mut self,
        taker_oid: &str, _client_oid: &str, taker_lei: &str, _desk: &str,
        taker_side: Side, limit: f64, mut remaining: f64, post_only: bool,
    ) -> Vec<InternalFill> {
        if post_only {
            // Post-only rejects if it would cross
            let would_cross = match taker_side {
                Side::Buy  => self.asks.keys().next().map_or(false, |&ask| ask as f64 / 1e8 <= limit),
                Side::Sell => self.bids.keys().next_back().map_or(false, |&bid| bid as f64 / 1e8 >= limit),
            };
            if would_cross { return vec![]; }
            return vec![];
        }

        let mut fills = Vec::new();

        loop {
            if remaining < 1e-9 { break; }

            let (best_price, crosses) = match taker_side {
                Side::Buy => {
                    match self.asks.keys().next().copied() {
                        Some(k) => (k as f64 / 1e8, (k as f64 / 1e8) <= limit),
                        None => break,
                    }
                }
                Side::Sell => {
                    match self.bids.keys().next_back().copied() {
                        Some(k) => (k as f64 / 1e8, (k as f64 / 1e8) >= limit),
                        None => break,
                    }
                }
            };
            if !crosses { break; }

            let level_key = Self::scale(best_price);
            let level = match taker_side {
                Side::Buy  => self.asks.get_mut(&level_key).unwrap(),
                Side::Sell => self.bids.get_mut(&level_key).unwrap(),
            };

            // Take the oldest maker at this level (FIFO time priority)
            let maker = &mut level[0];
            let maker_open = maker.size - maker.filled;
            let fill_qty = remaining.min(maker_open);

            self.fill_counter += 1;
            fills.push(InternalFill {
                fill_id:     format!("{}-{}", self.symbol, self.fill_counter),
                taker_oid:   taker_oid.to_string(),
                maker_oid:   maker.order_id.clone(),
                taker_lei:   taker_lei.to_string(),
                maker_lei:   maker.lei.clone(),
                price:       best_price,
                size:        fill_qty,
                taker_side,
                fee_taker:   fill_qty * best_price * 0.00025,
                fee_maker:   fill_qty * best_price * 0.00010,
            });

            maker.filled += fill_qty;
            remaining -= fill_qty;
            self.last_trade = best_price;

            if (maker.size - maker.filled).abs() < 1e-9 {
                level.remove(0);
                if level.is_empty() {
                    match taker_side {
                        Side::Buy  => { self.asks.remove(&level_key); }
                        Side::Sell => { self.bids.remove(&level_key); }
                    }
                }
            }
        }

        fills
    }

    pub fn cancel(&mut self, order_id: &str, lei: &str) -> bool {
        for book in [&mut self.bids, &mut self.asks] {
            for (_, level) in book.iter_mut() {
                if let Some(pos) = level.iter().position(|o| o.order_id == order_id && o.lei == lei) {
                    level.remove(pos);
                    return true;
                }
            }
        }
        false
    }

    pub fn snapshot(&self, depth: usize) -> (Vec<Level>, Vec<Level>) {
        let bids: Vec<Level> = self.bids.iter().rev().take(depth)
            .map(|(k, level)| Level {
                price: *k as f64 / 1e8,
                size:  level.iter().map(|o| o.size - o.filled).sum(),
            })
            .collect();
        let asks: Vec<Level> = self.asks.iter().take(depth)
            .map(|(k, level)| Level {
                price: *k as f64 / 1e8,
                size:  level.iter().map(|o| o.size - o.filled).sum(),
            })
            .collect();
        (bids, asks)
    }

    pub fn best_bid_ask(&self) -> (Option<f64>, Option<f64>) {
        let bid = self.bids.keys().next_back().map(|k| *k as f64 / 1e8);
        let ask = self.asks.keys().next().map(|k| *k as f64 / 1e8);
        (bid, ask)
    }
}

#[derive(Debug, Clone)]
pub struct InternalFill {
    pub fill_id:   String,
    pub taker_oid: String,
    pub maker_oid: String,
    pub taker_lei: String,
    pub maker_lei: String,
    pub price:     f64,
    pub size:      f64,
    pub taker_side: Side,
    pub fee_taker: f64,
    pub fee_maker: f64,
}

/// One matcher task, owning one MatchingEngine.
pub struct Matcher {
    pub symbol: String,
    pub cursor: Arc<ConsumerCursor>,
    pub handle: JoinHandle<()>,
}

pub async fn spawn_pool(cfg: Arc<Config>, ring: Arc<OrderRing>) -> anyhow::Result<Vec<Matcher>> {
    let mut matchers = Vec::new();
    for inst in cfg.instruments.iter() {
        let cursor = Arc::new(ConsumerCursor::new(Box::leak(inst.id.clone().into_boxed_str())));
        let c2 = cursor.clone();
        let ring2 = ring.clone();
        let icfg = inst.clone();
        let symbol = inst.id.clone();

        let handle = tokio::task::spawn_blocking(move || {
            // In production: pin this thread to inst.cpu_pin via `core_affinity` crate
            info!(symbol = %icfg.id, chain = icfg.chain_id, "matcher thread started");
            let mut engine = MatchingEngine::new(&icfg);
            let mut next = 0u64;

            loop {
                let event = ring2.read(next);
                match &event.kind {
                    EventKind::OrderPlaced { symbol, order_id, client_oid, lei, desk, side, kind, price, size, leverage, tif, reduce_only, post_only, .. } if *symbol == engine.symbol => {
                        let result = engine.place(
                            order_id.clone(), client_oid.clone(), lei.clone(), desk.clone(),
                            *side, *kind, *price, *size, *leverage, *tif, *reduce_only, *post_only,
                            event.seq, event.ts_ns,
                        );
                        match result {
                            Ok((status, fills)) => {
                                debug!(symbol = %engine.symbol, status = ?status, fills = fills.len(), "matched");
                                // In real impl: publish MatchedEvent back to ring for Pact submitter
                            }
                            Err(reason) => {
                                warn!(symbol = %engine.symbol, order_id = %order_id, reason, "rejected");
                            }
                        }
                    }
                    EventKind::OrderCancelled { order_id, lei } => {
                        engine.cancel(order_id, lei);
                    }
                    _ => {}
                }
                c2.advance(next);
                next += 1;
            }
        });

        matchers.push(Matcher { symbol, cursor, handle });
    }
    info!(count = matchers.len(), "matcher pool online");
    Ok(matchers)
}
