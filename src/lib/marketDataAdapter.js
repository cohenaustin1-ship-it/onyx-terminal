/**
 * Client-side market data adapters.
 *
 * The React app normally receives mark prices from the sequencer (which
 * aggregates ICE/CME/EIA internally). These adapters exist for two purposes:
 *
 *   1. Development — run the UI against public data sources when no sequencer
 *      is available.
 *   2. Cross-check — institutional clients can pull a second independent
 *      feed directly to sanity-check the sequencer's marks (common pattern
 *      in prop trading risk systems).
 *
 * Pattern: each adapter implements `subscribe(symbol, callback)` and returns
 * an unsubscribe function. `createHub()` gives you a fan-out across multiple
 * adapters with automatic failover.
 */

// ============================================================================
// EIA (US Energy Information Administration)
// FREE — public API key required, daily cadence
// https://www.eia.gov/opendata/
// ============================================================================
export function createEiaAdapter({ apiKey }) {
  const SERIES = {
    'WTI-F26':   'PET.RWTC.D',                  // Cushing WTI spot
    'BRENT-F26': 'PET.RBRTE.D',                 // Europe Brent spot
    'NG-G26':    'NG.RNGWHHD.D',                // Henry Hub spot
    'HO-F26':    'PET.EER_EPD2F_PF4_Y35NY_DPG.D',
  };

  async function fetchLatest(symbol) {
    const series = SERIES[symbol];
    if (!series) throw new Error(`EIA: unknown symbol ${symbol}`);
    const url = `https://api.eia.gov/v2/seriesid/${series}` +
                `?api_key=${apiKey}&length=1` +
                `&sort[0][column]=period&sort[0][direction]=desc`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`EIA ${r.status}`);
    const body = await r.json();
    const point = body?.response?.data?.[0];
    if (!point) throw new Error('EIA: no data returned');
    return { price: point.value, ts: new Date(point.period).getTime(), source: 'EIA' };
  }

  return {
    name: 'EIA',
    symbols: Object.keys(SERIES),
    async subscribe(symbol, callback) {
      let cancelled = false;
      const poll = async () => {
        if (cancelled) return;
        try {
          const tick = await fetchLatest(symbol);
          callback(tick);
        } catch (e) {
          console.warn('[EIA]', symbol, e.message);
        }
        setTimeout(poll, 3_600_000); // hourly
      };
      poll();
      return () => { cancelled = true; };
    },
  };
}

// ============================================================================
// ICE WebICE (institutional)
// LICENSED — requires JPM's ICE entitlement and FIX session credentials
// https://www.theice.com/market-data/real-time-data/ice-data-services
// ============================================================================
export function createIceAdapter({ endpoint, apiKey, username }) {
  const SYMBOLS = {
    'BRENT-F26': 'B\\F26',
    'WTI-F26':   'T\\F26',
    'NG-G26':    'H\\G26',
    'HO-F26':    'O\\F26',
  };

  let sessionId = null;

  async function logon() {
    const r = await fetch(`${endpoint}/api/v1/session`, {
      method: 'POST',
      headers: { 'X-ICE-API-Key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, entitlements: ['B', 'CL', 'NG', 'HO'] }),
    });
    if (!r.ok) throw new Error(`ICE logon ${r.status}`);
    const body = await r.json();
    sessionId = body.sessionId;
    return sessionId;
  }

  return {
    name: 'ICE',
    symbols: Object.keys(SYMBOLS),
    async subscribe(symbol, callback) {
      const iceSym = SYMBOLS[symbol];
      if (!iceSym) throw new Error(`ICE: unknown symbol ${symbol}`);
      if (!sessionId) await logon();

      let cancelled = false;
      const poll = async () => {
        if (cancelled) return;
        try {
          const r = await fetch(`${endpoint}/api/v1/marketdata/${encodeURIComponent(iceSym)}?depth=10`, {
            headers: { 'X-ICE-API-Key': apiKey, 'X-ICE-Session': sessionId },
          });
          if (!r.ok) throw new Error(`ICE ${r.status}`);
          const snap = await r.json();
          callback({ price: snap.last, bid: snap.bid, ask: snap.ask, ts: Date.now(), source: 'ICE' });
        } catch (e) {
          console.warn('[ICE]', symbol, e.message);
          if (e.message.includes('401') || e.message.includes('403')) sessionId = null;
        }
        setTimeout(poll, 500);
      };
      poll();
      return () => { cancelled = true; };
    },
  };
}

// ============================================================================
// CME Group Market Data
// LICENSED — CME Globex or CME Direct API entitlement required
// https://www.cmegroup.com/market-data/
// ============================================================================
export function createCmeAdapter({ endpoint, token }) {
  const SYMBOLS = {
    'BTC-PERP': 'BTC',
    'ETH-PERP': 'ETH',
    'WTI-F26':  'CLF6',
    'NG-G26':   'NGG6',
  };

  return {
    name: 'CME',
    symbols: Object.keys(SYMBOLS),
    async subscribe(symbol, callback) {
      const cmeSym = SYMBOLS[symbol];
      if (!cmeSym) throw new Error(`CME: unknown symbol ${symbol}`);

      let cancelled = false;
      const poll = async () => {
        if (cancelled) return;
        try {
          const r = await fetch(`${endpoint}/md/v1/quotes/${cmeSym}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!r.ok) throw new Error(`CME ${r.status}`);
          const quote = await r.json();
          callback({ price: quote.last, bid: quote.bid, ask: quote.ask, ts: Date.now(), source: 'CME' });
        } catch (e) {
          console.warn('[CME]', symbol, e.message);
        }
        setTimeout(poll, 250);
      };
      poll();
      return () => { cancelled = true; };
    },
  };
}

// ============================================================================
// Simulated (fallback for dev)
// ============================================================================
export function createSimulatedAdapter() {
  const BASE = {
    'BTC-PERP': 98420.50, 'ETH-PERP': 3842.18, 'SOL-PERP': 218.94,
    'WTI-F26': 74.82, 'BRENT-F26': 78.41, 'NG-G26': 3.248, 'HO-F26': 2.412,
  };
  return {
    name: 'simulated',
    symbols: Object.keys(BASE),
    subscribe(symbol, callback) {
      let price = BASE[symbol] ?? 100.0;
      const id = setInterval(() => {
        price *= 1 + (Math.random() - 0.5) * 0.0008;
        callback({ price, ts: Date.now(), source: 'simulated' });
      }, 650);
      return () => clearInterval(id);
    },
  };
}

// ============================================================================
// Hub — primary + fallback chain with automatic failover
// ============================================================================
export function createHub(adapters) {
  if (!adapters.length) throw new Error('at least one adapter required');

  return {
    subscribe(symbol, callback) {
      // Try each adapter in order; on any error beyond a grace period, fall over
      let activeIdx = 0;
      let unsubActive = null;
      let lastTickTs = Date.now();
      const WATCHDOG_MS = 15_000;

      const wrappedCallback = (tick) => {
        lastTickTs = Date.now();
        callback(tick);
      };

      const pickAdapter = async () => {
        for (let i = activeIdx; i < adapters.length; i++) {
          const a = adapters[i];
          if (!a.symbols.includes(symbol)) continue;
          try {
            unsubActive = await a.subscribe(symbol, wrappedCallback);
            console.info(`[md-hub] ${symbol} -> ${a.name}`);
            activeIdx = i;
            return;
          } catch (e) {
            console.warn(`[md-hub] ${symbol} ${a.name} failed:`, e.message);
          }
        }
        console.error(`[md-hub] no adapter could subscribe to ${symbol}`);
      };

      pickAdapter();

      // Watchdog — if no ticks for WATCHDOG_MS, fail over to next adapter
      const watchdog = setInterval(() => {
        if (Date.now() - lastTickTs > WATCHDOG_MS) {
          console.warn(`[md-hub] ${symbol} watchdog fired, failing over`);
          if (unsubActive) unsubActive();
          activeIdx = Math.min(activeIdx + 1, adapters.length - 1);
          pickAdapter();
          lastTickTs = Date.now();
        }
      }, WATCHDOG_MS / 2);

      return () => {
        clearInterval(watchdog);
        if (unsubActive) unsubActive();
      };
    },
  };
}

// ============================================================================
// React hook — easy consumption
// ============================================================================
import { useEffect, useState } from 'react';

export function useMarketData(hub, symbol) {
  const [tick, setTick] = useState(null);
  useEffect(() => {
    if (!hub || !symbol) return;
    const unsub = hub.subscribe(symbol, setTick);
    return () => unsub();
  }, [hub, symbol]);
  return tick;
}
