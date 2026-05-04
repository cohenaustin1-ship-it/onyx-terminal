// IMO Onyx Terminal — quant risk-math module
//
// Phase 3o.90 (structural starter): extracted from JPMOnyxTerminal.jsx
// to begin the file split. This module contains pure-function math
// helpers for portfolio risk analytics. No React, no DOM, no
// localStorage — safe to import anywhere.
//
// Functions:
//   fitGARCH11(returns)
//     → { omega, alpha, beta, persistence, halfLife, uncondVar,
//         uncondVol, condVarPath, condVolPath, logLik, n,
//         nextStepVol, fitted }
//   forecastGARCHVol(fit, horizons=[1,5,10,20,60])
//     → [{ h, vol, var }]
//   decomposeDrawdownByRegime(returns, opts)
//     → { regimes, episodes, summary }
//   computeAIvsAnalystConsensus(aiIdeas, analystRatings)
//     → { rows, summary }
//   computeEWMAVol(returns, lambda=0.94)
//     → number | null
//   computeHARRVol(returns)
//     → number | null
//   computePortfolioVolForecast(returnsBySymbol, weightBySymbol)
//     → { fitted, perAsset, portfolioVol, portfolioVolAnnual,
//         weightedAvgVol, diversificationRatio, correlationMatrix, n }
//   computeRebalancingOptimization(holdings, lots, recentBuys, cash, opts)
//     → { trades, metrics }
//
// Migration path (for future phases):
//   3o.90 (this batch): extract these 8 helpers; ~770 lines off the monolith
//   3o.91+: extract additional pure-math helpers (computeVaR family,
//           portfolio-fundamentals, scenario engine)
//   3o.92+: extract React components (start with leaf components: panels
//           with no children-of-this-codebase, like LoadingSkeleton)
//   3o.95+: extract page-level React components (TradePage, RiskPage, etc.)
//
// The migration is mechanical — no behavior changes. Each batch reduces
// JPMOnyxTerminal.jsx by 500-2000 lines and establishes one more import.

//   var* and cvar* are positive numbers (the dollar loss at risk).
// ────────── GARCH(1,1) volatility forecasting ──────────
// Phase 3o.85 — fit a GARCH(1,1) model to a return series and project
// the conditional variance forward. Standard GARCH(1,1) recursion:
//   σ²_t = ω + α·ε²_{t-1} + β·σ²_{t-1}
// where ε_t = r_t - μ (return minus mean). The persistence is α+β
// (must be < 1 for the model to be stationary). Long-run unconditional
// variance is ω/(1-α-β); the half-life of vol shocks is
// ln(0.5) / ln(α+β) days.
//
// Honest scope: full QMLE optimization in pure JS without scipy is
// finicky (the log-likelihood surface has flat regions, especially
// near α+β = 1, that trip up naive grid search). We use a coordinate-
// descent fit with a coarse-then-fine bracketed grid, anchored to the
// well-known "sensible defaults" (α≈0.06, β≈0.92, persistence≈0.98).
// Better than method-of-moments, much simpler than a full Newton-Raphson.
//
// Returns:
//   { omega, alpha, beta, persistence, halfLife, uncondVar, uncondVol,
//     condVarPath, condVolPath, logLik, n, fitted: true }
// On failure (insufficient data, degenerate fit) returns { fitted: false }.
export const fitGARCH11 = (returns) => {
  if (!Array.isArray(returns) || returns.length < 60) {
    return { fitted: false, reason: 'need >= 60 returns' };
  }
  const n = returns.length;
  const mean = returns.reduce((a, b) => a + b, 0) / n;
  const eps = returns.map(r => r - mean);
  const sampleVar = eps.reduce((a, e) => a + e * e, 0) / n;
  if (!Number.isFinite(sampleVar) || sampleVar <= 0) {
    return { fitted: false, reason: 'degenerate variance' };
  }
  // Negative log-likelihood for given (omega, alpha, beta). We
  // assume conditional normality: -logL = 0.5·Σ(log(σ²_t) + ε²_t/σ²_t)
  // Constants dropped (don't affect argmin).
  const negLogL = (omega, alpha, beta) => {
    if (omega <= 0 || alpha < 0 || beta < 0 || alpha + beta >= 0.999) return Infinity;
    let sigma2 = sampleVar; // initialize at unconditional variance
    let nll = 0;
    for (let t = 0; t < n; t++) {
      if (sigma2 <= 0 || !Number.isFinite(sigma2)) return Infinity;
      nll += 0.5 * (Math.log(sigma2) + (eps[t] * eps[t]) / sigma2);
      sigma2 = omega + alpha * eps[t] * eps[t] + beta * sigma2;
    }
    return nll;
  };
  // Coarse grid centered on RiskMetrics-like defaults.
  let bestNLL = Infinity;
  let best = { omega: sampleVar * 0.02, alpha: 0.06, beta: 0.92 };
  // Coarse: alpha in [0.02, 0.20], beta in [0.70, 0.97], omega scaled
  // off sampleVar at three orders of magnitude.
  const alphaGrid = [0.02, 0.04, 0.06, 0.09, 0.12, 0.16, 0.20];
  const betaGrid  = [0.70, 0.78, 0.85, 0.90, 0.93, 0.95, 0.97];
  const omegaScales = [0.005, 0.01, 0.02, 0.05, 0.10, 0.20];
  for (const a of alphaGrid) {
    for (const b of betaGrid) {
      if (a + b >= 0.999) continue;
      for (const os of omegaScales) {
        const omega = sampleVar * os * (1 - a - b);
        const ll = negLogL(omega, a, b);
        if (ll < bestNLL) { bestNLL = ll; best = { omega, alpha: a, beta: b }; }
      }
    }
  }
  // Fine refinement: ±1 grid step in each dimension, log-spaced for omega.
  const refine = (center, step, count) => {
    const out = [];
    for (let i = -count; i <= count; i++) out.push(center + step * i);
    return out.filter(x => x >= 0);
  };
  const aFine = refine(best.alpha, 0.01, 3);
  const bFine = refine(best.beta, 0.01, 3);
  const oFine = refine(best.omega, best.omega * 0.3, 3).filter(x => x > 0);
  for (const a of aFine) {
    for (const b of bFine) {
      if (a + b >= 0.999) continue;
      for (const omega of oFine) {
        const ll = negLogL(omega, a, b);
        if (ll < bestNLL) { bestNLL = ll; best = { omega, alpha: a, beta: b }; }
      }
    }
  }
  // Compute fitted conditional variance path with the best parameters.
  const condVarPath = new Array(n);
  let sigma2 = sampleVar;
  for (let t = 0; t < n; t++) {
    condVarPath[t] = sigma2;
    sigma2 = best.omega + best.alpha * eps[t] * eps[t] + best.beta * sigma2;
  }
  const persistence = best.alpha + best.beta;
  const uncondVar = persistence < 0.999 ? best.omega / (1 - persistence) : sampleVar;
  const halfLife = persistence > 0 && persistence < 1 ? Math.log(0.5) / Math.log(persistence) : Infinity;
  return {
    fitted: true,
    omega: best.omega,
    alpha: best.alpha,
    beta: best.beta,
    persistence,
    halfLife,
    uncondVar,
    uncondVol: Math.sqrt(uncondVar),
    condVarPath,
    condVolPath: condVarPath.map(v => Math.sqrt(v)),
    nextStepVar: sigma2, // forecast for t+1
    nextStepVol: Math.sqrt(sigma2),
    logLik: -bestNLL,
    n,
    sampleVar,
    sampleVol: Math.sqrt(sampleVar),
    mean,
  };
};

// forecastGARCHVol — given a fitted GARCH(1,1) model, project the
// conditional variance forward h steps. Closed-form forecast:
//   E[σ²_{t+h}] = ω·(1-(α+β)^(h-1))/(1-(α+β)) + (α+β)^(h-1)·σ²_{t+1}
// As h → ∞, the forecast mean-reverts to the unconditional variance.
export const forecastGARCHVol = (fit, horizons = [1, 5, 10, 20, 60]) => {
  if (!fit?.fitted) return horizons.map(h => ({ h, vol: null, var: null }));
  const ab = fit.persistence;
  const out = [];
  for (const h of horizons) {
    let varH;
    if (ab >= 0.999) {
      varH = fit.nextStepVar; // not stationary; treat as a constant
    } else {
      const power = Math.pow(ab, h - 1);
      varH = fit.omega * (1 - power) / (1 - ab) + power * fit.nextStepVar;
    }
    out.push({ h, var: varH, vol: Math.sqrt(varH) });
  }
  return out;
};

// ────────── Conditional Drawdown by Regime ──────────
// Phase 3o.85 — decomposes drawdown experience by volatility regime.
// Question answered: "during STRESSED regimes (vol > 80th pct), what
// drawdowns have we historically seen, vs. during NORMAL regimes?"
// Useful for risk planning: knowing your "calm-market drawdown" tells
// you nothing about how much you'll lose in the next vol spike.
//
// Algorithm:
//   1. Build equity curve from cumulative returns
//   2. Compute rolling 30-day realized vol at each bar
//   3. Compute the percentile rank of each rolling vol vs the full
//      sample → label STRESSED if rank > stressedPercentile (default 0.80)
//   4. Compute drawdown at each bar: dd_t = equity_t / runMax_t - 1
//   5. Bucket bars by regime, compute summary stats per bucket:
//      maxDD, meanDD, timeInDrawdown, recovery time (avg)
export const decomposeDrawdownByRegime = (returns, opts = {}) => {
  const window = opts.window || 30;
  const stressedPercentile = opts.stressedPercentile ?? 0.80;
  if (!Array.isArray(returns) || returns.length < window + 30) {
    return { ok: false, reason: 'need >= window + 30 returns' };
  }
  const n = returns.length;
  // Equity curve
  const equity = new Array(n);
  let cum = 1;
  for (let i = 0; i < n; i++) { cum *= (1 + returns[i]); equity[i] = cum; }
  // Running max and drawdown
  const runMax = new Array(n);
  const dd = new Array(n);
  let mx = equity[0];
  for (let i = 0; i < n; i++) {
    if (equity[i] > mx) mx = equity[i];
    runMax[i] = mx;
    dd[i] = equity[i] / mx - 1; // negative or zero
  }
  // Rolling vol (annualized) — null until window-1 bars are available.
  const rollVol = new Array(n).fill(null);
  for (let i = window - 1; i < n; i++) {
    let s = 0, ss = 0;
    for (let j = i - window + 1; j <= i; j++) { s += returns[j]; ss += returns[j] * returns[j]; }
    const m = s / window;
    const v = ss / window - m * m;
    rollVol[i] = v > 0 ? Math.sqrt(v) * Math.sqrt(252) : 0;
  }
  // Percentile threshold for STRESSED based on observed rolling vols.
  const validVols = rollVol.filter(v => v != null && Number.isFinite(v)).slice().sort((a, b) => a - b);
  if (validVols.length < 10) return { ok: false, reason: 'insufficient vol history' };
  const threshIdx = Math.floor(validVols.length * stressedPercentile);
  const stressThresh = validVols[Math.min(threshIdx, validVols.length - 1)];
  // Classify each bar and bucket the drawdowns
  const bucket = { stressed: [], normal: [] };
  let stressedCount = 0, normalCount = 0;
  let stressedInDD = 0, normalInDD = 0;
  for (let i = window - 1; i < n; i++) {
    if (rollVol[i] == null) continue;
    const isStressed = rollVol[i] >= stressThresh;
    if (isStressed) {
      bucket.stressed.push(dd[i]);
      stressedCount++;
      if (dd[i] < -0.001) stressedInDD++;
    } else {
      bucket.normal.push(dd[i]);
      normalCount++;
      if (dd[i] < -0.001) normalInDD++;
    }
  }
  const summarize = (arr) => {
    if (arr.length === 0) return { count: 0, maxDD: 0, meanDD: 0, p5DD: 0, p25DD: 0 };
    const sorted = arr.slice().sort((a, b) => a - b); // most-negative first
    const sum = arr.reduce((a, b) => a + b, 0);
    return {
      count: arr.length,
      maxDD: sorted[0],
      meanDD: sum / arr.length,
      p5DD:  sorted[Math.floor(sorted.length * 0.05)],
      p25DD: sorted[Math.floor(sorted.length * 0.25)],
    };
  };
  const stressedStats = summarize(bucket.stressed);
  const normalStats   = summarize(bucket.normal);
  // Current regime
  const currentVol = rollVol[n - 1];
  const currentRegime = (currentVol != null && currentVol >= stressThresh) ? 'STRESSED' : 'NORMAL';
  return {
    ok: true,
    window,
    stressedPercentile,
    stressThresh,            // annualized vol threshold
    currentVol,
    currentRegime,
    stressedFraction: stressedCount / Math.max(1, stressedCount + normalCount),
    normalFraction:   normalCount   / Math.max(1, stressedCount + normalCount),
    stressedTimeInDD: stressedInDD / Math.max(1, stressedCount),
    normalTimeInDD:   normalInDD   / Math.max(1, normalCount),
    stressed: stressedStats,
    normal:   normalStats,
    overallMaxDD: Math.min(...dd),
    n,
  };
};

// ────────── AI vs Analyst consensus comparison ──────────
// Phase 3o.85 — joins AI-generated trade ideas (stored in localStorage
// under 'imo_ai_trade_ideas') with curated sell-side analyst ratings
// (CURATED_ANALYST_RATINGS) per ticker. Surfaces three kinds of
// signals:
//
//   AGREE-BULL    AI bullish AND Street bullish (consensus-bullish)
//   AGREE-BEAR    AI bearish AND Street bearish
//   CONTRA-AI-BULL  AI bullish but Street bearish/neutral (contrarian
//                  — either AI sees something Street missed, or Street
//                  is rationally cautious; resolution is empirical)
//   CONTRA-AI-BEAR  AI bearish but Street bullish (warning — AI flags
//                   risk that Street consensus is missing)
//
// Confidence scoring: how strong is each side's signal.
//   AI confidence: # of ideas pointing the same direction (more = stronger)
//   Street confidence: buy/(buy+hold+sell) ratio normalized
//
// Returns array of per-ticker rows sorted by absolute disagreement
// (CONTRA cases at top), so users see the contrarian opportunities
// first.
export const computeAIvsAnalystConsensus = (aiIdeas, analystRatings) => {
  if (!Array.isArray(aiIdeas) || aiIdeas.length === 0) return [];
  if (!analystRatings || typeof analystRatings !== 'object') return [];
  // Group AI ideas by ticker
  const byTicker = {};
  for (const idea of aiIdeas) {
    const sym = (idea.sym || '').toUpperCase();
    if (!sym) continue;
    if (!byTicker[sym]) byTicker[sym] = { long: 0, short: 0, neutral: 0 };
    const dir = String(idea.direction || '').toLowerCase();
    if (dir === 'long' || dir === 'bullish' || dir === 'buy') byTicker[sym].long++;
    else if (dir === 'short' || dir === 'bearish' || dir === 'sell') byTicker[sym].short++;
    else byTicker[sym].neutral++;
  }
  const rows = [];
  for (const [sym, ai] of Object.entries(byTicker)) {
    const street = analystRatings[sym];
    if (!street) continue;
    const totalAI = ai.long + ai.short + ai.neutral;
    if (totalAI === 0) continue;
    // AI bias: -1 (bearish) to +1 (bullish)
    const aiBias = (ai.long - ai.short) / totalAI;
    // Street bias from buy/hold/sell counts
    const buy  = Number(street.buy)  || 0;
    const hold = Number(street.hold) || 0;
    const sell = Number(street.sell) || 0;
    const totalStreet = buy + hold + sell;
    if (totalStreet === 0) continue;
    // Map: buy = +1, hold = 0, sell = -1; weighted average
    const streetBias = (buy - sell) / totalStreet;
    // Upside per Street price target
    const upside = (street.priceTarget && street.currentPrice)
      ? (street.priceTarget - street.currentPrice) / street.currentPrice : 0;
    // Disagreement magnitude
    const disagreement = aiBias - streetBias;
    let signal;
    if (aiBias > 0.2 && streetBias > 0.2) signal = 'AGREE-BULL';
    else if (aiBias < -0.2 && streetBias < -0.2) signal = 'AGREE-BEAR';
    else if (aiBias > 0.2 && streetBias < 0.2) signal = 'CONTRA-AI-BULL';
    else if (aiBias < -0.2 && streetBias > 0.2) signal = 'CONTRA-AI-BEAR';
    else signal = 'NEUTRAL';
    rows.push({
      sym,
      aiLong: ai.long,
      aiShort: ai.short,
      aiNeutral: ai.neutral,
      aiTotal: totalAI,
      aiBias,
      buyCount: buy,
      holdCount: hold,
      sellCount: sell,
      totalStreet,
      streetBias,
      upside,
      disagreement,
      absDisagreement: Math.abs(disagreement),
      priceTarget: street.priceTarget,
      currentPrice: street.currentPrice,
      signal,
    });
  }
  // Sort: CONTRA signals first (by abs disagreement), then AGREE, then NEUTRAL
  rows.sort((a, b) => {
    const tier = (s) => s.startsWith('CONTRA') ? 0 : s.startsWith('AGREE') ? 1 : 2;
    const ta = tier(a.signal), tb = tier(b.signal);
    if (ta !== tb) return ta - tb;
    return b.absDisagreement - a.absDisagreement;
  });
  return rows;
};

// ────────── Cross-Asset Vol Forecast Ensemble (Phase 3o.86) ──────────
// Portfolio-level vol forecasting that combines three single-asset
// forecasts per holding and aggregates via the cross-correlation matrix:
//
//   1. GARCH(1,1)  — captures vol clustering + mean reversion
//                    (already implemented in 3o.85)
//   2. EWMA        — RiskMetrics-style exponentially-weighted moving
//                    average; σ²_t+1 = λσ²_t + (1-λ)r²_t with λ=0.94
//                    Robust, fast-adapting, used by major risk systems
//   3. HAR-RV      — Heterogeneous Autoregressive realized vol
//                    Captures multi-scale persistence:
//                    RV_t+1 = β_0 + β_d·RV_d + β_w·RV_w + β_m·RV_m
//                    where RV_d = today, RV_w = avg last 5d, RV_m = avg last 22d
//
// Per-asset ensemble: simple average of the three (each method has
// different biases — GARCH overshoots after big shocks, EWMA underweights
// far history, HAR-RV needs longer samples). The average is more robust
// than any single model.
//
// Portfolio variance: σ²_p = w' Σ w  where Σ_ij = σ_i × σ_j × ρ_ij
// We compute ρ_ij from empirical correlations on the same return panel.
//
// Returns:
//   {
//     perAsset: [{ symbol, weight, garchVol, ewmaVol, harVol, ensembleVol }],
//     portfolioVol: <annualized 1-day-ahead forecast>,
//     diversificationRatio: <weighted avg single-asset vol> / portfolioVol,
//     correlationMatrix: { [sym1]: { [sym2]: rho }},
//     fitted: true
//   }
export const computeEWMAVol = (returns, lambda = 0.94) => {
  if (!Array.isArray(returns) || returns.length < 30) return null;
  const mean = returns.reduce((s, v) => s + v, 0) / returns.length;
  const eps = returns.map(r => r - mean);
  let sigma2 = eps[0] * eps[0];
  for (let t = 1; t < eps.length; t++) {
    sigma2 = lambda * sigma2 + (1 - lambda) * eps[t - 1] * eps[t - 1];
  }
  // Next-step forecast
  const next = lambda * sigma2 + (1 - lambda) * eps[eps.length - 1] * eps[eps.length - 1];
  return Math.sqrt(next);
};

export const computeHARRVol = (returns) => {
  if (!Array.isArray(returns) || returns.length < 30) return null;
  // Daily realized vol = |return| (squared, summed for multi-day periods)
  // Build RV series and fit OLS on RV_t = β_0 + β_d·RV_d + β_w·RV_w + β_m·RV_m
  const rv = returns.map(r => r * r);
  const N = rv.length;
  const minLag = 22;
  if (N < minLag + 30) return null;
  // Build rolling means
  const rvW = new Array(N).fill(0);
  const rvM = new Array(N).fill(0);
  for (let t = 4; t < N; t++) {
    let s = 0;
    for (let j = t - 4; j <= t; j++) s += rv[j];
    rvW[t] = s / 5;
  }
  for (let t = 21; t < N; t++) {
    let s = 0;
    for (let j = t - 21; j <= t; j++) s += rv[j];
    rvM[t] = s / 22;
  }
  // OLS: y = X β  where X = [1, RV_t-1, RV_w_t-1, RV_m_t-1]
  const n = N - minLag - 1;
  const X = [];
  const y = [];
  for (let t = minLag; t < N - 1; t++) {
    X.push([1, rv[t], rvW[t], rvM[t]]);
    y.push(rv[t + 1]);
  }
  // Solve normal equations β = (X'X)⁻¹ X'y by direct 4x4 inverse
  const xtx = [[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]];
  const xty = [0,0,0,0];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < 4; j++) {
      xty[j] += X[i][j] * y[i];
      for (let k = 0; k < 4; k++) xtx[j][k] += X[i][j] * X[i][k];
    }
  }
  // 4×4 matrix inverse via Gauss-Jordan
  const inv = (() => {
    const a = xtx.map(r => r.slice());
    const I = [[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]];
    for (let i = 0; i < 4; i++) {
      // Pivot
      let p = i;
      for (let r = i + 1; r < 4; r++) if (Math.abs(a[r][i]) > Math.abs(a[p][i])) p = r;
      if (p !== i) { [a[i], a[p]] = [a[p], a[i]]; [I[i], I[p]] = [I[p], I[i]]; }
      const piv = a[i][i];
      if (Math.abs(piv) < 1e-12) return null;
      for (let j = 0; j < 4; j++) { a[i][j] /= piv; I[i][j] /= piv; }
      for (let r = 0; r < 4; r++) {
        if (r === i) continue;
        const f = a[r][i];
        for (let j = 0; j < 4; j++) { a[r][j] -= f * a[i][j]; I[r][j] -= f * I[i][j]; }
      }
    }
    return I;
  })();
  if (!inv) return null;
  const beta = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    let s = 0;
    for (let j = 0; j < 4; j++) s += inv[i][j] * xty[j];
    beta[i] = s;
  }
  // Forecast: RV_{N} = β_0 + β_d·RV_{N-1} + β_w·RV_w_{N-1} + β_m·RV_m_{N-1}
  const last = N - 1;
  const forecastRV = beta[0] + beta[1] * rv[last] + beta[2] * rvW[last] + beta[3] * rvM[last];
  if (!(forecastRV > 0) || !Number.isFinite(forecastRV)) return null;
  return Math.sqrt(forecastRV);
};

export const computePortfolioVolForecast = (returnsBySymbol, weightBySymbol) => {
  const symbols = Object.keys(weightBySymbol).filter(s => {
    const ret = returnsBySymbol[s];
    const w = weightBySymbol[s];
    return Array.isArray(ret) && ret.length >= 60 && Number.isFinite(w) && w > 0;
  });
  if (symbols.length === 0) {
    return { fitted: false, reason: 'no symbols with sufficient return history' };
  }
  // Per-asset forecasts (3 methods, ensemble = simple average)
  const perAsset = [];
  const volBySym = {};
  for (const sym of symbols) {
    const rets = returnsBySymbol[sym];
    const garchFit = fitGARCH11(rets);
    const garchVol = garchFit?.fitted ? garchFit.nextStepVol : null;
    const ewmaVol = computeEWMAVol(rets, 0.94);
    const harVol = computeHARRVol(rets);
    const valid = [garchVol, ewmaVol, harVol].filter(v => Number.isFinite(v) && v > 0);
    if (valid.length === 0) continue;
    const ensembleVol = valid.reduce((s, v) => s + v, 0) / valid.length;
    perAsset.push({
      symbol: sym,
      weight: weightBySymbol[sym],
      garchVol,
      ewmaVol,
      harVol,
      ensembleVol,
      methodsUsed: valid.length,
    });
    volBySym[sym] = ensembleVol;
  }
  if (perAsset.length === 0) return { fitted: false, reason: 'no asset forecasts' };
  // Empirical correlation matrix (Pearson on aligned tail)
  const minLen = Math.min(...perAsset.map(p => returnsBySymbol[p.symbol].length));
  const aligned = {};
  const means = {};
  const stds = {};
  for (const p of perAsset) {
    const tail = returnsBySymbol[p.symbol].slice(-minLen);
    aligned[p.symbol] = tail;
    const m = tail.reduce((s, v) => s + v, 0) / tail.length;
    means[p.symbol] = m;
    let v = 0;
    for (const r of tail) v += (r - m) ** 2;
    stds[p.symbol] = Math.sqrt(v / tail.length);
  }
  const corr = {};
  for (const a of perAsset) {
    corr[a.symbol] = {};
    for (const b of perAsset) {
      if (a.symbol === b.symbol) { corr[a.symbol][b.symbol] = 1; continue; }
      const ra = aligned[a.symbol], rb = aligned[b.symbol];
      let cov = 0;
      for (let i = 0; i < minLen; i++) cov += (ra[i] - means[a.symbol]) * (rb[i] - means[b.symbol]);
      cov /= minLen;
      const c = (stds[a.symbol] > 0 && stds[b.symbol] > 0)
        ? cov / (stds[a.symbol] * stds[b.symbol]) : 0;
      corr[a.symbol][b.symbol] = Math.max(-1, Math.min(1, c));
    }
  }
  // Portfolio variance: σ²_p = ΣΣ w_i w_j σ_i σ_j ρ_ij
  let portVar = 0;
  let weightedAvgVol = 0;
  let totalW = 0;
  for (const a of perAsset) {
    weightedAvgVol += a.weight * a.ensembleVol;
    totalW += a.weight;
    for (const b of perAsset) {
      portVar += a.weight * b.weight * a.ensembleVol * b.ensembleVol * corr[a.symbol][b.symbol];
    }
  }
  const portfolioVol = Math.sqrt(Math.max(0, portVar));
  const naiveSum = totalW > 0 ? weightedAvgVol / totalW : 0;
  // Diversification ratio = (Σ w_i σ_i) / σ_p   ≥ 1
  const diversificationRatio = portfolioVol > 0 ? naiveSum * totalW / portfolioVol : 1;
  return {
    fitted: true,
    perAsset,
    portfolioVol,            // 1-day, raw (multiply by √252 for annual)
    portfolioVolAnnual: portfolioVol * Math.sqrt(252),
    weightedAvgVol: naiveSum * totalW,
    diversificationRatio,
    correlationMatrix: corr,
    n: perAsset.length,
  };
};

// ────────── Tax-aware rebalancing optimizer (Phase 3o.86) ──────────
// Multi-objective trade-list construction:
//   1. Primary objective: minimize tracking error vs target weights
//      Σ_i (w_i - target_i)²  where w_i = (qty_i × mark_i) / NAV
//   2. Secondary objective: minimize realized tax cost
//   3. Constraint: cash-neutral (Σ buys = Σ sells, after slippage band)
//   4. Constraint: wash-sale-aware — flags lots that would realize a
//      loss within 30 days of a buy in the same symbol
//
// Approach:
//   For each over-weight position (current > target + driftThresholdPct):
//     - Compute sell qty needed to hit target
//     - Sort open lots by (loss-first, then long-term gains, then short-term gains)
//     - Skip lots that would trigger a wash-sale (any buy in same symbol in
//       the last `washWindowDays`)
//     - Select lots greedily until sell qty satisfied
//     - Compute realized gain/loss + tax owed using user's bracket rates
//   For each under-weight position:
//     - Compute buy qty needed to hit target
//     - Add to BUY queue (no tax cost, but consumes cash)
//   Cash reconciliation:
//     - If sells > buys: surplus cash (good — can be deployed to new positions
//       or held)
//     - If sells < buys: deficit (raise via additional sells of low-tax lots
//       OR scale down all buys proportionally)
//
// Inputs:
//   holdings:    [{ symbol, qty, mark, target?, sector? }]  // target in %
//   lotsBySymbol: { [symbol]: [{ qty, price (open), ts (ms), ageDays }] }
//   recentBuys:  [{ symbol, ts, qty }]  // for wash-sale check
//   cash:        number
//   options:     { driftThresholdPct=2, stRate=0.32, ltRate=0.20,
//                  washWindowDays=30, maxTaxBudget=Infinity, allowFractional=true }
//
// Returns:
//   {
//     trades: [{ symbol, side, qty, value, lots?: [...], realizedGain, taxImpact, washSaleFlag }],
//     metrics: {
//       trackingErrorBefore, trackingErrorAfter,
//       totalTaxCost, totalTradeValue,
//       cashFlowNet,             // sells - buys
//       washSaleSkipped,         // count of lot rows skipped due to wash-sale
//       feasible,                // false if cash deficit unresolvable
//     }
//   }
export const computeRebalancingOptimization = (holdings, lotsBySymbol, recentBuys, cash, options = {}) => {
  const driftThresholdPct = options.driftThresholdPct ?? 2;
  const stRate = options.stRate ?? 0.32;
  const ltRate = options.ltRate ?? 0.20;
  const washWindowDays = options.washWindowDays ?? 30;
  const maxTaxBudget = options.maxTaxBudget ?? Infinity;
  const allowFractional = options.allowFractional ?? true;
  const now = Date.now();
  const empty = {
    trades: [],
    metrics: {
      trackingErrorBefore: 0, trackingErrorAfter: 0,
      totalTaxCost: 0, totalTradeValue: 0, cashFlowNet: 0,
      washSaleSkipped: 0, feasible: true, totalNAV: 0,
    },
  };
  if (!Array.isArray(holdings) || holdings.length === 0) return empty;
  // Total NAV = positions market value + cash
  const positionsMV = holdings.reduce((s, h) => s + Math.abs((h.qty || 0) * (h.mark || 0)), 0);
  const totalNAV = positionsMV + (Number(cash) || 0);
  if (totalNAV <= 0) return empty;

  // Recent-buy lookup for wash-sale check
  const recentBuysBySym = {};
  for (const rb of (recentBuys || [])) {
    if (!rb?.symbol || !rb?.ts) continue;
    const ageDays = (now - rb.ts) / 86400000;
    if (ageDays <= washWindowDays) {
      if (!recentBuysBySym[rb.symbol]) recentBuysBySym[rb.symbol] = [];
      recentBuysBySym[rb.symbol].push({ ts: rb.ts, qty: Number(rb.qty) || 0 });
    }
  }

  // Tracking error before
  let teBefore = 0;
  for (const h of holdings) {
    const mv = Math.abs((h.qty || 0) * (h.mark || 0));
    const w = mv / totalNAV;
    const t = (h.target ?? null);
    if (t == null || !Number.isFinite(t)) continue;
    const target = t / 100;
    teBefore += (w - target) * (w - target);
  }

  // Build the trade plan
  const trades = [];
  let totalTaxCost = 0;
  let totalTradeValue = 0;
  let washSaleSkipped = 0;
  let buysQueue = [];
  let sellsQueue = [];

  for (const h of holdings) {
    if (h.target == null || !Number.isFinite(h.target)) continue;
    const mv = Math.abs((h.qty || 0) * (h.mark || 0));
    const currentPct = (mv / totalNAV) * 100;
    const driftPct = currentPct - h.target;
    if (Math.abs(driftPct) < driftThresholdPct) continue;

    const targetMV = (h.target / 100) * totalNAV;
    const dollarDelta = targetMV - mv;
    if (Math.abs(dollarDelta) < 1) continue;

    const action = dollarDelta > 0 ? 'BUY' : 'SELL';
    const px = Math.max(0.01, h.mark || 1);
    let qtyDelta = Math.abs(dollarDelta) / px;
    if (!allowFractional) qtyDelta = Math.floor(qtyDelta);
    const tradeValue = qtyDelta * px;
    if (tradeValue < 1) continue;

    if (action === 'BUY') {
      buysQueue.push({ symbol: h.symbol, qty: qtyDelta, price: px, value: tradeValue, drift: driftPct });
    } else {
      // SELL: tax-aware lot selection
      const lots = (lotsBySymbol?.[h.symbol] || []).slice();
      // Score each lot for "sell priority":
      //   - Loss → very negative score (sell first)
      //   - Long-term gain → moderate (sell with LT rate)
      //   - Short-term gain → highest score (avoid)
      const scored = lots.map(lot => {
        const gain = (h.mark - lot.price) * lot.qty;
        const isLT = (lot.ageDays || 0) >= 365;
        let score;
        if (gain < 0) score = -1000 + gain;
        else if (isLT) score = gain * ltRate;
        else score = gain * stRate;
        return { ...lot, gain, isLT, score };
      });
      scored.sort((a, b) => a.score - b.score);

      // Wash-sale check: if a lot would realize a loss AND there's a buy
      // in the same symbol within washWindowDays, flag and skip.
      const recentBuysOfSym = recentBuysBySym[h.symbol] || [];
      const hasRecentBuy = recentBuysOfSym.length > 0;

      const lotPlan = [];
      let qtyToSell = qtyDelta;
      let realizedGain = 0;
      let estTax = 0;
      let lotsWashSkipped = 0;
      for (const lot of scored) {
        if (qtyToSell <= 0) break;
        // Skip if this is a loss lot AND we have a recent buy in same symbol.
        // The IRS wash-sale rule disallows the loss; selling here would be useless
        // (we'd realize the loss but not get to deduct it). So skip and emit a flag.
        if (lot.gain < 0 && hasRecentBuy) {
          lotsWashSkipped++;
          continue;
        }
        const lotQty = Math.min(qtyToSell, lot.qty || 0);
        if (lotQty <= 0) continue;
        const lotGain = (h.mark - lot.price) * lotQty;
        const isLT = (lot.ageDays || 0) >= 365;
        const lotTax = lotGain > 0 ? lotGain * (isLT ? ltRate : stRate) : 0;
        realizedGain += lotGain;
        estTax += lotTax;
        lotPlan.push({ openPrice: lot.price, qty: lotQty, ageDays: lot.ageDays, gain: lotGain, isLT, taxImpact: lotTax });
        qtyToSell -= lotQty;
      }
      washSaleSkipped += lotsWashSkipped;

      // If we couldn't find enough lots (e.g. wash-sale blocked too much),
      // emit a partial trade — the SELL will still execute on the actual
      // shares (FIFO at the broker), but we surface the lot constraint.
      const realQtySold = qtyDelta - qtyToSell;
      if (realQtySold <= 0) {
        // Entire sell blocked — emit a notice trade (washSaleFlag=true)
        sellsQueue.push({
          symbol: h.symbol, qty: 0, price: px, value: 0,
          drift: driftPct, lots: [], realizedGain: 0, taxImpact: 0,
          washSaleFlag: true,
          note: `${lotsWashSkipped} loss lots blocked by wash-sale rule (recent buy within ${washWindowDays}d)`,
        });
        continue;
      }
      const realTradeValue = realQtySold * px;
      totalTaxCost += estTax;
      totalTradeValue += realTradeValue;
      sellsQueue.push({
        symbol: h.symbol, qty: realQtySold, price: px, value: realTradeValue,
        drift: driftPct, lots: lotPlan, realizedGain, taxImpact: estTax,
        washSaleFlag: lotsWashSkipped > 0,
        ...(qtyToSell > 0 ? { note: `partial: ${realQtySold.toFixed(2)} of requested ${qtyDelta.toFixed(2)} (${lotsWashSkipped} loss lots wash-sale blocked)` } : {}),
      });
    }
  }

  // Cash reconciliation
  const sellTotal = sellsQueue.reduce((s, t) => s + t.value, 0);
  const buyTotal = buysQueue.reduce((s, t) => s + t.value, 0);
  const availableForBuys = sellTotal + (Number(cash) || 0);
  let feasible = true;
  if (buyTotal > availableForBuys) {
    // Scale down buys proportionally
    const scale = availableForBuys / Math.max(0.01, buyTotal);
    if (scale < 0.5) feasible = false;
    buysQueue = buysQueue.map(b => ({
      ...b,
      qty: b.qty * scale,
      value: b.value * scale,
    }));
  }
  for (const t of buysQueue) totalTradeValue += t.value;

  // If tax cost exceeds budget, skip the highest-tax sells
  if (totalTaxCost > maxTaxBudget) {
    sellsQueue.sort((a, b) => (b.taxImpact || 0) - (a.taxImpact || 0));
    while (totalTaxCost > maxTaxBudget && sellsQueue.length > 0) {
      const cut = sellsQueue.shift();
      totalTaxCost -= (cut.taxImpact || 0);
      totalTradeValue -= cut.value;
    }
    feasible = false; // if we hit the cap, the user's targets aren't reachable
  }

  // Compose final trade list — sells first (cash raise), then buys
  for (const t of sellsQueue) {
    trades.push({
      symbol: t.symbol, side: 'SELL',
      qty: t.qty, price: t.price, value: t.value,
      drift: t.drift,
      lots: t.lots, realizedGain: t.realizedGain, taxImpact: t.taxImpact,
      washSaleFlag: t.washSaleFlag, note: t.note,
    });
  }
  for (const t of buysQueue) {
    trades.push({
      symbol: t.symbol, side: 'BUY',
      qty: t.qty, price: t.price, value: t.value,
      drift: t.drift,
      lots: null, realizedGain: 0, taxImpact: 0,
      washSaleFlag: false,
    });
  }

  // Tracking error AFTER trades
  let teAfter = 0;
  for (const h of holdings) {
    if (h.target == null || !Number.isFinite(h.target)) continue;
    const tradesForSym = trades.filter(t => t.symbol === h.symbol);
    let netDelta = 0;
    for (const t of tradesForSym) netDelta += (t.side === 'BUY' ? +1 : -1) * t.value;
    const newMV = Math.abs((h.qty || 0) * (h.mark || 0)) + netDelta;
    const newW = newMV / totalNAV;
    const target = h.target / 100;
    teAfter += (newW - target) * (newW - target);
  }

  return {
    trades,
    metrics: {
      trackingErrorBefore: Math.sqrt(teBefore),
      trackingErrorAfter:  Math.sqrt(teAfter),
      totalTaxCost,
      totalTradeValue,
      cashFlowNet: sellTotal - buyTotal,
      washSaleSkipped,
      feasible,
      totalNAV,
    },
  };
};
