//! Canonical message schemas used across all sequencer components.
//!
//! These types are the single source of truth for:
//!   - WebSocket wire protocol (serialized as JSON for dev, MessagePack for prod)
//!   - Ring buffer slot contents
//!   - Pact RPC submission payloads
//!   - BFT replication log entries
//!
//! Keep this module dependency-free — it's imported everywhere.

use serde::{Deserialize, Serialize};

// -----------------------------------------------------------------------------
// Primitives
// -----------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Side {
    Buy,
    Sell,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum OrderKind {
    Market,
    Limit,
    Stop,
    StopLimit,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Tif {
    GTC,
    IOC,
    FOK,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OrderStatus {
    Pending,
    Resting,
    Partial,
    Filled,
    Cancelled,
    Rejected,
}

// -----------------------------------------------------------------------------
// Ring buffer event envelope
// -----------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SequencedEvent {
    pub seq:   u64,
    pub ts_ns: u64,
    pub kind:  EventKind,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum EventKind {
    OrderPlaced {
        order_id:    String,
        client_oid:  String,
        symbol:      String,
        lei:         String,
        desk:        String,
        side:        Side,
        kind:        OrderKind,
        price:       Option<f64>,
        stop_price:  Option<f64>,
        size:        f64,
        leverage:    u8,
        tif:         Tif,
        reduce_only: bool,
        post_only:   bool,
    },
    OrderCancelled { order_id: String, lei: String },
    OrderMatched {
        taker_oid:  String,
        maker_oid:  String,
        symbol:     String,
        price:      f64,
        size:       f64,
        taker_side: Side,
    },
    BookUpdate {
        symbol: String,
        bids:   Vec<Level>,
        asks:   Vec<Level>,
    },
    MarkPrice {
        symbol: String,
        price:  f64,
        source: String,   // "ICE", "CME", "EIA", "simulated"
    },
    BftFinalized { seq: u64, block_height: u64, chain_id: u8 },
    ComplianceBlock { lei: String, reason: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Level {
    pub price: f64,
    pub size:  f64,
}

// -----------------------------------------------------------------------------
// WebSocket protocol — fast channel (sub-ms optimistic)
// -----------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum ClientRequest {
    Auth {
        lei:  String,
        desk: String,
        /// Timestamped nonce, signed by the desk's X.509 cert. mTLS already
        /// handles the transport layer; this re-proves the specific desk identity.
        signed_nonce: String,
    },
    Sub { channel: String, symbol: String },
    Unsub { channel: String, symbol: String },
    PlaceOrder(PlaceOrderPayload),
    CancelOrder { order_id: String, client_oid: String },
    Ping { ts_ms: u64 },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaceOrderPayload {
    pub client_oid:  String,
    pub symbol:      String,
    pub side:        Side,
    #[serde(rename = "type")]
    pub kind:        OrderKind,
    pub price:       Option<f64>,
    pub stop_price:  Option<f64>,
    pub size:        f64,
    pub leverage:    u8,
    pub tif:         Tif,
    pub reduce_only: bool,
    pub post_only:   bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum ServerEvent {
    AuthOk { session_id: String, heartbeat_ms: u64 },
    AuthFail { reason: String },

    /// Optimistic ack — sequencer confirms receipt, before BFT finality.
    OrderAck {
        client_oid:    String,
        order_id:      String,
        seq:           u64,
        ts_ns:         u64,
        symbol:        String,
        status:        OrderStatus,
        latency_us:    u64,
    },

    /// Final ack — BFT finalized the block containing this order.
    OrderFinal {
        client_oid:    String,
        order_id:      String,
        block_height:  u64,
        chain_id:      u8,
        fills:         Vec<FillEvent>,
    },

    OrderReject {
        client_oid: String,
        reason:     String,
        code:       u16,
    },

    BookSnapshot {
        channel: String,
        symbol:  String,
        book:    Book,
    },

    BookDelta {
        channel: String,
        symbol:  String,
        bids:    Vec<Level>,
        asks:    Vec<Level>,
    },

    Trade {
        channel:    String,
        symbol:     String,
        price:      f64,
        size:       f64,
        side:       Side,
        taker_lei:  String,
        maker_lei:  String,
        ts_ms:      u64,
        tx_hash:    Option<String>,
    },

    Ticker {
        channel:     String,
        symbol:      String,
        mark:        f64,
        index:       f64,
        last:        f64,
        change_24h:  f64,
        volume_24h:  f64,
        funding_8h:  Option<f64>,
        open_interest: f64,
    },

    ChainEvent {
        channel:    String,
        kind:       String,     // "block" | "finality" | "margin" | "settle" | "compliance"
        seq:        u64,
        chain_id:   u8,
        detail:     String,
        bft_latency_ms: Option<f64>,
    },

    Pong { ts_ms: u64 },
    Error { code: u16, message: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Book {
    pub bids: Vec<Level>,
    pub asks: Vec<Level>,
    pub seq:  u64,
    pub ts_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FillEvent {
    pub fill_id:     String,
    pub price:       f64,
    pub size:        f64,
    pub fee:         f64,
    pub is_maker:    bool,
    pub counterparty_lei: String,
    pub ts_ns:       u64,
    pub tx_hash:     String,
}

// -----------------------------------------------------------------------------
// Error codes — stable contract with the client
// -----------------------------------------------------------------------------

pub mod error_codes {
    pub const AUTH_FAIL:              u16 = 1001;
    pub const INVALID_MESSAGE:        u16 = 1002;
    pub const NOT_SUBSCRIBED:         u16 = 1003;
    pub const RATE_LIMITED:           u16 = 1004;

    pub const INSUFFICIENT_MARGIN:    u16 = 2001;
    pub const SYMBOL_NOT_FOUND:       u16 = 2002;
    pub const POST_ONLY_WOULD_CROSS:  u16 = 2003;
    pub const LEVERAGE_TOO_HIGH:      u16 = 2004;
    pub const TICK_SIZE_VIOLATION:    u16 = 2005;
    pub const LOT_SIZE_VIOLATION:     u16 = 2006;

    pub const COMPLIANCE_LEI_FROZEN:  u16 = 3001;
    pub const COMPLIANCE_SANCTIONS:   u16 = 3002;
    pub const COMPLIANCE_KYC_EXPIRED: u16 = 3003;
    pub const COMPLIANCE_POS_LIMIT:   u16 = 3004;
    pub const COMPLIANCE_NOTIONAL:    u16 = 3005;

    pub const CHAIN_UNREACHABLE:      u16 = 4001;
    pub const BFT_TIMEOUT:            u16 = 4002;
}
