// IMO Onyx Terminal — quant portfolio-construction module
//
// Phase 3o.91 (file split, batch 3): extracted from JPMOnyxTerminal.jsx.
// Two portfolio-construction algorithms — Equal Risk Contribution
// (Maillard-Roncalli-Teiletche 2010) and Black-Litterman (Goldman 1990).
// Both are pure functions: takes covariance matrices and views,
// returns optimal weights.
//
// Exports:
//   computeEqualRiskContribution(covMatrix, maxIter, tol)
//     → { weights, riskContributions, iterations, converged }
//
//     Each asset contributes equal % of total portfolio risk. More
//     rigorous than inverse-vol weighting, which only matches ERC
//     when correlations are uniform.
//
//   runBlackLitterman({ holdings, views, delta, tau, useShrinkage })
//     → { impliedReturns, posteriorReturns, optimalWeights,
//         currentWeights, suggestions, covMatrix, error }
//
//     Full BL pipeline: derive implied equilibrium returns from
//     market-cap weights, blend with user views via the Bayesian
//     posterior, solve for optimal weights via mean-variance
//     optimization. Supports shrinkage estimation of the
//     covariance matrix (Ledoit-Wolf style).


// computeEqualRiskContribution — true Equal Risk Contribution (ERC) weights
// via fixed-point iteration. Each asset contributes equal % of total
// portfolio risk (volatility). More rigorous than inverse-vol weighting,
// which only matches ERC when correlations are uniform.
//
// Algorithm (Maillard-Roncalli-Teiletche 2010):
//   Start with inverse-volatility weights as initial guess.
//   Iterate: w_i = w_i × (target_RC / actual_RC_i)
//   where RC_i = w_i × (Σ·w)_i / σ_p (asset i's contribution to portfolio vol)
//   target_RC = σ_p / N (equal share)
//   Renormalize so weights sum to 1 each iteration.
//   Converge when max |actual_RC_i / target_RC − 1| < tolerance.
//
// Inputs:
//   covMatrix: NxN covariance matrix (annualized)
//   maxIter: optimization iterations (default 100)
//   tol: convergence tolerance (default 1e-5)
//
// Returns: { weights: array, riskContributions: array (sum = 1), iterations, converged }
import { _invertMatrixBL } from './portfolio-math.js';

export const computeEqualRiskContribution = (covMatrix, maxIter = 100, tol = 1e-5) => {
  if (!Array.isArray(covMatrix) || covMatrix.length === 0) return null;
  const n = covMatrix.length;
  if (n < 2) return null;
  // Verify square + extract variances
  const variances = [];
  for (let i = 0; i < n; i++) {
    if (!Array.isArray(covMatrix[i]) || covMatrix[i].length !== n) return null;
    variances.push(covMatrix[i][i]);
    if (variances[i] <= 0) return null;
  }
  // Initialize with inverse-vol weights
  const vols = variances.map(v => Math.sqrt(v));
  const invVolSum = vols.reduce((s, v) => s + (1 / v), 0);
  let w = vols.map(v => (1 / v) / invVolSum);
  let iter = 0;
  let converged = false;
  for (iter = 0; iter < maxIter; iter++) {
    // Σ·w
    const sigW = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        sigW[i] += covMatrix[i][j] * w[j];
      }
    }
    // Portfolio variance
    const portVar = w.reduce((s, wi, i) => s + wi * sigW[i], 0);
    if (portVar <= 0) break;
    const portVol = Math.sqrt(portVar);
    // Risk contributions: RC_i = w_i × (Σ·w)_i / σ_p
    const rc = w.map((wi, i) => wi * sigW[i] / portVol);
    const targetRC = portVol / n;
    // Check convergence
    let maxDev = 0;
    for (let i = 0; i < n; i++) {
      const dev = Math.abs(rc[i] / targetRC - 1);
      if (dev > maxDev) maxDev = dev;
    }
    if (maxDev < tol) {
      converged = true;
      break;
    }
    // Update weights: w_new = w × (target/actual), then renormalize
    const newW = w.map((wi, i) => wi * (targetRC / Math.max(1e-10, rc[i])));
    const sumNewW = newW.reduce((s, x) => s + x, 0);
    w = newW.map(x => x / sumNewW);
  }
  // Final risk contribution snapshot
  const sigW = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      sigW[i] += covMatrix[i][j] * w[j];
    }
  }
  const portVar = w.reduce((s, wi, i) => s + wi * sigW[i], 0);
  const portVol = Math.sqrt(Math.max(0, portVar));
  const riskContributions = w.map((wi, i) => portVol > 0 ? wi * sigW[i] / portVol : 0);
  // Normalize as % of total risk
  const rcPct = riskContributions.map(r => portVol > 0 ? (r / portVol) * 100 : 0);
  return {
    weights: w,
    riskContributions: rcPct,
    portfolioVol: portVol,
    iterations: iter,
    converged,
  };
};

// runBlackLitterman — full BL pipeline.
//
// Inputs:
//   holdings: [{ symbol, qty, mark, returns }]
//   views:    [{ type, tickers, magnitudePct, confidencePct }]
//   delta:    risk aversion (default 2.5)
//   tau:      prior scaling (default 0.05)
//
// Output:
//   {
//     impliedReturns: { symbol → annualized %},
//     posteriorReturns: { symbol → annualized %},
//     optimalWeights: { symbol → weight (0-1)},
//     currentWeights: { symbol → weight (0-1)},
//     suggestions: [{symbol, currentWeight, optimalWeight, deltaPct}],
//     covMatrix: ...  (annualized)
//   }
export const runBlackLitterman = ({ holdings, views = [], delta = 2.5, tau = 0.05, useShrinkage = false }) => {
  const empty = {
    impliedReturns: {}, posteriorReturns: {}, optimalWeights: {},
    currentWeights: {}, suggestions: [], covMatrix: null, error: null,
    shrinkageIntensity: null,
  };
  if (!Array.isArray(holdings) || holdings.length < 2) {
    return { ...empty, error: 'Need at least 2 positions for optimization' };
  }
  const valid = holdings.filter(h =>
    Array.isArray(h.returns) && h.returns.length >= 30 &&
    Number.isFinite(h.qty) && Number.isFinite(h.mark)
  );
  if (valid.length < 2) {
    return { ...empty, error: 'Need at least 2 positions with 30+ bars of return history' };
  }
  const n = valid.length;
  const symbols = valid.map(h => h.symbol);
  const minLen = Math.min(...valid.map(h => h.returns.length));
  if (minLen < 30) return { ...empty, error: 'Insufficient return history' };
  const series = valid.map(h => h.returns.slice(-minLen));
  // Annualization factor (252 trading days)
  const ANN = 252;
  // Means
  const means = series.map(s => s.reduce((a, b) => a + b, 0) / minLen);
  // Build annualized covariance matrix (sample S)
  const S_sample = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      let cov = 0;
      for (let k = 0; k < minLen; k++) {
        cov += (series[i][k] - means[i]) * (series[j][k] - means[j]);
      }
      cov = (cov / minLen) * ANN; // annualize
      S_sample[i][j] = S_sample[j][i] = cov;
    }
  }
  // Optionally apply Ledoit-Wolf shrinkage:
  //   Σ_shrunk = α · F + (1 − α) · S
  // Where F = identity × mean(diag(S)) is the "constant variance, zero
  // correlation" target, and α* is the data-driven optimal shrinkage
  // intensity that minimizes expected MSE between Σ_shrunk and the
  // true covariance.
  //
  // Reference: Ledoit & Wolf 2004 "Honey, I Shrunk the Sample
  // Covariance Matrix" — the formula is roughly α* = b̂²/d̂²
  // where d̂² = ||S − F||²_F and b̂² is the variance of S entries
  // around their expectation.
  let Sigma = S_sample;
  let shrinkageIntensity = null;
  if (useShrinkage) {
    // Target F: diagonal with mean variance, zero off-diagonal
    const meanVar = S_sample.reduce((s, row, i) => s + row[i], 0) / n;
    const F = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => i === j ? meanVar : 0));
    // d̂² — squared Frobenius norm of (S − F)
    let dSq = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const diff = S_sample[i][j] - F[i][j];
        dSq += diff * diff;
      }
    }
    // b̂² — sum over t of squared deviations of x_t x_t' from S
    // (annualized scaling cancels since we use the same scale on both sides)
    // We use unannualized here for the variance-of-cov-entries computation,
    // then renormalize.
    const seriesMean = series.map((s, i) => s.map(v => v - means[i]));
    let bSq = 0;
    for (let t = 0; t < minLen; t++) {
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          const xt = seriesMean[i][t] * seriesMean[j][t] * ANN;
          const diff = xt - S_sample[i][j];
          bSq += diff * diff;
        }
      }
    }
    bSq = bSq / (minLen * minLen);
    // α* — clamp to [0, 1]
    shrinkageIntensity = (dSq > 0)
      ? Math.max(0, Math.min(1, bSq / dSq))
      : 0;
    // Build shrunk covariance: Σ = α·F + (1−α)·S
    const a = shrinkageIntensity;
    Sigma = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => a * F[i][j] + (1 - a) * S_sample[i][j]));
  }
  // Current MV weights as proxy for market weights
  const totalMV = valid.reduce((s, h) => s + Math.abs(h.qty * h.mark), 0);
  const wMkt = valid.map(h => Math.abs(h.qty * h.mark) / totalMV);
  // Implied equilibrium returns: π = δ · Σ · w_mkt
  const pi = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      pi[i] += delta * Sigma[i][j] * wMkt[j];
    }
  }
  // If no views, posterior = implied; weights = market
  if (!views || views.length === 0) {
    const impliedMap = {}, postMap = {}, wMap = {};
    for (let i = 0; i < n; i++) {
      impliedMap[symbols[i]] = pi[i] * 100;
      postMap[symbols[i]] = pi[i] * 100;
      wMap[symbols[i]] = wMkt[i];
    }
    return {
      impliedReturns: impliedMap,
      posteriorReturns: postMap,
      optimalWeights: wMap,
      currentWeights: wMap,
      suggestions: [],
      covMatrix: Sigma,
      shrinkageIntensity,
      symbols,
      error: null,
    };
  }
  // Build P (k × n) and Q (k) and Ω (k × k)
  const validViews = views.filter(v => {
    if (!v.tickers || v.tickers.length === 0) return false;
    if (!v.tickers.every(t => symbols.includes(t.toUpperCase()))) return false;
    if (!Number.isFinite(Number(v.magnitudePct))) return false;
    return true;
  });
  if (validViews.length === 0) {
    // Same as no-views case
    const impliedMap = {}, postMap = {}, wMap = {};
    for (let i = 0; i < n; i++) {
      impliedMap[symbols[i]] = pi[i] * 100;
      postMap[symbols[i]] = pi[i] * 100;
      wMap[symbols[i]] = wMkt[i];
    }
    return {
      impliedReturns: impliedMap,
      posteriorReturns: postMap,
      optimalWeights: wMap,
      currentWeights: wMap,
      suggestions: [],
      covMatrix: Sigma,
      shrinkageIntensity,
      symbols,
      error: 'No valid views (tickers must be in portfolio)',
    };
  }
  const k = validViews.length;
  const P = Array.from({ length: k }, () => new Array(n).fill(0));
  const Q = new Array(k).fill(0);
  const Omega = Array.from({ length: k }, () => new Array(k).fill(0));
  for (let v = 0; v < k; v++) {
    const view = validViews[v];
    const mag = Number(view.magnitudePct) / 100;
    const conf = Math.max(1, Math.min(99, Number(view.confidencePct) || 50));
    const tickers = view.tickers.map(t => t.toUpperCase());
    if (view.type === 'absolute') {
      // P row: 1 in the asset's column, 0 elsewhere
      const idx = symbols.indexOf(tickers[0]);
      if (idx >= 0) P[v][idx] = 1;
      Q[v] = mag;
    } else { // relative
      // First ticker outperforms the rest
      const longIdx = symbols.indexOf(tickers[0]);
      if (longIdx >= 0) P[v][longIdx] = 1;
      const others = tickers.slice(1);
      for (const t of others) {
        const idx = symbols.indexOf(t);
        if (idx >= 0) P[v][idx] = -1 / others.length;
      }
      Q[v] = mag;
    }
    // Ω diagonal = confidence-derived uncertainty.
    // Standard heuristic: Ω_ii = (P_v · τΣ · P_v') / confidence_factor
    // High confidence = low uncertainty. Map 99% → 0.01x, 1% → 100x of variance.
    const baseVar = (() => {
      let s = 0;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          s += P[v][i] * (tau * Sigma[i][j]) * P[v][j];
        }
      }
      return s;
    })();
    const confFactor = conf / 50; // 1 = neutral, > 1 = more confident, < 1 = less
    Omega[v][v] = Math.max(1e-6, baseVar / confFactor);
  }
  // Compute posterior expected returns:
  // E[r] = ((τΣ)^-1 + P' Ω^-1 P)^-1 · ((τΣ)^-1 π + P' Ω^-1 Q)
  const tauSigma = Sigma.map(row => row.map(v => v * tau));
  const tauSigmaInv = _invertMatrixBL(tauSigma);
  if (!tauSigmaInv) return { ...empty, error: 'Covariance matrix is singular' };
  const OmegaInv = _invertMatrixBL(Omega);
  if (!OmegaInv) return { ...empty, error: 'View uncertainty matrix is singular' };
  // P' Ω^-1
  const PtOmegaInv = Array.from({ length: n }, () => new Array(k).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < k; j++) {
      let s = 0;
      for (let l = 0; l < k; l++) s += P[l][i] * OmegaInv[l][j];
      PtOmegaInv[i][j] = s;
    }
  }
  // P' Ω^-1 P
  const PtOmegaInvP = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (let l = 0; l < k; l++) s += PtOmegaInv[i][l] * P[l][j];
      PtOmegaInvP[i][j] = s;
    }
  }
  // M1 = (τΣ)^-1 + P' Ω^-1 P
  const M1 = tauSigmaInv.map((row, i) => row.map((v, j) => v + PtOmegaInvP[i][j]));
  const M1Inv = _invertMatrixBL(M1);
  if (!M1Inv) return { ...empty, error: 'Posterior precision matrix is singular' };
  // (τΣ)^-1 π
  const tauSigmaInvPi = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) tauSigmaInvPi[i] += tauSigmaInv[i][j] * pi[j];
  }
  // P' Ω^-1 Q
  const PtOmegaInvQ = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let l = 0; l < k; l++) PtOmegaInvQ[i] += PtOmegaInv[i][l] * Q[l];
  }
  // V2 = (τΣ)^-1 π + P' Ω^-1 Q
  const V2 = tauSigmaInvPi.map((v, i) => v + PtOmegaInvQ[i]);
  // E[r] = M1Inv * V2
  const Er = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) Er[i] += M1Inv[i][j] * V2[j];
  }
  // Optimal weights w* = (δΣ)^-1 · E[r]
  const deltaSigma = Sigma.map(row => row.map(v => v * delta));
  const deltaSigmaInv = _invertMatrixBL(deltaSigma);
  if (!deltaSigmaInv) return { ...empty, error: 'δΣ is singular' };
  const wRaw = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) wRaw[i] += deltaSigmaInv[i][j] * Er[j];
  }
  // Clip negative weights to 0 (long-only) then renormalize. For full
  // long/short, comment this out — but most retail users want long-only.
  for (let i = 0; i < n; i++) wRaw[i] = Math.max(0, wRaw[i]);
  const wSum = wRaw.reduce((a, b) => a + b, 0);
  const wOpt = wSum > 0 ? wRaw.map(w => w / wSum) : wMkt;
  // Build output
  const impliedMap = {}, postMap = {}, wOptMap = {}, wCurMap = {};
  for (let i = 0; i < n; i++) {
    impliedMap[symbols[i]] = pi[i] * 100;
    postMap[symbols[i]] = Er[i] * 100;
    wOptMap[symbols[i]] = wOpt[i];
    wCurMap[symbols[i]] = wMkt[i];
  }
  // Suggestions: where to add/trim
  const suggestions = symbols.map((s, i) => ({
    symbol: s,
    currentWeight: wMkt[i],
    optimalWeight: wOpt[i],
    deltaPct: (wOpt[i] - wMkt[i]) * 100,
  })).sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct));
  return {
    impliedReturns: impliedMap,
    posteriorReturns: postMap,
    optimalWeights: wOptMap,
    currentWeights: wCurMap,
    suggestions,
    covMatrix: Sigma,
    shrinkageIntensity,
    symbols,
    error: null,
  };
};
