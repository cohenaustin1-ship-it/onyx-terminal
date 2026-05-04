/**
 * sequencerClient.js
 *
 * Client library for connecting the React UI to the JPM Onyx sequencer.
 *
 * Architecture:
 *   React UI  ──(WebSocket)──►  Sequencer (Rust, LMAX ring buffer)
 *                                      │
 *                                      ▼
 *                               Chainweb (20 chains)
 *                                      │
 *                                      ▼
 *                               Pact modules (order-book, clearinghouse)
 *
 * The sequencer pushes optimistic order book updates (sub-ms) and
 * BFT-finalized trade confirmations (~4ms) over two separate WebSocket
 * channels for latency-sensitive vs settlement-grade data.
 */

const DEFAULT_ENDPOINTS = {
  wsFast:   'wss://seq-nyc4.onyx.jpmorgan.com/ws/fast',     // optimistic
  wsSlow:   'wss://seq-nyc4.onyx.jpmorgan.com/ws/final',    // BFT-finalized
  rest:     'https://api.onyx.jpmorgan.com/v1',             // REST fallback
  compliance: 'https://compliance.onyx.jpmorgan.com/v1',    // KYC/LEI check
};

export class SequencerClient {
  constructor(options = {}) {
    this.endpoints = { ...DEFAULT_ENDPOINTS, ...(options.endpoints || {}) };
    this.cert = options.cert;           // X.509 cert for mTLS
    this.lei  = options.lei;            // Legal Entity Identifier
    this.desk = options.desk;           // internal JPM desk code

    this.subscribers = new Map();       // channel -> Set(callback)
    this.pendingOrders = new Map();     // clientOrderId -> { resolve, reject, ts }
    this.fastWs = null;
    this.slowWs = null;
    this.reconnectDelay = 100;
    this.closed = false;
  }

  // ---------------------------------------------------------------------
  // Connection lifecycle
  // ---------------------------------------------------------------------
  async connect() {
    await Promise.all([
      this._connectWs('fast'),
      this._connectWs('slow'),
    ]);
    return this;
  }

  _connectWs(kind) {
    return new Promise((resolve, reject) => {
      const url = kind === 'fast' ? this.endpoints.wsFast : this.endpoints.wsSlow;
      const ws = new WebSocket(url);

      ws.onopen = () => {
        this[kind === 'fast' ? 'fastWs' : 'slowWs'] = ws;
        this.reconnectDelay = 100;
        // Auth handshake — X.509 client cert is handled by mTLS at TLS layer,
        // but we also send LEI + desk so the sequencer knows routing.
        ws.send(JSON.stringify({ op: 'auth', lei: this.lei, desk: this.desk }));
        resolve(ws);
      };

      ws.onmessage = (ev) => this._onMessage(kind, ev);

      ws.onclose = () => {
        if (this.closed) return;
        setTimeout(() => this._connectWs(kind), this.reconnectDelay);
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 10_000);
      };

      ws.onerror = (e) => {
        console.error(`[seq:${kind}] ws error`, e);
        reject(e);
      };
    });
  }

  close() {
    this.closed = true;
    this.fastWs?.close();
    this.slowWs?.close();
  }

  // ---------------------------------------------------------------------
  // Subscriptions — fast channel pushes book + trades pre-consensus
  // ---------------------------------------------------------------------
  subscribe(channel, symbol, callback) {
    const key = `${channel}:${symbol}`;
    if (!this.subscribers.has(key)) this.subscribers.set(key, new Set());
    this.subscribers.get(key).add(callback);
    this._send('fast', { op: 'sub', channel, symbol });
    return () => this.unsubscribe(channel, symbol, callback);
  }

  unsubscribe(channel, symbol, callback) {
    const key = `${channel}:${symbol}`;
    const set = this.subscribers.get(key);
    if (!set) return;
    set.delete(callback);
    if (set.size === 0) {
      this._send('fast', { op: 'unsub', channel, symbol });
      this.subscribers.delete(key);
    }
  }

  _onMessage(kind, ev) {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }

    // Order ack from sequencer (optimistic)
    if (msg.op === 'order_ack') {
      const pending = this.pendingOrders.get(msg.clientOrderId);
      if (pending) {
        pending.resolve({
          ...msg,
          latencyMs: performance.now() - pending.ts,
          optimistic: kind === 'fast',
        });
        if (kind === 'slow') this.pendingOrders.delete(msg.clientOrderId);
      }
      return;
    }

    // Order rejection (rare, usually pre-validated)
    if (msg.op === 'order_reject') {
      const pending = this.pendingOrders.get(msg.clientOrderId);
      if (pending) {
        pending.reject(new Error(msg.reason));
        this.pendingOrders.delete(msg.clientOrderId);
      }
      return;
    }

    // Topic update (book, trades, positions)
    if (msg.channel) {
      const key = `${msg.channel}:${msg.symbol}`;
      const set = this.subscribers.get(key);
      if (set) set.forEach(cb => cb(msg));
    }
  }

  _send(kind, obj) {
    const ws = kind === 'fast' ? this.fastWs : this.slowWs;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  }

  // ---------------------------------------------------------------------
  // Order lifecycle — returns a promise that resolves on optimistic ack
  // ---------------------------------------------------------------------
  placeOrder(order) {
    const clientOrderId = order.clientOrderId ?? this._genId();
    const payload = {
      op: 'place_order',
      clientOrderId,
      lei: this.lei,
      desk: this.desk,
      ...order,
    };
    return new Promise((resolve, reject) => {
      this.pendingOrders.set(clientOrderId, { resolve, reject, ts: performance.now() });
      this._send('fast', payload);
      // Timeout fallback
      setTimeout(() => {
        if (this.pendingOrders.has(clientOrderId)) {
          this.pendingOrders.delete(clientOrderId);
          reject(new Error('Sequencer timeout (>500ms)'));
        }
      }, 500);
    });
  }

  cancelOrder(orderId) {
    const clientOrderId = this._genId();
    this._send('fast', { op: 'cancel_order', orderId, clientOrderId, lei: this.lei });
  }

  // ---------------------------------------------------------------------
  // REST fallbacks — for historical data, account info, compliance
  // ---------------------------------------------------------------------
  async getAccount() {
    return this._fetch(`${this.endpoints.rest}/account/${this.desk}`);
  }

  async getPositions() {
    return this._fetch(`${this.endpoints.rest}/account/${this.desk}/positions`);
  }

  async getTradeHistory(symbol, { limit = 100, before } = {}) {
    const qs = new URLSearchParams({ limit, ...(before && { before }) });
    return this._fetch(`${this.endpoints.rest}/trades/${symbol}?${qs}`);
  }

  async getChainStatus(chainId) {
    return this._fetch(`${this.endpoints.rest}/chain/${chainId}/status`);
  }

  async _fetch(url) {
    const r = await fetch(url, {
      credentials: 'include',
      headers: { 'X-JPM-LEI': this.lei, 'X-JPM-Desk': this.desk },
    });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return r.json();
  }

  _genId() {
    return `${this.desk}-${Date.now()}-${Math.floor(Math.random() * 0xffff).toString(16)}`;
  }
}

// ---------------------------------------------------------------------
// React hook — thin wrapper for common use cases
// ---------------------------------------------------------------------
import { useEffect, useState, useRef } from 'react';

export function useSequencer(options) {
  const [client, setClient] = useState(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const c = new SequencerClient(options);
    c.connect()
      .then(() => { setClient(c); setConnected(true); })
      .catch(e => console.error('Sequencer connect failed', e));
    return () => c.close();
  }, []);

  return { client, connected };
}

export function useOrderBook(client, symbol) {
  const [book, setBook] = useState({ bids: [], asks: [] });
  useEffect(() => {
    if (!client || !symbol) return;
    return client.subscribe('book', symbol, msg => setBook(msg.book));
  }, [client, symbol]);
  return book;
}

export function useTicker(client, symbol) {
  const [tick, setTick] = useState(null);
  useEffect(() => {
    if (!client || !symbol) return;
    return client.subscribe('ticker', symbol, msg => setTick(msg.tick));
  }, [client, symbol]);
  return tick;
}
