// IMO Onyx Terminal — Polygon API integrations
//
// Phase 3p.18 file-splitting / extracted from JPMOnyxTerminal.jsx
// (originally lines ~1006-1595).
//
// Polygon.io is the primary equity data source — financials,
// short interest, quotes, recent trades, ticker details, market
// movers, sector maps, and aggregated bars. Replaces hardcoded
// fixtures used in earlier dev builds.
//
// Public exports:
//   fetchPolygonFinancials(ticker)
//   fetchPolygonShortInterest(ticker)
//   fetchPolygonLastQuote(ticker)
//   fetchPolygonRecentTrades(ticker, limit)
//   reconstructOrderBookFromTrades(trades, nbbo, binCount)
//   deriveFundamentalsFromPolygon(financials, details, currentPrice)
//   fetchPolygonTickerDetails(ticker)
//   fetchPolygonMovers(direction)
//   SECTOR_ETF_MAP
//   fetchPolygonSectorMap()
//   SECTOR_CONSTITUENTS
//   fetchPolygonMarketMap()
//   fetchPolygonAggs(ticker, days, span, mult)
//
// All cloud calls cache via api-cache.js. Cache TTLs are tuned per
// data type: financials/short-interest 6h (slow-changing), sector
// maps 30min, quotes/trades cached for ~5s only.
//
// Honest scope:
//   - Polygon's free tier rate-limits to 5 calls/min. Cache TTLs
//     here are aggressive enough to stay under that during normal
//     UX patterns, but a "scan 30 tickers in a row" workflow will
//     hit the limit. The fetchers all return null on 429s rather
//     than throwing.
//   - reconstructOrderBookFromTrades is a heuristic — Polygon doesn't
//     publish a full L2 book at the free tier, so we synthesize one
//     from recent trades + NBBO. Good enough for visual display, NOT
//     for executing decisions.

import { cacheGet, cacheSet } from './api-cache.js';

// MASSIVE_API_KEY (Polygon key) duplicated from monolith — same source,
// separate read.
const MASSIVE_API_KEY = (() => { try { return import.meta.env?.VITE_MASSIVE_API_KEY ?? ''; } catch { return ''; } })();

export const fetchPolygonFinancials = async (ticker) => {
  if (!MASSIVE_API_KEY || !ticker) return null;
  const cached = cacheGet(`fin:${ticker}`, 6 * 60 * 60_000);
  if (cached) return cached;
  try {
    const url = `https://api.polygon.io/vX/reference/financials?ticker=${ticker}&limit=4&order=desc&apiKey=${MASSIVE_API_KEY}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const results = j?.results ?? [];
    if (results.length === 0) return null;
    // Map to a normalized shape — first row is most recent
    const out = results.map(rec => {
      const f = rec?.financials ?? {};
      const inc = f.income_statement ?? {};
      const bal = f.balance_sheet ?? {};
      const cf  = f.cash_flow_statement ?? {};
      const v = (k, src) => (src?.[k]?.value != null ? src[k].value : null);
      return {
        period:        rec.fiscal_period ?? rec.timeframe ?? '',
        year:          rec.fiscal_year   ?? rec.fiscal_period_end?.slice(0, 4),
        endDate:       rec.end_date,
        startDate:     rec.start_date,
        filingDate:    rec.filing_date,
        sourceFiling:  rec.source_filing_url,
        revenue:       v('revenues', inc),
        costOfRevenue: v('cost_of_revenue', inc),
        grossProfit:   v('gross_profit', inc),
        operatingIncome: v('operating_income_loss', inc),
        netIncome:     v('net_income_loss', inc),
        eps:           v('basic_earnings_per_share', inc),
        epsDiluted:    v('diluted_earnings_per_share', inc),
        totalAssets:   v('assets', bal),
        totalLiabilities: v('liabilities', bal),
        totalEquity:   v('equity', bal),
        cashAndEquivalents: v('cash_and_equivalents', bal) ?? v('cash_and_cash_equivalents', bal),
        opCashFlow:    v('net_cash_flow_from_operating_activities', cf),
        invCashFlow:   v('net_cash_flow_from_investing_activities', cf),
        finCashFlow:   v('net_cash_flow_from_financing_activities', cf),
      };
    });
    cacheSet(`fin:${ticker}`, out);
    return out;
  } catch (e) {
    console.warn('[Polygon financials]', e.message);
    return null;
  }
};

// fetchPolygonShortInterest — fetch the most recent reported short
// interest data per FINRA settlement cycle. Polygon's
// /stocks/v1/short-interest endpoint returns:
//   - settlement_date     bi-monthly FINRA settlement date
//   - short_interest      shares short
//   - days_to_cover       SI / avg daily volume
//   - avg_daily_volume    averaged over reporting period
// Returns null if API key missing or ticker not covered.
export const fetchPolygonShortInterest = async (ticker) => {
  if (!MASSIVE_API_KEY || !ticker) return null;
  const cached = cacheGet(`shortint:${ticker}`, 6 * 60 * 60_000); // 6h cache
  if (cached) return cached;
  try {
    // Newer Polygon endpoint shape; also try the legacy path as fallback
    const candidates = [
      `https://api.polygon.io/stocks/v1/short-interest?ticker=${ticker}&limit=4&apiKey=${MASSIVE_API_KEY}`,
      `https://api.polygon.io/v2/reference/short-interest/${ticker}?limit=4&apiKey=${MASSIVE_API_KEY}`,
    ];
    let body = null;
    for (const url of candidates) {
      try {
        const r = await fetch(url);
        if (r.ok) {
          body = await r.json();
          if (body?.results?.length > 0) break;
        }
      } catch {}
    }
    const results = body?.results;
    if (!Array.isArray(results) || results.length === 0) return null;
    // Sort by settlement date desc; latest first
    const sorted = results.slice().sort((a, b) => {
      const da = new Date(a.settlement_date || a.settlementDate || 0).getTime();
      const db = new Date(b.settlement_date || b.settlementDate || 0).getTime();
      return db - da;
    });
    const latest = sorted[0];
    const prior = sorted[1] || null;
    const sharesShort = Number(latest.short_interest || latest.shortInterest || 0);
    const avgVol = Number(latest.avg_daily_volume || latest.avgDailyVolume || 0);
    const dtc = Number(latest.days_to_cover || latest.daysToCover || (avgVol > 0 ? sharesShort / avgVol : 0));
    const priorShort = prior ? Number(prior.short_interest || prior.shortInterest || 0) : 0;
    const recentChange = priorShort > 0 ? (sharesShort - priorShort) / priorShort : 0;
    const out = {
      sharesShort,
      avgDailyVolume: avgVol,
      daysToCover: dtc,
      settlementDate: latest.settlement_date || latest.settlementDate,
      priorShort,
      recentChange, // fractional change
      history: sorted.slice(0, 4),
      _source: 'polygon-live',
    };
    cacheSet(`shortint:${ticker}`, out);
    return out;
  } catch (e) {
    console.warn('[Polygon short-interest]', e.message);
    return null;
  }
};

// fetchPolygonLastQuote — fetch the most recent NBBO (best bid/ask)
// for a ticker. Snapshot endpoint returns top-of-book; deeper L2
// requires paid plans + websocket. Returns null on failure.
export const fetchPolygonLastQuote = async (ticker) => {
  if (!MASSIVE_API_KEY || !ticker) return null;
  const cached = cacheGet(`quote:${ticker}`, 5_000); // 5s cache, this is real-time data
  if (cached) return cached;
  try {
    const url = `https://api.polygon.io/v2/last/nbbo/${ticker}?apiKey=${MASSIVE_API_KEY}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const q = j?.results;
    if (!q) return null;
    const out = {
      bid: q.p ?? q.bid,
      bidSize: q.s ?? q.bidSize,
      ask: q.P ?? q.ask,
      askSize: q.S ?? q.askSize,
      bidExchange: q.x,
      askExchange: q.X,
      ts: q.t ?? q.timestamp,
      // Spread + mid-price computed for convenience
      spread: ((q.P ?? q.ask) - (q.p ?? q.bid)),
      mid: ((q.P ?? q.ask) + (q.p ?? q.bid)) / 2,
    };
    cacheSet(`quote:${ticker}`, out);
    return out;
  } catch (e) {
    console.warn('[Polygon NBBO]', e.message);
    return null;
  }
};

// fetchPolygonRecentTrades — pull last N trades for a ticker. Used
// to reconstruct an approximate order book from execution flow:
// recent trades clustered near the bid show selling pressure;
// near the ask show buying pressure.
export const fetchPolygonRecentTrades = async (ticker, limit = 100) => {
  if (!MASSIVE_API_KEY || !ticker) return [];
  const cached = cacheGet(`trades:${ticker}:${limit}`, 30_000);
  if (cached) return cached;
  try {
    const url = `https://api.polygon.io/v3/trades/${ticker}?limit=${limit}&order=desc&apiKey=${MASSIVE_API_KEY}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const out = (j?.results || []).map(t => ({
      price: t.price,
      size: t.size,
      ts: t.participant_timestamp ?? t.sip_timestamp ?? t.t,
      exchange: t.exchange,
      conditions: t.conditions || [],
    }));
    cacheSet(`trades:${ticker}:${limit}`, out);
    return out;
  } catch (e) {
    console.warn('[Polygon trades]', e.message);
    return [];
  }
};

// reconstructOrderBookFromTrades — given recent trade tape + NBBO,
// builds an approximate order book by binning trades by price level.
// Trades closer to bid tend to be sells (price-takers hitting bid);
// trades closer to ask tend to be buys (price-takers lifting offer).
//
// This is NOT a true L2 book — it's a back-of-envelope reconstruction
// from public trade data. Real L2 requires paid feeds. For our purposes
// it's a useful liquidity visualization.
export const reconstructOrderBookFromTrades = (trades, nbbo, binCount = 20) => {
  if (!Array.isArray(trades) || trades.length === 0) return null;
  if (!nbbo || !Number.isFinite(nbbo.bid) || !Number.isFinite(nbbo.ask)) return null;
  const mid = nbbo.mid;
  const spread = nbbo.spread;
  // Use ±5 spreads from mid as the price range
  const priceRange = Math.max(spread * 5, mid * 0.005); // at least 0.5%
  const minP = mid - priceRange;
  const maxP = mid + priceRange;
  const binW = (maxP - minP) / binCount;
  // Build empty bins
  const bidBins = [];
  const askBins = [];
  for (let i = 0; i < binCount; i++) {
    const priceLow = minP + i * binW;
    const priceMid = priceLow + binW / 2;
    if (priceMid < mid) {
      bidBins.push({ priceMid, priceLow, priceHigh: priceLow + binW, size: 0, trades: 0 });
    } else {
      askBins.push({ priceMid, priceLow, priceHigh: priceLow + binW, size: 0, trades: 0 });
    }
  }
  // Bucket trades by price level
  for (const t of trades) {
    if (!Number.isFinite(t.price) || !Number.isFinite(t.size) || t.size <= 0) continue;
    if (t.price < minP || t.price > maxP) continue;
    const target = t.price < mid ? bidBins : askBins;
    for (const bin of target) {
      if (t.price >= bin.priceLow && t.price < bin.priceHigh) {
        bin.size += t.size;
        bin.trades++;
        break;
      }
    }
  }
  return {
    bidBins: bidBins.slice().reverse(), // highest bid first
    askBins,
    mid,
    spread,
    binWidth: binW,
    totalTrades: trades.length,
    // Cumulative size on each side — proxy for visible liquidity
    bidCumulative: bidBins.reduce((s, b) => s + b.size, 0),
    askCumulative: askBins.reduce((s, b) => s + b.size, 0),
  };
};

// deriveFundamentalsFromPolygon — computes ratio snapshot from raw
// Polygon financials + ticker details. The Polygon /financials
// endpoint returns absolute numbers (revenue, equity, FCF) but not
// ratios; this function does the arithmetic to produce the same
// shape as CURATED_FUNDAMENTALS so screening/display code can be
// uniform across live + curated sources.
//
// Returns null if essential numerator/denominator data is missing
// (e.g. negative equity makes some ratios meaningless).
export const deriveFundamentalsFromPolygon = (financials, details, currentPrice) => {
  if (!Array.isArray(financials) || financials.length === 0) return null;
  if (!details) return null;
  const latest = financials[0];
  if (!latest) return null;
  // Sum the most recent 4 quarters where available for trailing-12-month
  const ttm4 = financials.slice(0, 4);
  const sum = (key) => ttm4.reduce((s, r) => s + (Number(r[key]) || 0), 0);
  const revTTM = sum('revenue');
  const niTTM  = sum('netIncome');
  const opIncTTM = sum('operatingIncome');
  const grossTTM = sum('grossProfit');
  const opCfTTM = sum('opCashFlow');
  const invCfTTM = sum('invCashFlow');
  // FCF approximation: operating CF - capex (where capex is invest-CF excluding investments)
  // We use opCF - |invCF| as a rough approximation since Polygon doesn't isolate capex
  const fcfTTM = opCfTTM + invCfTTM; // negative invCF = capex spend
  const equity = Number(latest.totalEquity) || 0;
  const totalAssets = Number(latest.totalAssets) || 0;
  const totalLiab = Number(latest.totalLiabilities) || 0;
  const debt = Math.max(0, totalLiab - (Number(latest.cashAndEquivalents) || 0));
  const sharesOut = details.weightedSharesOutstanding || details.sharesOutstanding;
  const marketCapBn = (sharesOut && currentPrice) ? (sharesOut * currentPrice) / 1e9 : null;
  if (!marketCapBn || !revTTM) return null;
  const eps = (sharesOut > 0) ? (niTTM / sharesOut) : null;
  return {
    pe:           (eps && eps > 0 && currentPrice) ? currentPrice / eps : null,
    ps:           revTTM > 0 ? (marketCapBn * 1e9) / revTTM : null,
    pb:           equity > 0 ? (marketCapBn * 1e9) / equity : null,
    peg:          null, // requires forward growth estimate; not in Polygon
    roe:          equity > 0 && niTTM ? (niTTM / equity) * 100 : null,
    roic:         totalAssets > 0 && opIncTTM ? (opIncTTM / totalAssets) * 100 : null, // rough
    divYield:     null, // Polygon /financials doesn't include dividends; need separate fetch
    marketCap:    marketCapBn,
    fcfYield:     marketCapBn > 0 && fcfTTM ? (fcfTTM / (marketCapBn * 1e9)) * 100 : null,
    debtToEquity: equity > 0 && debt > 0 ? debt / equity : null,
    grossMargin:  revTTM > 0 && grossTTM ? (grossTTM / revTTM) * 100 : null,
    opMargin:     revTTM > 0 && opIncTTM ? (opIncTTM / revTTM) * 100 : null,
    sector:       details.sicDescription || 'Unknown',
    // Live-data marker so the UI can distinguish live vs curated
    _source: 'polygon-live',
    _asOfPeriod: latest.period,
    _asOfDate: latest.endDate,
    // For DCF prefill
    _fcfTTM: fcfTTM,
    _opCfTTM: opCfTTM,
    _equity: equity,
    _debt: debt,
    _sharesOut: sharesOut,
    _netIncomeTTM: niTTM,
    _revenueTTM: revTTM,
  };
};

// ──────── 18. Polygon ticker-details (KEY required) ────────
// Company overview — name, sector, employees, market cap, description.
export const fetchPolygonTickerDetails = async (ticker) => {
  if (!MASSIVE_API_KEY || !ticker) return null;
  const cached = cacheGet(`tkr:${ticker}`, 24 * 60 * 60_000);
  if (cached) return cached;
  try {
    const url = `https://api.polygon.io/v3/reference/tickers/${ticker}?apiKey=${MASSIVE_API_KEY}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const d = j?.results;
    if (!d) return null;
    const out = {
      ticker: d.ticker,
      name:   d.name,
      market: d.market,
      locale: d.locale,
      primaryExchange: d.primary_exchange,
      currency: d.currency_name,
      cik: d.cik,
      composite_figi: d.composite_figi,
      sicCode: d.sic_code,
      sicDescription: d.sic_description,
      description: d.description,
      homepage: d.homepage_url,
      employees: d.total_employees,
      listedDate: d.list_date,
      marketCap: d.market_cap,
      shareClassSharesOutstanding: d.share_class_shares_outstanding,
      weightedSharesOutstanding: d.weighted_shares_outstanding,
      logo: d.branding?.logo_url ? `${d.branding.logo_url}?apiKey=${MASSIVE_API_KEY}` : null,
    };
    cacheSet(`tkr:${ticker}`, out);
    return out;
  } catch (e) {
    console.warn('[Polygon details]', e.message);
    return null;
  }
};

// ──────── 19. Polygon market movers (KEY required) ────────
// Top gainers/losers across all US equities. Cached 60s — Stocks Starter
// tier has unlimited requests so we refresh more aggressively than free.
export const fetchPolygonMovers = async (direction = 'gainers') => {
  if (!MASSIVE_API_KEY) return [];
  const cached = cacheGet(`movers:${direction}`, 60_000);
  if (cached) return cached;
  try {
    const url = `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/${direction}?apiKey=${MASSIVE_API_KEY}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const out = (j?.tickers ?? []).slice(0, 20).map(t => ({
      ticker: t.ticker,
      change: t.todaysChangePerc ?? 0,
      lastPrice: t.day?.c ?? t.lastTrade?.p ?? 0,
      volume: t.day?.v ?? 0,
    }));
    cacheSet(`movers:${direction}`, out);
    return out;
  } catch (e) {
    console.warn('[Polygon movers]', e.message);
    return [];
  }
};

// ──────── 20. Polygon sector ETF snapshots (KEY required) ────────
// Live snapshots for the SPDR sector ETFs (XLK, XLV, etc.) — feeds the
// sector heat map widget.
export const SECTOR_ETF_MAP = {
  XLK: 'Technology',     XLV: 'Health',         XLF: 'Financials',
  XLE: 'Energy',         XLY: 'Consumer Disc',  XLP: 'Consumer Staples',
  XLI: 'Industrials',    XLU: 'Utilities',      XLB: 'Materials',
  XLRE: 'Real Estate',   XLC: 'Communications',
};
export const fetchPolygonSectorMap = async () => {
  if (!MASSIVE_API_KEY) return null;
  const cached = cacheGet('sectors', 60_000);
  if (cached) return cached;
  try {
    const tickers = Object.keys(SECTOR_ETF_MAP).join(',');
    const url = `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${tickers}&apiKey=${MASSIVE_API_KEY}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const out = (j?.tickers ?? []).map(t => ({
      etf: t.ticker,
      sector: SECTOR_ETF_MAP[t.ticker] ?? t.ticker,
      change: t.todaysChangePerc ?? 0,
      lastPrice: t.day?.c ?? t.lastTrade?.p ?? 0,
    }));
    cacheSet('sectors', out);
    return out;
  } catch (e) {
    console.warn('[Polygon sectors]', e.message);
    return null;
  }
};

// ──────── 21. Polygon market-map constituents (KEY required) ────────
// Maps every major US sector to its top ~8-10 constituent companies with
// approximate market caps (early 2026 levels — accurate to ~5%). We pull a
// single batched snapshot for live % changes; the cap values stay roughly
// stable day-to-day so we don't need to re-fetch share counts.
// ──────── Ticker exchange abbreviation map ────────
// For institutional-style display: tickers prefixed with their listing
// exchange. NSDQ:AAPL, NYSE:JPM, ARCA:SPY, CME:ES, OPRA:AAPL240619C00200000.
// Used by the formatTicker() helper below. Default for stocks not in this
// map is NSDQ since most tech is NASDAQ-listed; institutional traders can
// see at a glance whether something is exchange-listed or OTC.
// Phase 3p.01: TICKER_EXCHANGE extracted to src/lib/format.js.
// Format a ticker with its listing exchange prefix. Returns either
// "NSDQ:AAPL" / "NYSE:JPM" / "ARCA:SPY" or for unknown stocks just the
// raw ticker. Pass cls='equity' to enable the prefix; non-equity instruments
// return the raw id (BTC-PERP, EUR-USD, WTI-F26, etc.).
// Phase 3p.01: formatTicker extracted to src/lib/format.js (10+ usage sites).

export const SECTOR_CONSTITUENTS = {
  'Technology': [
    { ticker: 'AAPL',  name: 'Apple',           cap: 3850 },
    { ticker: 'MSFT',  name: 'Microsoft',       cap: 3200 },
    { ticker: 'NVDA',  name: 'NVIDIA',          cap: 3050 },
    { ticker: 'AVGO',  name: 'Broadcom',        cap:  950 },
    { ticker: 'ORCL',  name: 'Oracle',          cap:  550 },
    { ticker: 'CRM',   name: 'Salesforce',      cap:  320 },
    { ticker: 'ADBE',  name: 'Adobe',           cap:  270 },
    { ticker: 'AMD',   name: 'AMD',             cap:  250 },
    { ticker: 'CSCO',  name: 'Cisco',           cap:  230 },
    { ticker: 'ACN',   name: 'Accenture',       cap:  220 },
  ],
  'Communications': [
    { ticker: 'GOOGL', name: 'Alphabet',        cap: 2400 },
    { ticker: 'META',  name: 'Meta',            cap: 1700 },
    { ticker: 'NFLX',  name: 'Netflix',         cap:  300 },
    { ticker: 'TMUS',  name: 'T-Mobile',        cap:  270 },
    { ticker: 'DIS',   name: 'Disney',          cap:  200 },
    { ticker: 'CMCSA', name: 'Comcast',         cap:  180 },
    { ticker: 'VZ',    name: 'Verizon',         cap:  180 },
    { ticker: 'T',     name: 'AT&T',            cap:  160 },
  ],
  'Consumer Disc': [
    { ticker: 'AMZN',  name: 'Amazon',          cap: 2150 },
    { ticker: 'TSLA',  name: 'Tesla',           cap: 1100 },
    { ticker: 'HD',    name: 'Home Depot',      cap:  400 },
    { ticker: 'MCD',   name: "McDonald's",      cap:  210 },
    { ticker: 'LOW',   name: "Lowe's",          cap:  160 },
    { ticker: 'NKE',   name: 'Nike',            cap:  130 },
    { ticker: 'TJX',   name: 'TJX Companies',   cap:  130 },
    { ticker: 'BKNG',  name: 'Booking',         cap:  120 },
    { ticker: 'SBUX',  name: 'Starbucks',       cap:  100 },
  ],
  'Financials': [
    { ticker: 'BRK.B', name: 'Berkshire Hath.', cap: 1050 },
    { ticker: 'JPM',   name: 'JPMorgan Chase',  cap:  780 },
    { ticker: 'V',     name: 'Visa',            cap:  620 },
    { ticker: 'MA',    name: 'Mastercard',      cap:  500 },
    { ticker: 'BAC',   name: 'Bank of America', cap:  400 },
    { ticker: 'WFC',   name: 'Wells Fargo',     cap:  300 },
    { ticker: 'BX',    name: 'Blackstone',      cap:  200 },
    { ticker: 'MS',    name: 'Morgan Stanley',  cap:  200 },
    { ticker: 'GS',    name: 'Goldman Sachs',   cap:  180 },
  ],
  'Health Care': [
    { ticker: 'LLY',   name: 'Eli Lilly',       cap:  850 },
    { ticker: 'UNH',   name: 'UnitedHealth',    cap:  600 },
    { ticker: 'JNJ',   name: 'Johnson & J.',    cap:  420 },
    { ticker: 'ABBV',  name: 'AbbVie',          cap:  350 },
    { ticker: 'MRK',   name: 'Merck',           cap:  320 },
    { ticker: 'TMO',   name: 'Thermo Fisher',   cap:  220 },
    { ticker: 'ABT',   name: 'Abbott Labs',     cap:  220 },
    { ticker: 'PFE',   name: 'Pfizer',          cap:  200 },
  ],
  'Energy': [
    { ticker: 'XOM',   name: 'Exxon Mobil',     cap:  550 },
    { ticker: 'CVX',   name: 'Chevron',         cap:  320 },
    { ticker: 'COP',   name: 'ConocoPhillips',  cap:  150 },
    { ticker: 'SLB',   name: 'Schlumberger',    cap:   70 },
    { ticker: 'EOG',   name: 'EOG Resources',   cap:   70 },
    { ticker: 'MPC',   name: 'Marathon Petro',  cap:   70 },
    { ticker: 'PSX',   name: 'Phillips 66',     cap:   60 },
  ],
  'Industrials': [
    { ticker: 'CAT',   name: 'Caterpillar',     cap:  200 },
    { ticker: 'GE',    name: 'GE',              cap:  200 },
    { ticker: 'RTX',   name: 'RTX',             cap:  160 },
    { ticker: 'HON',   name: 'Honeywell',       cap:  140 },
    { ticker: 'BA',    name: 'Boeing',          cap:  140 },
    { ticker: 'UPS',   name: 'UPS',             cap:  130 },
    { ticker: 'LMT',   name: 'Lockheed Martin', cap:  130 },
    { ticker: 'DE',    name: 'Deere',           cap:  120 },
  ],
  'Consumer Staples': [
    { ticker: 'WMT',   name: 'Walmart',         cap:  650 },
    { ticker: 'COST',  name: 'Costco',          cap:  400 },
    { ticker: 'PG',    name: 'Procter & G.',    cap:  390 },
    { ticker: 'KO',    name: 'Coca-Cola',       cap:  270 },
    { ticker: 'PEP',   name: 'PepsiCo',         cap:  220 },
    { ticker: 'PM',    name: 'Philip Morris',   cap:  180 },
  ],
  'Utilities': [
    { ticker: 'NEE',   name: 'NextEra Energy',  cap:  160 },
    { ticker: 'SO',    name: 'Southern Co.',    cap:  100 },
    { ticker: 'DUK',   name: 'Duke Energy',     cap:   90 },
    { ticker: 'AEP',   name: 'AEP',             cap:   50 },
  ],
  'Materials': [
    { ticker: 'LIN',   name: 'Linde',           cap:  220 },
    { ticker: 'SHW',   name: 'Sherwin-W.',      cap:  100 },
    { ticker: 'ECL',   name: 'Ecolab',          cap:   70 },
    { ticker: 'APD',   name: 'Air Products',    cap:   60 },
  ],
  'Real Estate': [
    { ticker: 'AMT',   name: 'Amer. Tower',     cap:  100 },
    { ticker: 'PLD',   name: 'Prologis',        cap:  100 },
    { ticker: 'EQIX',  name: 'Equinix',         cap:   70 },
    { ticker: 'WELL',  name: 'Welltower',       cap:   60 },
  ],
};

// Single batched snapshot call for ALL constituents — Polygon's snapshot
// endpoint accepts comma-separated tickers up to ~250, fits comfortably
// in one request. Returns an array of { ticker, change, lastPrice, cap }.
export const fetchPolygonMarketMap = async () => {
  if (!MASSIVE_API_KEY) return null;
  const cached = cacheGet('marketmap', 60_000);
  if (cached) return cached;
  // Flatten all sector constituents into a single ticker list
  const allTickers = [];
  Object.entries(SECTOR_CONSTITUENTS).forEach(([sector, comps]) => {
    comps.forEach(c => allTickers.push({ ...c, sector }));
  });
  // Polygon doesn't accept dots in ticker symbols on the snapshot endpoint;
  // BRK.B has to be sent as BRK-B (Polygon's preferred format).
  const tickerList = allTickers.map(t => t.ticker.replace('.', '-')).join(',');
  try {
    const url = `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${tickerList}&apiKey=${MASSIVE_API_KEY}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    // Build a lookup of live changes by ticker (re-mapping BRK-B back to BRK.B)
    const liveByTicker = {};
    (j?.tickers ?? []).forEach(t => {
      const tickerKey = (t.ticker || '').replace('-', '.');
      liveByTicker[tickerKey] = {
        change: t.todaysChangePerc ?? 0,
        lastPrice: t.day?.c ?? t.lastTrade?.p ?? 0,
      };
    });
    // Merge live data with hardcoded sector + cap data
    const out = allTickers.map(t => ({
      ...t,
      change: liveByTicker[t.ticker]?.change ?? null,
      lastPrice: liveByTicker[t.ticker]?.lastPrice ?? null,
      isLive: liveByTicker[t.ticker] != null,
    }));
    cacheSet('marketmap', out);
    return out;
  } catch (e) {
    console.warn('[Polygon market map]', e.message);
    return null;
  }
};

// ──────── 22. Polygon historical aggs (KEY required) ────────
// Fetch OHLCV bars for any equity. Used by the Volume-by-Price widget which
// needs ~90 days of daily bars to compute volume distribution by price.
// Cached for 5 minutes since daily bars only change once a day.
export const fetchPolygonAggs = async (ticker, days = 90, span = 'day', mult = 1) => {
  if (!MASSIVE_API_KEY || !ticker) return null;
  const cacheKey = `aggs:${ticker}:${mult}${span}:${days}`;
  const cached = cacheGet(cacheKey, 5 * 60_000);
  if (cached) return cached;
  try {
    const to = new Date();
    const from = new Date(to.getTime() - days * 86400000);
    const toStr = to.toISOString().slice(0, 10);
    const fromStr = from.toISOString().slice(0, 10);
    const url = `https://api.polygon.io/v2/aggs/ticker/${ticker}/range/${mult}/${span}/${fromStr}/${toStr}?adjusted=true&sort=asc&limit=5000&apiKey=${MASSIVE_API_KEY}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const out = (j?.results ?? []).map(b => ({
      t: b.t,            // timestamp (ms)
      open: b.o,
      high: b.h,
      low: b.l,
      close: b.c,
      volume: b.v,
      vwap: b.vw,
      txns: b.n,
    }));
    cacheSet(cacheKey, out);
    return out;
  } catch (e) {
    console.warn('[Polygon aggs]', ticker, e.message);
    return null;
  }
};
