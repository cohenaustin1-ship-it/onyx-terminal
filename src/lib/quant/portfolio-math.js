// IMO Onyx Terminal — quant portfolio-math module
//
// Phase 3o.90 (file split, batch 2): extracted from JPMOnyxTerminal.jsx.
// Continues the migration started in 3o.89 (which moved 8 GARCH/EWMA/
// rebalancing-optimizer helpers to ./risk-math.js).
//
// This module contains the bulk of the "RISK MANAGEMENT MODULE" block
// from the original monolith — 17 pure-function helpers + 1 data
// constant. All inputs are plain JS objects; all outputs are plain
// JS objects. Zero React, DOM, or localStorage dependencies.
//
// Exports:
//   STRESS_SCENARIOS                       — historical stress regimes
//   computePortfolioStats(holdings)        — gross/net MV, leverage, HHI
//   computeReturnStats(returns, rfDaily)   — Sharpe, Sortino, max DD
//   computePortfolioReturns(holdings)      — weight-blended return series
//   computeVaR(returns, mv, conf, horizon) — parametric + historical VaR/CVaR
//   computeBetaToBenchmark(pos, bench)     — single-factor beta + R²
//   computeCorrelationMatrixFromReturns(seriesByLabel)
//                                          — pairwise Pearson correlations
//   runStressTest(holdings, scenarioId)    — apply STRESS_SCENARIOS shocks
//   computePortfolioRiskBudget(holdings)   — risk-contribution decomposition
//   computeLiquidityRisk(holdings, pct)    — days-to-liquidate at participation
//   runMonteCarloPortfolio({...})          — multi-asset GBM Monte Carlo
//   computePerformanceAttribution(holdings, bench)
//                                          — Brinson allocation/selection
//   computeBrinsonFachler(holdings, bench, sectorReturnsBySector)
//                                          — sector-level attribution
//   computeCrossAssetCorrelation(portReturns, proxyReturnsBySymbol)
//                                          — rolling cross-asset corr
//   computeFamaFrench5Factor(portReturns, factorReturnsBySymbol)
//                                          — FF5 regression
//   computePortfolioFundamentals(holdings) — weighted P/E, P/B, dividend yld
//   computeRebalancePlan(holdings, opts)   — drift-band rebalance trades
//   computeTaxLossHarvestBacktest(prices, opts)
//                                          — historical TLH simulator
//
// Migration progress (cumulative across 3o.89 + 3o.90):
//   - 26 helpers + 1 constant extracted
//   - JPMOnyxTerminal.jsx: 126,891 → ~124,500 lines
//   - 2 modules in src/lib/quant/ totalling ~2,500 lines
//   - Build identical (Vite bundles the same regardless)
//
// Next batches (rough plan):
//   3o.91+: computeEqualRiskContribution + runBlackLitterman cluster
//           (Black-Litterman / risk-parity portfolio construction)
//   3o.92+: cointegration + pairs-trading helpers (computeOLSHedgeRatio,
//           computeSpreadHalfLife, findCointegratedPairs, ...)
//   3o.93+: backtest/strategy runners (runBacktest, runWalkForward,
//           runMonteCarloPermutation, runCrossSectional, runPairTrade,
//           runSeasonalStrategy)
//   3o.94+: leaf React components (LoadingSkeleton, PanelErrorBoundary,
//           KeyboardShortcutsOverlay, OnboardingModal, Pinnable)
//   3o.95+: page-level components (TradePage, RiskTabPanel, etc.)

// ════════════════════════════════════════════════════════════════════
// RISK MANAGEMENT MODULE
// ════════════════════════════════════════════════════════════════════
//
// Portfolio-level risk math + stress testing. All math is pure (no
// state, no side effects) so it can be reused from anywhere — the
// new RiskPage, the AI agent's tool calls, or backtest summaries.
//
// Inputs: an array of "holdings" of shape:
//   { symbol, qty, mark, costBasis, sector?, beta?, returns?: number[] }
// where `returns` is an optional array of historical daily returns
// (decimal, not percent) for the position. When provided, the math
// upgrades from analytical/parametric estimates to historical/empirical
// estimates wherever possible.
//
// Outputs: numbers + structured records. Format/render is up to caller.

// computePortfolioStats — returns gross/net exposure, leverage,
// long/short balance, concentration (HHI), and largest position %.
export const computePortfolioStats = (holdings) => {
  if (!Array.isArray(holdings) || holdings.length === 0) {
    return {
      grossMV: 0, netMV: 0, longMV: 0, shortMV: 0, leverage: 0,
      longShortRatio: 0, hhi: 0, largestWeight: 0, nPositions: 0,
    };
  }
  let longMV = 0, shortMV = 0;
  for (const h of holdings) {
    const mv = (Number(h.qty) || 0) * (Number(h.mark) || 0);
    if (mv > 0) longMV += mv;
    else        shortMV += -mv; // store as positive
  }
  const grossMV = longMV + shortMV;
  const netMV   = longMV - shortMV;
  const totalCapital = Math.max(grossMV, Math.abs(netMV)); // best estimate
  const leverage = totalCapital > 0 ? grossMV / totalCapital : 0;
  // HHI = sum of squared weights × 10,000 (scaled so 10000 = single position,
  // ~5000 = 2 equal-weight, ~3333 = 3 equal-weight, etc.)
  let hhi = 0;
  let largestWeight = 0;
  if (grossMV > 0) {
    for (const h of holdings) {
      const mv = Math.abs((Number(h.qty) || 0) * (Number(h.mark) || 0));
      const w = mv / grossMV;
      hhi += w * w;
      if (w > largestWeight) largestWeight = w;
    }
    hhi *= 10000;
  }
  return {
    grossMV, netMV, longMV, shortMV,
    leverage,
    longShortRatio: shortMV > 0 ? longMV / shortMV : Infinity,
    hhi,
    largestWeight,
    nPositions: holdings.filter(h => (Number(h.qty) || 0) !== 0).length,
  };
};

// computeReturnStats — given a returns series, return mean, stddev,
// downside deviation (only negative returns), Sharpe (annualized,
// risk-free rate at 0 for simplicity), Sortino, max drawdown.
export const computeReturnStats = (returns, rfDaily = 0) => {
  if (!Array.isArray(returns) || returns.length < 5) {
    return { mean: 0, stddev: 0, downside: 0, sharpe: 0, sortino: 0, maxDD: 0 };
  }
  const n = returns.length;
  const mean = returns.reduce((a, b) => a + b, 0) / n;
  let varSum = 0, downsideSum = 0, downsideN = 0;
  for (const r of returns) {
    varSum += (r - mean) ** 2;
    if (r < 0) {
      downsideSum += r * r;
      downsideN++;
    }
  }
  const stddev = Math.sqrt(varSum / n);
  const downside = downsideN > 0 ? Math.sqrt(downsideSum / downsideN) : 0;
  // Annualize (252 trading days)
  const meanAnn = mean * 252;
  const stddevAnn = stddev * Math.sqrt(252);
  const downsideAnn = downside * Math.sqrt(252);
  const sharpe = stddevAnn > 0 ? (meanAnn - rfDaily * 252) / stddevAnn : 0;
  const sortino = downsideAnn > 0 ? (meanAnn - rfDaily * 252) / downsideAnn : 0;
  // Max drawdown from cumulative product of (1+r)
  let eq = 1, peak = 1, maxDD = 0;
  for (const r of returns) {
    eq *= (1 + r);
    if (eq > peak) peak = eq;
    const dd = (eq - peak) / peak;
    if (dd < maxDD) maxDD = dd;
  }
  return { mean: meanAnn, stddev: stddevAnn, downside: downsideAnn, sharpe, sortino, maxDD };
};

// computePortfolioReturns — given holdings with per-position returns
// and qty*mark weights, build the portfolio's daily returns series.
// Returns the time-aligned weighted return array.
export const computePortfolioReturns = (holdings) => {
  const valid = holdings.filter(h =>
    Array.isArray(h.returns) && h.returns.length > 0 &&
    Number.isFinite(h.qty) && Number.isFinite(h.mark)
  );
  if (valid.length === 0) return [];
  // Align to the minimum length (drop earliest from longer series)
  const minLen = Math.min(...valid.map(h => h.returns.length));
  if (minLen < 5) return [];
  // Compute weights from current MV
  const totalMV = valid.reduce((s, h) => s + Math.abs(h.qty * h.mark), 0);
  if (totalMV <= 0) return [];
  const weights = valid.map(h => (h.qty * h.mark) / totalMV);
  // Trim each series to minLen and combine
  const trimmed = valid.map(h => h.returns.slice(-minLen));
  const portRets = new Array(minLen).fill(0);
  for (let i = 0; i < minLen; i++) {
    let r = 0;
    for (let j = 0; j < trimmed.length; j++) {
      r += weights[j] * trimmed[j][i];
    }
    portRets[i] = r;
  }
  return portRets;
};

// computeVaR — Value at Risk with multi-day horizon scaling. Two
// methods + two horizons:
//   parametric (variance-covariance, normal-distribution assumption):
//     1-day VaR = z * σ * portfolioMV
//     T-day VaR = z * σ * sqrt(T) * portfolioMV   (square-root-of-time)
//     z = 1.645 for 95%, 2.326 for 99%
//
//     Parametric CVaR (closed-form for normal):
//     CVaR_α = σ * φ(z) / (1-α)        where φ is the std-normal pdf
//
//   historical (empirical quantile of returns):
//     1-day VaR = -quantile(returns, 1-conf) * portfolioMV
//     T-day VaR scales similarly via √T (same Brownian assumption,
//     applied to whatever the empirical 1-day shape is)
//
// Returns: { varParametric, varHistorical, cvarParametric, cvarHistorical,
//            conf, horizonDays }
//   var* and cvar* are positive numbers (the dollar loss at risk).
// Phase 3o.90: GARCH/regime/AI-consensus helpers extracted to
// src/lib/quant/risk-math.js (fitGARCH11, forecastGARCHVol,
// decomposeDrawdownByRegime, computeAIvsAnalystConsensus)

export const computeVaR = (returns, portfolioMV, conf = 0.95, horizonDays = 1) => {
  if (!Array.isArray(returns) || returns.length < 20 || portfolioMV <= 0) {
    return {
      varParametric: 0, varHistorical: 0,
      cvarParametric: 0, cvarHistorical: 0,
      conf, horizonDays,
    };
  }
  const n = returns.length;
  const mean = returns.reduce((a, b) => a + b, 0) / n;
  const stddev = Math.sqrt(returns.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  const sqrtT = Math.sqrt(Math.max(1, horizonDays));
  // Parametric — assume normal returns, ignore drift (conservative)
  const z = conf >= 0.99 ? 2.326 : conf >= 0.95 ? 1.645 : 1.282;
  const varParametric = z * stddev * sqrtT * portfolioMV;
  // Parametric CVaR for normal: CVaR_α = (σ/(1-α)) * φ(z) where φ is std normal pdf
  // φ(z) = (1/√(2π)) * exp(-z²/2)
  const phi_z = (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-(z * z) / 2);
  const cvarParametric = (stddev / (1 - conf)) * phi_z * sqrtT * portfolioMV;
  // Historical — sort returns ascending, take (1 - conf) quantile
  const sorted = [...returns].sort((a, b) => a - b);
  const tailIdx = Math.floor(n * (1 - conf));
  const varReturn = -sorted[tailIdx];
  const varHistorical = Math.max(0, varReturn * sqrtT * portfolioMV);
  // CVaR (Expected Shortfall) — average of returns in the tail
  let cvarSum = 0;
  for (let i = 0; i <= tailIdx; i++) cvarSum += sorted[i];
  const cvarReturn = -(cvarSum / Math.max(1, tailIdx + 1));
  const cvarHistorical = Math.max(0, cvarReturn * sqrtT * portfolioMV);
  return {
    varParametric, varHistorical,
    cvarParametric, cvarHistorical,
    conf, horizonDays,
  };
};

// computeBetaToBenchmark — OLS regression of position returns on
// benchmark (e.g. SPY) returns. Returns slope (beta) + R² + alpha.
export const computeBetaToBenchmark = (positionReturns, benchmarkReturns) => {
  if (!Array.isArray(positionReturns) || !Array.isArray(benchmarkReturns)) {
    return { beta: 1, alpha: 0, r2: 0 };
  }
  const n = Math.min(positionReturns.length, benchmarkReturns.length);
  if (n < 10) return { beta: 1, alpha: 0, r2: 0 };
  const x = benchmarkReturns.slice(-n);
  const y = positionReturns.slice(-n);
  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;
  let num = 0, denom = 0, ssY = 0;
  for (let i = 0; i < n; i++) {
    num   += (x[i] - meanX) * (y[i] - meanY);
    denom += (x[i] - meanX) ** 2;
    ssY   += (y[i] - meanY) ** 2;
  }
  const beta = denom > 0 ? num / denom : 1;
  const alpha = meanY - beta * meanX;
  // R² = 1 - SSres/SStot
  let ssRes = 0;
  for (let i = 0; i < n; i++) {
    const fitted = alpha + beta * x[i];
    ssRes += (y[i] - fitted) ** 2;
  }
  const r2 = ssY > 0 ? Math.max(0, 1 - ssRes / ssY) : 0;
  return { beta, alpha: alpha * 252, r2 };  // alpha annualized
};

// computeCorrelationMatrixFromReturns — pairwise pearson correlations
// across multiple return series. Used for risk concentration heatmap.
export const computeCorrelationMatrixFromReturns = (seriesByLabel) => {
  const labels = Object.keys(seriesByLabel);
  const n = labels.length;
  if (n < 2) return { labels, matrix: [] };
  const minLen = Math.min(...labels.map(l => seriesByLabel[l].length));
  if (minLen < 5) return { labels, matrix: [] };
  const series = labels.map(l => seriesByLabel[l].slice(-minLen));
  const means = series.map(s => s.reduce((a, b) => a + b, 0) / minLen);
  const stds = series.map((s, i) => {
    const m = means[i];
    return Math.sqrt(s.reduce((a, b) => a + (b - m) ** 2, 0) / minLen);
  });
  const matrix = [];
  for (let i = 0; i < n; i++) {
    const row = [];
    for (let j = 0; j < n; j++) {
      if (i === j) { row.push(1); continue; }
      let cov = 0;
      for (let k = 0; k < minLen; k++) {
        cov += (series[i][k] - means[i]) * (series[j][k] - means[j]);
      }
      cov /= minLen;
      const c = (stds[i] > 0 && stds[j] > 0) ? cov / (stds[i] * stds[j]) : 0;
      row.push(Math.max(-1, Math.min(1, c)));
    }
    matrix.push(row);
  }
  return { labels, matrix };
};

// STRESS_SCENARIOS — historical regimes with rough sector-shock
// magnitudes. When user runs a stress test we apply these shocks to
// each position based on its sector (or symbol-specific override
// where listed). All values are decimal returns (negative = loss).
//
// Shock estimates are calibrated to peak-to-trough during each event.
// They're approximations; real risk teams use actual historical
// returns from the period. For an in-app demonstration these are
// reasonable representative magnitudes.
export const STRESS_SCENARIOS = [
  {
    id: '2008-gfc',
    label: '2008 Financial Crisis',
    description: 'Sept 2008 – Mar 2009 (Lehman → market trough). SPX -52%, financials hit hardest.',
    icon: 'TrendingDown',
    sectorShocks: {
      'Financials':         -0.65,
      'Real Estate':        -0.62,
      'Discretionary':      -0.55,
      'Tech':               -0.45,
      'Industrials':        -0.50,
      'Materials':          -0.55,
      'Energy':             -0.45,
      'Utilities':          -0.30,
      'Health Care':        -0.32,
      'Staples':            -0.25,
      'Communications':     -0.45,
      '__default__':        -0.45,
    },
  },
  {
    id: '2020-covid',
    label: '2020 COVID Crash',
    description: 'Feb 19 – Mar 23, 2020 (5-week selloff). SPX -34%, energy and travel hit hardest.',
    icon: 'AlertTriangle',
    sectorShocks: {
      'Energy':             -0.60,
      'Financials':         -0.42,
      'Real Estate':        -0.40,
      'Industrials':        -0.40,
      'Materials':          -0.38,
      'Discretionary':      -0.35,
      'Utilities':          -0.35,
      'Communications':     -0.30,
      'Tech':               -0.25,
      'Health Care':        -0.20,
      'Staples':            -0.18,
      '__default__':        -0.34,
    },
  },
  {
    id: '2022-tech',
    label: '2022 Tech / Rate Selloff',
    description: 'Jan – Oct 2022. SPX -25%, NASDAQ -33%. Long-duration assets hit hardest by rate rises.',
    icon: 'Activity',
    sectorShocks: {
      'Tech':               -0.35,
      'Communications':     -0.40,
      'Discretionary':      -0.35,
      'Real Estate':        -0.30,
      'Financials':         -0.20,
      'Industrials':        -0.20,
      'Materials':          -0.18,
      'Health Care':        -0.10,
      'Staples':            -0.08,
      'Utilities':          -0.10,
      'Energy':             +0.45, // big up year for energy
      '__default__':        -0.25,
    },
  },
  {
    id: 'rates-up-200',
    label: 'Rates +200bp Shock',
    description: 'Synthetic: 200 basis point parallel shift up in the yield curve.',
    icon: 'TrendingUp',
    sectorShocks: {
      'Real Estate':        -0.20,
      'Tech':               -0.18,
      'Communications':     -0.15,
      'Discretionary':      -0.15,
      'Utilities':          -0.18,
      'Staples':            -0.12,
      'Financials':         +0.05, // banks benefit modestly
      'Health Care':        -0.10,
      'Energy':             -0.05,
      'Industrials':        -0.10,
      'Materials':          -0.10,
      '__default__':        -0.12,
    },
  },
  {
    id: 'oil-shock',
    label: 'Oil +50% Shock',
    description: 'Synthetic: WTI crude jumps 50% over 30 days (geopolitical / supply shock).',
    icon: 'Flame',
    sectorShocks: {
      'Energy':             +0.30,
      'Materials':          +0.05,
      'Industrials':        -0.10,
      'Discretionary':      -0.15, // consumer pinch
      'Tech':               -0.05,
      'Financials':         -0.05,
      'Real Estate':        -0.05,
      'Utilities':          -0.08,
      'Staples':            -0.05,
      'Health Care':        -0.03,
      'Communications':     -0.05,
      '__default__':        -0.05,
    },
  },
  {
    id: '2018-volmageddon',
    label: '2018 Volmageddon',
    description: 'Feb 5, 2018 single-day VIX spike (XIV blow-up). SPX -4% intraday, vol products -90%+.',
    icon: 'Activity',
    sectorShocks: {
      'Tech':               -0.06,
      'Discretionary':      -0.05,
      'Communications':     -0.05,
      'Financials':         -0.05,
      'Industrials':        -0.05,
      'Materials':          -0.04,
      'Energy':             -0.04,
      'Real Estate':        -0.04,
      'Health Care':        -0.03,
      'Utilities':          -0.02,
      'Staples':            -0.02,
      '__default__':        -0.04,
    },
  },
  {
    id: '2023-banking',
    label: '2023 Regional Banking',
    description: 'Mar 9-13 2023 (SVB / Signature / First Republic). KRE -28%, regional banks -40-50%.',
    icon: 'Building2',
    sectorShocks: {
      'Financials':         -0.35,    // regionals worse than mega-banks
      'Real Estate':        -0.12,    // CRE concerns
      'Tech':               +0.04,    // benefited from rate-cut expectations
      'Discretionary':      -0.05,
      'Communications':     -0.03,
      'Industrials':        -0.06,
      'Materials':          -0.04,
      'Energy':             -0.06,
      'Health Care':        -0.02,
      'Staples':            +0.01,
      'Utilities':          +0.02,
      '__default__':        -0.05,
    },
  },
  {
    id: '1987-black-monday',
    label: '1987 Black Monday',
    description: 'Oct 19, 1987 single-session crash. SPX -22.6% in one day. Synthetic application to current portfolio.',
    icon: 'AlertTriangle',
    sectorShocks: {
      'Tech':               -0.25,
      'Financials':         -0.28,
      'Discretionary':      -0.24,
      'Industrials':        -0.23,
      'Materials':          -0.22,
      'Energy':             -0.20,
      'Communications':     -0.22,
      'Real Estate':        -0.22,
      'Utilities':          -0.18,
      'Health Care':        -0.18,
      'Staples':            -0.18,
      '__default__':        -0.22,
    },
  },
  {
    id: 'inflation-spike',
    label: 'Inflation Re-acceleration',
    description: 'Synthetic: CPI prints jump from 3% → 5%+; Fed forced into another hike cycle.',
    icon: 'TrendingUp',
    sectorShocks: {
      'Tech':               -0.18,
      'Real Estate':        -0.20,
      'Communications':     -0.15,
      'Discretionary':      -0.18,
      'Utilities':          -0.12,
      'Financials':         +0.03,
      'Energy':             +0.18,
      'Materials':          +0.05,
      'Industrials':        -0.08,
      'Health Care':        -0.05,
      'Staples':            -0.03,
      '__default__':        -0.10,
    },
  },
];

// runStressTest — apply a scenario's sector shocks to a holdings
// list. Returns { totalPnL, totalPnLPct, perPosition: [...], byScenario }
export const runStressTest = (holdings, scenarioId) => {
  const scenario = STRESS_SCENARIOS.find(s => s.id === scenarioId);
  if (!scenario || !Array.isArray(holdings) || holdings.length === 0) {
    return { totalPnL: 0, totalPnLPct: 0, perPosition: [], scenario: null };
  }
  const perPosition = [];
  let totalPnL = 0;
  let totalMV = 0;
  for (const h of holdings) {
    const mv = (Number(h.qty) || 0) * (Number(h.mark) || 0);
    if (mv === 0) continue;
    const sector = h.sector || '__default__';
    const shock = scenario.sectorShocks[sector] ?? scenario.sectorShocks['__default__'];
    // Shock direction is the price-change. P&L = qty * Δprice = mv * shock
    const pnl = mv * shock;
    totalPnL += pnl;
    totalMV += Math.abs(mv);
    perPosition.push({
      symbol: h.symbol,
      sector,
      mv,
      shock,
      pnl,
      pctOfPortfolio: 0, // filled in after totalMV is known
    });
  }
  // Sort by magnitude of P&L (worst first)
  for (const p of perPosition) {
    p.pctOfPortfolio = totalMV > 0 ? Math.abs(p.mv) / totalMV : 0;
  }
  perPosition.sort((a, b) => a.pnl - b.pnl);
  return {
    totalPnL,
    totalPnLPct: totalMV > 0 ? totalPnL / totalMV : 0,
    perPosition,
    scenario,
  };
};

// computePortfolioRiskBudget — risk contribution of each position to
// total portfolio variance. For position i, contribution = w_i * (Cov*w)_i / σ²_p
// where Cov is the covariance matrix and w is the weight vector.
export const computePortfolioRiskBudget = (holdings) => {
  const valid = holdings.filter(h =>
    Array.isArray(h.returns) && h.returns.length > 5 &&
    Number.isFinite(h.qty) && Number.isFinite(h.mark)
  );
  if (valid.length === 0) {
    return { perPosition: [], totalVar: 0 };
  }
  const minLen = Math.min(...valid.map(h => h.returns.length));
  if (minLen < 10) return { perPosition: [], totalVar: 0 };
  const series = valid.map(h => h.returns.slice(-minLen));
  const totalMV = valid.reduce((s, h) => s + Math.abs(h.qty * h.mark), 0);
  if (totalMV <= 0) return { perPosition: [], totalVar: 0 };
  const weights = valid.map(h => (h.qty * h.mark) / totalMV);
  const n = valid.length;
  // Build covariance matrix
  const means = series.map(s => s.reduce((a, b) => a + b, 0) / minLen);
  const cov = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      let s = 0;
      for (let k = 0; k < minLen; k++) {
        s += (series[i][k] - means[i]) * (series[j][k] - means[j]);
      }
      cov[i][j] = cov[j][i] = s / minLen;
    }
  }
  // Compute Cov*w
  const covW = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      covW[i] += cov[i][j] * weights[j];
    }
  }
  // Total portfolio variance = w' Cov w
  let totalVar = 0;
  for (let i = 0; i < n; i++) totalVar += weights[i] * covW[i];
  // Per-position marginal contribution to total variance
  const perPosition = valid.map((h, i) => ({
    symbol: h.symbol,
    weight: weights[i],
    riskContribution: totalVar > 0 ? (weights[i] * covW[i]) / totalVar : 0,
    marginalContribution: covW[i],
  }));
  perPosition.sort((a, b) => Math.abs(b.riskContribution) - Math.abs(a.riskContribution));
  return { perPosition, totalVar };
};

// computeLiquidityRisk — days-to-liquidate per position assuming we
// take no more than `participationPct` of average daily volume per
// day. Standard institutional rule of thumb: trading >10% of ADV
// in a single day moves the market against you, so 10% is a typical
// non-impact participation cap. Default 10%.
//
// Inputs:
//   holdings: [{ symbol, qty, mark, adv? }] (adv = avg daily volume in shares)
// Output:
//   { perPosition: [{symbol, qty, mark, mv, adv, daysToLiquidate, liquidityScore}],
//     portfolioDaysToLiquidate: number, weightedAvg: number,
//     concentrationDays: number, illiquidPositions: number }
//
// liquidityScore is 0-100 where 100 = fully liquid (≤1 day to exit).
// The score scales: 1 day → 100, 5 days → 50, 20 days → 10, 60 days → 0.
export const computeLiquidityRisk = (holdings, participationPct = 0.10) => {
  if (!Array.isArray(holdings) || holdings.length === 0) {
    return {
      perPosition: [],
      portfolioDaysToLiquidate: 0,
      weightedAvg: 0,
      concentrationDays: 0,
      illiquidPositions: 0,
    };
  }
  const perPosition = [];
  let totalMV = 0;
  let weightedDaysSum = 0;
  let maxDays = 0;
  let illiquidCount = 0;
  for (const h of holdings) {
    const qty = Math.abs(Number(h.qty) || 0);
    const mark = Number(h.mark) || 0;
    const mv = qty * mark;
    if (qty === 0 || mark === 0) continue;
    const adv = Number(h.adv) || 0;
    let daysToLiquidate;
    if (adv > 0) {
      // Days = qty / (participationPct * adv)
      daysToLiquidate = qty / (participationPct * adv);
    } else {
      // No ADV data — flag as illiquid with sentinel value
      daysToLiquidate = null;
    }
    let liquidityScore;
    if (daysToLiquidate == null) liquidityScore = 0;
    else if (daysToLiquidate <= 1) liquidityScore = 100;
    else if (daysToLiquidate <= 5) liquidityScore = 100 - (daysToLiquidate - 1) * 12.5; // 100 → 50
    else if (daysToLiquidate <= 20) liquidityScore = 50 - (daysToLiquidate - 5) * 2.67; // 50 → 10
    else if (daysToLiquidate <= 60) liquidityScore = Math.max(0, 10 - (daysToLiquidate - 20) * 0.25);
    else liquidityScore = 0;
    perPosition.push({
      symbol: h.symbol,
      qty,
      mark,
      mv,
      adv,
      daysToLiquidate,
      liquidityScore,
    });
    totalMV += mv;
    if (daysToLiquidate != null) {
      weightedDaysSum += daysToLiquidate * mv;
      if (daysToLiquidate > maxDays) maxDays = daysToLiquidate;
      if (daysToLiquidate > 5) illiquidCount++;
    } else {
      illiquidCount++;
    }
  }
  perPosition.sort((a, b) => (b.daysToLiquidate ?? Infinity) - (a.daysToLiquidate ?? Infinity));
  const weightedAvg = totalMV > 0 ? weightedDaysSum / totalMV : 0;
  return {
    perPosition,
    portfolioDaysToLiquidate: maxDays, // worst position drives the timeline
    weightedAvg,
    concentrationDays: maxDays,
    illiquidPositions: illiquidCount,
  };
};

// runMonteCarloPortfolio — simulate the portfolio's value over a
// horizon using Geometric Brownian Motion driven by per-position
// historical mean + vol + correlations.
//
// Approach:
//   1. Compute mean & stddev per position from the supplied returns
//   2. Build a correlation matrix and Cholesky-decompose it
//   3. For each path: draw uncorrelated normals, multiply by Cholesky
//      to get correlated shocks, propagate each position day-by-day
//      using GBM increments r_i = mu_i + sigma_i * shock_i
//   4. Aggregate to portfolio MV, store the path
//   5. Compute percentiles + probability of hitting various levels
//
// Output:
//   {
//     paths: [[v0, v1, ..., vT], ...]  (subset of paths for chart)
//     percentiles: { p5, p25, p50, p75, p95 }  arrays of length T+1
//     finalDistribution: number[]  (each path's final value)
//     probLossOver: { '5pct': 0.12, '10pct': 0.06, '20pct': 0.01 }
//     probGainOver: { '5pct': 0.55, '10pct': 0.42, '20pct': 0.18 }
//     expected: number  (mean of finalDistribution)
//     median: number
//     worstCase5pct: number  (5th percentile of final value)
//   }
export const runMonteCarloPortfolio = ({
  holdings,
  horizonDays = 60,
  numPaths = 1000,
  startMV = null,
} = {}) => {
  const empty = {
    paths: [], percentiles: { p5: [], p25: [], p50: [], p75: [], p95: [] },
    finalDistribution: [], probLossOver: {}, probGainOver: {},
    expected: 0, median: 0, worstCase5pct: 0,
  };
  if (!Array.isArray(holdings) || holdings.length === 0) return empty;
  // Filter to positions with sufficient return history
  const valid = holdings.filter(h =>
    Array.isArray(h.returns) && h.returns.length >= 30 &&
    Number.isFinite(h.qty) && Number.isFinite(h.mark)
  );
  if (valid.length === 0) return empty;
  const minLen = Math.min(...valid.map(h => h.returns.length));
  if (minLen < 30) return empty;
  const series = valid.map(h => h.returns.slice(-minLen));
  const n = valid.length;
  // Per-position mean, stddev
  const means = series.map(s => s.reduce((a, b) => a + b, 0) / minLen);
  const stds = series.map((s, i) => {
    const m = means[i];
    return Math.sqrt(s.reduce((a, b) => a + (b - m) ** 2, 0) / minLen);
  });
  // Correlation matrix
  const corrM = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    corrM[i][i] = 1;
    for (let j = i + 1; j < n; j++) {
      let cov = 0;
      for (let k = 0; k < minLen; k++) {
        cov += (series[i][k] - means[i]) * (series[j][k] - means[j]);
      }
      cov /= minLen;
      const c = (stds[i] > 0 && stds[j] > 0) ? cov / (stds[i] * stds[j]) : 0;
      corrM[i][j] = corrM[j][i] = Math.max(-0.99, Math.min(0.99, c));
    }
  }
  // Cholesky decomposition: L*L' = corrM (lower triangular)
  // Numerically stable for positive-definite matrices
  const L = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = 0;
      for (let k = 0; k < j; k++) s += L[i][k] * L[j][k];
      if (i === j) {
        const diag = corrM[i][i] - s;
        L[i][j] = diag > 0 ? Math.sqrt(diag) : 0.001;
      } else {
        L[i][j] = L[j][j] !== 0 ? (corrM[i][j] - s) / L[j][j] : 0;
      }
    }
  }
  // Position MVs at start
  const startMVs = valid.map(h => h.qty * h.mark);
  const startTotal = startMV ?? startMVs.reduce((a, b) => a + Math.abs(b), 0);
  // Box-Muller for standard normal
  const randNorm = () => {
    const u1 = Math.random() || 1e-9;
    const u2 = Math.random();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };
  // Run paths
  const paths = []; // store all paths but trim later
  const finalDist = [];
  for (let p = 0; p < numPaths; p++) {
    const positionMVs = startMVs.slice();
    const path = [positionMVs.reduce((a, b) => a + b, 0)];
    for (let t = 1; t <= horizonDays; t++) {
      // Draw n uncorrelated normals, transform via L for correlated shocks
      const z = new Array(n);
      for (let i = 0; i < n; i++) z[i] = randNorm();
      // shock_i = sum_j L[i][j] * z[j]
      for (let i = 0; i < n; i++) {
        let shock = 0;
        for (let j = 0; j <= i; j++) shock += L[i][j] * z[j];
        const r = means[i] + stds[i] * shock;
        positionMVs[i] = positionMVs[i] * (1 + r);
      }
      path.push(positionMVs.reduce((a, b) => a + b, 0));
    }
    paths.push(path);
    finalDist.push(path[path.length - 1]);
  }
  // Compute percentiles for each timestep
  const T = horizonDays + 1;
  const percentiles = { p5: [], p25: [], p50: [], p75: [], p95: [] };
  for (let t = 0; t < T; t++) {
    const col = paths.map(p => p[t]).sort((a, b) => a - b);
    percentiles.p5.push(col[Math.floor(numPaths * 0.05)]);
    percentiles.p25.push(col[Math.floor(numPaths * 0.25)]);
    percentiles.p50.push(col[Math.floor(numPaths * 0.50)]);
    percentiles.p75.push(col[Math.floor(numPaths * 0.75)]);
    percentiles.p95.push(col[Math.floor(numPaths * 0.95)]);
  }
  finalDist.sort((a, b) => a - b);
  const expected = finalDist.reduce((a, b) => a + b, 0) / numPaths;
  const median = finalDist[Math.floor(numPaths / 2)];
  const worstCase5pct = finalDist[Math.floor(numPaths * 0.05)];
  // Probability of various drawdowns / gains
  const probLossOver = {};
  const probGainOver = {};
  for (const pct of [5, 10, 20, 30]) {
    const lossThresh = startTotal * (1 - pct / 100);
    const gainThresh = startTotal * (1 + pct / 100);
    probLossOver[`${pct}pct`] = finalDist.filter(v => v < lossThresh).length / numPaths;
    probGainOver[`${pct}pct`] = finalDist.filter(v => v > gainThresh).length / numPaths;
  }
  // Subsample paths for chart rendering (50 representative paths)
  const subsample = [];
  const step = Math.max(1, Math.floor(numPaths / 50));
  for (let i = 0; i < numPaths; i += step) subsample.push(paths[i]);
  return {
    paths: subsample,
    percentiles,
    finalDistribution: finalDist,
    probLossOver,
    probGainOver,
    expected,
    median,
    worstCase5pct,
    startMV: startTotal,
  };
};

// computePerformanceAttribution — decompose portfolio return into:
//   - market beta contribution: β × (benchmark return)
//   - sector contribution: sector tilt vs benchmark sectors
//   - security selection (alpha residual): position-level alpha
//
// Inputs:
//   holdings: [{ symbol, qty, mark, returns, sector, beta? }]
//   benchmarkReturns: number[]
// Output:
//   {
//     totalReturn: number  (% over the period)
//     beta: number  (portfolio beta)
//     marketContribution: number  (β × benchmark return)
//     sectorContribution: number  (sector tilt effect)
//     securitySelection: number  (residual alpha)
//     perPosition: [{symbol, weight, return, contribution, alphaReturn}]
//   }
export const computePerformanceAttribution = (holdings, benchmarkReturns) => {
  const empty = {
    totalReturn: 0, beta: 1,
    marketContribution: 0, sectorContribution: 0, securitySelection: 0,
    perPosition: [],
  };
  if (!Array.isArray(holdings) || holdings.length === 0) return empty;
  if (!Array.isArray(benchmarkReturns) || benchmarkReturns.length < 5) return empty;
  // Compute the period's benchmark return (simple sum of returns for now;
  // could also use cumulative product (1+r) - 1 for compound)
  const benchPeriodRet = benchmarkReturns.reduce((s, r) => s + r, 0);
  // Per-position computation
  const valid = holdings.filter(h =>
    Array.isArray(h.returns) && h.returns.length >= 5 &&
    Number.isFinite(h.qty) && Number.isFinite(h.mark)
  );
  if (valid.length === 0) return empty;
  const minLen = Math.min(...valid.map(h => h.returns.length), benchmarkReturns.length);
  if (minLen < 5) return empty;
  const trimmedBench = benchmarkReturns.slice(-minLen);
  const totalMV = valid.reduce((s, h) => s + Math.abs(h.qty * h.mark), 0);
  if (totalMV <= 0) return empty;
  // Per-position return, beta vs bench, contribution
  const perPosition = valid.map(h => {
    const trimmed = h.returns.slice(-minLen);
    const positionRet = trimmed.reduce((s, r) => s + r, 0);
    // Beta of this position vs benchmark
    const meanX = trimmedBench.reduce((a, b) => a + b, 0) / minLen;
    const meanY = trimmed.reduce((a, b) => a + b, 0) / minLen;
    let num = 0, denom = 0;
    for (let k = 0; k < minLen; k++) {
      num   += (trimmedBench[k] - meanX) * (trimmed[k] - meanY);
      denom += (trimmedBench[k] - meanX) ** 2;
    }
    const beta = denom > 0 ? num / denom : 1;
    // Alpha return = position return - beta × benchmark return
    const alphaReturn = positionRet - beta * benchPeriodRet;
    const weight = (h.qty * h.mark) / totalMV;
    const contribution = weight * positionRet;
    return {
      symbol: h.symbol,
      sector: h.sector || '__unknown__',
      weight,
      return: positionRet,
      beta,
      alphaReturn,
      contribution,
      marketContrib: weight * beta * benchPeriodRet,
      alphaContrib:  weight * alphaReturn,
    };
  });
  // Aggregates
  const totalReturn = perPosition.reduce((s, p) => s + p.contribution, 0);
  const portBeta = perPosition.reduce((s, p) => s + p.weight * p.beta, 0);
  const marketContribution = portBeta * benchPeriodRet;
  // Sector contribution = sum over sectors of (sector weight - benchmark weight) × sector return
  // We don't have benchmark sector weights, so we approximate sector contribution
  // as weight × (sector_return - market_return) summed over sectors.
  const bySector = {};
  for (const p of perPosition) {
    if (!bySector[p.sector]) bySector[p.sector] = { weight: 0, weightedRet: 0 };
    bySector[p.sector].weight += p.weight;
    bySector[p.sector].weightedRet += p.weight * p.return;
  }
  let sectorContribution = 0;
  for (const sec of Object.keys(bySector)) {
    const sectorRet = bySector[sec].weight > 0 ? bySector[sec].weightedRet / bySector[sec].weight : 0;
    sectorContribution += bySector[sec].weight * (sectorRet - benchPeriodRet);
  }
  // Sec selection = total - market - sector
  const securitySelection = totalReturn - marketContribution - sectorContribution;
  perPosition.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  return {
    totalReturn,
    beta: portBeta,
    marketContribution,
    sectorContribution,
    securitySelection,
    perPosition,
  };
};

// computeBrinsonFachler — full Brinson-Fachler decomposition:
//
//   Total active return = Allocation + Selection + Interaction
//
// Where:
//   Allocation_i = (w_p,i - w_b,i) × (R_b,i - R_b)
//                  weight bet × benchmark sector excess return
//   Selection_i  = w_b,i × (R_p,i - R_b,i)
//                  benchmark weight × manager picking skill
//   Interaction_i = (w_p,i - w_b,i) × (R_p,i - R_b,i)
//                   active weight × active picking skill
//
// w_p,i = portfolio weight in sector i
// w_b,i = benchmark weight in sector i
// R_p,i = portfolio return in sector i
// R_b,i = benchmark return in sector i
// R_b   = total benchmark return
//
// Inputs require benchmark sector weights — we approximate using the
// SPDR sector ETFs as proxies for "the benchmark" with their typical
// SPX weights. Real institutional use would source live SPX sector
// weights from S&P Indices (paid feed).
//
// Output:
//   {
//     bySector: [{ sector, allocation, selection, interaction, total }],
//     totals:   { allocation, selection, interaction, total },
//     portBeta, totalReturn, benchReturn,
//   }

// SPX_SECTOR_WEIGHTS — approximate static benchmark sector weights
// for the S&P 500 (~mid-2025). For institutional-grade use, replace
// with a live feed from S&P Dow Jones Indices.
const SPX_SECTOR_WEIGHTS = {
  'Tech':                   0.305,
  'Financials':             0.130,
  'Healthcare':             0.115,
  'Consumer Disc':          0.105,
  'Communications':         0.090,
  'Industrials':            0.080,
  'Consumer Staples':       0.060,
  'Energy':                 0.040,
  'Utilities':              0.025,
  'Materials':              0.025,
  'Real Estate':            0.025,
};

export const computeBrinsonFachler = (holdings, benchmarkReturns, sectorReturnsBySector) => {
  const empty = {
    bySector: [], totals: { allocation: 0, selection: 0, interaction: 0, total: 0 },
    totalReturn: 0, benchReturn: 0, error: null,
  };
  if (!Array.isArray(holdings) || holdings.length === 0) return empty;
  if (!Array.isArray(benchmarkReturns) || benchmarkReturns.length < 5) return empty;
  const valid = holdings.filter(h =>
    Array.isArray(h.returns) && h.returns.length >= 5 &&
    Number.isFinite(h.qty) && Number.isFinite(h.mark)
  );
  if (valid.length === 0) return empty;
  const minLen = Math.min(...valid.map(h => h.returns.length), benchmarkReturns.length);
  if (minLen < 5) return empty;
  const trimmedBench = benchmarkReturns.slice(-minLen);
  const benchReturn = trimmedBench.reduce((s, r) => s + r, 0);
  const totalMV = valid.reduce((s, h) => s + Math.abs(h.qty * h.mark), 0);
  if (totalMV <= 0) return empty;
  // Aggregate portfolio by sector
  const portBySector = {}; // sector → { weight, weightedRet }
  for (const h of valid) {
    const sec = h.sector || 'Unknown';
    if (!portBySector[sec]) portBySector[sec] = { weight: 0, weightedRet: 0 };
    const w = (h.qty * h.mark) / totalMV;
    const r = h.returns.slice(-minLen).reduce((s, x) => s + x, 0);
    portBySector[sec].weight += w;
    portBySector[sec].weightedRet += w * r;
  }
  // Compute portfolio sector returns
  for (const sec of Object.keys(portBySector)) {
    const s = portBySector[sec];
    s.return = s.weight > 0 ? s.weightedRet / s.weight : 0;
  }
  // Build the full sector universe (union of portfolio + benchmark)
  const allSectors = new Set([
    ...Object.keys(portBySector),
    ...Object.keys(SPX_SECTOR_WEIGHTS),
  ]);
  let totalAllocation = 0, totalSelection = 0, totalInteraction = 0;
  const bySector = [];
  for (const sec of allSectors) {
    const portWeight = portBySector[sec]?.weight || 0;
    const benchWeight = SPX_SECTOR_WEIGHTS[sec] || 0;
    const portRet = portBySector[sec]?.return || 0;
    // Benchmark sector return — caller can supply via sectorReturnsBySector,
    // otherwise approximate using benchmark return (simplifies to "all sectors
    // returned same as benchmark" which neutralizes selection).
    const benchSectorRet = sectorReturnsBySector?.[sec] ?? benchReturn;
    const allocation = (portWeight - benchWeight) * (benchSectorRet - benchReturn);
    const selection = benchWeight * (portRet - benchSectorRet);
    const interaction = (portWeight - benchWeight) * (portRet - benchSectorRet);
    const sectorTotal = allocation + selection + interaction;
    totalAllocation += allocation;
    totalSelection += selection;
    totalInteraction += interaction;
    if (portWeight > 0 || benchWeight > 0) {
      bySector.push({
        sector: sec,
        portWeight, benchWeight,
        portRet, benchSectorRet,
        allocation, selection, interaction,
        total: sectorTotal,
      });
    }
  }
  bySector.sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
  const total = totalAllocation + totalSelection + totalInteraction;
  return {
    bySector,
    totals: {
      allocation: totalAllocation,
      selection: totalSelection,
      interaction: totalInteraction,
      total,
    },
    totalReturn: total,
    benchReturn,
    error: null,
  };
};

// CROSS_ASSET_PROXIES — predefined ETF/index tickers representing major
// asset classes. Used for the cross-asset correlation panel which shows
// a portfolio's correlation with each asset class via a proxy.
export const CROSS_ASSET_PROXIES = [
  { symbol: 'SPY',  label: 'S&P 500',          assetClass: 'US Equities' },
  { symbol: 'QQQ',  label: 'Nasdaq 100',        assetClass: 'US Tech' },
  { symbol: 'IWM',  label: 'Russell 2000',      assetClass: 'US Small Caps' },
  { symbol: 'EFA',  label: 'EAFE (Dev. Intl)',  assetClass: 'Intl Equities' },
  { symbol: 'EEM',  label: 'Emerging Markets',  assetClass: 'EM Equities' },
  { symbol: 'TLT',  label: '20+yr Treasuries',  assetClass: 'Long Bonds' },
  { symbol: 'IEF',  label: '7-10yr Treasuries', assetClass: 'Med Bonds' },
  { symbol: 'HYG',  label: 'High-yield Credit', assetClass: 'Credit' },
  { symbol: 'GLD',  label: 'Gold',              assetClass: 'Precious Metals' },
  { symbol: 'USO',  label: 'WTI Oil',           assetClass: 'Energy/Commodities' },
  { symbol: 'DBC',  label: 'Broad Commodities', assetClass: 'Commodities' },
  { symbol: 'UUP',  label: 'US Dollar Index',   assetClass: 'FX/Dollar' },
  { symbol: 'VNQ',  label: 'US REITs',          assetClass: 'Real Estate' },
  { symbol: 'TIP',  label: 'TIPS (real bonds)', assetClass: 'Inflation Hedge' },
];

// computeCrossAssetCorrelation — given the portfolio return series
// and a map of asset-proxy → return series, compute pairwise
// correlations. Returns a sorted list of asset → correlation, useful
// for highlighting hidden exposures (e.g., "your tech-heavy book is
// 0.92 correlated with QQQ — you don't really have diversification
// even though you hold 10 stocks").
export const computeCrossAssetCorrelation = (portfolioReturns, proxyReturnsBySymbol) => {
  if (!Array.isArray(portfolioReturns) || portfolioReturns.length < 10) return [];
  const out = [];
  for (const proxy of CROSS_ASSET_PROXIES) {
    const proxyRets = proxyReturnsBySymbol[proxy.symbol];
    if (!proxyRets || proxyRets.length < 10) continue;
    const minLen = Math.min(portfolioReturns.length, proxyRets.length);
    const x = portfolioReturns.slice(-minLen);
    const y = proxyRets.slice(-minLen);
    const meanX = x.reduce((a, b) => a + b, 0) / minLen;
    const meanY = y.reduce((a, b) => a + b, 0) / minLen;
    let num = 0, denomX = 0, denomY = 0;
    for (let i = 0; i < minLen; i++) {
      num    += (x[i] - meanX) * (y[i] - meanY);
      denomX += (x[i] - meanX) ** 2;
      denomY += (y[i] - meanY) ** 2;
    }
    const corr = (denomX > 0 && denomY > 0)
      ? num / (Math.sqrt(denomX) * Math.sqrt(denomY))
      : 0;
    out.push({
      ...proxy,
      correlation: Math.max(-1, Math.min(1, corr)),
    });
  }
  out.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));
  return out;
};

// ════════════════════════════════════════════════════════════════════
// BLACK-LITTERMAN PORTFOLIO OPTIMIZER
// ════════════════════════════════════════════════════════════════════
//
// Black-Litterman blends market-equilibrium implied returns with the
// user's subjective views into a posterior expected return vector,
// then solves for optimal weights via mean-variance optimization.
//
// Standard formulation:
//   π = δ · Σ · w_mkt           (implied equilibrium returns)
//   E[r] = ((τΣ)^-1 + P'Ω^-1 P)^-1 · ((τΣ)^-1 π + P'Ω^-1 Q)   (posterior)
//   w_optimal = (δΣ)^-1 · E[r]   (mean-variance unconstrained)
//
// Where:
//   δ        risk aversion (typical: 2.5-3 for equities)
//   τ        scaling factor on prior uncertainty (typical: 0.025-0.05)
//   Σ        covariance matrix from historical returns
//   w_mkt    market-cap weights (we use current MV weights as proxy)
//   P        view matrix (each row picks assets the view talks about)
//   Q        view vector (expected returns under the views)
//   Ω        view uncertainty matrix (diagonal, derived from confidence)
//
// View shape: { type: 'absolute' | 'relative', tickers: [...],
//               magnitudePct: number, confidencePct: 0-100 }
// Examples:
//   { type:'absolute', tickers:['AAPL'], magnitudePct: 8 }
//     → "AAPL will return 8% over the period"
//   { type:'relative', tickers:['AAPL', 'MSFT'], magnitudePct: 3 }
//     → "AAPL outperforms MSFT by 3%"

// helper: invert a small matrix via Gauss-Jordan (already exists in
// repo elsewhere, but inlined here to avoid coupling).
export const _invertMatrixBL = (m) => {
  const n = m.length;
  // Augment [m | I]
  const aug = m.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let i = 0; i < n; i++) {
    // Find pivot
    let pivot = aug[i][i];
    if (Math.abs(pivot) < 1e-12) {
      // Try to swap with a row below
      let swapRow = -1;
      for (let k = i + 1; k < n; k++) {
        if (Math.abs(aug[k][i]) > 1e-12) { swapRow = k; break; }
      }
      if (swapRow === -1) return null; // singular
      [aug[i], aug[swapRow]] = [aug[swapRow], aug[i]];
      pivot = aug[i][i];
    }
    // Scale row to pivot=1
    for (let j = 0; j < 2 * n; j++) aug[i][j] /= pivot;
    // Eliminate other rows
    for (let k = 0; k < n; k++) {
      if (k === i) continue;
      const factor = aug[k][i];
      for (let j = 0; j < 2 * n; j++) {
        aug[k][j] -= factor * aug[i][j];
      }
    }
  }
  // Extract right half
  return aug.map(row => row.slice(n));
};

// ════════════════════════════════════════════════════════════════════
// FAMA-FRENCH 5-FACTOR ATTRIBUTION
// ════════════════════════════════════════════════════════════════════
//
// Standard quant performance attribution decomposing portfolio excess
// returns into 5 factors:
//
//   Mkt-RF (Market):    Market excess return; beta to broad equity market
//   SMB (Size):         Small-Minus-Big; small-cap excess over large-cap
//   HML (Value):        High-Minus-Low book-to-market; value over growth
//   RMW (Profitability): Robust-Minus-Weak operating profitability
//   CMA (Investment):   Conservative-Minus-Aggressive investment policy
//
// The 5-factor model is: R_p - R_f = α + β_M·(R_M - R_f) + β_S·SMB + β_V·HML + β_P·RMW + β_I·CMA + ε
//
// Estimation: Multivariate linear regression. We use ETF proxies as
// factor returns (no Ken French data subscription needed):
//
//   Mkt    = SPY excess return (over short-rate proxy SHV)
//   SMB    = IWM (Russell 2000) − SPY  (small minus big)
//   HML    = IWD (Russell 1000 Value) − IWF (Russell 1000 Growth)
//   RMW    = QUAL (MSCI Quality) − SPY (quality / robust profitability minus market)
//   CMA    = USMV (MSCI Min-Vol) − SPY (low-vol = conservative investment proxy)
//
// These are imperfect proxies; academic FF data is more rigorous but
// not freely available in real-time. Results within ±10% of "true"
// FF betas for typical portfolios over multi-year windows.
export const FF_FACTOR_PROXIES = [
  { factor: 'Mkt-RF', label: 'Market',       longProxy: 'SPY',  shortProxy: 'SHV', desc: 'Broad equity market excess return' },
  { factor: 'SMB',    label: 'Size',         longProxy: 'IWM',  shortProxy: 'SPY', desc: 'Small minus big (Russell 2000 − SPY)' },
  { factor: 'HML',    label: 'Value',        longProxy: 'IWD',  shortProxy: 'IWF', desc: 'Value minus growth (R1k Value − R1k Growth)' },
  { factor: 'RMW',    label: 'Profitability',longProxy: 'QUAL', shortProxy: 'SPY', desc: 'Robust minus weak profitability (Quality − SPY)' },
  { factor: 'CMA',    label: 'Investment',   longProxy: 'USMV', shortProxy: 'SPY', desc: 'Conservative minus aggressive (MinVol − SPY)' },
];

// Multivariate OLS regression: y = X·β + ε
// X is n×k (n observations, k regressors); y is n×1
// Returns { betas: k-vector, alpha: intercept, r2, residuals } or null
export const _multivariateOLS = (X, y) => {
  if (!Array.isArray(X) || !Array.isArray(y)) return null;
  const n = X.length;
  if (n < 10 || n !== y.length) return null;
  const k = X[0]?.length || 0;
  if (k === 0) return null;
  // Augment X with column of 1s for intercept
  const Xa = X.map(row => [1, ...row]);
  const ka = k + 1;
  // Compute X'X (ka×ka) and X'y (ka)
  const XtX = Array.from({ length: ka }, () => new Array(ka).fill(0));
  const Xty = new Array(ka).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < ka; j++) {
      Xty[j] += Xa[i][j] * y[i];
      for (let l = 0; l < ka; l++) {
        XtX[j][l] += Xa[i][j] * Xa[i][l];
      }
    }
  }
  // Invert X'X
  const XtXinv = _invertMatrixBL(XtX);
  if (!XtXinv) return null;
  // β = (X'X)^-1 · X'y
  const betas = new Array(ka).fill(0);
  for (let j = 0; j < ka; j++) {
    for (let l = 0; l < ka; l++) {
      betas[j] += XtXinv[j][l] * Xty[l];
    }
  }
  const alpha = betas[0];
  const factorBetas = betas.slice(1);
  // Compute R²
  const yMean = y.reduce((s, v) => s + v, 0) / n;
  let ssTot = 0, ssRes = 0;
  const residuals = [];
  for (let i = 0; i < n; i++) {
    const yhat = betas.reduce((s, b, j) => s + b * Xa[i][j], 0);
    const e = y[i] - yhat;
    residuals.push(e);
    ssRes += e * e;
    ssTot += (y[i] - yMean) ** 2;
  }
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
  return { betas: factorBetas, alpha, r2, residuals, n };
};

// computeFamaFrench5Factor — runs the FF5 regression on portfolio
// returns vs factor proxy returns.
//
// Inputs:
//   portfolioReturns: array of daily portfolio returns (decimal)
//   factorReturnsBySymbol: map of ETF symbol → daily returns array
//
// Returns:
//   { betas: { factor → β }, alpha, r2, n,
//     factorContributions: { factor → annualized % contribution to total return },
//     idiosyncraticReturn: residual annualized %,
//     totalReturn: annualized portfolio return }
//   or null if insufficient data.
export const computeFamaFrench5Factor = (portfolioReturns, factorReturnsBySymbol) => {
  if (!Array.isArray(portfolioReturns) || portfolioReturns.length < 60) return null;
  // Build factor returns matrix from proxies
  const factorRets = {};
  for (const f of FF_FACTOR_PROXIES) {
    const longRets = factorReturnsBySymbol[f.longProxy];
    const shortRets = factorReturnsBySymbol[f.shortProxy];
    if (!longRets || !shortRets) continue;
    const len = Math.min(longRets.length, shortRets.length, portfolioReturns.length);
    if (len < 60) continue;
    const series = [];
    for (let i = 0; i < len; i++) {
      const ll = longRets[longRets.length - len + i];
      const ss = shortRets[shortRets.length - len + i];
      if (!Number.isFinite(ll) || !Number.isFinite(ss)) {
        series.push(0);
      } else {
        series.push(ll - ss);
      }
    }
    factorRets[f.factor] = series;
  }
  if (Object.keys(factorRets).length < 3) return null;
  // Common length = min length across factors
  const factorOrder = FF_FACTOR_PROXIES
    .map(f => f.factor)
    .filter(f => factorRets[f]);
  const len = Math.min(
    portfolioReturns.length,
    ...factorOrder.map(f => factorRets[f].length),
  );
  if (len < 60) return null;
  // Build X matrix (n × k)
  const X = [];
  const y = portfolioReturns.slice(-len);
  for (let i = 0; i < len; i++) {
    X.push(factorOrder.map(f => factorRets[f][factorRets[f].length - len + i]));
  }
  const reg = _multivariateOLS(X, y);
  if (!reg) return null;
  // Build output
  const betas = {};
  factorOrder.forEach((f, idx) => { betas[f] = reg.betas[idx]; });
  // Annualize
  const alphaAnn = reg.alpha * 252 * 100;
  const totalRet = (y.reduce((s, r) => s + r, 0) / y.length) * 252 * 100;
  // Factor contributions: β_f × avg_factor_return × 252 × 100
  const factorContributions = {};
  for (const f of factorOrder) {
    const avgFactRet = factorRets[f].slice(-len).reduce((s, r) => s + r, 0) / len;
    factorContributions[f] = betas[f] * avgFactRet * 252 * 100;
  }
  // Idiosyncratic = alpha (annualized)
  return {
    betas,
    alpha: reg.alpha,
    alphaAnnualized: alphaAnn,
    r2: reg.r2,
    n: reg.n,
    factorOrder,
    factorContributions,
    idiosyncraticReturn: alphaAnn,
    totalReturn: totalRet,
  };
};

// computePortfolioFundamentals — weighted-average fundamental ratios
// at the portfolio level. Each holding contributes its fundamental
// value × portfolio weight. Useful for spotting:
//   - "Are we overpaying as a portfolio?" (weighted P/E vs SPX ~22)
//   - "Where's the cash flow?" (weighted FCF yield)
//   - "How leveraged is the book?" (weighted debt/equity)
//
// Inputs:
//   holdings: [{ symbol, qty, mark, fundamentals: {pe, ps, pb, peg, roe, roic, divYield, fcfYield, debtToEquity, grossMargin, opMargin, marketCap, sector} }]
//
// Returns:
//   { weighted: {pe, ps, pb, ...}, coverage: {n, totalMV, missingTickers}, sectorBreakdown: [...] }
export const computePortfolioFundamentals = (holdings) => {
  if (!Array.isArray(holdings) || holdings.length === 0) {
    return { weighted: null, coverage: null, sectorBreakdown: [] };
  }
  const validHoldings = holdings.filter(h => h.fundamentals);
  if (validHoldings.length === 0) {
    return {
      weighted: null,
      coverage: { n: 0, totalMV: 0, missingTickers: holdings.map(h => h.symbol) },
      sectorBreakdown: [],
    };
  }
  // Build weights based on absolute MV (handles longs + shorts equally)
  const totalMV = validHoldings.reduce((s, h) => s + Math.abs((h.qty || 0) * (h.mark || 0)), 0);
  if (totalMV <= 0) {
    return {
      weighted: null,
      coverage: { n: 0, totalMV: 0, missingTickers: holdings.map(h => h.symbol) },
      sectorBreakdown: [],
    };
  }
  // Weighted aggregation per metric
  const KEYS = ['pe', 'ps', 'pb', 'peg', 'roe', 'roic', 'divYield', 'fcfYield',
                'debtToEquity', 'grossMargin', 'opMargin'];
  const weighted = {};
  // Some metrics are best aggregated harmonic mean (P/E, P/S, P/B) since
  // they're price ratios — averaging the inverses is more meaningful.
  // We expose both arithmetic and harmonic for the caller to choose.
  const HARMONIC = new Set(['pe', 'ps', 'pb', 'peg']);
  for (const k of KEYS) {
    let weightedSum = 0, weightSum = 0;
    let invSum = 0, invWeightSum = 0;
    for (const h of validHoldings) {
      const v = h.fundamentals[k];
      if (!Number.isFinite(v)) continue;
      const w = Math.abs((h.qty || 0) * (h.mark || 0)) / totalMV;
      weightedSum += w * v;
      weightSum += w;
      // Harmonic — only for positive values
      if (v > 0) {
        invSum += w * (1 / v);
        invWeightSum += w;
      }
    }
    if (weightSum > 0) {
      weighted[k] = weightedSum / weightSum;
    }
    if (HARMONIC.has(k) && invSum > 0) {
      weighted[`${k}_harmonic`] = invWeightSum / invSum;
    }
  }
  // Sector breakdown — for diversification analysis
  const sectorMap = {};
  const missingTickers = [];
  for (const h of holdings) {
    if (!h.fundamentals) {
      missingTickers.push(h.symbol);
      continue;
    }
    const sector = h.fundamentals.sector || 'Unknown';
    const mv = Math.abs((h.qty || 0) * (h.mark || 0));
    if (!sectorMap[sector]) sectorMap[sector] = { sector, mv: 0, count: 0 };
    sectorMap[sector].mv += mv;
    sectorMap[sector].count++;
  }
  const sectorBreakdown = Object.values(sectorMap)
    .map(s => ({ ...s, weightPct: (s.mv / totalMV) * 100 }))
    .sort((a, b) => b.mv - a.mv);
  return {
    weighted,
    coverage: {
      n: validHoldings.length,
      totalMV,
      coveragePct: (validHoldings.length / holdings.length) * 100,
      missingTickers,
    },
    sectorBreakdown,
  };
};

// computeRebalancePlan — given current weights and target weights,
// computes the minimum trades to hit target. Returns ordered list of
// trades sorted by largest drift (most impactful).
//
// Tax-aware lot selection (when lots are provided):
//   - For SELLS, prefer harvest-eligible loss lots first (LIFO/HIFO style)
//   - Then prefer long-term lots (lower tax rate) over short-term
//   - This is a heuristic — real tax optimization needs full bracket math
//
// Inputs:
//   holdings:   [{ symbol, qty, mark, mv, weightPct, target?, lots? }]
//                target is the desired weight in %; if absent we treat it
//                as missing (skip rebalance) for that ticker
//   options: { driftThresholdPct=2, totalNAV?, includeTransactionCost=0.05 }
//
// Returns:
//   { trades: [...], totalDrift, totalTradeValue, taxImpact: estimate }
export const computeRebalancePlan = (holdings, options = {}) => {
  const { driftThresholdPct = 2, includeTransactionCost = 0.05 } = options;
  if (!Array.isArray(holdings) || holdings.length === 0) {
    return { trades: [], totalDrift: 0, totalTradeValue: 0, taxImpact: 0 };
  }
  // Compute total NAV
  const totalNAV = options.totalNAV ?? holdings.reduce((s, h) => s + Math.abs((h.qty || 0) * (h.mark || 0)), 0);
  if (totalNAV <= 0) {
    return { trades: [], totalDrift: 0, totalTradeValue: 0, taxImpact: 0 };
  }
  const trades = [];
  let totalDriftAbs = 0;
  let totalTradeValue = 0;
  let taxImpact = 0;
  for (const h of holdings) {
    if (h.target == null || !Number.isFinite(h.target)) continue;
    const mv = Math.abs((h.qty || 0) * (h.mark || 0));
    const currentPct = (mv / totalNAV) * 100;
    const driftPct = currentPct - h.target;
    totalDriftAbs += Math.abs(driftPct);
    if (Math.abs(driftPct) < driftThresholdPct) continue;
    const targetMV = (h.target / 100) * totalNAV;
    const dollarDelta = targetMV - mv;
    const action = dollarDelta > 0 ? 'BUY' : 'SELL';
    const qtyDelta = Math.abs(dollarDelta) / Math.max(0.01, h.mark || 1);
    const tradeValue = Math.abs(dollarDelta);
    totalTradeValue += tradeValue;
    // Tax-aware lot selection for sells
    let lotPlan = null;
    let estTaxBill = 0;
    if (action === 'SELL' && Array.isArray(h.lots) && h.lots.length > 0) {
      // Sort lots: harvest losses first, then long-term gains, then short-term gains
      const sortedLots = h.lots.slice().sort((a, b) => {
        const aGain = (h.mark - a.openPrice) * a.qty;
        const bGain = (h.mark - b.openPrice) * b.qty;
        // Score: lower score = higher priority for selling
        // Loss → very negative score (sell first)
        // Long-term gain → moderate positive score
        // Short-term gain → high positive score (sell last)
        const score = (lot, gain) => {
          if (gain < 0) return -1000 + gain;            // losses: sell first
          if (lot.ageDays >= 365) return gain * 0.20;   // LT: tax 20%
          return gain * 0.37;                            // ST: tax 37% (top bracket)
        };
        return score(a, aGain) - score(b, bGain);
      });
      lotPlan = [];
      let qtyToSell = qtyDelta;
      for (const lot of sortedLots) {
        if (qtyToSell <= 0) break;
        const lotQty = Math.min(qtyToSell, lot.qty || 0);
        const lotGain = (h.mark - lot.openPrice) * lotQty;
        const isLT = lot.ageDays >= 365;
        const lotTax = lotGain > 0 ? lotGain * (isLT ? 0.20 : 0.37) : 0;
        estTaxBill += lotTax;
        lotPlan.push({
          openPrice: lot.openPrice,
          qty: lotQty,
          ageDays: lot.ageDays,
          gain: lotGain,
          isLT,
          taxImpact: lotTax,
        });
        qtyToSell -= lotQty;
      }
      taxImpact += estTaxBill;
    }
    trades.push({
      symbol: h.symbol,
      action,
      currentPct,
      targetPct: h.target,
      driftPct,
      currentMV: mv,
      targetMV,
      dollarDelta,
      qtyDelta,
      mark: h.mark,
      lotPlan,
      estTaxBill,
      transactionCost: tradeValue * (includeTransactionCost / 100),
    });
  }
  // Sort by absolute drift (biggest drifts first — they matter most)
  trades.sort((a, b) => Math.abs(b.driftPct) - Math.abs(a.driftPct));
  return {
    trades,
    totalDrift: totalDriftAbs / 2, // divide by 2 because over-vs-under cancels
    totalTradeValue,
    taxImpact,
    transactionCostTotal: trades.reduce((s, t) => s + t.transactionCost, 0),
  };
};

// Phase 3o.90: Cross-Asset Vol Forecast helpers extracted to
// src/lib/quant/risk-math.js (computeEWMAVol, computeHARRVol,
// computePortfolioVolForecast, computeRebalancingOptimization)

// computeTaxLossHarvestBacktest — simulate historical tax-loss harvest
// triggers and quantify the cumulative tax savings that would have
// resulted from a rules-based harvest policy.
//
// Approach:
//   1. Take a price series for the holding (daily closes)
//   2. Walk forward simulating purchases at fixed cost basis (single-lot
//      simplification) OR multi-lot DCA mode
//   3. At each bar, check if (price < cost basis × (1 - lossPct)) and
//      enough days since last harvest (washSaleDays) — trigger harvest
//   4. Realize the loss, repurchase a "substitute" (conceptually — we
//      don't model the substitute's path), reset cost basis after
//      washSaleDays
//   5. Sum tax savings = realized losses × marginal tax rate
//
// Inputs:
//   priceSeries: array of { date, close } daily bars
//   options: {
//     initialInvestment = 10000,        // dollars
//     lossThresholdPct  = 5,            // trigger if down by this %
//     marginalTaxRate   = 0.32,         // for ST losses (typical mid-bracket)
//     ltMarginalTaxRate = 0.20,         // for LT losses (federal)
//     washSaleDays      = 31,           // re-buy after this many days
//     mode              = 'single',     // 'single' | 'monthly_dca'
//     monthlyContrib    = 1000,         // for DCA mode
//   }
//
// Returns:
//   { harvestEvents: [...], totalLossesRealized, totalTaxSaved,
//     finalValue, percentReturn, harvestedReturn,
//     opportunityCost: cost of cash drag during the 31-day wash period }
export const computeTaxLossHarvestBacktest = (priceSeries, options = {}) => {
  const {
    initialInvestment = 10000,
    lossThresholdPct = 5,
    marginalTaxRate = 0.32,
    ltMarginalTaxRate = 0.20,
    washSaleDays = 31,
    mode = 'single',
    monthlyContrib = 1000,
  } = options;
  if (!Array.isArray(priceSeries) || priceSeries.length < 60) return null;
  const events = [];
  let totalLossesRealized = 0;
  let totalTaxSaved = 0;
  let opportunityCost = 0;
  // Cost basis tracking — single lot first, will extend for DCA
  let costBasis = priceSeries[0].close; // open at first bar
  let costDate = new Date(priceSeries[0].date).getTime();
  let shares = initialInvestment / costBasis;
  let cumulativeContributed = initialInvestment;
  let cashDuringWash = 0;
  let washSaleEnd = 0; // timestamp; 0 = not in wash period
  for (let i = 1; i < priceSeries.length; i++) {
    const bar = priceSeries[i];
    const ts = new Date(bar.date).getTime();
    const price = bar.close;
    if (!Number.isFinite(price) || price <= 0) continue;
    // Monthly DCA: add fixed contribution at first bar of each month
    if (mode === 'monthly_dca' && i > 0) {
      const prevDate = new Date(priceSeries[i - 1].date);
      const currDate = new Date(bar.date);
      if (currDate.getMonth() !== prevDate.getMonth()) {
        // Skip contributions during wash sale period
        if (ts > washSaleEnd) {
          const newShares = monthlyContrib / price;
          // Update weighted-average cost basis
          const totalCost = (shares * costBasis) + monthlyContrib;
          shares += newShares;
          costBasis = totalCost / shares;
          cumulativeContributed += monthlyContrib;
        } else {
          cashDuringWash += monthlyContrib;
        }
      }
    }
    // Re-enter after wash sale period
    if (washSaleEnd > 0 && ts >= washSaleEnd) {
      shares = (cashDuringWash > 0 ? cashDuringWash : (shares * priceSeries[i - 1].close)) / price;
      costBasis = price;
      costDate = ts;
      cashDuringWash = 0;
      washSaleEnd = 0;
    }
    if (washSaleEnd > 0) continue; // mid wash period, holding cash
    // Check harvest condition
    const lossPct = ((costBasis - price) / costBasis) * 100;
    if (lossPct >= lossThresholdPct) {
      const lossAmount = (costBasis - price) * shares;
      const ageDays = (ts - costDate) / 86400000;
      const isLT = ageDays >= 365;
      const taxRate = isLT ? ltMarginalTaxRate : marginalTaxRate;
      const taxSaved = lossAmount * taxRate;
      totalLossesRealized += lossAmount;
      totalTaxSaved += taxSaved;
      events.push({
        date: bar.date,
        triggerPrice: price,
        costBasis,
        ageDays,
        isLT,
        lossAmount,
        taxSaved,
        sharesHarvested: shares,
      });
      // Lock in the loss; sit in cash for wash sale period
      cashDuringWash = shares * price;
      washSaleEnd = ts + washSaleDays * 86400000;
      // Approximate opportunity cost: 31 days × average daily return
      // We use the asset's own return which is conservative (could miss
      // a rally, could miss a further drop).
      // Look-ahead to estimate cost; this is a backtest assumption.
      const lookAheadEnd = Math.min(priceSeries.length - 1, i + washSaleDays);
      const futurePrice = priceSeries[lookAheadEnd]?.close;
      if (futurePrice && futurePrice > price) {
        const missedGain = (futurePrice - price) * shares;
        opportunityCost += missedGain;
      }
    }
  }
  const finalPrice = priceSeries[priceSeries.length - 1].close;
  const finalValue = (shares * finalPrice) + cashDuringWash;
  const percentReturn = ((finalValue - cumulativeContributed) / cumulativeContributed) * 100;
  const harvestedReturn = ((finalValue + totalTaxSaved - cumulativeContributed) / cumulativeContributed) * 100;
  return {
    harvestEvents: events,
    totalLossesRealized,
    totalTaxSaved,
    finalValue,
    cumulativeContributed,
    percentReturn,
    harvestedReturn,
    opportunityCost,
    netBenefit: totalTaxSaved - opportunityCost,
    settings: { initialInvestment, lossThresholdPct, marginalTaxRate, ltMarginalTaxRate, washSaleDays, mode, monthlyContrib },
  };
};
