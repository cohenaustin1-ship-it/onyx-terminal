// IMO Onyx Terminal — quant pairs-trading module
//
// Phase 3o.91 (file split, batch 3): extracted from JPMOnyxTerminal.jsx.
// Cointegration screener (Engle-Granger procedure) plus pair-trade
// plan generator. Pure functions — takes price/return series and
// parameters, returns hedge ratios, half-lives, z-scores, and trade
// signals.
//
// Exports:
//   computeOLSHedgeRatio(yReturns, xReturns)
//     → number | null     (slope-only OLS β)
//
//   computeSpreadHalfLife(spread)
//     → number             (half-life in periods, ∞ if not mean-reverting)
//
//   findCointegratedPairs({ priceSeriesBySymbol, confidencePct, maxPairs })
//     → [{ y, x, beta, halfLife, currentZ, adfStat, ... }]
//     Engle-Granger 2-step:
//       1. OLS regress Y on X → hedge ratio β
//       2. Compute spread = Y - β·X
//       3. ADF test on spread; pair is cointegrated if stationary
//       4. Compute spread half-life + current Z-score
//       5. Rank by ADF significance + practicality
//
//   buildPairTradePlan({ ySeries, xSeries, ySymbol, xSymbol,
//                        entryZ, exitZ, stopZ, lookback })
//     → { hedge, spreadHistory, zScores, signals, backtest }
//     Standard pairs trading rules:
//       Entry long-spread:   z ≤ −entryZ
//       Entry short-spread:  z ≥ +entryZ
//       Exit:                |z| ≤ exitZ
//       Stop loss:           |z| ≥ stopZ

// ════════════════════════════════════════════════════════════════════
// PAIRS TRADING SCREENER
// ════════════════════════════════════════════════════════════════════
//
// Find cointegrated pairs from a universe. Engle-Granger procedure:
//   1. For each pair (Y, X), regress Y on X via OLS to get hedge ratio β
//   2. Compute spread = Y - β·X
//   3. Run ADF on the spread; if stationary (ADF stat < critical value),
//      the pair is cointegrated
//   4. Compute spread half-life (mean-reversion speed) via OLS of
//      Δspread on lagged spread
//   5. Compute current Z-score of the spread = (cur - mean) / stddev
//   6. Rank pairs by ADF significance + practicality of trade

// computeOLSHedgeRatio — simple OLS β (slope-only, no intercept):
// β = sum(x*y) / sum(x²)
export const computeOLSHedgeRatio = (yReturns, xReturns) => {
  const n = Math.min(yReturns.length, xReturns.length);
  if (n < 10) return null;
  const y = yReturns.slice(-n);
  const x = xReturns.slice(-n);
  let xx = 0, xy = 0;
  for (let i = 0; i < n; i++) {
    xx += x[i] * x[i];
    xy += x[i] * y[i];
  }
  return xx > 0 ? xy / xx : null;
};

// computeSpreadHalfLife — OLS regression of Δspread on lagged spread.
// half-life = -log(2) / log(1 + slope). Negative slope means mean-reverting.
export const computeSpreadHalfLife = (spread) => {
  if (spread.length < 20) return Infinity;
  const n = spread.length - 1;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (let i = 0; i < n; i++) {
    const x = spread[i];      // lagged
    const y = spread[i + 1] - spread[i]; // delta
    sumX += x; sumY += y; sumXY += x * y; sumXX += x * x;
  }
  const slope = (n * sumXY - sumX * sumY) / Math.max(1e-12, n * sumXX - sumX * sumX);
  if (slope >= 0) return Infinity; // not mean-reverting
  const halfLife = -Math.log(2) / Math.log(1 + slope);
  return halfLife > 0 ? halfLife : Infinity;
};

// findCointegratedPairs — screen a universe of symbols for cointegrated
// pairs. Each pair reports hedge ratio, current Z-score, half-life,
// and ADF p-value (approximated via critical-value comparison).
//
// Critical values from MacKinnon (Engle-Granger, no constant):
//   1%: -3.43, 5%: -2.86, 10%: -2.57
export const findCointegratedPairs = ({ priceSeriesBySymbol, confidencePct = 95, maxPairs = 20 }) => {
  const symbols = Object.keys(priceSeriesBySymbol).filter(s =>
    Array.isArray(priceSeriesBySymbol[s]) && priceSeriesBySymbol[s].length >= 50);
  const cv = confidencePct >= 99 ? -3.43 : confidencePct >= 95 ? -2.86 : -2.57;
  const pairs = [];
  for (let i = 0; i < symbols.length; i++) {
    for (let j = i + 1; j < symbols.length; j++) {
      const symY = symbols[i], symX = symbols[j];
      const Yp = priceSeriesBySymbol[symY];
      const Xp = priceSeriesBySymbol[symX];
      const minLen = Math.min(Yp.length, Xp.length);
      if (minLen < 50) continue;
      // Use log prices for cointegration testing (standard practice)
      const Y = Yp.slice(-minLen).map(p => Math.log(Math.max(0.01, p)));
      const X = Xp.slice(-minLen).map(p => Math.log(Math.max(0.01, p)));
      const beta = computeOLSHedgeRatio(Y, X);
      if (beta == null || !Number.isFinite(beta) || Math.abs(beta) > 10) continue;
      const spread = Y.map((y, k) => y - beta * X[k]);
      // Run ADF (use adfTest if available, otherwise inline)
      // Inline ADF: Δs_t = α + ρ·s_{t-1} + ε. Test ρ = 0.
      const dn = spread.length - 1;
      let sumX = 0, sumY = 0, sumXX = 0, sumXY = 0;
      for (let t = 0; t < dn; t++) {
        const xs = spread[t];
        const ys = spread[t + 1] - spread[t];
        sumX += xs; sumY += ys; sumXX += xs * xs; sumXY += xs * ys;
      }
      const meanX = sumX / dn;
      const meanY = sumY / dn;
      const denom = sumXX - dn * meanX * meanX;
      if (Math.abs(denom) < 1e-12) continue;
      const rho = (sumXY - dn * meanX * meanY) / denom;
      // Compute SE of rho
      let ssRes = 0;
      for (let t = 0; t < dn; t++) {
        const xs = spread[t];
        const ys = spread[t + 1] - spread[t];
        const fitted = meanY + rho * (xs - meanX);
        ssRes += (ys - fitted) ** 2;
      }
      const sigma2 = ssRes / Math.max(1, dn - 2);
      const seRho = Math.sqrt(sigma2 / denom);
      const adfStat = seRho > 0 ? rho / seRho : 0;
      if (adfStat >= cv) continue; // not stationary at this confidence
      // Compute spread Z-score (current vs in-sample mean/std)
      const spreadMean = spread.reduce((a, b) => a + b, 0) / spread.length;
      const spreadStd = Math.sqrt(spread.reduce((a, b) => a + (b - spreadMean) ** 2, 0) / spread.length);
      const curSpread = spread[spread.length - 1];
      const zScore = spreadStd > 0 ? (curSpread - spreadMean) / spreadStd : 0;
      const halfLife = computeSpreadHalfLife(spread);
      if (!Number.isFinite(halfLife) || halfLife > 60) continue; // too slow to mean-revert
      pairs.push({
        symY, symX,
        beta,
        adfStat,
        zScore,
        halfLife,
        spreadMean, spreadStd,
        curSpread,
      });
    }
  }
  // Rank: combination of |zScore| (extremity) and -adfStat (significance)
  pairs.sort((a, b) =>
    (Math.abs(b.zScore) + Math.abs(b.adfStat)) - (Math.abs(a.zScore) + Math.abs(a.adfStat)));
  return pairs.slice(0, maxPairs);
};

// buildPairTradePlan — given two cointegrated series + parameters,
// produces a complete trade plan:
//   - Hedge ratio β (OLS on log prices)
//   - Spread time series and z-score history
//   - Spread mean (μ) and σ
//   - Current z-score
//   - Entry/exit/stop signals based on threshold parameters
//   - Backtest of historical signals over the lookback window
//
// Standard pairs trading rules:
//   Entry long-spread:   z ≤ −entryZ  (spread cheap; long Y short X*β)
//   Entry short-spread:  z ≥ +entryZ  (spread rich; short Y long X*β)
//   Exit:                |z| ≤ exitZ
//   Stop loss:           |z| ≥ stopZ  (cointegration break-down)
export const buildPairTradePlan = ({
  ySeries, xSeries, ySymbol, xSymbol,
  entryZ = 2.0, exitZ = 0.5, stopZ = 4.0,
  lookback = 60,
}) => {
  if (!Array.isArray(ySeries) || !Array.isArray(xSeries)) return null;
  const minLen = Math.min(ySeries.length, xSeries.length);
  if (minLen < lookback + 10) return null;
  // Use log prices for stationary spread estimation
  const Y = ySeries.slice(-minLen).map(p => Math.log(Math.max(0.01, p)));
  const X = xSeries.slice(-minLen).map(p => Math.log(Math.max(0.01, p)));
  // OLS β with intercept (more stable than slope-only)
  let sumX = 0, sumY = 0, sumXX = 0, sumXY = 0;
  for (let i = 0; i < minLen; i++) {
    sumX += X[i]; sumY += Y[i]; sumXX += X[i] * X[i]; sumXY += X[i] * Y[i];
  }
  const meanX = sumX / minLen;
  const meanY = sumY / minLen;
  const denom = sumXX - minLen * meanX * meanX;
  if (Math.abs(denom) < 1e-12) return null;
  const beta = (sumXY - minLen * meanX * meanY) / denom;
  const alpha = meanY - beta * meanX;
  // Spread = Y − (α + β·X)
  const spread = Y.map((y, i) => y - alpha - beta * X[i]);
  // Z-scores using rolling lookback window
  const zScores = [];
  for (let i = 0; i < spread.length; i++) {
    const start = Math.max(0, i - lookback + 1);
    const window = spread.slice(start, i + 1);
    if (window.length < 10) { zScores.push(null); continue; }
    const m = window.reduce((s, v) => s + v, 0) / window.length;
    const v = window.reduce((s, x) => s + (x - m) ** 2, 0) / window.length;
    const std = Math.sqrt(v);
    zScores.push(std > 1e-10 ? (spread[i] - m) / std : 0);
  }
  // Generate signals — simple threshold strategy
  const signals = [];
  let position = 0; // 0 = flat, +1 = long-spread, -1 = short-spread
  let entryIdx = -1;
  let entryZAt = null;
  for (let i = 0; i < zScores.length; i++) {
    const z = zScores[i];
    if (z == null) continue;
    if (position === 0) {
      if (z <= -entryZ) {
        position = +1;
        entryIdx = i;
        entryZAt = z;
        signals.push({ idx: i, action: 'enter-long-spread', z, spread: spread[i] });
      } else if (z >= +entryZ) {
        position = -1;
        entryIdx = i;
        entryZAt = z;
        signals.push({ idx: i, action: 'enter-short-spread', z, spread: spread[i] });
      }
    } else if (position !== 0) {
      // Exit at mean reversion
      if (Math.abs(z) <= exitZ) {
        signals.push({
          idx: i, action: position > 0 ? 'exit-long-spread' : 'exit-short-spread',
          z, spread: spread[i],
          entrySpread: spread[entryIdx], entryZ: entryZAt,
          // P&L proxy: long spread profits when spread rises from entry
          pnl: position * (spread[i] - spread[entryIdx]),
          barsHeld: i - entryIdx,
        });
        position = 0;
        entryIdx = -1;
      } else if (Math.abs(z) >= stopZ) {
        signals.push({
          idx: i, action: 'stop',
          z, spread: spread[i],
          entrySpread: spread[entryIdx], entryZ: entryZAt,
          pnl: position * (spread[i] - spread[entryIdx]),
          barsHeld: i - entryIdx,
        });
        position = 0;
        entryIdx = -1;
      }
    }
  }
  // Backtest summary
  const closedTrades = signals.filter(s => s.action.startsWith('exit-') || s.action === 'stop');
  const winning = closedTrades.filter(t => t.pnl > 0).length;
  const totalPnL = closedTrades.reduce((s, t) => s + t.pnl, 0);
  const avgBarsHeld = closedTrades.length > 0
    ? closedTrades.reduce((s, t) => s + t.barsHeld, 0) / closedTrades.length
    : 0;
  // Current state
  const currentZ = zScores[zScores.length - 1];
  const currentSpread = spread[spread.length - 1];
  const recentMean = spread.slice(-lookback).reduce((s, v) => s + v, 0) / Math.min(lookback, spread.length);
  const recentVar = spread.slice(-lookback).reduce((s, v) => s + (v - recentMean) ** 2, 0) / Math.min(lookback, spread.length);
  const recentStd = Math.sqrt(recentVar);
  const currentSignal = (currentZ != null)
    ? (currentZ <= -entryZ ? 'enter-long-spread'
      : currentZ >= +entryZ ? 'enter-short-spread'
      : Math.abs(currentZ) <= exitZ ? 'flat / exit'
      : 'wait')
    : 'insufficient data';
  return {
    ySymbol, xSymbol,
    beta, alpha,
    spread,
    zScores,
    currentZ,
    currentSpread,
    recentMean,
    recentStd,
    currentSignal,
    signals,
    closedTrades,
    backtest: {
      trades: closedTrades.length,
      winning,
      winRate: closedTrades.length > 0 ? (winning / closedTrades.length) * 100 : 0,
      totalPnL,
      avgPnL: closedTrades.length > 0 ? totalPnL / closedTrades.length : 0,
      avgBarsHeld,
    },
    params: { entryZ, exitZ, stopZ, lookback },
    error: null,
  };
};
