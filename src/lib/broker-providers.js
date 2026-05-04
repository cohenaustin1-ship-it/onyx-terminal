// IMO Onyx Terminal — broker provider configs
//
// Phase 3p.18 file-splitting / extracted from JPMOnyxTerminal.jsx
// (originally lines ~982-1860).
//
// Multi-broker abstraction. Each provider implements a common contract:
//   {
//     id:        string identifier
//     label:     human-readable name
//     kind:      'gateway' | 'oauth' | 'cloud'
//     configFields: [{ key, label, placeholder, type, required }]
//     getStatus(config)
//     getAccounts(config)
//     getPositions(config, accountId)
//     placeOrder(config, accountId, params)
//     getQuote(config, symbol)
//   }
//
// Currently supported:
//   PAPER     — In-app simulated account (default, always available)
//   IBKR      — Interactive Brokers Client Portal Gateway (localhost)
//   TRADIER   — Cloud REST API
//   ALPACA    — Cloud REST API with paper + live endpoints
//   SCHWAB    — OAuth-based, server-side proxy required (3p.14)
//
// Storage:
//   imo_brokers         { [providerId]: { ...configFields } }
//   imo_active_broker   { providerId, accountId }
//   (helpers in src/lib/broker-storage.js)
//
// Honest scope:
//   - Real broker integration in production needs much more than
//     these adapters: rate-limit handling, partial-fill reconciliation,
//     order-state polling, error code mapping, paper-vs-live env
//     awareness, etc. The adapters here are good enough for the
//     common UX paths but not bullet-proof for high-frequency use.
//   - SCHWAB requires the server-side OAuth proxy from 3p.14.
//   - All cloud adapters use cacheGet/cacheSet for short-lived
//     position/quote caches to avoid hammering free-tier endpoints.

import { cacheGet, cacheSet } from './api-cache.js';
import { loadBrokerConfigs, saveBrokerConfigs } from './broker-storage.js';

// Alpaca env-var keys (duplicated from monolith — same source, separate read).
const ALPACA_KEY    = (() => { try { return import.meta.env?.VITE_ALPACA_KEY    ?? ''; } catch { return ''; } })();
const ALPACA_SECRET = (() => { try { return import.meta.env?.VITE_ALPACA_SECRET ?? ''; } catch { return ''; } })();

export const PROVIDER_PAPER = {
  id: 'paper',
  label: 'Paper account (in-app)',
  kind: 'cloud',
  description: 'Default in-app simulated account. No setup required, no real money.',
  configFields: [],
  getStatus: () => 'connected',
  getAccounts: () => [{ id: 'paper-default', label: 'Paper trading', type: 'paper', currency: 'USD' }],
  getPositions: () => null, // handled by the in-app account state
  placeOrder: () => ({ ok: false, error: 'Paper account orders go through the in-app trade engine, not the broker adapter.' }),
  getQuote: () => null,
};

export const PROVIDER_IBKR = {
  id: 'ibkr',
  label: 'Interactive Brokers (Client Portal)',
  kind: 'gateway',
  description: 'Routes through your locally-running IBKR Client Portal Gateway. Run clientportal.gw on your machine, log in once, then enter the gateway URL below.',
  configFields: [
    { key: 'gatewayUrl', label: 'Gateway URL', placeholder: 'https://localhost:5000', type: 'text', required: true,
      help: 'The URL where your locally-running Client Portal Gateway listens. Default https://localhost:5000.' },
  ],

  getStatus: async (config) => {
    const base = (config?.gatewayUrl || 'https://localhost:5000').replace(/\/$/, '');
    try {
      const r = await fetch(`${base}/v1/api/iserver/auth/status`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!r.ok) return 'error';
      const j = await r.json();
      // IBKR returns { authenticated, connected, competing, ... }
      if (j?.authenticated && j?.connected) return 'connected';
      return 'unauthenticated';
    } catch (e) {
      return 'error';
    }
  },

  // Tickle endpoint — keeps the session alive. IBKR sessions
  // expire after ~5 minutes of inactivity; calling this on a
  // timer keeps it open. Caller schedules.
  tickle: async (config) => {
    const base = (config?.gatewayUrl || 'https://localhost:5000').replace(/\/$/, '');
    try {
      await fetch(`${base}/v1/api/tickle`, {
        method: 'POST',
        credentials: 'include',
      });
      return true;
    } catch { return false; }
  },

  getAccounts: async (config) => {
    const base = (config?.gatewayUrl || 'https://localhost:5000').replace(/\/$/, '');
    try {
      const r = await fetch(`${base}/v1/api/iserver/accounts`, { credentials: 'include' });
      if (!r.ok) return null;
      const j = await r.json();
      // Response: { accounts: ['DU123456', ...], aliases: { ... } }
      return (j?.accounts ?? []).map(id => ({
        id,
        label: j?.aliases?.[id] || id,
        type:  id.startsWith('DU') ? 'paper' : 'live',  // DU prefix = demo/paper account
        currency: 'USD',
      }));
    } catch (e) {
      console.warn('[IBKR getAccounts]', e?.message);
      return null;
    }
  },

  getPositions: async (config, accountId) => {
    if (!accountId) return null;
    const base = (config?.gatewayUrl || 'https://localhost:5000').replace(/\/$/, '');
    try {
      const r = await fetch(`${base}/v1/api/portfolio/${encodeURIComponent(accountId)}/positions/0`, {
        credentials: 'include',
      });
      if (!r.ok) return null;
      const j = await r.json();
      // Response is an array of position objects
      return (Array.isArray(j) ? j : []).map(p => ({
        symbol:    p.contractDesc ?? p.ticker ?? '',
        conid:     p.conid,
        qty:       Number(p.position) || 0,
        avgPx:     Number(p.avgCost) || 0,
        mark:      Number(p.mktPrice) || 0,
        marketVal: Number(p.mktValue) || 0,
        unrealizedPnL: Number(p.unrealizedPnl) || 0,
        currency:  p.currency || 'USD',
        assetClass: p.assetClass,
      }));
    } catch (e) {
      console.warn('[IBKR getPositions]', e?.message);
      return null;
    }
  },

  // Resolve a symbol (like "AAPL") to an IBKR conid, which is
  // required for order placement. Cached briefly since conids
  // are stable for a given (symbol, exchange) pair.
  resolveConid: async (config, symbol) => {
    if (!symbol) return null;
    const cached = cacheGet(`ibkr:conid:${symbol}`, 60 * 60_000);
    if (cached) return cached;
    const base = (config?.gatewayUrl || 'https://localhost:5000').replace(/\/$/, '');
    try {
      const r = await fetch(`${base}/v1/api/iserver/secdef/search?symbol=${encodeURIComponent(symbol)}`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!r.ok) return null;
      const j = await r.json();
      // First match — IBKR returns ranked candidates
      const first = Array.isArray(j) ? j[0] : null;
      const conid = first?.conid;
      if (conid) cacheSet(`ibkr:conid:${symbol}`, conid);
      return conid ?? null;
    } catch (e) {
      console.warn('[IBKR resolveConid]', e?.message);
      return null;
    }
  },

  placeOrder: async (config, accountId, params) => {
    // params: { instrument, side, size, leverage, entryPrice, type? }
    if (!accountId) return { ok: false, error: 'No IBKR account selected' };
    const base = (config?.gatewayUrl || 'https://localhost:5000').replace(/\/$/, '');
    const symbol = params?.instrument?.id?.split('-')[0] ?? params?.symbol;
    if (!symbol) return { ok: false, error: 'No symbol' };
    // Resolve conid first
    const conid = await PROVIDER_IBKR.resolveConid(config, symbol);
    if (!conid) return { ok: false, error: `Could not resolve IBKR conid for ${symbol}` };
    const isLong = params.side === 'long' || params.side === 'buy';
    const isLimit = params.type === 'limit' && Number.isFinite(Number(params.entryPrice));
    const orderBody = {
      orders: [{
        acctId:     accountId,
        conid:      conid,
        secType:    `${conid}:STK`,
        orderType:  isLimit ? 'LMT' : 'MKT',
        side:       isLong ? 'BUY' : 'SELL',
        tif:        'DAY',
        quantity:   Math.abs(Number(params.size) || 0),
        ...(isLimit ? { price: Number(params.entryPrice) } : {}),
      }],
    };
    try {
      let r = await fetch(`${base}/v1/api/iserver/account/${encodeURIComponent(accountId)}/orders`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderBody),
      });
      if (!r.ok) {
        const errText = await r.text().catch(() => '');
        return { ok: false, error: `IBKR HTTP ${r.status}: ${errText.slice(0, 200)}` };
      }
      let j = await r.json();
      // IBKR returns an array. If any element has an `id` field,
      // it's a confirmation prompt that must be replied to. Walk
      // the chain auto-confirming up to 5 deep.
      let depth = 0;
      while (Array.isArray(j) && j.length > 0 && j[0]?.id && depth < 5) {
        const replyId = j[0].id;
        r = await fetch(`${base}/v1/api/iserver/reply/${encodeURIComponent(replyId)}`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirmed: true }),
        });
        if (!r.ok) {
          const errText = await r.text().catch(() => '');
          return { ok: false, error: `IBKR confirm HTTP ${r.status}: ${errText.slice(0, 200)}` };
        }
        j = await r.json();
        depth++;
      }
      // Success: array contains { order_id, order_status, ... }
      const submitted = Array.isArray(j) ? j[0] : j;
      if (submitted?.order_id) {
        return { ok: true, orderId: String(submitted.order_id), status: submitted.order_status, raw: submitted };
      }
      return { ok: false, error: `Unexpected IBKR response: ${JSON.stringify(j).slice(0, 200)}` };
    } catch (e) {
      return { ok: false, error: `IBKR placeOrder failed: ${e?.message}` };
    }
  },

  getQuote: async (config, symbol) => {
    if (!symbol) return null;
    const base = (config?.gatewayUrl || 'https://localhost:5000').replace(/\/$/, '');
    const conid = await PROVIDER_IBKR.resolveConid(config, symbol);
    if (!conid) return null;
    try {
      // Snapshot endpoint with bid/ask/last fields. fields=84 is
      // bid, 86 is ask, 31 is last. Quote needs to be primed first
      // by calling the endpoint twice (first call subscribes,
      // second call returns data — IBKR's quirk).
      const url = `${base}/v1/api/iserver/marketdata/snapshot?conids=${conid}&fields=84,86,31,7295`;
      await fetch(url, { credentials: 'include' });
      const r = await fetch(url, { credentials: 'include' });
      if (!r.ok) return null;
      const j = await r.json();
      const row = Array.isArray(j) ? j[0] : null;
      if (!row) return null;
      return {
        bid:  Number(row['84']) || null,
        ask:  Number(row['86']) || null,
        last: Number(row['31']) || null,
        ts:   Date.now(),
      };
    } catch (e) {
      console.warn('[IBKR getQuote]', e?.message);
      return null;
    }
  },
};

// Tradier broker adapter
//
// Tradier is a cloud-hosted brokerage API — straightforward Bearer
// auth, no local gateway required. Sandbox base URL gives paper
// trading; production base gives real money. Account types include
// margin, cash, and IRA.
//
// API docs:   https://documentation.tradier.com
// Sandbox:    https://sandbox.tradier.com  (paper)
// Production: https://api.tradier.com      (live)
//
// Endpoints used:
//   GET  /v1/user/profile          — verify auth + list accounts
//   GET  /v1/accounts/{id}/balances — cash/equity for the account
//   GET  /v1/accounts/{id}/positions — current positions
//   GET  /v1/markets/quotes?symbols=AAPL — bid/ask/last
//   POST /v1/accounts/{id}/orders   — submit order
//
// Tradier accepts content-type application/x-www-form-urlencoded
// for order POSTs (not JSON). All other endpoints are GET with
// JSON responses. Bearer token in Authorization header.
//
// Browser CORS note: Tradier's sandbox & production APIs both set
// permissive CORS headers, so the SPA can call them directly. No
// proxy required for development.
export const PROVIDER_TRADIER = {
  id: 'tradier',
  label: 'Tradier',
  kind: 'cloud',
  description: 'Cloud-hosted broker with API key auth. Supports stocks, options, ETFs. Sandbox endpoint gives paper trading; production gives real money. Get a key from developer.tradier.com.',
  configFields: [
    { key: 'apiKey', label: 'API token', placeholder: 'Bearer token from Tradier dashboard', type: 'password', required: true,
      help: 'Generate at developer.tradier.com → Profile → API tokens. Tokens are tied to either sandbox or production — switching requires a new token.' },
    { key: 'environment', label: 'Environment', placeholder: 'sandbox', type: 'select', required: true,
      options: [
        { value: 'sandbox',    label: 'Sandbox (paper trading)' },
        { value: 'production', label: 'Production (live trading)' },
      ],
      help: 'Sandbox uses simulated fills with delayed quotes. Switch to production only after testing with sandbox.' },
  ],

  // Helper — derive base URL from config.environment
  _baseUrl: (config) => {
    const env = config?.environment || 'sandbox';
    return env === 'production'
      ? 'https://api.tradier.com'
      : 'https://sandbox.tradier.com';
  },
  _headers: (config) => ({
    'Authorization': `Bearer ${config?.apiKey || ''}`,
    'Accept':        'application/json',
  }),

  getStatus: async (config) => {
    if (!config?.apiKey) return 'unauthenticated';
    const base = PROVIDER_TRADIER._baseUrl(config);
    try {
      // /user/profile is the canonical "is my key valid" check
      const r = await fetch(`${base}/v1/user/profile`, {
        headers: PROVIDER_TRADIER._headers(config),
      });
      if (r.status === 401) return 'unauthenticated';
      if (!r.ok) return 'error';
      return 'connected';
    } catch (e) {
      return 'error';
    }
  },

  getAccounts: async (config) => {
    if (!config?.apiKey) return null;
    const base = PROVIDER_TRADIER._baseUrl(config);
    try {
      const r = await fetch(`${base}/v1/user/profile`, {
        headers: PROVIDER_TRADIER._headers(config),
      });
      if (!r.ok) return null;
      const j = await r.json();
      // Response shape: { profile: { account: [...] | { ... } } }
      // Tradier returns a single object when there's one account,
      // an array when there are multiple — normalize.
      const raw = j?.profile?.account;
      const accounts = Array.isArray(raw) ? raw : raw ? [raw] : [];
      return accounts.map(a => ({
        id:       a.account_number,
        label:    `${a.account_number} · ${a.classification || 'individual'}`,
        type:     a.type === 'margin' ? 'margin' : a.type || 'cash',
        currency: 'USD',
      }));
    } catch (e) {
      console.warn('[Tradier getAccounts]', e?.message);
      return null;
    }
  },

  getPositions: async (config, accountId) => {
    if (!config?.apiKey || !accountId) return null;
    const base = PROVIDER_TRADIER._baseUrl(config);
    try {
      const r = await fetch(`${base}/v1/accounts/${encodeURIComponent(accountId)}/positions`, {
        headers: PROVIDER_TRADIER._headers(config),
      });
      if (!r.ok) return null;
      const j = await r.json();
      // Response: { positions: { position: [...] | { ... } | "null" } }
      // Tradier sends "null" string when there are no positions, the
      // single-position object when there's one, an array otherwise.
      const raw = j?.positions?.position;
      if (!raw || raw === 'null') return [];
      const list = Array.isArray(raw) ? raw : [raw];
      return list.map(p => ({
        symbol:    p.symbol,
        qty:       Number(p.quantity) || 0,
        avgPx:     Number(p.cost_basis) / (Number(p.quantity) || 1),
        // Tradier doesn't return current mark in positions endpoint —
        // would need a separate quote call. Leave null; the UI shows
        // the entry price + "—" for live mark.
        mark:      null,
        marketVal: null,
        unrealizedPnL: null,
        currency:  'USD',
        dateAcquired: p.date_acquired,
      }));
    } catch (e) {
      console.warn('[Tradier getPositions]', e?.message);
      return null;
    }
  },

  placeOrder: async (config, accountId, params) => {
    if (!config?.apiKey) return { ok: false, error: 'Tradier API token missing' };
    if (!accountId)      return { ok: false, error: 'No Tradier account selected' };
    const base = PROVIDER_TRADIER._baseUrl(config);
    const symbol = params?.instrument?.id?.split('-')[0] ?? params?.symbol;
    if (!symbol) return { ok: false, error: 'No symbol' };
    const isLong = params.side === 'long' || params.side === 'buy';
    const isLimit = params.type === 'limit' && Number.isFinite(Number(params.entryPrice));
    // Tradier order params (form-encoded body):
    //   class:    'equity' | 'option' | 'multileg'
    //   symbol:   ticker
    //   side:     'buy' | 'sell' (or 'buy_to_cover'/'sell_short' for shorts)
    //   quantity: shares
    //   type:     'market' | 'limit' | 'stop' | 'stop_limit'
    //   duration: 'day' | 'gtc'
    //   price:    only for limit orders
    // Tradier sides:
    //   'buy'           — open or add to a long position
    //   'sell'          — close (or partial close) a long position
    //   'sell_short'    — open or add to a short position
    //   'buy_to_cover'  — close (or partial close) a short position
    // Pick the right one based on the resolved intent (if present).
    // If intent is missing (e.g. position lookup not yet warm),
    // fall back to the raw side and Tradier will reject the order
    // if it's a mismatch — better than silently routing a close
    // as a short open.
    const tradierSide = (() => {
      if (params.intent === 'open-long' || params.intent === 'add-long') return 'buy';
      if (params.intent === 'close-long')  return 'sell';
      if (params.intent === 'open-short' || params.intent === 'add-short') return 'sell_short';
      if (params.intent === 'close-short') return 'buy_to_cover';
      if (params.intent === 'reverse') {
        // For reversals, Tradier doesn't support a single order that
        // both closes and opens — would need two orders. v1 punts:
        // submit the new direction and rely on broker margin to flag.
        return isLong ? 'buy' : 'sell_short';
      }
      // No intent context — best guess by raw side
      return isLong ? 'buy' : 'sell_short';
    })();
    const formBody = new URLSearchParams();
    formBody.set('class', 'equity');
    formBody.set('symbol', symbol);
    formBody.set('side', tradierSide);
    formBody.set('quantity', String(Math.abs(Number(params.size) || 0)));
    formBody.set('type', isLimit ? 'limit' : 'market');
    formBody.set('duration', 'day');
    if (isLimit) formBody.set('price', String(Number(params.entryPrice)));
    try {
      const r = await fetch(`${base}/v1/accounts/${encodeURIComponent(accountId)}/orders`, {
        method:  'POST',
        headers: {
          ...PROVIDER_TRADIER._headers(config),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formBody.toString(),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        const errMsg = j?.errors?.error?.[0] || j?.error || j?.fault?.faultstring || `HTTP ${r.status}`;
        return { ok: false, error: `Tradier: ${errMsg}` };
      }
      // Success: { order: { id, status, partner_id } }
      const orderId = j?.order?.id;
      if (orderId) {
        return { ok: true, orderId: String(orderId), status: j.order.status, raw: j.order };
      }
      return { ok: false, error: `Unexpected Tradier response: ${JSON.stringify(j).slice(0, 200)}` };
    } catch (e) {
      return { ok: false, error: `Tradier placeOrder failed: ${e?.message}` };
    }
  },

  getQuote: async (config, symbol) => {
    if (!config?.apiKey || !symbol) return null;
    const base = PROVIDER_TRADIER._baseUrl(config);
    try {
      const r = await fetch(`${base}/v1/markets/quotes?symbols=${encodeURIComponent(symbol)}`, {
        headers: PROVIDER_TRADIER._headers(config),
      });
      if (!r.ok) return null;
      const j = await r.json();
      // Response: { quotes: { quote: { ... } | [...] } }
      const raw = j?.quotes?.quote;
      const q = Array.isArray(raw) ? raw[0] : raw;
      if (!q) return null;
      return {
        bid:  Number(q.bid)  || null,
        ask:  Number(q.ask)  || null,
        last: Number(q.last) || null,
        ts:   Date.now(),
      };
    } catch (e) {
      console.warn('[Tradier getQuote]', e?.message);
      return null;
    }
  },
};

// Alpaca broker adapter
//
// Alpaca is a commission-free cloud broker with a clean REST API.
// Auth is by API key + secret (two headers). Like Tradier, separate
// paper and live endpoints; tokens are environment-specific.
//
// API docs: https://alpaca.markets/docs/api-references/
// Paper:    https://paper-api.alpaca.markets
// Live:     https://api.alpaca.markets
//
// Endpoints used:
//   GET  /v2/account               — auth check + account info
//   GET  /v2/positions             — current positions
//   GET  /v2/positions/{symbol}    — single position lookup
//   GET  /v2/stocks/{symbol}/quotes/latest
//   POST /v2/orders                — submit order (JSON body)
//
// Alpaca's API has CORS configured for browser access.
export const PROVIDER_ALPACA = {
  id: 'alpaca',
  label: 'Alpaca',
  kind: 'cloud',
  description: 'Commission-free cloud broker. API key + secret auth, separate paper/live endpoints. Get keys at alpaca.markets/dashboard.',
  configFields: [
    { key: 'apiKey',    label: 'API key',    placeholder: 'PK… or AK…',   type: 'password', required: true,
      help: 'API Key ID from Alpaca dashboard. Paper keys start with PK, live with AK.' },
    { key: 'apiSecret', label: 'API secret', placeholder: 'Secret value', type: 'password', required: true,
      help: 'Secret value, shown ONCE when key was generated. Save it; can\'t be re-retrieved.' },
    { key: 'environment', label: 'Environment', placeholder: 'paper', type: 'select', required: true,
      options: [
        { value: 'paper', label: 'Paper trading' },
        { value: 'live',  label: 'Live trading' },
      ],
      help: 'Paper and live use separate API key pairs. Make sure your keys match the environment.' },
  ],
  _baseUrl: (config) => config?.environment === 'live'
    ? 'https://api.alpaca.markets'
    : 'https://paper-api.alpaca.markets',
  _dataUrl: () => 'https://data.alpaca.markets',
  _headers: (config) => ({
    'APCA-API-KEY-ID':     config?.apiKey || '',
    'APCA-API-SECRET-KEY': config?.apiSecret || '',
    'Accept':              'application/json',
  }),

  getStatus: async (config) => {
    if (!config?.apiKey || !config?.apiSecret) return 'unauthenticated';
    try {
      const r = await fetch(`${PROVIDER_ALPACA._baseUrl(config)}/v2/account`, {
        headers: PROVIDER_ALPACA._headers(config),
      });
      if (r.status === 401 || r.status === 403) return 'unauthenticated';
      if (!r.ok) return 'error';
      return 'connected';
    } catch (e) {
      return 'error';
    }
  },

  getAccounts: async (config) => {
    // Alpaca exposes a single account per key pair — there's no
    // multi-account API. So we synthesize one entry from /v2/account.
    if (!config?.apiKey || !config?.apiSecret) return null;
    try {
      const r = await fetch(`${PROVIDER_ALPACA._baseUrl(config)}/v2/account`, {
        headers: PROVIDER_ALPACA._headers(config),
      });
      if (!r.ok) return null;
      const j = await r.json();
      return [{
        id:       j.account_number || j.id || 'alpaca',
        label:    `${j.account_number || 'Alpaca'} · ${j.status || ''}`.trim(),
        type:     config.environment === 'live' ? 'live' : 'paper',
        currency: j.currency || 'USD',
      }];
    } catch (e) {
      console.warn('[Alpaca getAccounts]', e?.message);
      return null;
    }
  },

  getPositions: async (config /*, accountId */) => {
    if (!config?.apiKey || !config?.apiSecret) return null;
    try {
      const r = await fetch(`${PROVIDER_ALPACA._baseUrl(config)}/v2/positions`, {
        headers: PROVIDER_ALPACA._headers(config),
      });
      if (!r.ok) return null;
      const list = await r.json();
      return (Array.isArray(list) ? list : []).map(p => ({
        symbol:    p.symbol,
        qty:       Number(p.qty) || 0,
        avgPx:     Number(p.avg_entry_price) || 0,
        mark:      Number(p.current_price) || null,
        marketVal: Number(p.market_value) || null,
        unrealizedPnL: Number(p.unrealized_pl) || null,
        currency:  'USD',
        side:      p.side, // 'long' | 'short' — Alpaca exposes this directly
      }));
    } catch (e) {
      console.warn('[Alpaca getPositions]', e?.message);
      return null;
    }
  },

  placeOrder: async (config, accountId, params) => {
    if (!config?.apiKey || !config?.apiSecret) return { ok: false, error: 'Alpaca credentials missing' };
    const symbol = params?.instrument?.id?.split('-')[0] ?? params?.symbol;
    if (!symbol) return { ok: false, error: 'No symbol' };
    const isLong = params.side === 'long' || params.side === 'buy';
    const isLimit = params.type === 'limit' && Number.isFinite(Number(params.entryPrice));
    // Alpaca order body — JSON, not form-encoded:
    //   symbol, qty, side: 'buy'|'sell', type: 'market'|'limit'|...,
    //   time_in_force: 'day'|'gtc'|'ioc'|'fok', limit_price?, stop_price?
    // For shorts, Alpaca uses side='sell' on a long-side instrument
    // and the broker handles the short-sell automatically (account
    // must be approved for shorts). We pass intended-side here; if
    // the user is opening a short via our UI, side='sell' on a
    // symbol they don't own = short open. Alpaca's marginal-account
    // handles the rest.
    // Alpaca side resolution from intent:
    //   open-long, add-long, close-short  → 'buy'
    //   open-short, add-short, close-long → 'sell'
    // Alpaca treats 'sell' as either a close (if you have a long
    // position) or an opening short (if you don't or you're already
    // short and your account allows). With intent we can prefer the
    // explicit interpretation; without intent we fall back to side.
    const alpacaSide = (() => {
      if (params.intent === 'open-long' || params.intent === 'add-long' || params.intent === 'close-short') return 'buy';
      if (params.intent === 'open-short' || params.intent === 'add-short' || params.intent === 'close-long') return 'sell';
      return isLong ? 'buy' : 'sell';
    })();
    const body = {
      symbol,
      qty:           String(Math.abs(Number(params.size) || 0)),
      side:          alpacaSide,
      type:          isLimit ? 'limit' : 'market',
      time_in_force: 'day',
      ...(isLimit ? { limit_price: String(Number(params.entryPrice)) } : {}),
    };
    try {
      const r = await fetch(`${PROVIDER_ALPACA._baseUrl(config)}/v2/orders`, {
        method: 'POST',
        headers: { ...PROVIDER_ALPACA._headers(config), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        return { ok: false, error: `Alpaca: ${j?.message || j?.error || `HTTP ${r.status}`}` };
      }
      return { ok: true, orderId: String(j.id), status: j.status, raw: j };
    } catch (e) {
      return { ok: false, error: `Alpaca placeOrder failed: ${e?.message}` };
    }
  },

  getQuote: async (config, symbol) => {
    if (!config?.apiKey || !config?.apiSecret || !symbol) return null;
    try {
      // Note: market data endpoint is data.alpaca.markets, NOT the
      // trading endpoint. Same headers, different host.
      const r = await fetch(`${PROVIDER_ALPACA._dataUrl()}/v2/stocks/${encodeURIComponent(symbol)}/quotes/latest`, {
        headers: PROVIDER_ALPACA._headers(config),
      });
      if (!r.ok) return null;
      const j = await r.json();
      const q = j?.quote;
      if (!q) return null;
      return {
        bid:  Number(q.bp) || null,
        ask:  Number(q.ap) || null,
        last: null, // not in latest-quote endpoint; would need /trades/latest
        ts:   Date.now(),
      };
    } catch (e) {
      console.warn('[Alpaca getQuote]', e?.message);
      return null;
    }
  },
};

// Charles Schwab broker adapter
//
// Schwab's API uses OAuth2 with short-lived access tokens (30 min)
// and refresh tokens (7 days). Direct SPA integration is awkward
// because:
//   1. The OAuth flow needs a registered redirect URI
//   2. Schwab CORS is restrictive — direct browser calls to most
//      endpoints are rejected
//   3. Refresh tokens must be securely stored
//
// Realistic browser-direct integration: user runs the OAuth flow
// externally (Schwab's developer portal has a getting-started flow
// with curl examples), pastes the resulting access + refresh
// tokens into our config, and we use them. When the access token
// expires, we exchange the refresh token for a new one. When the
// refresh token expires, the user re-runs the OAuth flow.
//
// For users who want fully-automated OAuth: route through a
// backend proxy (the existing zeroclaw service is the place).
// That's a future drop. For v1 we ship the manual-token flow so
// developer-account users can wire up Schwab today.
//
// API docs: https://developer.schwab.com/products/trader-api--individual
// Base:     https://api.schwabapi.com/trader/v1
export const PROVIDER_SCHWAB = {
  id: 'schwab',
  label: 'Charles Schwab',
  kind: 'oauth',
  description: 'Schwab Trader API. OAuth2 with refresh-token rotation. Browser-direct integration requires you to run the initial OAuth flow externally and paste the tokens here. For fully-automated OAuth, route through a backend proxy.',
  configFields: [
    { key: 'accessToken',  label: 'Access token',  placeholder: 'Bearer access token', type: 'password', required: true,
      help: 'Schwab OAuth2 access token. Expires every 30 minutes — when it does, paste a fresh one or use the refresh token below.' },
    { key: 'refreshToken', label: 'Refresh token', placeholder: 'Long-lived refresh token', type: 'password', required: false,
      help: 'Optional. Used to auto-renew the access token without re-running OAuth. Refresh tokens themselves expire after 7 days.' },
    { key: 'clientId',     label: 'App key (client ID)', placeholder: 'From Schwab developer portal', type: 'text', required: false,
      help: 'Required for refresh-token rotation. Get it from your registered app at developer.schwab.com.' },
    { key: 'clientSecret', label: 'App secret', placeholder: 'From Schwab developer portal', type: 'password', required: false,
      help: 'Required for refresh-token rotation. Pair with the App key.' },
  ],
  _baseUrl: () => 'https://api.schwabapi.com/trader/v1',
  _headers: (config) => ({
    'Authorization': `Bearer ${config?.accessToken || ''}`,
    'Accept':        'application/json',
  }),

  // Refresh the access token using the refresh token. Returns the
  // new access token, or null if refresh fails. Caller persists
  // the new token to config.
  _refreshAccessToken: async (config) => {
    if (!config?.refreshToken || !config?.clientId || !config?.clientSecret) return null;
    try {
      const credentials = btoa(`${config.clientId}:${config.clientSecret}`);
      const r = await fetch('https://api.schwabapi.com/v1/oauth/token', {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${credentials}`,
          'Content-Type':  'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type:    'refresh_token',
          refresh_token: config.refreshToken,
        }).toString(),
      });
      if (!r.ok) return null;
      const j = await r.json();
      return j?.access_token || null;
    } catch (e) {
      console.warn('[Schwab refresh]', e?.message);
      return null;
    }
  },

  getStatus: async (config) => {
    if (!config?.accessToken) return 'unauthenticated';
    try {
      const r = await fetch(`${PROVIDER_SCHWAB._baseUrl()}/accounts/accountNumbers`, {
        headers: PROVIDER_SCHWAB._headers(config),
      });
      if (r.status === 401) {
        // Try a refresh if we have the materials
        const fresh = await PROVIDER_SCHWAB._refreshAccessToken(config);
        if (fresh) {
          // Persist the fresh token so subsequent calls use it
          const cfg = loadBrokerConfigs();
          cfg.schwab = { ...(cfg.schwab || {}), accessToken: fresh };
          saveBrokerConfigs(cfg);
          return 'connected';
        }
        return 'unauthenticated';
      }
      if (!r.ok) return 'error';
      return 'connected';
    } catch (e) {
      return 'error';
    }
  },

  getAccounts: async (config) => {
    if (!config?.accessToken) return null;
    try {
      const r = await fetch(`${PROVIDER_SCHWAB._baseUrl()}/accounts/accountNumbers`, {
        headers: PROVIDER_SCHWAB._headers(config),
      });
      if (!r.ok) return null;
      const list = await r.json();
      // Response: [{ accountNumber, hashValue }, ...]
      // hashValue is the obfuscated id used in subsequent API calls.
      return (Array.isArray(list) ? list : []).map(a => ({
        id:       a.hashValue || a.accountNumber,
        label:    a.accountNumber,
        type:     'live',  // Schwab Trader API is production-only; no sandbox env
        currency: 'USD',
      }));
    } catch (e) {
      console.warn('[Schwab getAccounts]', e?.message);
      return null;
    }
  },

  getPositions: async (config, accountId) => {
    if (!config?.accessToken || !accountId) return null;
    try {
      const r = await fetch(`${PROVIDER_SCHWAB._baseUrl()}/accounts/${encodeURIComponent(accountId)}?fields=positions`, {
        headers: PROVIDER_SCHWAB._headers(config),
      });
      if (!r.ok) return null;
      const j = await r.json();
      // Response: { securitiesAccount: { positions: [...] } }
      const list = j?.securitiesAccount?.positions ?? [];
      return list.map(p => ({
        symbol:    p?.instrument?.symbol || '',
        qty:       (Number(p.longQuantity) || 0) - (Number(p.shortQuantity) || 0),
        avgPx:     Number(p.averagePrice) || 0,
        mark:      Number(p.marketValue) && Number(p.longQuantity) ? Number(p.marketValue) / Number(p.longQuantity) : null,
        marketVal: Number(p.marketValue) || null,
        unrealizedPnL: Number(p.currentDayProfitLoss) || null,
        currency:  'USD',
        side:      Number(p.longQuantity) > 0 ? 'long' : 'short',
      }));
    } catch (e) {
      console.warn('[Schwab getPositions]', e?.message);
      return null;
    }
  },

  placeOrder: async (config, accountId, params) => {
    if (!config?.accessToken) return { ok: false, error: 'Schwab access token missing' };
    if (!accountId)           return { ok: false, error: 'No Schwab account selected' };
    const symbol = params?.instrument?.id?.split('-')[0] ?? params?.symbol;
    if (!symbol) return { ok: false, error: 'No symbol' };
    const isLong = params.side === 'long' || params.side === 'buy';
    const isLimit = params.type === 'limit' && Number.isFinite(Number(params.entryPrice));
    // Schwab order body — JSON. Order types are EQUITY for stocks.
    // instruction: BUY | SELL | SELL_SHORT | BUY_TO_COVER
    // Pick the right instruction based on intent; if absent, fall
    // back to the raw side. Schwab will reject mismatches (e.g.
    // SELL_SHORT against existing long) which is better than the
    // silent routing of a close-long as a short-open.
    const schwabInstruction = (() => {
      if (params.intent === 'open-long' || params.intent === 'add-long') return 'BUY';
      if (params.intent === 'close-long')  return 'SELL';
      if (params.intent === 'open-short' || params.intent === 'add-short') return 'SELL_SHORT';
      if (params.intent === 'close-short') return 'BUY_TO_COVER';
      if (params.intent === 'reverse')     return isLong ? 'BUY' : 'SELL_SHORT';
      return isLong ? 'BUY' : 'SELL_SHORT';
    })();
    const body = {
      orderType: isLimit ? 'LIMIT' : 'MARKET',
      session:   'NORMAL',
      duration:  'DAY',
      orderStrategyType: 'SINGLE',
      ...(isLimit ? { price: String(Number(params.entryPrice)) } : {}),
      orderLegCollection: [{
        instruction: schwabInstruction,
        quantity: Math.abs(Number(params.size) || 0),
        instrument: { symbol, assetType: 'EQUITY' },
      }],
    };
    try {
      const r = await fetch(`${PROVIDER_SCHWAB._baseUrl()}/accounts/${encodeURIComponent(accountId)}/orders`, {
        method: 'POST',
        headers: { ...PROVIDER_SCHWAB._headers(config), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const errText = await r.text().catch(() => '');
        return { ok: false, error: `Schwab HTTP ${r.status}: ${errText.slice(0, 200)}` };
      }
      // Schwab returns 201 Created with Location header — parse the order id
      const loc = r.headers.get('Location') || r.headers.get('location') || '';
      const orderId = loc.split('/').pop() || `schwab-${Date.now()}`;
      return { ok: true, orderId, status: 'submitted' };
    } catch (e) {
      return { ok: false, error: `Schwab placeOrder failed: ${e?.message}` };
    }
  },

  getQuote: async (config, symbol) => {
    if (!config?.accessToken || !symbol) return null;
    try {
      // Schwab's market data endpoint is /marketdata/v1, separate from /trader/v1
      const r = await fetch(`https://api.schwabapi.com/marketdata/v1/${encodeURIComponent(symbol)}/quotes`, {
        headers: PROVIDER_SCHWAB._headers(config),
      });
      if (!r.ok) return null;
      const j = await r.json();
      const q = j?.[symbol]?.quote;
      if (!q) return null;
      return {
        bid:  Number(q.bidPrice) || null,
        ask:  Number(q.askPrice) || null,
        last: Number(q.lastPrice) || null,
        ts:   Date.now(),
      };
    } catch (e) {
      console.warn('[Schwab getQuote]', e?.message);
      return null;
    }
  },
};

// Robinhood adapter — intentionally NOT shipped.
//
// Robinhood does not offer a public trading API. Their unofficial
// API requires:
//   - Username + password posted from the browser
//   - SMS or email MFA challenge response
//   - A device fingerprint header
// Putting a username/password form for a third-party brokerage in
// our SPA would be a phishing-grade UX even if our intent is clean,
// because users have no way to verify our code isn't exfiltrating
// their credentials. The right way to integrate Robinhood is
// through OAuth, which they don't offer to retail.
//
// If Robinhood ever ships a real API, an adapter goes here. Until
// then we leave it out and document the reason rather than hide it.
//
// Users who want to route Robinhood orders through this terminal
// should consider Tradier (better API, similar zero-commission
// economics) or Alpaca (full programmatic broker).

export const BROKER_PROVIDERS = [
  PROVIDER_PAPER,
  PROVIDER_IBKR,
  PROVIDER_TRADIER,
  PROVIDER_ALPACA,
  PROVIDER_SCHWAB,
];
export const getBrokerProvider = (id) => BROKER_PROVIDERS.find(p => p.id === id) ?? null;
