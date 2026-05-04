// IMO Onyx Terminal — miscellaneous quant helpers
//
// Phase 3o.95 (file split, batch 7c). Small leaf-level helpers that
// don't fit the existing focused modules. Each is self-contained:
// pure function, no cross-module dependencies inside src/lib/quant/.
//
// Public exports:
//   computeInsiderVelocity(transactions, windowDays)
//     → { netFlow, buyDollars, sellDollars, buyerCount, sellerCount,
//         transactionCount, openMarketBuys, clusterSignal,
//         velocityRatio, byInsider, recentActivity } | null
//     Aggregates Form 4 transaction events into a per-ticker insider
//     sentiment signal. Cluster signal (≥3 distinct buyers) historically
//     predictive of positive returns (Lakonishok & Lee 2001).
//
//   blackScholes(S, K, T, r, sigma)
//     → { call, put, callDelta, putDelta, gamma, callTheta, putTheta, vega }
//     Paired call+put European option pricing. Distinct from
//     blackScholesAdvanced in options-payoff.js (which is single-side
//     with dividend yield). This is the simpler legacy API.
//
//   computeBarCount(rangeMins, intervalMins)
//     → number   Candle count for a given range + interval. Used by
//                chart range pickers to validate combinations.
//
//   computeHedgeRecommendations(portfolioReturns, portfolioVolAnnual,
//                                grossMV, proxyReturnsBySymbol)
//     → [{ symbol, label, correlation, hedgeRatio, hedgeNotional,
//          varianceReduction, direction }]
//     Variance-minimizing hedge proxy selection. h* = ρ × (σ_p / σ_h);
//     filters |ρ| > 0.3 to avoid spurious hedges.
//
//   buildRoundTrips(trades)
//     → [{ symbol, qty, openTs, closeTs, openPx, closePx, gross, net, ... }]
//     FIFO-matches buy/sell pairs per ticker into completed round-trips.
//     Used by the trade-history analytics surface.


// ════════════════════════════════════════════════════════════════════
// INSIDER TRANSACTION VELOCITY
// ════════════════════════════════════════════════════════════════════
//
// Aggregates raw Form 4 transaction events into a per-ticker sentiment
// signal. Three primary signals:
//
//   Net dollar flow:  Sum of buys − sells in $.  Positive = net buying
//                     by insiders (bullish); negative = net selling.
//   Buyer count:      Number of distinct insiders buying in window.
//                     Single-name buying is weak; ≥3 buyers = "cluster"
//                     signal which has been historically predictive of
//                     positive returns (Lakonishok & Lee 2001).
//   Velocity:         Trade count vs same-window average.  Spike of
//                     activity often precedes news.
//
// Insider buying is more informative than selling because:
//   - Selling has many non-bullish reasons (diversification, RSU vesting,
//     liquidity, divorce). We filter out 'F' (tax withholding), 'M'
//     (option exercise), 'A' (grants/awards) which are not market signals.
//   - Buying with personal cash signals genuine view; "open market"
//     transaction code 'P' is the cleanest signal.
//
// Inputs:
//   transactions: array of { date, code, shares, price, value, acquired,
//                            insiderName }  (per-filing transactions
//                            already extracted via parseSecForm4)
//   windowDays:   how far back to consider (default 90)
//
// Returns:
//   { netFlow, buyDollars, sellDollars, buyerCount, sellerCount,
//     transactionCount, openMarketBuys, clusterSignal,
//     velocityRatio, byInsider: [...], recentActivity: [...] }
import { CROSS_ASSET_PROXIES } from './portfolio-math.js';

export const computeInsiderVelocity = (transactions, windowDays = 90) => {
  if (!Array.isArray(transactions) || transactions.length === 0) {
    return null;
  }
  const now = Date.now();
  const cutoff = now - windowDays * 86400000;
  const olderCutoff = now - 2 * windowDays * 86400000;
  // Filter to the analysis window
  const inWindow = transactions.filter(t => {
    const ts = t.date ? new Date(t.date).getTime() : 0;
    return ts >= cutoff;
  });
  // Older window for velocity comparison
  const olderWindow = transactions.filter(t => {
    const ts = t.date ? new Date(t.date).getTime() : 0;
    return ts >= olderCutoff && ts < cutoff;
  });
  if (inWindow.length === 0) {
    return {
      netFlow: 0, buyDollars: 0, sellDollars: 0,
      buyerCount: 0, sellerCount: 0, transactionCount: 0,
      openMarketBuys: 0, clusterSignal: false,
      velocityRatio: 0, byInsider: [], recentActivity: [],
      windowDays,
    };
  }
  // Aggregate
  let buyDollars = 0;
  let sellDollars = 0;
  let openMarketBuys = 0;
  const buyerSet = new Set();
  const sellerSet = new Set();
  const insiderMap = {};
  for (const t of inWindow) {
    // Skip non-market codes — F/M/A/G are not real market signals
    const code = t.code || '';
    if (code === 'F' || code === 'M' || code === 'A' || code === 'G') continue;
    const value = Math.abs(Number(t.value) || 0);
    if (value <= 0) continue;
    const insider = t.insiderName || 'Unknown';
    const isBuy = t.acquired === 'A' || code === 'P';
    if (!insiderMap[insider]) {
      insiderMap[insider] = { name: insider, buys: 0, sells: 0, net: 0, count: 0 };
    }
    insiderMap[insider].count++;
    if (isBuy) {
      buyDollars += value;
      buyerSet.add(insider);
      insiderMap[insider].buys += value;
      insiderMap[insider].net += value;
      if (code === 'P') openMarketBuys++;
    } else {
      sellDollars += value;
      sellerSet.add(insider);
      insiderMap[insider].sells += value;
      insiderMap[insider].net -= value;
    }
  }
  const netFlow = buyDollars - sellDollars;
  // Cluster signal: ≥3 distinct buyers in window. Historically predictive.
  const clusterSignal = buyerSet.size >= 3;
  // Velocity vs older window
  const inWindowMarketCount = inWindow.filter(t =>
    !['F', 'M', 'A', 'G'].includes(t.code || '')
  ).length;
  const olderMarketCount = olderWindow.filter(t =>
    !['F', 'M', 'A', 'G'].includes(t.code || '')
  ).length;
  const velocityRatio = olderMarketCount > 0
    ? inWindowMarketCount / olderMarketCount
    : (inWindowMarketCount > 0 ? 99 : 0);
  // Per-insider rollup, sorted by absolute net flow
  const byInsider = Object.values(insiderMap)
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  // Recent activity (most recent transactions, top 10)
  const recentActivity = inWindow
    .slice()
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 10);
  return {
    netFlow,
    buyDollars, sellDollars,
    buyerCount: buyerSet.size,
    sellerCount: sellerSet.size,
    transactionCount: inWindowMarketCount,
    openMarketBuys,
    clusterSignal,
    velocityRatio,
    byInsider,
    recentActivity,
    windowDays,
  };
};

// Black-Scholes for European call/put. Inputs:
//   S = spot, K = strike, T = years to expiration, r = risk-free rate,
//   sigma = annualized volatility (e.g. 0.6 for 60%).
// Returns { call, put, callDelta, putDelta, gamma, callTheta, putTheta, vega }.

// Standard normal CDF using Abramowitz & Stegun 26.2.17 — accurate to ~7
// decimal places, more than enough for option pricing display purposes.
// Internal to this module since blackScholes is its only consumer here.
const normCdf = (x) => {
  const a1 =  0.254829592;
  const a2 = -0.284496736;
  const a3 =  1.421413741;
  const a4 = -1.453152027;
  const a5 =  1.061405429;
  const p  =  0.3275911;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * ax);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return 0.5 * (1.0 + sign * y);
};
const normPdf = (x) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);

export const blackScholes = (S, K, T, r, sigma) => {
  if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) {
    return {
      call: Math.max(0, S - K), put: Math.max(0, K - S),
      callDelta: S > K ? 1 : 0, putDelta: S > K ? 0 : -1,
      gamma: 0, callTheta: 0, putTheta: 0, vega: 0,
    };
  }
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  const Nd1 = normCdf(d1);
  const Nd2 = normCdf(d2);
  const nd1 = normPdf(d1);

  const call = S * Nd1 - K * Math.exp(-r * T) * Nd2;
  const put  = K * Math.exp(-r * T) * normCdf(-d2) - S * normCdf(-d1);

  // Greeks
  const gamma = nd1 / (S * sigma * sqrtT);
  const vega  = S * nd1 * sqrtT * 0.01;       // per 1 vol point
  const callTheta = (-(S * nd1 * sigma) / (2 * sqrtT) - r * K * Math.exp(-r * T) * Nd2) / 365;
  const putTheta  = (-(S * nd1 * sigma) / (2 * sqrtT) + r * K * Math.exp(-r * T) * normCdf(-d2)) / 365;

  return {
    call: Math.max(0, call),
    put:  Math.max(0, put),
    callDelta: Nd1,
    putDelta: Nd1 - 1,
    gamma, callTheta, putTheta, vega,
  };
};


// Compute candle count for a given range + interval. Used to validate
// the combination doesn't blow up the renderer, and to display the
// expected bar count in tooltips.
export const computeBarCount = (rangeMins, intervalMins) => {
  if (!rangeMins || !intervalMins) return 0;
  return Math.floor(rangeMins / intervalMins);
};

// computeHedgeRecommendations — given a portfolio's beta, vol, and gross
// MV, plus a set of candidate hedge proxies with their own returns,
// recommend hedge instruments + notional sizes that would minimize
// portfolio variance.
//
// Method:
//   For each candidate hedge instrument (SPY, TLT, GLD, VIX, etc.):
//     Compute correlation ρ between portfolio returns and candidate returns
//     Compute candidate's annualized vol σ_h
//     Optimal hedge ratio (variance-minimizing): h* = ρ × (σ_p / σ_h)
//     Hedge notional = h* × portfolio gross MV (as % of book)
//     Variance reduction = ρ² (portion of variance hedged)
//
// Filters:
//   |ρ| > 0.3  to avoid spurious hedges
//   Sort by |ρ × σ_h|  — most leverageable hedges first
//
// Returns array of { symbol, label, correlation, hedgeRatio, hedgeNotional,
//                    variance Reduction, direction (+1 short hedge / -1 long hedge) }
export const computeHedgeRecommendations = (portfolioReturns, portfolioVolAnnual, grossMV,
                                     proxyReturnsBySymbol) => {
  if (!Array.isArray(portfolioReturns) || portfolioReturns.length < 30) return [];
  if (!Number.isFinite(portfolioVolAnnual) || portfolioVolAnnual <= 0) return [];
  if (!Number.isFinite(grossMV) || grossMV <= 0) return [];
  const out = [];
  // Compute portfolio mean for correlation calc
  const N = portfolioReturns.length;
  const meanP = portfolioReturns.reduce((s, r) => s + r, 0) / N;
  for (const proxy of CROSS_ASSET_PROXIES) {
    const rets = proxyReturnsBySymbol[proxy.symbol];
    if (!rets || rets.length < 30) continue;
    const minLen = Math.min(N, rets.length);
    const x = portfolioReturns.slice(-minLen);
    const y = rets.slice(-minLen);
    const meanXloc = x.reduce((a, b) => a + b, 0) / minLen;
    const meanY = y.reduce((a, b) => a + b, 0) / minLen;
    let num = 0, denomX = 0, denomY = 0;
    for (let i = 0; i < minLen; i++) {
      num    += (x[i] - meanXloc) * (y[i] - meanY);
      denomX += (x[i] - meanXloc) ** 2;
      denomY += (y[i] - meanY) ** 2;
    }
    if (denomX <= 0 || denomY <= 0) continue;
    const corr = num / (Math.sqrt(denomX) * Math.sqrt(denomY));
    if (!Number.isFinite(corr) || Math.abs(corr) < 0.3) continue;
    const proxyVarDaily = denomY / minLen;
    const proxyVolAnnual = Math.sqrt(proxyVarDaily) * Math.sqrt(252);
    if (!Number.isFinite(proxyVolAnnual) || proxyVolAnnual <= 0) continue;
    // Variance-minimizing hedge ratio
    const hedgeRatio = corr * (portfolioVolAnnual / proxyVolAnnual);
    // Direction: positive corr → short the hedge (we want negative MV exposure)
    //            negative corr → long the hedge
    const direction = hedgeRatio > 0 ? -1 : 1;
    const hedgeNotional = Math.abs(hedgeRatio) * grossMV * direction;
    const varianceReduction = corr * corr; // ρ² of variance is hedgeable
    out.push({
      symbol: proxy.symbol,
      label: proxy.label,
      assetClass: proxy.assetClass,
      correlation: corr,
      proxyVolAnnual,
      hedgeRatio,
      hedgeNotional,
      varianceReduction,
      direction,
    });
  }
  // Sort by absolute variance reduction (best hedges first)
  out.sort((a, b) => b.varianceReduction - a.varianceReduction);
  return out;
};

// Build round-trips from trade list. Trades come in chronological
// order; we FIFO-match buys and sells per ticker.
export const buildRoundTrips = (trades = []) => {
  if (!Array.isArray(trades) || trades.length === 0) return [];
  // Reverse so we process oldest first
  const ordered = [...trades].reverse();
  const openLots = {}; // ticker → array of { qty, price, time, raw }
  const trips = [];
  for (const t of ordered) {
    const sym = t.sym;
    if (!sym) continue;
    const qty = parseFloat(t.size) || 0;
    const px  = parseFloat(t.price) || 0;
    if (qty <= 0 || px <= 0) continue;
    if (!openLots[sym]) openLots[sym] = [];
    if (t.side === 'buy') {
      openLots[sym].push({ qty, price: px, time: t.time, raw: t });
    } else if (t.side === 'sell') {
      let remaining = qty;
      while (remaining > 0 && openLots[sym].length > 0) {
        const lot = openLots[sym][0];
        const matched = Math.min(remaining, lot.qty);
        const pnl = (px - lot.price) * matched;
        trips.push({
          ticker: sym,
          qty: matched,
          entryPrice: lot.price,
          exitPrice: px,
          entryTime: lot.time,
          exitTime: t.time,
          pnl,
          ret: lot.price > 0 ? (px - lot.price) / lot.price : 0,
        });
        lot.qty -= matched;
        remaining -= matched;
        if (lot.qty <= 0) openLots[sym].shift();
      }
    }
  }
  return trips;
};
