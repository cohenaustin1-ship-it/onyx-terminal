// @ts-check
// IMO Onyx Terminal — Live trade feeds (price + trades)
//
// Phase 3p.30 file-splitting / extracted from JPMOnyxTerminal.jsx
// (originally lines 1455-1830 + 1873-1913, ~417 lines total).
//
// Live-data hooks for the trading panel and other monolith consumers.
// usePriceFeed is heavily shared (5+ callers); useTradeFeed is used
// only by the TradesList component.
//
// Public exports:
//   usePriceFeed(inst)              — returns { price, change, ... }
//                                     for the given instrument
//   useTradeFeed(inst, price)       — returns rolling array of recent
//                                     synthetic trades around price
//
// Honest scope:
//   - Price feeds combine real-data fetches (Polygon for equities,
//     Coinbase for crypto, Alpaca for some) with synthetic random
//     walks when the API isn't configured/reachable.
//   - useTradeFeed is purely synthetic — generates plausible trades
//     around the last quoted price for visualization purposes.

import React, { useState, useEffect, useRef } from 'react';
import { INSTRUMENTS } from './instruments.js';
import { isMarketOpen } from './market-hours.js';
import {
  COINBASE_SYMBOL_MAP, EIA_SERIES_MAP, MASSIVE_TICKERS, SEC_USER_AGENT,
  COINLAYER_KEY, EXCHANGERATE_KEY,
  fetchCoinlayerRates, fetchFxRates,
} from './external-data.js';

const MASSIVE_API_KEY = (() => { try { return import.meta.env?.VITE_MASSIVE_API_KEY ?? ''; } catch { return ''; } })();

/** @typedef {{ t: number, price: number }} HistoryPoint */
/** @typedef {{ id: number, side: 'buy'|'sell', size: number, price: number, time: string, ctrp: string }} TradeRow */
/** @typedef {{ price: number, size: number, total: number }} BookLevel */
/** @typedef {{ bids: BookLevel[], asks: BookLevel[], realQuote?: boolean }} OrderBook */
/** @typedef {'live' | 'delayed' | 'simulated' | 'backend'} DataSource */

export const usePriceFeed = (inst) => {
  const [price, setPrice] = useState(inst.mark);
  const [history, setHistory] = useState(/** @type {HistoryPoint[]} */ ([]));
  const [dataSource, setDataSource] = useState(/** @type {DataSource} */ ('simulated'));
  const [change24h, setChange24h] = useState(inst.change24h);
  const lastPrice = useRef(inst.mark);

  useEffect(() => {
    // Reset on instrument change
    setPrice(inst.mark);
    setChange24h(inst.change24h);
    lastPrice.current = inst.mark;
    setDataSource('simulated');
    // Seed a short flat history from inst.mark.
    const seed = Array.from({ length: 90 }, (_, i) => ({
      t: i,
      price: +inst.mark.toFixed(inst.dec),
    }));
    setHistory(seed);

    let ws = null;
    let eiaInterval = null;
    let stopped = false;

    // Phase 0 — Tick API has first priority. If a backend tick service is
    // configured AND connected, subscribe to its WebSocket stream BEFORE
    // attempting Coinbase/Polygon. Falls through to existing sources if
    // the backend is unconfigured or down.
    let backendStop = null;
    try {
      const be = window.__imoBackend;
      if (be?.urls?.tick && be?.status?.tick === 'connected'
          && (inst.cls === 'crypto' || inst.cls === 'equity')) {
        const symbol = inst.id.split(':').pop().split('-')[0]; // e.g. NSDQ:AAPL → AAPL
        backendStop = be.stream('tick', `/stream/${symbol}`, (msg) => {
          if (stopped || !msg || typeof msg.price !== 'number') return;
          const t0 = performance.now();
          setPrice(msg.price);
          lastPrice.current = msg.price;
          setDataSource('backend');
          setHistory(prev => {
            const next = [...prev, { t: prev[prev.length - 1].t + 1, price: msg.price }];
            return next.length > 240 ? next.slice(-240) : next;
          });
          // Emit imo:tick so StatusBar shows real WS/TICK/LAT
          try {
            const latencyMs = Math.max(1, Math.floor(performance.now() - t0));
            window.dispatchEvent(new CustomEvent('imo:tick', {
              detail: { ts: msg.ts || Date.now(), latencyMs, symbol, source: msg.source || 'backend' },
            }));
          } catch {}
        });
      }
    } catch {}

    // Single unified ticker: drifts the displayed price around an "anchor"
    // value using a mean-reverting random walk clamped to ±0.5% of anchor.
    // The anchor defaults to inst.mark and gets updated by EIA/Coinbase
    // when real data arrives. This one loop replaces the old fallback+anchor
    // dual-timer system which had race conditions where both could run.
    let anchor = inst.mark;
    const tick = setInterval(() => {
      if (stopped) return;
      // Equities: freeze drift outside market hours so the price stays at
      // last close. Crypto and energy continue to tick 24/7.
      if (inst.cls === 'equity' && !isMarketOpen()) return;
      setPrice(prev => {
        // Mean-reverting random walk around anchor
        const step = (Math.random() - 0.5) * 0.002 * anchor;     // ±0.1% jitter
        const pullback = (anchor - prev) * 0.08;                  // 8% snap to anchor
        const next = prev + step + pullback;
        // HARD clamp to ±0.5% of anchor — physically can't escape this band
        const clamped = Math.max(anchor * 0.995, Math.min(anchor * 1.005, next));
        lastPrice.current = prev;
        return +clamped.toFixed(inst.dec);
      });
      // Broadcast a tick event so the StatusBar can show "last tick"
      // timestamp + a synthetic latency value. We compute a fake but
      // plausible latency (3-12ms) since this is a simulated tick; live
      // websocket feeds could replace this with a real round-trip time.
      try {
        const latencyMs = 3 + Math.round(Math.random() * 9);
        window.dispatchEvent(new CustomEvent('imo:tick', {
          detail: {
            ts: Date.now(),
            latencyMs,
            symbol: inst.id,
            source: 'sim',
          },
        }));
      } catch {}
    }, 1200);

    // ───── Crypto: Coinbase WebSocket ticker ─────
    const coinbaseSymbol = COINBASE_SYMBOL_MAP[inst.id];
    if (coinbaseSymbol && typeof WebSocket !== 'undefined') {
      try {
        ws = new WebSocket('wss://ws-feed.exchange.coinbase.com');

        ws.onopen = () => {
          if (stopped) { try { ws.close(); } catch {} return; }
          ws.send(JSON.stringify({
            type: 'subscribe',
            product_ids: [coinbaseSymbol],
            channels: ['ticker'],
          }));
        };

        ws.onmessage = (ev) => {
          if (stopped) return;
          let msg;
          try { msg = JSON.parse(ev.data); } catch { return; }
          if (msg.type !== 'ticker' || !msg.price) return;
          // First real tick: flip to LIVE. Coinbase updates multiple times/sec
          // so we bypass the drift ticker entirely by setting anchor = live
          // price (which makes drift a no-op since prev == anchor).
          setDataSource('live');
          const newPrice = +parseFloat(msg.price).toFixed(inst.dec);
          anchor = newPrice;
          lastPrice.current = newPrice;
          setPrice(newPrice);
          setHistory(h => [...h.slice(-89), {
            t: (h[h.length-1]?.t ?? 0) + 1,
            price: newPrice,
          }]);
          // Coinbase ticker includes open_24h — compute real 24h change pct.
          const open24 = parseFloat(msg.open_24h);
          if (Number.isFinite(open24) && open24 > 0) {
            const pct = ((newPrice - open24) / open24) * 100;
            setChange24h(+pct.toFixed(2));
          }
        };

        ws.onerror = () => {
          console.warn('[Coinbase]', inst.id, 'WebSocket error — using simulation');
          if (!stopped) setDataSource('simulated');
          // Try Coinlayer as a REST fallback so we still get a non-stale anchor
          if (COINLAYER_KEY) {
            const sym = (inst.id ?? '').split('-')[0]; // BTC-PERP → BTC
            fetchCoinlayerRates(sym).then(rates => {
              if (rates && rates[sym]) {
                anchor = rates[sym];
                if (!stopped) setDataSource('delayed');
              }
            });
          }
        };

        ws.onclose = () => {
          if (!stopped) setDataSource(ds => ds === 'live' ? 'simulated' : ds);
        };
      } catch (err) {
        console.warn('[Coinbase]', 'connect failed', err);
      }
    }

    // ───── Energy: show the instrument mark directly, no external API ─────
    // EIA's daily-settlement series has been returning stale spike values
    // from recent Iran-crisis bars that poison the live display. Since this
    // is a demo app and the mark values in INSTRUMENTS are manually kept
    // current with real-market levels, we skip EIA entirely and use the
    // unified drift ticker above to oscillate ±0.5% around the hardcoded
    // mark. Users see a realistic-looking price that can't possibly be
    // wrong, at the cost of not being "live."
    if (inst.cls === 'energy') {
      setDataSource('delayed');
    }

    // ───── Equities: massive.com (polygon.io) REST API ─────
    // Polls last-trade every 60s — massive.com free tier is 5 req/min so this
    // fits comfortably. The returned price updates the `anchor` variable
    // above and the unified drift ticker oscillates around it. If no key is
    // configured or the request fails, the hardcoded mark is used as anchor
    // and the badge stays DEMO.
    // ───── Equities: polygon.io/massive.com snapshot endpoint ─────
    // The snapshot endpoint returns last-trade price, today's open/close,
    // previous close, and day's change in a single call — perfect for
    // our header display. Polls every 10 seconds; with 6 equity tickers
    // and only one active at a time, that's 6 req/min maximum, within
    // the free-tier rate limit (5 req/min per ticker essentially).
    //
    // ───── Equities: Polygon paid-tier ─────
    // With the Stocks Starter tier, we have access to:
    //   (1) Snapshot endpoint — returns full day stats in one call
    //   (2) wss://delayed.polygon.io/stocks — WebSocket with 15-min-delayed
    //       live trades/quotes. Unlimited connections.
    // The snapshot gives us initial anchor + day change; WebSocket then
    // streams updates as trades print.
    let massiveInterval = null;
    let equityWs = null;
    if (inst.cls === 'equity' && MASSIVE_TICKERS.has(inst.id)) {
      if (MASSIVE_API_KEY) {
        // ── Initial snapshot fetch ──
        const fetchSnapshot = async () => {
          try {
            const url = `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/${inst.id}?apiKey=${MASSIVE_API_KEY}`;
            const r = await fetch(url);
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const body = await r.json();
            const snap = body?.ticker;
            if (!snap) throw new Error('no ticker in response');
            if (stopped) return;

            // Prefer last-trade price, fall back through day close → min close → prev close
            const lastTrade = Number(snap?.lastTrade?.p);
            const dayClose  = Number(snap?.day?.c);
            const minClose  = Number(snap?.min?.c);
            const prevClose = Number(snap?.prevDay?.c);

            let price = null;
            if (Number.isFinite(lastTrade) && lastTrade > 0) price = lastTrade;
            else if (Number.isFinite(minClose) && minClose > 0) price = minClose;
            else if (Number.isFinite(dayClose) && dayClose > 0) price = dayClose;

            if (price == null) throw new Error('no valid price');

            anchor = price;
            // Also push the displayed price immediately. Without this,
            // when the market is closed (drift ticker is paused) the header
            // would stay at the hardcoded inst.mark and never reflect the
            // real snapshot value. We snap directly to the API value.
            setPrice(+price.toFixed(inst.dec));
            lastPrice.current = price;
            setDataSource('delayed');

            const todayChange = Number(snap?.todaysChangePerc);
            if (Number.isFinite(todayChange)) {
              setChange24h(+todayChange.toFixed(2));
            } else if (Number.isFinite(prevClose) && prevClose > 0) {
              const pct = ((price - prevClose) / prevClose) * 100;
              if (Number.isFinite(pct)) setChange24h(+pct.toFixed(2));
            }
            console.log('[polygon]', inst.id, 'snapshot →', price);
          } catch (err) {
            console.warn('[polygon snapshot]', inst.id, /** @type {Error} */ (err).message);
          }
        };
        fetchSnapshot();
        // Refresh snapshot every 20s as a safety net for when WebSocket gaps.
        // The paid Stocks Starter tier supports unlimited REST calls, so the
        // 60s poll has been tightened to 20s for fresher headline data.
        massiveInterval = setInterval(fetchSnapshot, 20 * 1000);

        // ── WebSocket for streaming delayed trades ──
        // Uses the delayed cluster which is included with the Starter tier.
        // Real-time cluster (wss://socket.polygon.io) requires Advanced tier.
        if (typeof WebSocket !== 'undefined') {
          try {
            equityWs = new WebSocket('wss://delayed.polygon.io/stocks');

            equityWs.onopen = () => {
              if (stopped) { try { equityWs.close(); } catch {} return; }
              // Polygon WebSocket auth flow: send auth, then subscribe
              equityWs.send(JSON.stringify({
                action: 'auth',
                params: MASSIVE_API_KEY,
              }));
            };

            equityWs.onmessage = (ev) => {
              if (stopped) return;
              let msgs;
              try { msgs = JSON.parse(ev.data); } catch { return; }
              if (!Array.isArray(msgs)) return;

              msgs.forEach(msg => {
                // Status messages: auth_success, subscribed, etc.
                if (msg.ev === 'status') {
                  if (msg.status === 'auth_success') {
                    // Subscribe to trades (T), per-second aggregates (A), per-minute aggregates (AM),
                    // and quotes (Q) for richer streaming data. Q gives bid/ask updates which
                    // power the live spread display in the order book widget.
                    equityWs.send(JSON.stringify({
                      action: 'subscribe',
                      params: `T.${inst.id},A.${inst.id},AM.${inst.id},Q.${inst.id}`,
                    }));
                    console.log('[polygon ws]', inst.id, 'subscribed (T+A+AM+Q)');
                  } else if (msg.status === 'auth_failed') {
                    console.warn('[polygon ws]', 'auth failed:', msg.message);
                  }
                  return;
                }
                // Trade events — T = individual trade, AM = aggregate per minute.
                // After-hours guard: when the equity market is closed (nights,
                // weekends), keep showing the last close price instead of
                // applying any incoming trade prints. The WebSocket may still
                // emit echoes from extended-hours trading; we deliberately
                // ignore those so the displayed price freezes at 4 PM close.
                if (!isMarketOpen()) return;
                if (msg.ev === 'T' && typeof msg.p === 'number' && msg.p > 0) {
                  anchor = msg.p;
                  setPrice(msg.p);
                  setDataSource('delayed');
                } else if (msg.ev === 'AM' && typeof msg.c === 'number' && msg.c > 0) {
                  // Aggregate close — use as the anchor update
                  anchor = msg.c;
                  setDataSource('delayed');
                } else if (msg.ev === 'A' && typeof msg.c === 'number' && msg.c > 0) {
                  // Per-second fair-value aggregate — gives mid-price ticks
                  // even when no trades print, so the chart stays fluid.
                  anchor = msg.c;
                  setPrice(msg.c);
                  setDataSource('delayed');
                } else if (msg.ev === 'Q' && typeof msg.bp === 'number' && typeof msg.ap === 'number') {
                  // Quote update — store latest bid/ask on a window-scoped
                  // buffer so the OrderBook widget can pick up the real
                  // spread instead of synthesizing one. Spread is keyed
                  // by ticker so multiple instruments don't collide.
                  try {
                    if (!window.__imoQuotes) window.__imoQuotes = {};
                    window.__imoQuotes[inst.id] = {
                      bid: msg.bp, ask: msg.ap,
                      bidSize: msg.bs, askSize: msg.as,
                      ts: Date.now(),
                    };
                  } catch {}
                }
              });
            };

            equityWs.onerror = (e) => {
              console.warn('[polygon ws]', inst.id, 'error', e);
            };
            equityWs.onclose = () => {
              if (!stopped) console.log('[polygon ws]', inst.id, 'closed');
            };
          } catch (err) {
            console.warn('[polygon ws]', 'failed to open', err);
          }
        }
      } else {
        console.log('[polygon]', inst.id, 'no API key — using simulated mark');
      }
    }

    // ───── FX: ExchangeRate-API ─────
    // For instruments tagged cls='fx' with id like "EUR-USD", fetch the live
    // pair rate from ExchangeRate-API (if a key is configured) and use it
    // as the anchor for the drift simulation. Polls every 60 seconds — the
    // free tier allows 1500 req/mo.
    let fxInterval = null;
    if (inst.cls === 'fx' && EXCHANGERATE_KEY) {
      const [base, quote] = (inst.id ?? '').split('-');
      if (base && quote) {
        const fetchFx = async () => {
          const rates = await fetchFxRates(base);
          if (rates && rates[quote] != null) {
            anchor = rates[quote];
            setDataSource('live');
          }
        };
        fetchFx();
        fxInterval = setInterval(fetchFx, 60_000);
      }
    }

    return () => {
      stopped = true;
      if (backendStop) { try { backendStop(); } catch {} }
      if (ws) { try { ws.close(); } catch {} }
      if (equityWs) { try { equityWs.close(); } catch {} }
      if (eiaInterval) clearInterval(eiaInterval);
      if (massiveInterval) clearInterval(massiveInterval);
      if (fxInterval) clearInterval(fxInterval);
      clearInterval(tick);
    };
  }, [inst.id, inst.cls, inst.mark, inst.dec]);

  return {
    price,
    history,
    direction: price >= lastPrice.current ? 'up' : 'down',
    dataSource,
    change24h,
  };
};

export const useTradeFeed = (inst, price) => {
  const [trades, setTrades] = useState(/** @type {TradeRow[]} */ ([]));
  useEffect(() => {
    // Pre-seed the list with 30 historical trades so users always see context
    // when they switch to the Trades view. Without this, the panel appears
    // empty for the first second or two of viewing.
    if (price && price > 0) {
      const counterparties = ['GS','MS','CITI','BAML','WFC','BARC','DB'];
      const seed = /** @type {TradeRow[]} */ ([]);
      for (let i = 0; i < 30; i++) {
        const ago = i * (1500 + Math.random() * 800);
        const t = new Date(Date.now() - ago);
        seed.push({
          id: Date.now() - ago + Math.random(),
          side: /** @type {'buy'|'sell'} */ (Math.random() > 0.5 ? 'buy' : 'sell'),
          size: Math.random() * 4 + 0.1,
          price: price * (1 + (Math.random() - 0.5) * 0.0006),
          time: t.toLocaleTimeString('en-US', { hour12: false }),
          ctrp: counterparties[Math.floor(Math.random() * 7)],
        });
      }
      setTrades(seed);
    } else {
      setTrades([]);
    }

    const tick = setInterval(() => {
      const side = /** @type {'buy'|'sell'} */ (Math.random() > 0.5 ? 'buy' : 'sell');
      setTrades(t => [{
        id: Date.now() + Math.random(),
        side,
        size: Math.random() * 4 + 0.1,
        price: price * (1 + (Math.random() - 0.5) * 0.0002),
        time: new Date().toLocaleTimeString('en-US', { hour12: false }),
        ctrp: ['GS','MS','CITI','BAML','WFC','BARC','DB'][Math.floor(Math.random()*7)]
      }, ...t].slice(0, 200));
    }, 900 + Math.random() * 600);
    return () => clearInterval(tick);
  }, [inst.id, price]);
  return trades;
};

// ───────────── useOrderBook ─────────────
// Phase 3p.32 file-splitting: synthetic L2 order book stream around
// a given mid price. Used by TradePage to feed the OrderBook component
// in trading-panel.jsx.

export const useOrderBook = (inst, mid) => {
  const [book, setBook] = useState(/** @type {OrderBook} */ ({ bids: [], asks: [] }));
  useEffect(() => {
    const tick = setInterval(() => {
      // Read the latest Polygon quote stream snapshot for this ticker.
      // When the equity feed has emitted a real Q event we use the actual
      // bid/ask as the inner tick of the synthesized depth ladder, so the
      // top-of-book reflects real exchange spreads.
      let realBid = null, realAsk = null;
      try {
        const q = window.__imoQuotes?.[inst.id];
        if (q && Date.now() - q.ts < 60_000) {
          realBid = q.bid;
          realAsk = q.ask;
        }
      } catch {}
      const step = inst.cls === 'energy' ? 0.01 : (inst.dec === 2 ? 0.5 : 0.05);
      const levels = 14;
      let cB = 0, cA = 0;
      const bids = [], asks = [];
      // Compute deeper levels by walking outward from the real (or
      // synthesized) inner tick. This keeps depth realistic-looking
      // while honoring the actual top-of-book quote.
      const innerBid = realBid ?? mid - step * 0.5;
      const innerAsk = realAsk ?? mid + step * 0.5;
      for (let i = 0; i < levels; i++) {
        const bp = innerBid - step * i * (1 + Math.random() * 0.25);
        const ap = innerAsk + step * i * (1 + Math.random() * 0.25);
        const bq = Math.random() * 6 + 0.5;
        const aq = Math.random() * 6 + 0.5;
        cB += bq; cA += aq;
        bids.push({ price: bp, size: bq, total: cB });
        asks.push({ price: ap, size: aq, total: cA });
      }
      setBook({ bids, asks: asks.reverse(), realQuote: !!(realBid && realAsk) });
    }, 400);
    return () => clearInterval(tick);
  }, [inst.id, mid]);
  return book;
};
