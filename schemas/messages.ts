/**
 * JPM Onyx Sequencer — WebSocket message protocol
 *
 * Single source of truth for the wire contract between React clients
 * and the Rust sequencer. These types are the TypeScript mirror of the
 * Rust enums in `sequencer/src/schemas.rs` — keep in sync.
 *
 * Channels:
 *   /ws/fast  — optimistic acks, book deltas, tickers, trades (sub-ms)
 *   /ws/final — BFT-finalized confirmations with tx hashes (~4ms)
 *
 * Transport:
 *   - Production: MessagePack over mTLS WebSocket, X.509 client cert
 *   - Development: JSON over plain WebSocket
 *
 * All timestamps are either `ts_ns` (nanoseconds from sequencer) or
 * `ts_ms` (milliseconds, client-safe). Clients should prefer `ts_ns`
 * for ordering and `ts_ms` for display.
 */

// ============================================================================
// Primitives
// ============================================================================
export type Side       = 'buy' | 'sell';
export type OrderKind  = 'market' | 'limit' | 'stop' | 'stop-limit';
export type Tif        = 'GTC' | 'IOC' | 'FOK';
export type OrderStatus = 'pending' | 'resting' | 'partial' | 'filled' | 'cancelled' | 'rejected';

export interface Level {
  price: number;
  size:  number;
}

export interface Book {
  bids:  Level[];
  asks:  Level[];
  seq:   number;
  ts_ms: number;
}

export interface FillEvent {
  fill_id:         string;
  price:           number;
  size:            number;
  fee:             number;
  is_maker:        boolean;
  counterparty_lei: string;
  ts_ns:           number;
  tx_hash:         string;
}

// ============================================================================
// Client → Server
// ============================================================================

/**
 * First message on any connection. mTLS has already verified the peer cert;
 * `signed_nonce` re-proves the specific desk identity (a timestamp signed with
 * the cert's private key, verified against the cert's subject public key).
 */
export interface AuthRequest {
  op:           'auth';
  lei:          string;      // ISO 17442, 20 chars
  desk:         string;      // e.g. "ECM-147"
  signed_nonce: string;      // base64(ed25519_sign(ts_ms || session_id))
}

export interface SubRequest {
  op:      'sub' | 'unsub';
  channel: 'book' | 'trades' | 'ticker' | 'chain' | 'positions' | 'orders';
  symbol:  string;
}

export interface PlaceOrderRequest {
  op:          'place_order';
  client_oid:  string;        // client-generated, idempotent
  symbol:      string;
  side:        Side;
  type:        OrderKind;
  price?:      number;        // required unless type='market'
  stop_price?: number;        // required for stop / stop-limit
  size:        number;
  leverage:    number;        // 1-50, instrument-dependent cap
  tif:         Tif;
  reduce_only: boolean;
  post_only:   boolean;
}

export interface CancelOrderRequest {
  op:         'cancel_order';
  order_id:   string;
  client_oid: string;
}

export interface PingRequest {
  op:    'ping';
  ts_ms: number;
}

export type ClientRequest =
  | AuthRequest
  | SubRequest
  | PlaceOrderRequest
  | CancelOrderRequest
  | PingRequest;

// ============================================================================
// Server → Client
// ============================================================================

export interface AuthOk {
  op:           'auth_ok';
  session_id:   string;
  heartbeat_ms: number;
}
export interface AuthFail {
  op:     'auth_fail';
  reason: string;
}

/** Optimistic ack — sequencer has the order in its ring, BFT still pending. */
export interface OrderAck {
  op:         'order_ack';
  client_oid: string;
  order_id:   string;
  seq:        number;         // sequencer global sequence
  ts_ns:      number;
  symbol:     string;
  status:     OrderStatus;
  latency_us: number;         // round-trip observed by sequencer
}

/** Final ack — BFT finalized. Carries the on-chain tx hash. */
export interface OrderFinal {
  op:           'order_final';
  client_oid:   string;
  order_id:     string;
  block_height: number;
  chain_id:     number;
  fills:        FillEvent[];
}

export interface OrderReject {
  op:         'order_reject';
  client_oid: string;
  reason:     string;
  code:       number;         // see ERROR_CODES below
}

export interface BookSnapshot {
  op:      'book_snapshot';
  channel: 'book';
  symbol:  string;
  book:    Book;
}

export interface BookDelta {
  op:      'book_delta';
  channel: 'book';
  symbol:  string;
  bids:    Level[];          // only changed levels; size=0 means remove
  asks:    Level[];
  seq:     number;
}

export interface Trade {
  op:        'trade';
  channel:   'trades';
  symbol:    string;
  price:     number;
  size:      number;
  side:      Side;            // aggressor side
  taker_lei: string;
  maker_lei: string;
  ts_ms:     number;
  tx_hash?:  string;          // populated after BFT finality
}

export interface Ticker {
  op:            'ticker';
  channel:       'ticker';
  symbol:        string;
  mark:          number;
  index:         number;
  last:          number;
  change_24h:    number;     // percent
  volume_24h:    number;     // USD notional
  funding_8h?:   number;     // percent, only for perps
  open_interest: number;     // USD notional
}

export interface ChainEvent {
  op:              'chain_event';
  channel:         'chain';
  kind:            'block' | 'finality' | 'margin' | 'settle' | 'compliance';
  seq:             number;
  chain_id:        number;
  detail:          string;
  bft_latency_ms?: number;
}

export interface Pong {
  op:    'pong';
  ts_ms: number;
}

export interface ServerError {
  op:      'error';
  code:    number;
  message: string;
}

export type ServerEvent =
  | AuthOk
  | AuthFail
  | OrderAck
  | OrderFinal
  | OrderReject
  | BookSnapshot
  | BookDelta
  | Trade
  | Ticker
  | ChainEvent
  | Pong
  | ServerError;

// ============================================================================
// Error codes — stable contract with the client
// ============================================================================
export const ERROR_CODES = {
  // 1xxx — protocol
  AUTH_FAIL:              1001,
  INVALID_MESSAGE:        1002,
  NOT_SUBSCRIBED:         1003,
  RATE_LIMITED:           1004,

  // 2xxx — trading
  INSUFFICIENT_MARGIN:    2001,
  SYMBOL_NOT_FOUND:       2002,
  POST_ONLY_WOULD_CROSS:  2003,
  LEVERAGE_TOO_HIGH:      2004,
  TICK_SIZE_VIOLATION:    2005,
  LOT_SIZE_VIOLATION:     2006,

  // 3xxx — compliance (from compliance.pact)
  COMPLIANCE_LEI_FROZEN:  3001,
  COMPLIANCE_SANCTIONS:   3002,
  COMPLIANCE_KYC_EXPIRED: 3003,
  COMPLIANCE_POS_LIMIT:   3004,
  COMPLIANCE_NOTIONAL:    3005,

  // 4xxx — chain / infra
  CHAIN_UNREACHABLE:      4001,
  BFT_TIMEOUT:            4002,
} as const;

export type ErrorCode = typeof ERROR_CODES[keyof typeof ERROR_CODES];

// ============================================================================
// Helper: type guards
// ============================================================================
export function isOrderAck(ev: ServerEvent): ev is OrderAck { return ev.op === 'order_ack'; }
export function isOrderFinal(ev: ServerEvent): ev is OrderFinal { return ev.op === 'order_final'; }
export function isBookEvent(ev: ServerEvent): ev is BookSnapshot | BookDelta {
  return ev.op === 'book_snapshot' || ev.op === 'book_delta';
}
export function isTrade(ev: ServerEvent): ev is Trade { return ev.op === 'trade'; }
export function isTicker(ev: ServerEvent): ev is Ticker { return ev.op === 'ticker'; }
export function isChainEvent(ev: ServerEvent): ev is ChainEvent { return ev.op === 'chain_event'; }
