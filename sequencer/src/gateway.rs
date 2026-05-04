//! WebSocket gateway — where clients connect.
//!
//! Two channels per connection:
//!   - fast: optimistic acks, book deltas, tickers, trades (sub-ms)
//!   - final: BFT-finalized confirmations with tx hashes
//!
//! All connections are mTLS with X.509 client certs. This module assumes
//! the TLS layer has already verified the client cert; we read the subject's
//! LEI + desk from the cert CN/SAN to authorize the session.

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Instant;

use futures_util::{SinkExt, StreamExt};
use tokio::net::TcpListener;
use tokio_tungstenite::tungstenite::Message;
use tracing::{error, info, warn};
use uuid::Uuid;

use crate::config::Config;
use crate::marketdata::MarketDataHub;
use crate::matcher::Matcher;
use crate::ring_buffer::{OrderRing, publish_order};
use crate::risk;
use crate::schemas::{
    ClientRequest, ServerEvent, EventKind, OrderStatus, error_codes,
};

pub struct Gateway {
    config:     Arc<Config>,
    ring:       Arc<OrderRing>,
    md:         Arc<MarketDataHub>,
    matchers:   Arc<Vec<Matcher>>,
}

impl Gateway {
    pub fn new(
        config: Arc<Config>,
        ring: Arc<OrderRing>,
        md: Arc<MarketDataHub>,
        matchers: Vec<Matcher>,
    ) -> Self {
        Self { config, ring, md, matchers: Arc::new(matchers) }
    }

    pub async fn serve(self: Self) {
        let addr: SocketAddr = self.config.bind.parse().expect("invalid bind addr");
        let listener = TcpListener::bind(&addr).await.expect("bind failed");
        info!(%addr, "gateway listening");

        loop {
            match listener.accept().await {
                Ok((stream, peer)) => {
                    let this = Arc::new(self.clone_arc());
                    tokio::spawn(async move {
                        if let Err(e) = handle_connection(this, stream, peer).await {
                            warn!(%peer, error = %e, "connection closed with error");
                        }
                    });
                }
                Err(e) => error!(error = %e, "accept failed"),
            }
        }
    }

    fn clone_arc(&self) -> Self {
        Self {
            config:   self.config.clone(),
            ring:     self.ring.clone(),
            md:       self.md.clone(),
            matchers: self.matchers.clone(),
        }
    }
}

async fn handle_connection(
    gw: Arc<Gateway>,
    stream: tokio::net::TcpStream,
    peer: SocketAddr,
) -> anyhow::Result<()> {
    // In production, wrap `stream` in rustls and extract the client cert here.
    // For dev we skip TLS.
    let ws = tokio_tungstenite::accept_async(stream).await?;
    let (mut tx, mut rx) = ws.split();

    let session_id = Uuid::new_v4().to_string();
    let mut authed: Option<SessionState> = None;
    let connect_ts = Instant::now();

    info!(%peer, session = %session_id, "client connected");

    while let Some(msg) = rx.next().await {
        let msg = msg?;
        let text = match msg {
            Message::Text(t) => t,
            Message::Binary(b) => String::from_utf8_lossy(&b).into_owned(),
            Message::Ping(p) => { tx.send(Message::Pong(p)).await.ok(); continue; }
            Message::Close(_) => break,
            _ => continue,
        };

        let req: ClientRequest = match serde_json::from_str(&text) {
            Ok(r) => r,
            Err(e) => {
                send(&mut tx, ServerEvent::Error {
                    code: error_codes::INVALID_MESSAGE,
                    message: e.to_string(),
                }).await;
                continue;
            }
        };

        match req {
            ClientRequest::Auth { lei, desk, signed_nonce: _ } => {
                // In production: verify signed_nonce against the mTLS peer cert pubkey
                authed = Some(SessionState {
                    session_id: session_id.clone(),
                    lei:  lei.clone(),
                    desk: desk.clone(),
                    subs: Vec::new(),
                });
                send(&mut tx, ServerEvent::AuthOk {
                    session_id: session_id.clone(),
                    heartbeat_ms: 30_000,
                }).await;
                info!(session = %session_id, %lei, %desk, "authed");
            }

            ClientRequest::Sub { channel, symbol } => {
                let Some(s) = authed.as_mut() else {
                    send(&mut tx, ServerEvent::Error { code: error_codes::AUTH_FAIL, message: "not authed".into() }).await;
                    continue;
                };
                s.subs.push((channel.clone(), symbol.clone()));
                // Send snapshot immediately
                if channel == "book" {
                    if let Some(snap) = gw.md.book_snapshot(&symbol).await {
                        send(&mut tx, ServerEvent::BookSnapshot {
                            channel, symbol, book: snap,
                        }).await;
                    }
                }
            }

            ClientRequest::Unsub { channel, symbol } => {
                if let Some(s) = authed.as_mut() {
                    s.subs.retain(|(c, sy)| !(c == &channel && sy == &symbol));
                }
            }

            ClientRequest::PlaceOrder(payload) => {
                let Some(s) = authed.as_ref() else {
                    send(&mut tx, ServerEvent::Error { code: error_codes::AUTH_FAIL, message: "not authed".into() }).await;
                    continue;
                };
                let t0 = Instant::now();

                // Pre-trade risk check against in-memory snapshot (no chain call)
                if let Err(e) = risk::pretrade_check(&s.lei, &s.desk, &payload).await {
                    send(&mut tx, ServerEvent::OrderReject {
                        client_oid: payload.client_oid.clone(),
                        reason:     e.message,
                        code:       e.code,
                    }).await;
                    continue;
                }

                // Publish to ring — matchers pick it up, Pact submitter picks it up
                let order_id = Uuid::new_v4().to_string();
                let seq = publish_order(&gw.ring, EventKind::OrderPlaced {
                    order_id:    order_id.clone(),
                    client_oid:  payload.client_oid.clone(),
                    symbol:      payload.symbol.clone(),
                    lei:         s.lei.clone(),
                    desk:        s.desk.clone(),
                    side:        payload.side,
                    kind:        payload.kind,
                    price:       payload.price,
                    stop_price:  payload.stop_price,
                    size:        payload.size,
                    leverage:    payload.leverage,
                    tif:         payload.tif,
                    reduce_only: payload.reduce_only,
                    post_only:   payload.post_only,
                });

                let latency_us = t0.elapsed().as_micros() as u64;
                send(&mut tx, ServerEvent::OrderAck {
                    client_oid: payload.client_oid,
                    order_id,
                    seq,
                    ts_ns: now_ns(),
                    symbol: payload.symbol,
                    status: OrderStatus::Pending,
                    latency_us,
                }).await;
            }

            ClientRequest::CancelOrder { order_id, client_oid } => {
                let Some(s) = authed.as_ref() else {
                    send(&mut tx, ServerEvent::Error { code: error_codes::AUTH_FAIL, message: "not authed".into() }).await;
                    continue;
                };
                publish_order(&gw.ring, EventKind::OrderCancelled {
                    order_id,
                    lei: s.lei.clone(),
                });
                let _ = client_oid;
            }

            ClientRequest::Ping { ts_ms } => {
                send(&mut tx, ServerEvent::Pong { ts_ms }).await;
            }
        }
    }

    info!(session = %session_id, elapsed_s = connect_ts.elapsed().as_secs_f64(), "client disconnected");
    Ok(())
}

struct SessionState {
    session_id: String,
    lei:        String,
    desk:       String,
    subs:       Vec<(String, String)>, // (channel, symbol)
}

async fn send<S: SinkExt<Message> + Unpin>(tx: &mut S, event: ServerEvent)
where <S as futures_util::Sink<Message>>::Error: std::fmt::Debug
{
    let payload = serde_json::to_string(&event).unwrap_or_default();
    let _ = tx.send(Message::Text(payload)).await;
}

fn now_ns() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos() as u64).unwrap_or(0)
}
