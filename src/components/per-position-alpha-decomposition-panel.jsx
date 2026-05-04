// IMO Onyx Terminal — Per-position alpha decomposition panel
//
// Phase 3p.22 file-splitting / extracted from JPMOnyxTerminal.jsx
// (originally lines ~43543-44713, ~1,170 lines).
//
// Decomposes each position's return into alpha, beta, sector, and
// idiosyncratic components using a Polygon-fed historical regression.
// Helps users see WHERE their P&L came from — which positions
// genuinely outperformed (alpha) vs which just rode the market or
// sector wave (beta / sector tilt).
//
// Public export:
//   PerPositionAlphaDecompositionPanel({ augmented, benchmarkReturns })
//     augmented        — array of position records with mark/cost/qty
//     benchmarkReturns — pre-computed benchmark return series
//
// Honest scope:
//   - Regression uses ~90 days of daily returns. Short windows make
//     beta noisy; long windows make it stale. 90 is a compromise.
//   - "Alpha" here is the regression intercept — pre-cost, pre-tax,
//     and assumes the benchmark's risk model captures all systematic
//     factors. A real Brinson attribution would decompose further.

import React, { useState, useEffect, useMemo } from 'react';
import { COLORS, TICKER_SECTORS } from '../lib/constants.js';
import { cacheGet, cacheSet } from '../lib/api-cache.js';

// MASSIVE_API_KEY (Polygon) duplicated env read.
const MASSIVE_API_KEY = (() => { try { return import.meta.env?.VITE_MASSIVE_API_KEY ?? ''; } catch { return ''; } })();

// fetchKenFrenchFactors (inlined — only used here). Returns the latest
// daily Fama-French 5-factor + RF series from the Tuck mirror via a
// Vercel proxy that handles CORS. Falls back to user-configured URL.
const fetchKenFrenchFactors = async () => {
  const cacheKey = 'ff-factors-tuck';
  const cached = cacheGet(cacheKey, 12 * 60 * 60_000);
  if (cached) return cached;
  try {
    const candidates = [
      '/api/ff-factors',
      (() => { try { return import.meta.env?.VITE_FF_FACTORS_URL; } catch { return ''; } })(),
    ].filter(Boolean);
    for (const url of candidates) {
      try {
        const r = await fetch(url);
        if (!r.ok) continue;
        const j = await r.json();
        if (Array.isArray(j?.rows) && j.rows.length > 0) {
          const out = { rows: j.rows, asOf: j.asOf, count: j.count ?? j.rows.length, source: j.source || 'tuck-live' };
          cacheSet(cacheKey, out);
          return out;
        }
      } catch {}
    }
    return null;
  } catch (e) {
    console.warn('[Ken French factors]', e.message);
    return null;
  }
};

// Sector / Fama-French proxy data (inlined from monolith — FF_*
// constants only used here; TICKER_SECTORS is also referenced 15×
// elsewhere in monolith but small enough to duplicate).
const FF_SECTOR_ETFS_FOR_FETCH = ['XLK', 'XLV', 'XLF', 'XLY', 'XLP', 'XLE', 'XLI', 'XLB', 'XLU', 'XLRE', 'XLC'];
const FF_PROXY_TICKERS = ['IWM', 'SPY', 'VTV', 'VUG', 'QUAL', 'VYM', 'MTUM', ...FF_SECTOR_ETFS_FOR_FETCH];
const FF_SECTOR_TO_ETF = {
  'Technology': 'XLK', 'Information Technology': 'XLK',
  'Health Care': 'XLV', 'Healthcare': 'XLV',
  'Financials': 'XLF', 'Financial': 'XLF',
  'Consumer Discretionary': 'XLY', 'Consumer Cyclical': 'XLY',
  'Consumer Staples': 'XLP', 'Consumer Defensive': 'XLP',
  'Energy': 'XLE',
  'Industrials': 'XLI', 'Industrial': 'XLI',
  'Materials': 'XLB', 'Basic Materials': 'XLB',
  'Utilities': 'XLU',
  'Real Estate': 'XLRE',
  'Communication Services': 'XLC', 'Communications': 'XLC',
};

// fmt (inlined per established pattern).
const _getFmtLocale = () => {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('imo_settings') : null;
    if (!raw) return 'en-US';
    const s = JSON.parse(raw);
    const loc = s?.numberFormat;
    if (typeof loc === 'string' && /^[a-z]{2}-[A-Z]{2}$/.test(loc)) return loc;
    return 'en-US';
  } catch { return 'en-US'; }
};
const fmt = (n, d = 2) => Number(n).toLocaleString(_getFmtLocale(), {
  minimumFractionDigits: d, maximumFractionDigits: d,
});

export const PerPositionAlphaDecompositionPanel = ({ augmented, benchmarkReturns }) => {
  const [factorBars, setFactorBars] = useState({});
  const [loadingFactors, setLoadingFactors] = useState(false);
  // 3o.86: live Ken French factor returns (overrides ETF-proxy when present)
  const [ffLive, setFfLive] = useState(null);

  // Fetch FF factor proxy ETFs
  useEffect(() => {
    let cancelled = false;
    setLoadingFactors(true);
    const today = new Date().toISOString().slice(0, 10);
    const start = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10);
    Promise.all(FF_PROXY_TICKERS.map(async (sym) => {
      try {
        const url = `https://api.polygon.io/v2/aggs/ticker/${sym}/range/1/day/${start}/${today}?adjusted=true&sort=asc&limit=400&apiKey=${MASSIVE_API_KEY}`;
        const r = await fetch(url);
        if (!r.ok) return [sym, []];
        const j = await r.json();
        return [sym, j?.results || []];
      } catch {
        return [sym, []];
      }
    })).then(results => {
      if (cancelled) return;
      const map = Object.fromEntries(results);
      setFactorBars(map);
      setLoadingFactors(false);
    }).catch(() => {
      if (!cancelled) setLoadingFactors(false);
    });
    // Best-effort live FF data fetch — if successful, we'll prefer it
    // over the ETF-proxy approximation in the panel. Failure is silent;
    // the panel continues to work with proxies (existing behavior).
    fetchKenFrenchFactors().then(res => {
      if (!cancelled && res) setFfLive(res);
    });
    return () => { cancelled = true; };
  }, []);

  const analysis = useMemo(() => {
    if (!Array.isArray(augmented) || augmented.length === 0) return null;
    if (!Array.isArray(benchmarkReturns) || benchmarkReturns.length < 30) return null;
    const N = benchmarkReturns.length;
    const benchMean = benchmarkReturns.reduce((s, v) => s + v, 0) / N;
    let benchVar = 0;
    for (const r of benchmarkReturns) benchVar += (r - benchMean) ** 2;
    benchVar /= N;
    const benchAnnual = benchMean * 252 * 100;
    // Compute SMB + HML returns from factor ETFs (3o.79 Fama-French upgrade)
    const computeReturns = (bars) => {
      if (!Array.isArray(bars) || bars.length < 2) return null;
      const closes = bars.map(b => b.c);
      const rets = [];
      for (let i = 1; i < closes.length; i++) {
        rets.push((closes[i] - closes[i-1]) / closes[i-1]);
      }
      return rets;
    };
    const iwmRets = computeReturns(factorBars.IWM);
    const spyRets = computeReturns(factorBars.SPY);
    const vtvRets = computeReturns(factorBars.VTV);
    const vugRets = computeReturns(factorBars.VUG);
    const qualRets = computeReturns(factorBars.QUAL);
    const vymRets = computeReturns(factorBars.VYM);
    const mtumRets = computeReturns(factorBars.MTUM); // 3o.82: momentum proxy
    let smbReturns = null, hmlReturns = null, rmwReturns = null, cmaReturns = null, momReturns = null;
    // 3o.86: prefer live Ken French factor returns when available.
    // We slice the last N rows to match the benchmark window length.
    // Falls back to ETF-proxy spreads (existing behavior) on any failure.
    let factorSource = 'etf-proxy';
    if (ffLive?.rows?.length >= benchmarkReturns.length) {
      const tail = ffLive.rows.slice(-benchmarkReturns.length);
      smbReturns = tail.map(r => r.smb);
      hmlReturns = tail.map(r => r.hml);
      rmwReturns = tail.map(r => r.rmw);
      cmaReturns = tail.map(r => r.cma);
      // Tuck doesn't include momentum in the 5-factor file; that one
      // stays on the MTUM-SPY proxy. Same for FF6 sector factors.
      factorSource = 'ken-french-live';
    }
    if (!smbReturns && Array.isArray(iwmRets) && Array.isArray(spyRets) && iwmRets.length === spyRets.length) {
      smbReturns = iwmRets.map((r, i) => r - spyRets[i]);
    }
    if (!hmlReturns && Array.isArray(vtvRets) && Array.isArray(vugRets) && vtvRets.length === vugRets.length) {
      hmlReturns = vtvRets.map((r, i) => r - vugRets[i]);
    }
    // 3o.80: RMW (Robust Minus Weak profitability) ≈ QUAL − SPY
    if (!rmwReturns && Array.isArray(qualRets) && Array.isArray(spyRets) && qualRets.length === spyRets.length) {
      rmwReturns = qualRets.map((r, i) => r - spyRets[i]);
    }
    // 3o.80: CMA (Conservative Minus Aggressive investment) ≈ VYM − VUG
    if (!cmaReturns && Array.isArray(vymRets) && Array.isArray(vugRets) && vymRets.length === vugRets.length) {
      cmaReturns = vymRets.map((r, i) => r - vugRets[i]);
    }
    // 3o.82: MOM (Momentum, Carhart 4-factor) ≈ MTUM − SPY
    if (Array.isArray(mtumRets) && Array.isArray(spyRets) && mtumRets.length === spyRets.length) {
      momReturns = mtumRets.map((r, i) => r - spyRets[i]);
    }
    const rows = [];
    for (const h of augmented) {
      if (!Array.isArray(h.returns) || h.returns.length < 30) continue;
      const M = Math.min(h.returns.length, N);
      const posRets = h.returns.slice(-M);
      const benchSlice = benchmarkReturns.slice(-M);
      const posMean = posRets.reduce((s, v) => s + v, 0) / M;
      const benchSliceMean = benchSlice.reduce((s, v) => s + v, 0) / M;
      // OLS single-factor (market only)
      let cov = 0, benchSliceVar = 0;
      for (let i = 0; i < M; i++) {
        cov += (posRets[i] - posMean) * (benchSlice[i] - benchSliceMean);
        benchSliceVar += (benchSlice[i] - benchSliceMean) ** 2;
      }
      cov /= M;
      benchSliceVar /= M;
      if (benchSliceVar <= 0) continue;
      const beta = cov / benchSliceVar;
      const alpha = posMean - beta * benchSliceMean;
      // Idiosyncratic residuals (market-only)
      let resVar = 0;
      for (let i = 0; i < M; i++) {
        const predicted = alpha + beta * benchSlice[i];
        const residual = posRets[i] - predicted;
        resVar += residual ** 2;
      }
      resVar /= M;
      const idioVol = Math.sqrt(resVar) * Math.sqrt(252);
      const totalVar = posRets.reduce((s, v) => s + (v - posMean) ** 2, 0) / M;
      const rSquared = totalVar > 0 ? 1 - (resVar / totalVar) : 0;
      const alphaAnnual = alpha * 252 * 100;
      const expectedFromBeta = beta * benchAnnual;
      const annualPosReturn = posMean * 252 * 100;
      // 3o.79 multi-factor regression — extended to 5 factors (3o.80)
      // OLS multi-variable: r_i = α + β_mkt·r_mkt + β_SMB·r_SMB + β_HML·r_HML + β_RMW·r_RMW + β_CMA·r_CMA
      // Solved via Gaussian elimination on 5×5 normal equations system.
      let ff = null;
      let ff5 = null;
      let ff6 = null;
      let ff7 = null;
      const useFiveFactor = Array.isArray(smbReturns) && Array.isArray(hmlReturns)
                         && Array.isArray(rmwReturns) && Array.isArray(cmaReturns);
      if (Array.isArray(smbReturns) && Array.isArray(hmlReturns)) {
        const F = Math.min(M, smbReturns.length, hmlReturns.length,
          ...(useFiveFactor ? [rmwReturns.length, cmaReturns.length] : []));
        if (F >= 30) {
          const yArr = posRets.slice(-F);
          const x1 = benchSlice.slice(-F);
          const x2 = smbReturns.slice(-F);
          const x3 = hmlReturns.slice(-F);
          const meanY = yArr.reduce((s, v) => s + v, 0) / F;
          const meanX1 = x1.reduce((s, v) => s + v, 0) / F;
          const meanX2 = x2.reduce((s, v) => s + v, 0) / F;
          const meanX3 = x3.reduce((s, v) => s + v, 0) / F;
          const dy = yArr.map(v => v - meanY);
          const dx1 = x1.map(v => v - meanX1);
          const dx2 = x2.map(v => v - meanX2);
          const dx3 = x3.map(v => v - meanX3);
          // 3-factor (original 3o.79) — Cramer's rule
          let s11 = 0, s22 = 0, s33 = 0, s12 = 0, s13 = 0, s23 = 0;
          let r1 = 0, r2 = 0, r3 = 0;
          for (let i = 0; i < F; i++) {
            s11 += dx1[i] ** 2;
            s22 += dx2[i] ** 2;
            s33 += dx3[i] ** 2;
            s12 += dx1[i] * dx2[i];
            s13 += dx1[i] * dx3[i];
            s23 += dx2[i] * dx3[i];
            r1 += dx1[i] * dy[i];
            r2 += dx2[i] * dy[i];
            r3 += dx3[i] * dy[i];
          }
          const det = s11*(s22*s33 - s23*s23) - s12*(s12*s33 - s23*s13) + s13*(s12*s23 - s22*s13);
          if (Math.abs(det) > 1e-20) {
            const det1 = r1*(s22*s33 - s23*s23) - s12*(r2*s33 - s23*r3) + s13*(r2*s23 - s22*r3);
            const det2 = s11*(r2*s33 - s23*r3) - r1*(s12*s33 - s23*s13) + s13*(s12*r3 - r2*s13);
            const det3 = s11*(s22*r3 - r2*s23) - s12*(s12*r3 - r2*s13) + r1*(s12*s23 - s22*s13);
            const beta_mkt = det1 / det;
            const beta_smb = det2 / det;
            const beta_hml = det3 / det;
            const alpha_ff = meanY - beta_mkt * meanX1 - beta_smb * meanX2 - beta_hml * meanX3;
            let resVar_ff = 0;
            for (let i = 0; i < F; i++) {
              const predicted = alpha_ff + beta_mkt * x1[i] + beta_smb * x2[i] + beta_hml * x3[i];
              resVar_ff += (yArr[i] - predicted) ** 2;
            }
            resVar_ff /= F;
            const totalVar_ff = dy.reduce((s, v) => s + v * v, 0) / F;
            const rSquared_ff = totalVar_ff > 0 ? 1 - (resVar_ff / totalVar_ff) : 0;
            ff = {
              alpha: alpha_ff,
              alphaAnnual: alpha_ff * 252 * 100,
              betaMkt: beta_mkt,
              betaSMB: beta_smb,
              betaHML: beta_hml,
              rSquared: rSquared_ff * 100,
              n: F,
            };
          }
          // 3o.80: 5-factor extension
          if (useFiveFactor && F >= 30) {
            const x4 = rmwReturns.slice(-F);
            const x5 = cmaReturns.slice(-F);
            const meanX4 = x4.reduce((s, v) => s + v, 0) / F;
            const meanX5 = x5.reduce((s, v) => s + v, 0) / F;
            const dx4 = x4.map(v => v - meanX4);
            const dx5 = x5.map(v => v - meanX5);
            // Build 5×5 X'X matrix and 5×1 X'y vector
            const xs = [dx1, dx2, dx3, dx4, dx5];
            const A = [[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0]];
            const bvec = [0, 0, 0, 0, 0];
            for (let i = 0; i < F; i++) {
              for (let p = 0; p < 5; p++) {
                bvec[p] += xs[p][i] * dy[i];
                for (let q = p; q < 5; q++) {
                  const v = xs[p][i] * xs[q][i];
                  A[p][q] += v;
                  if (p !== q) A[q][p] += v;
                }
              }
            }
            // Gaussian elimination with partial pivoting on augmented matrix
            const aug = A.map((row, i) => [...row, bvec[i]]);
            const sz = 5;
            let singular = false;
            for (let col = 0; col < sz; col++) {
              // Pivot
              let maxRow = col;
              for (let r = col + 1; r < sz; r++) {
                if (Math.abs(aug[r][col]) > Math.abs(aug[maxRow][col])) maxRow = r;
              }
              if (Math.abs(aug[maxRow][col]) < 1e-15) {
                singular = true;
                break;
              }
              [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];
              // Eliminate below
              for (let r = col + 1; r < sz; r++) {
                const factor = aug[r][col] / aug[col][col];
                for (let c = col; c <= sz; c++) {
                  aug[r][c] -= factor * aug[col][c];
                }
              }
            }
            if (!singular) {
              // Back-substitution
              const beta5 = new Array(sz).fill(0);
              for (let r = sz - 1; r >= 0; r--) {
                let sum = aug[r][sz];
                for (let c = r + 1; c < sz; c++) {
                  sum -= aug[r][c] * beta5[c];
                }
                beta5[r] = sum / aug[r][r];
              }
              const [beta_mkt5, beta_smb5, beta_hml5, beta_rmw5, beta_cma5] = beta5;
              const alpha_ff5 = meanY - beta_mkt5 * meanX1 - beta_smb5 * meanX2
                              - beta_hml5 * meanX3 - beta_rmw5 * meanX4 - beta_cma5 * meanX5;
              let resVar_ff5 = 0;
              for (let i = 0; i < F; i++) {
                const predicted = alpha_ff5 + beta_mkt5 * x1[i] + beta_smb5 * x2[i]
                                + beta_hml5 * x3[i] + beta_rmw5 * x4[i] + beta_cma5 * x5[i];
                resVar_ff5 += (yArr[i] - predicted) ** 2;
              }
              resVar_ff5 /= F;
              const totalVar_ff5 = dy.reduce((s, v) => s + v * v, 0) / F;
              const rSquared_ff5 = totalVar_ff5 > 0 ? 1 - (resVar_ff5 / totalVar_ff5) : 0;
              ff5 = {
                alpha: alpha_ff5,
                alphaAnnual: alpha_ff5 * 252 * 100,
                betaMkt: beta_mkt5,
                betaSMB: beta_smb5,
                betaHML: beta_hml5,
                betaRMW: beta_rmw5,
                betaCMA: beta_cma5,
                rSquared: rSquared_ff5 * 100,
                n: F,
              };
            }
          }
          // 3o.81: 6-factor extension — adds sector_ETF − SPY as 6th factor
          // (per-position, since each holding's sector ETF differs)
          if (useFiveFactor && F >= 30 && h.sector) {
            const sectorEtf = FF_SECTOR_TO_ETF[h.sector];
            const sectorRets = sectorEtf ? computeReturns(factorBars[sectorEtf]) : null;
            if (Array.isArray(sectorRets) && Array.isArray(spyRets)
                && sectorRets.length === spyRets.length) {
              // Sector excess return = sector_ETF − SPY
              const sectorExcessReturns = sectorRets.map((r, i) => r - spyRets[i]);
              if (sectorExcessReturns.length >= F) {
                const x4_6 = rmwReturns.slice(-F);
                const x5_6 = cmaReturns.slice(-F);
                const x6 = sectorExcessReturns.slice(-F);
                const meanX4_6 = x4_6.reduce((s, v) => s + v, 0) / F;
                const meanX5_6 = x5_6.reduce((s, v) => s + v, 0) / F;
                const meanX6 = x6.reduce((s, v) => s + v, 0) / F;
                const dx4_6 = x4_6.map(v => v - meanX4_6);
                const dx5_6 = x5_6.map(v => v - meanX5_6);
                const dx6 = x6.map(v => v - meanX6);
                const xs6 = [dx1, dx2, dx3, dx4_6, dx5_6, dx6];
                const A6 = Array.from({ length: 6 }, () => new Array(6).fill(0));
                const bvec6 = new Array(6).fill(0);
                for (let i = 0; i < F; i++) {
                  for (let p = 0; p < 6; p++) {
                    bvec6[p] += xs6[p][i] * dy[i];
                    for (let q = p; q < 6; q++) {
                      const v = xs6[p][i] * xs6[q][i];
                      A6[p][q] += v;
                      if (p !== q) A6[q][p] += v;
                    }
                  }
                }
                const aug6 = A6.map((row, i) => [...row, bvec6[i]]);
                const sz6 = 6;
                let singular6 = false;
                for (let col = 0; col < sz6; col++) {
                  let maxRow = col;
                  for (let r = col + 1; r < sz6; r++) {
                    if (Math.abs(aug6[r][col]) > Math.abs(aug6[maxRow][col])) maxRow = r;
                  }
                  if (Math.abs(aug6[maxRow][col]) < 1e-15) {
                    singular6 = true;
                    break;
                  }
                  [aug6[col], aug6[maxRow]] = [aug6[maxRow], aug6[col]];
                  for (let r = col + 1; r < sz6; r++) {
                    const factor = aug6[r][col] / aug6[col][col];
                    for (let c = col; c <= sz6; c++) {
                      aug6[r][c] -= factor * aug6[col][c];
                    }
                  }
                }
                if (!singular6) {
                  const beta6 = new Array(sz6).fill(0);
                  for (let r = sz6 - 1; r >= 0; r--) {
                    let sum = aug6[r][sz6];
                    for (let c = r + 1; c < sz6; c++) {
                      sum -= aug6[r][c] * beta6[c];
                    }
                    beta6[r] = sum / aug6[r][r];
                  }
                  const [bM6, bSMB6, bHML6, bRMW6, bCMA6, bSec6] = beta6;
                  const alpha_ff6 = meanY - bM6 * meanX1 - bSMB6 * meanX2
                                  - bHML6 * meanX3 - bRMW6 * meanX4_6
                                  - bCMA6 * meanX5_6 - bSec6 * meanX6;
                  let resVar_ff6 = 0;
                  for (let i = 0; i < F; i++) {
                    const predicted = alpha_ff6 + bM6 * x1[i] + bSMB6 * x2[i]
                                    + bHML6 * x3[i] + bRMW6 * x4_6[i]
                                    + bCMA6 * x5_6[i] + bSec6 * x6[i];
                    resVar_ff6 += (yArr[i] - predicted) ** 2;
                  }
                  resVar_ff6 /= F;
                  const totalVar_ff6 = dy.reduce((s, v) => s + v * v, 0) / F;
                  const rSquared_ff6 = totalVar_ff6 > 0 ? 1 - (resVar_ff6 / totalVar_ff6) : 0;
                  ff6 = {
                    alpha: alpha_ff6,
                    alphaAnnual: alpha_ff6 * 252 * 100,
                    betaMkt: bM6,
                    betaSMB: bSMB6,
                    betaHML: bHML6,
                    betaRMW: bRMW6,
                    betaCMA: bCMA6,
                    betaSector: bSec6,
                    sectorEtf,
                    rSquared: rSquared_ff6 * 100,
                    n: F,
                  };
                }
              }
            }
          }
          // 3o.82: 7-factor extension — FF6 + momentum (Carhart-style)
          // Adds 7th factor = MTUM − SPY (momentum factor, distinct from
          // existing market/size/value/quality/investment/sector factors)
          if (useFiveFactor && F >= 30 && Array.isArray(momReturns)
              && h.sector && FF_SECTOR_TO_ETF[h.sector]) {
            const sectorEtf = FF_SECTOR_TO_ETF[h.sector];
            const sectorRets = computeReturns(factorBars[sectorEtf]);
            if (Array.isArray(sectorRets) && Array.isArray(spyRets)
                && sectorRets.length === spyRets.length) {
              const sectorExcessReturns = sectorRets.map((r, i) => r - spyRets[i]);
              if (sectorExcessReturns.length >= F && momReturns.length >= F) {
                const x4_7 = rmwReturns.slice(-F);
                const x5_7 = cmaReturns.slice(-F);
                const x6_7 = sectorExcessReturns.slice(-F);
                const x7 = momReturns.slice(-F);
                const meanX4_7 = x4_7.reduce((s, v) => s + v, 0) / F;
                const meanX5_7 = x5_7.reduce((s, v) => s + v, 0) / F;
                const meanX6_7 = x6_7.reduce((s, v) => s + v, 0) / F;
                const meanX7 = x7.reduce((s, v) => s + v, 0) / F;
                const dx4_7 = x4_7.map(v => v - meanX4_7);
                const dx5_7 = x5_7.map(v => v - meanX5_7);
                const dx6_7 = x6_7.map(v => v - meanX6_7);
                const dx7 = x7.map(v => v - meanX7);
                const xs7 = [dx1, dx2, dx3, dx4_7, dx5_7, dx6_7, dx7];
                const A7 = Array.from({ length: 7 }, () => new Array(7).fill(0));
                const bvec7 = new Array(7).fill(0);
                for (let i = 0; i < F; i++) {
                  for (let p = 0; p < 7; p++) {
                    bvec7[p] += xs7[p][i] * dy[i];
                    for (let q = p; q < 7; q++) {
                      const v = xs7[p][i] * xs7[q][i];
                      A7[p][q] += v;
                      if (p !== q) A7[q][p] += v;
                    }
                  }
                }
                const aug7 = A7.map((row, i) => [...row, bvec7[i]]);
                const sz7 = 7;
                let singular7 = false;
                for (let col = 0; col < sz7; col++) {
                  let maxRow = col;
                  for (let r = col + 1; r < sz7; r++) {
                    if (Math.abs(aug7[r][col]) > Math.abs(aug7[maxRow][col])) maxRow = r;
                  }
                  if (Math.abs(aug7[maxRow][col]) < 1e-15) {
                    singular7 = true;
                    break;
                  }
                  [aug7[col], aug7[maxRow]] = [aug7[maxRow], aug7[col]];
                  for (let r = col + 1; r < sz7; r++) {
                    const factor = aug7[r][col] / aug7[col][col];
                    for (let c = col; c <= sz7; c++) {
                      aug7[r][c] -= factor * aug7[col][c];
                    }
                  }
                }
                if (!singular7) {
                  const beta7 = new Array(sz7).fill(0);
                  for (let r = sz7 - 1; r >= 0; r--) {
                    let sum = aug7[r][sz7];
                    for (let c = r + 1; c < sz7; c++) {
                      sum -= aug7[r][c] * beta7[c];
                    }
                    beta7[r] = sum / aug7[r][r];
                  }
                  const [bM7, bSMB7, bHML7, bRMW7, bCMA7, bSec7, bMOM7] = beta7;
                  const alpha_ff7 = meanY - bM7 * meanX1 - bSMB7 * meanX2
                                  - bHML7 * meanX3 - bRMW7 * meanX4_7
                                  - bCMA7 * meanX5_7 - bSec7 * meanX6_7
                                  - bMOM7 * meanX7;
                  let resVar_ff7 = 0;
                  for (let i = 0; i < F; i++) {
                    const predicted = alpha_ff7 + bM7 * x1[i] + bSMB7 * x2[i]
                                    + bHML7 * x3[i] + bRMW7 * x4_7[i]
                                    + bCMA7 * x5_7[i] + bSec7 * x6_7[i]
                                    + bMOM7 * x7[i];
                    resVar_ff7 += (yArr[i] - predicted) ** 2;
                  }
                  resVar_ff7 /= F;
                  const totalVar_ff7 = dy.reduce((s, v) => s + v * v, 0) / F;
                  const rSquared_ff7 = totalVar_ff7 > 0 ? 1 - (resVar_ff7 / totalVar_ff7) : 0;
                  ff7 = {
                    alpha: alpha_ff7,
                    alphaAnnual: alpha_ff7 * 252 * 100,
                    betaMkt: bM7,
                    betaSMB: bSMB7,
                    betaHML: bHML7,
                    betaRMW: bRMW7,
                    betaCMA: bCMA7,
                    betaSector: bSec7,
                    betaMOM: bMOM7,
                    sectorEtf,
                    rSquared: rSquared_ff7 * 100,
                    n: F,
                  };
                }
              }
            }
          }
        }
      }
      // 3o.85: performance attribution decomposition.
      // Total position return over the lookback window decomposed as:
      //   r_total ≈ alpha_period + Σ (β_factor × factor_return_period)
      // Where factor_return_period is the cumulative log return of each
      // factor proxy over the same period. Reveals what portion of return
      // came from market timing (β_mkt × r_mkt), size tilt (β_SMB × r_SMB),
      // value tilt (β_HML × r_HML), profitability (β_RMW × r_RMW), etc.
      // Uses FF5 betas if available (most common), else FF3, else single-factor.
      let attribution = null;
      try {
        const periodM = Math.min(M, smbReturns?.length || 0, hmlReturns?.length || 0);
        if (ff5 && periodM >= 30) {
          // Sum factor returns over the same window
          const sumSPY = spyRets.slice(-periodM).reduce((s, v) => s + v, 0);
          const sumSMB = smbReturns.slice(-periodM).reduce((s, v) => s + v, 0);
          const sumHML = hmlReturns.slice(-periodM).reduce((s, v) => s + v, 0);
          const sumRMW = rmwReturns.slice(-periodM).reduce((s, v) => s + v, 0);
          const sumCMA = cmaReturns.slice(-periodM).reduce((s, v) => s + v, 0);
          const totalRet = posRets.slice(-periodM).reduce((s, v) => s + v, 0) * 100;
          // Each contribution in % terms (cumulative log return × 100)
          const contribMkt = ff5.betaMkt * sumSPY * 100;
          const contribSMB = ff5.betaSMB * sumSMB * 100;
          const contribHML = ff5.betaHML * sumHML * 100;
          const contribRMW = ff5.betaRMW * sumRMW * 100;
          const contribCMA = ff5.betaCMA * sumCMA * 100;
          const totalFactorContrib = contribMkt + contribSMB + contribHML + contribRMW + contribCMA;
          // Residual = total - factor contribution = period alpha
          const periodAlpha = totalRet - totalFactorContrib;
          attribution = {
            totalRet,
            contribMkt,
            contribSMB,
            contribHML,
            contribRMW,
            contribCMA,
            periodAlpha,
            n: periodM,
          };
        } else if (ff && periodM >= 30) {
          const sumSPY = spyRets.slice(-periodM).reduce((s, v) => s + v, 0);
          const sumSMB = smbReturns.slice(-periodM).reduce((s, v) => s + v, 0);
          const sumHML = hmlReturns.slice(-periodM).reduce((s, v) => s + v, 0);
          const totalRet = posRets.slice(-periodM).reduce((s, v) => s + v, 0) * 100;
          const contribMkt = ff.betaMkt * sumSPY * 100;
          const contribSMB = ff.betaSMB * sumSMB * 100;
          const contribHML = ff.betaHML * sumHML * 100;
          const totalFactorContrib = contribMkt + contribSMB + contribHML;
          const periodAlpha = totalRet - totalFactorContrib;
          attribution = {
            totalRet,
            contribMkt,
            contribSMB,
            contribHML,
            contribRMW: 0,
            contribCMA: 0,
            periodAlpha,
            n: periodM,
          };
        }
      } catch {}
      rows.push({
        sym: h.symbol,
        beta,
        alphaAnnual,
        expectedFromBeta,
        annualPosReturn,
        idioVol: idioVol * 100,
        rSquared: rSquared * 100,
        ff,
        ff5,
        ff6,
        ff7,
        attribution,
      });
    }
    if (rows.length === 0) return null;
    rows.sort((a, b) => b.alphaAnnual - a.alphaAnnual);
    const positiveAlpha = rows.filter(r => r.alphaAnnual > 0).length;
    const negativeAlpha = rows.filter(r => r.alphaAnnual < 0).length;
    const avgAlpha = rows.reduce((s, r) => s + r.alphaAnnual, 0) / rows.length;
    const ffRows = rows.filter(r => r.ff != null);
    const ff5Rows = rows.filter(r => r.ff5 != null);
    const ff6Rows = rows.filter(r => r.ff6 != null);
    const ff7Rows = rows.filter(r => r.ff7 != null);
    const ffAvailable = ffRows.length > 0;
    const ff5Available = ff5Rows.length > 0;
    const ff6Available = ff6Rows.length > 0;
    const ff7Available = ff7Rows.length > 0;
    return { rows, benchAnnual, positiveAlpha, negativeAlpha, avgAlpha,
             ffAvailable, ffCount: ffRows.length,
             ff5Available, ff5Count: ff5Rows.length,
             ff6Available, ff6Count: ff6Rows.length,
             ff7Available, ff7Count: ff7Rows.length,
             factorSource };
  }, [augmented, benchmarkReturns, factorBars, ffLive]);

  if (!analysis) return null;

  return (
    <div className="rounded-md border p-3"
         style={{ borderColor: COLORS.border, background: COLORS.surface }}>
      <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>
            Per-position alpha decomposition · OLS regression
          </div>
          <div className="text-[10.5px] mt-0.5" style={{ color: COLORS.textDim }}>
            Benchmark return (annualized): {analysis.benchAnnual.toFixed(1)}% ·
            avg alpha: <strong style={{ color: analysis.avgAlpha >= 0 ? COLORS.green : COLORS.red }}>
              {analysis.avgAlpha >= 0 ? '+' : ''}{analysis.avgAlpha.toFixed(1)}%
            </strong>
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">
        <div className="rounded border p-2"
             style={{ borderColor: `${COLORS.green}55`, background: `${COLORS.green}05` }}>
          <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.green }}>
            Positive alpha
          </div>
          <div className="tabular-nums text-[14px] font-medium" style={{ color: COLORS.green }}>
            {analysis.positiveAlpha}
          </div>
          <div className="text-[9.5px]" style={{ color: COLORS.textMute }}>
            outperforming β
          </div>
        </div>
        <div className="rounded border p-2"
             style={{ borderColor: `${COLORS.red}55`, background: `${COLORS.red}05` }}>
          <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.red }}>
            Negative alpha
          </div>
          <div className="tabular-nums text-[14px] font-medium" style={{ color: COLORS.red }}>
            {analysis.negativeAlpha}
          </div>
          <div className="text-[9.5px]" style={{ color: COLORS.textMute }}>
            underperforming β
          </div>
        </div>
        <div className="rounded border p-2"
             style={{ borderColor: COLORS.border, background: COLORS.bg }}>
          <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>
            Avg alpha
          </div>
          <div className="tabular-nums text-[14px] font-medium"
               style={{ color: analysis.avgAlpha >= 0 ? COLORS.green : COLORS.red }}>
            {analysis.avgAlpha >= 0 ? '+' : ''}{analysis.avgAlpha.toFixed(1)}%
          </div>
          <div className="text-[9.5px]" style={{ color: COLORS.textMute }}>
            per position avg
          </div>
        </div>
      </div>

      {/* Per-position table */}
      <div className="overflow-x-auto rounded border" style={{ borderColor: COLORS.border }}>
        <table className="w-full text-[10.5px] tabular-nums">
          <thead>
            <tr style={{ color: COLORS.textMute, background: COLORS.bg }}>
              <th className="text-left px-3 py-1.5">Symbol</th>
              <th className="text-right px-2">β</th>
              <th className="text-right px-2">Total return</th>
              <th className="text-right px-2">From β</th>
              <th className="text-right px-2">α (alpha)</th>
              <th className="text-right px-2">Idio vol</th>
              <th className="text-right px-3">R²</th>
            </tr>
          </thead>
          <tbody>
            {analysis.rows.slice(0, 15).map(r => (
              <tr key={r.sym} style={{ borderTop: `1px solid ${COLORS.border}` }}>
                <td className="px-3 py-1" style={{ color: COLORS.text, fontWeight: 500 }}>
                  {r.sym}
                </td>
                <td className="text-right px-2" style={{ color: COLORS.textDim }}>
                  {r.beta.toFixed(2)}
                </td>
                <td className="text-right px-2"
                    style={{ color: r.annualPosReturn >= 0 ? COLORS.text : COLORS.red }}>
                  {r.annualPosReturn >= 0 ? '+' : ''}{r.annualPosReturn.toFixed(1)}%
                </td>
                <td className="text-right px-2" style={{ color: COLORS.textDim }}>
                  {r.expectedFromBeta >= 0 ? '+' : ''}{r.expectedFromBeta.toFixed(1)}%
                </td>
                <td className="text-right px-2"
                    style={{
                      color: r.alphaAnnual > 5 ? COLORS.green
                           : r.alphaAnnual > 0 ? '#7AC8FF'
                           : r.alphaAnnual > -5 ? '#FFB84D' : COLORS.red,
                      fontWeight: 500,
                    }}>
                  {r.alphaAnnual >= 0 ? '+' : ''}{r.alphaAnnual.toFixed(1)}%
                </td>
                <td className="text-right px-2" style={{ color: COLORS.textDim }}>
                  {r.idioVol.toFixed(1)}%
                </td>
                <td className="text-right px-3"
                    style={{ color: r.rSquared > 50 ? COLORS.text : COLORS.textDim }}>
                  {r.rSquared.toFixed(0)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Fama-French 3-factor decomposition (3o.79 upgrade) */}
      {analysis.ffAvailable && (
        <div className="mt-3">
          <div className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: COLORS.mint }}>
            Fama-French 3-factor decomposition · {analysis.ffCount} positions
            {loadingFactors && <span className="ml-1" style={{ color: COLORS.textMute }}>(loading factors…)</span>}
          </div>
          <div className="overflow-x-auto rounded border" style={{ borderColor: COLORS.border }}>
            <table className="w-full text-[10.5px] tabular-nums">
              <thead>
                <tr style={{ color: COLORS.textMute, background: COLORS.bg }}>
                  <th className="text-left px-3 py-1.5">Symbol</th>
                  <th className="text-right px-2">β_market</th>
                  <th className="text-right px-2">β_SMB</th>
                  <th className="text-right px-2">β_HML</th>
                  <th className="text-right px-2">FF α</th>
                  <th className="text-right px-3">FF R²</th>
                </tr>
              </thead>
              <tbody>
                {analysis.rows.filter(r => r.ff != null).slice(0, 15).map(r => (
                  <tr key={`ff-${r.sym}`} style={{ borderTop: `1px solid ${COLORS.border}` }}>
                    <td className="px-3 py-1" style={{ color: COLORS.text, fontWeight: 500 }}>
                      {r.sym}
                    </td>
                    <td className="text-right px-2" style={{ color: COLORS.textDim }}>
                      {r.ff.betaMkt.toFixed(2)}
                    </td>
                    <td className="text-right px-2"
                        style={{
                          color: Math.abs(r.ff.betaSMB) > 0.3
                            ? (r.ff.betaSMB > 0 ? COLORS.text : '#7AC8FF')
                            : COLORS.textMute,
                        }}>
                      {r.ff.betaSMB >= 0 ? '+' : ''}{r.ff.betaSMB.toFixed(2)}
                    </td>
                    <td className="text-right px-2"
                        style={{
                          color: Math.abs(r.ff.betaHML) > 0.3
                            ? (r.ff.betaHML > 0 ? COLORS.text : '#7AC8FF')
                            : COLORS.textMute,
                        }}>
                      {r.ff.betaHML >= 0 ? '+' : ''}{r.ff.betaHML.toFixed(2)}
                    </td>
                    <td className="text-right px-2"
                        style={{
                          color: r.ff.alphaAnnual > 5 ? COLORS.green
                               : r.ff.alphaAnnual > 0 ? '#7AC8FF'
                               : r.ff.alphaAnnual > -5 ? '#FFB84D' : COLORS.red,
                          fontWeight: 500,
                        }}>
                      {r.ff.alphaAnnual >= 0 ? '+' : ''}{r.ff.alphaAnnual.toFixed(1)}%
                    </td>
                    <td className="text-right px-3"
                        style={{ color: r.ff.rSquared > 50 ? COLORS.text : COLORS.textDim }}>
                      {r.ff.rSquared.toFixed(0)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Fama-French 5-factor decomposition (3o.80 · live FF data 3o.86) */}
      {analysis.ff5Available && (
        <div className="mt-3">
          <div className="text-[10px] uppercase tracking-wider mb-1.5 flex items-center gap-2 flex-wrap" style={{ color: '#7AC8FF' }}>
            <span>Fama-French 5-factor decomposition · {analysis.ff5Count} positions</span>
            <span className="px-1.5 py-0.5 rounded text-[9px]"
                  style={{
                    background: analysis.factorSource === 'ken-french-live' ? `${COLORS.green}1A` : `${COLORS.textMute}1A`,
                    color: analysis.factorSource === 'ken-french-live' ? COLORS.green : COLORS.textMute,
                    border: `1px solid ${analysis.factorSource === 'ken-french-live' ? `${COLORS.green}55` : `${COLORS.textMute}33`}`,
                  }}>
              {analysis.factorSource === 'ken-french-live'
                ? '● Live · Tuck/French data'
                : '○ ETF proxy'}
            </span>
          </div>
          <div className="overflow-x-auto rounded border" style={{ borderColor: COLORS.border }}>
            <table className="w-full text-[10.5px] tabular-nums">
              <thead>
                <tr style={{ color: COLORS.textMute, background: COLORS.bg }}>
                  <th className="text-left px-3 py-1.5">Symbol</th>
                  <th className="text-right px-2">β_market</th>
                  <th className="text-right px-2">β_SMB</th>
                  <th className="text-right px-2">β_HML</th>
                  <th className="text-right px-2">β_RMW</th>
                  <th className="text-right px-2">β_CMA</th>
                  <th className="text-right px-2">FF5 α</th>
                  <th className="text-right px-3">FF5 R²</th>
                </tr>
              </thead>
              <tbody>
                {analysis.rows.filter(r => r.ff5 != null).slice(0, 15).map(r => (
                  <tr key={`ff5-${r.sym}`} style={{ borderTop: `1px solid ${COLORS.border}` }}>
                    <td className="px-3 py-1" style={{ color: COLORS.text, fontWeight: 500 }}>
                      {r.sym}
                    </td>
                    <td className="text-right px-2" style={{ color: COLORS.textDim }}>
                      {r.ff5.betaMkt.toFixed(2)}
                    </td>
                    <td className="text-right px-2"
                        style={{ color: Math.abs(r.ff5.betaSMB) > 0.3 ? (r.ff5.betaSMB > 0 ? COLORS.text : '#7AC8FF') : COLORS.textMute }}>
                      {r.ff5.betaSMB >= 0 ? '+' : ''}{r.ff5.betaSMB.toFixed(2)}
                    </td>
                    <td className="text-right px-2"
                        style={{ color: Math.abs(r.ff5.betaHML) > 0.3 ? (r.ff5.betaHML > 0 ? COLORS.text : '#7AC8FF') : COLORS.textMute }}>
                      {r.ff5.betaHML >= 0 ? '+' : ''}{r.ff5.betaHML.toFixed(2)}
                    </td>
                    <td className="text-right px-2"
                        style={{ color: Math.abs(r.ff5.betaRMW) > 0.3 ? (r.ff5.betaRMW > 0 ? COLORS.green : COLORS.red) : COLORS.textMute }}>
                      {r.ff5.betaRMW >= 0 ? '+' : ''}{r.ff5.betaRMW.toFixed(2)}
                    </td>
                    <td className="text-right px-2"
                        style={{ color: Math.abs(r.ff5.betaCMA) > 0.3 ? (r.ff5.betaCMA > 0 ? COLORS.text : '#7AC8FF') : COLORS.textMute }}>
                      {r.ff5.betaCMA >= 0 ? '+' : ''}{r.ff5.betaCMA.toFixed(2)}
                    </td>
                    <td className="text-right px-2"
                        style={{
                          color: r.ff5.alphaAnnual > 5 ? COLORS.green
                               : r.ff5.alphaAnnual > 0 ? '#7AC8FF'
                               : r.ff5.alphaAnnual > -5 ? '#FFB84D' : COLORS.red,
                          fontWeight: 500,
                        }}>
                      {r.ff5.alphaAnnual >= 0 ? '+' : ''}{r.ff5.alphaAnnual.toFixed(1)}%
                    </td>
                    <td className="text-right px-3"
                        style={{ color: r.ff5.rSquared > 50 ? COLORS.text : COLORS.textDim }}>
                      {r.ff5.rSquared.toFixed(0)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Fama-French 6-factor with sector (3o.81 upgrade) */}
      {analysis.ff6Available && (
        <div className="mt-3">
          <div className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: COLORS.mint }}>
            Fama-French 6-factor (FF5 + sector) · {analysis.ff6Count} positions
          </div>
          <div className="overflow-x-auto rounded border" style={{ borderColor: COLORS.border }}>
            <table className="w-full text-[10.5px] tabular-nums">
              <thead>
                <tr style={{ color: COLORS.textMute, background: COLORS.bg }}>
                  <th className="text-left px-3 py-1.5">Symbol</th>
                  <th className="text-right px-2">β_market</th>
                  <th className="text-right px-2">β_SMB</th>
                  <th className="text-right px-2">β_HML</th>
                  <th className="text-right px-2">β_RMW</th>
                  <th className="text-right px-2">β_CMA</th>
                  <th className="text-right px-2">β_sector</th>
                  <th className="text-right px-2">FF6 α</th>
                  <th className="text-right px-3">FF6 R²</th>
                </tr>
              </thead>
              <tbody>
                {analysis.rows.filter(r => r.ff6 != null).slice(0, 15).map(r => (
                  <tr key={`ff6-${r.sym}`} style={{ borderTop: `1px solid ${COLORS.border}` }}>
                    <td className="px-3 py-1" style={{ color: COLORS.text, fontWeight: 500 }}>
                      {r.sym}
                    </td>
                    <td className="text-right px-2" style={{ color: COLORS.textDim }}>
                      {r.ff6.betaMkt.toFixed(2)}
                    </td>
                    <td className="text-right px-2"
                        style={{ color: Math.abs(r.ff6.betaSMB) > 0.3 ? (r.ff6.betaSMB > 0 ? COLORS.text : '#7AC8FF') : COLORS.textMute }}>
                      {r.ff6.betaSMB >= 0 ? '+' : ''}{r.ff6.betaSMB.toFixed(2)}
                    </td>
                    <td className="text-right px-2"
                        style={{ color: Math.abs(r.ff6.betaHML) > 0.3 ? (r.ff6.betaHML > 0 ? COLORS.text : '#7AC8FF') : COLORS.textMute }}>
                      {r.ff6.betaHML >= 0 ? '+' : ''}{r.ff6.betaHML.toFixed(2)}
                    </td>
                    <td className="text-right px-2"
                        style={{ color: Math.abs(r.ff6.betaRMW) > 0.3 ? (r.ff6.betaRMW > 0 ? COLORS.green : COLORS.red) : COLORS.textMute }}>
                      {r.ff6.betaRMW >= 0 ? '+' : ''}{r.ff6.betaRMW.toFixed(2)}
                    </td>
                    <td className="text-right px-2"
                        style={{ color: Math.abs(r.ff6.betaCMA) > 0.3 ? (r.ff6.betaCMA > 0 ? COLORS.text : '#7AC8FF') : COLORS.textMute }}>
                      {r.ff6.betaCMA >= 0 ? '+' : ''}{r.ff6.betaCMA.toFixed(2)}
                    </td>
                    <td className="text-right px-2"
                        style={{ color: Math.abs(r.ff6.betaSector) > 0.3 ? (r.ff6.betaSector > 0 ? COLORS.green : COLORS.red) : COLORS.textMute, fontWeight: 500 }}
                        title={`Sector ETF: ${r.ff6.sectorEtf}`}>
                      {r.ff6.betaSector >= 0 ? '+' : ''}{r.ff6.betaSector.toFixed(2)}
                      <span className="ml-1 text-[8.5px]" style={{ color: COLORS.textMute }}>
                        ({r.ff6.sectorEtf})
                      </span>
                    </td>
                    <td className="text-right px-2"
                        style={{
                          color: r.ff6.alphaAnnual > 5 ? COLORS.green
                               : r.ff6.alphaAnnual > 0 ? '#7AC8FF'
                               : r.ff6.alphaAnnual > -5 ? '#FFB84D' : COLORS.red,
                          fontWeight: 500,
                        }}>
                      {r.ff6.alphaAnnual >= 0 ? '+' : ''}{r.ff6.alphaAnnual.toFixed(1)}%
                    </td>
                    <td className="text-right px-3"
                        style={{ color: r.ff6.rSquared > 50 ? COLORS.text : COLORS.textDim }}>
                      {r.ff6.rSquared.toFixed(0)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Fama-French 7-factor (FF6 + momentum) (3o.82 upgrade) */}
      {analysis.ff7Available && (
        <div className="mt-3">
          <div className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: COLORS.chartGold }}>
            Fama-French 7-factor (FF6 + momentum) · {analysis.ff7Count} positions
          </div>
          <div className="overflow-x-auto rounded border" style={{ borderColor: COLORS.border }}>
            <table className="w-full text-[10.5px] tabular-nums">
              <thead>
                <tr style={{ color: COLORS.textMute, background: COLORS.bg }}>
                  <th className="text-left px-3 py-1.5">Symbol</th>
                  <th className="text-right px-2">β_market</th>
                  <th className="text-right px-2">β_SMB</th>
                  <th className="text-right px-2">β_HML</th>
                  <th className="text-right px-2">β_RMW</th>
                  <th className="text-right px-2">β_CMA</th>
                  <th className="text-right px-2">β_sector</th>
                  <th className="text-right px-2">β_MOM</th>
                  <th className="text-right px-2">FF7 α</th>
                  <th className="text-right px-3">FF7 R²</th>
                </tr>
              </thead>
              <tbody>
                {analysis.rows.filter(r => r.ff7 != null).slice(0, 15).map(r => (
                  <tr key={`ff7-${r.sym}`} style={{ borderTop: `1px solid ${COLORS.border}` }}>
                    <td className="px-3 py-1" style={{ color: COLORS.text, fontWeight: 500 }}>
                      {r.sym}
                    </td>
                    <td className="text-right px-2" style={{ color: COLORS.textDim }}>
                      {r.ff7.betaMkt.toFixed(2)}
                    </td>
                    <td className="text-right px-2"
                        style={{ color: Math.abs(r.ff7.betaSMB) > 0.3 ? (r.ff7.betaSMB > 0 ? COLORS.text : '#7AC8FF') : COLORS.textMute }}>
                      {r.ff7.betaSMB >= 0 ? '+' : ''}{r.ff7.betaSMB.toFixed(2)}
                    </td>
                    <td className="text-right px-2"
                        style={{ color: Math.abs(r.ff7.betaHML) > 0.3 ? (r.ff7.betaHML > 0 ? COLORS.text : '#7AC8FF') : COLORS.textMute }}>
                      {r.ff7.betaHML >= 0 ? '+' : ''}{r.ff7.betaHML.toFixed(2)}
                    </td>
                    <td className="text-right px-2"
                        style={{ color: Math.abs(r.ff7.betaRMW) > 0.3 ? (r.ff7.betaRMW > 0 ? COLORS.green : COLORS.red) : COLORS.textMute }}>
                      {r.ff7.betaRMW >= 0 ? '+' : ''}{r.ff7.betaRMW.toFixed(2)}
                    </td>
                    <td className="text-right px-2"
                        style={{ color: Math.abs(r.ff7.betaCMA) > 0.3 ? (r.ff7.betaCMA > 0 ? COLORS.text : '#7AC8FF') : COLORS.textMute }}>
                      {r.ff7.betaCMA >= 0 ? '+' : ''}{r.ff7.betaCMA.toFixed(2)}
                    </td>
                    <td className="text-right px-2"
                        style={{ color: Math.abs(r.ff7.betaSector) > 0.3 ? (r.ff7.betaSector > 0 ? COLORS.green : COLORS.red) : COLORS.textMute }}>
                      {r.ff7.betaSector >= 0 ? '+' : ''}{r.ff7.betaSector.toFixed(2)}
                    </td>
                    <td className="text-right px-2"
                        style={{ color: Math.abs(r.ff7.betaMOM) > 0.3 ? (r.ff7.betaMOM > 0 ? COLORS.green : COLORS.red) : COLORS.textMute, fontWeight: 500 }}
                        title="Momentum factor: MTUM−SPY (Carhart). Positive = momentum tilt; negative = anti-momentum/contrarian tilt">
                      {r.ff7.betaMOM >= 0 ? '+' : ''}{r.ff7.betaMOM.toFixed(2)}
                    </td>
                    <td className="text-right px-2"
                        style={{
                          color: r.ff7.alphaAnnual > 5 ? COLORS.green
                               : r.ff7.alphaAnnual > 0 ? '#7AC8FF'
                               : r.ff7.alphaAnnual > -5 ? '#FFB84D' : COLORS.red,
                          fontWeight: 500,
                        }}>
                      {r.ff7.alphaAnnual >= 0 ? '+' : ''}{r.ff7.alphaAnnual.toFixed(1)}%
                    </td>
                    <td className="text-right px-3"
                        style={{ color: r.ff7.rSquared > 50 ? COLORS.text : COLORS.textDim }}>
                      {r.ff7.rSquared.toFixed(0)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 3o.83: R² comparison across factor models */}
      {(analysis.ffAvailable || analysis.ff5Available || analysis.ff6Available || analysis.ff7Available) && (
        <div className="mt-3">
          <div className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: COLORS.textMute }}>
            R² comparison across factor models · which model best explains each name
          </div>
          <div className="overflow-x-auto rounded border" style={{ borderColor: COLORS.border }}>
            <table className="w-full text-[10.5px] tabular-nums">
              <thead>
                <tr style={{ color: COLORS.textMute, background: COLORS.bg }}>
                  <th className="text-left px-3 py-1.5">Symbol</th>
                  <th className="text-right px-2">CAPM (1f)</th>
                  <th className="text-right px-2">FF3</th>
                  <th className="text-right px-2">FF5</th>
                  <th className="text-right px-2">FF6 +sect</th>
                  <th className="text-right px-2">FF7 +mom</th>
                  <th className="text-right px-3">Best model</th>
                </tr>
              </thead>
              <tbody>
                {analysis.rows.slice(0, 15).map(r => {
                  const candidates = [
                    { name: 'CAPM', val: r.rSquared },
                    { name: 'FF3', val: r.ff?.rSquared ?? null },
                    { name: 'FF5', val: r.ff5?.rSquared ?? null },
                    { name: 'FF6', val: r.ff6?.rSquared ?? null },
                    { name: 'FF7', val: r.ff7?.rSquared ?? null },
                  ];
                  const valid = candidates.filter(c => c.val != null);
                  let best = null;
                  if (valid.length > 0) {
                    best = valid.reduce((m, c) => c.val > m.val ? c : m, valid[0]);
                  }
                  // Penalty for adding parameters: best should add meaningful R² (>3pp)
                  // not just nominal lift. Find smallest model where R² is within 3pp of max.
                  let parsimonious = best;
                  if (best && valid.length > 1) {
                    for (const c of valid) {
                      if (best.val - c.val < 3) {
                        parsimonious = c;
                        break;
                      }
                    }
                  }
                  const fmt = (v) => v == null ? '—' : `${v.toFixed(0)}%`;
                  const cellColor = (v, isBest) => {
                    if (v == null) return COLORS.textMute;
                    if (isBest) return COLORS.mint;
                    if (v > 60) return COLORS.text;
                    if (v > 30) return COLORS.textDim;
                    return COLORS.textMute;
                  };
                  return (
                    <tr key={`r2-${r.sym}`} style={{ borderTop: `1px solid ${COLORS.border}` }}>
                      <td className="px-3 py-1" style={{ color: COLORS.text, fontWeight: 500 }}>
                        {r.sym}
                      </td>
                      {candidates.map(c => (
                        <td key={c.name} className="text-right px-2"
                            style={{
                              color: cellColor(c.val, best && c.name === best.name),
                              fontWeight: best && c.name === best.name ? 500 : 400,
                            }}>
                          {fmt(c.val)}
                        </td>
                      ))}
                      <td className="text-right px-3"
                          style={{ color: COLORS.mint, fontWeight: 500 }}
                          title={parsimonious && parsimonious.name !== best?.name
                            ? `Parsimonious choice: ${parsimonious.name} (within 3pp of best ${best?.name} but fewer factors)`
                            : ''}>
                        {parsimonious?.name || '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="text-[9.5px] mt-1.5" style={{ color: COLORS.textDim }}>
            Best model = highest R². <strong>Parsimonious choice</strong> = smallest model
            within 3pp of max R² (avoids over-fitting). For 30+ daily obs, FF7 will mechanically
            have ≥ FF6 R² ≥ FF5 R² etc. — meaningful lift requires R² Δ &gt; ~3pp per added factor.
            A name where CAPM R² = FF7 R² means market alone explains the variance; no factor
            tilts. Mismatch (FF7 R² &gt;&gt; CAPM R²) means significant style/sector/momentum exposure.
          </div>
        </div>
      )}

      {/* 3o.85: Performance attribution decomposition */}
      {analysis.rows.some(r => r.attribution) && (
        <div className="mt-3">
          <div className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: COLORS.chartCyan }}>
            Performance attribution · what drove returns over the lookback window
          </div>
          <div className="overflow-x-auto rounded border" style={{ borderColor: COLORS.border }}>
            <table className="w-full text-[10.5px] tabular-nums">
              <thead>
                <tr style={{ color: COLORS.textMute, background: COLORS.bg }}>
                  <th className="text-left px-3 py-1.5">Symbol</th>
                  <th className="text-right px-2">Total ret</th>
                  <th className="text-right px-2">Mkt</th>
                  <th className="text-right px-2">SMB</th>
                  <th className="text-right px-2">HML</th>
                  <th className="text-right px-2">RMW</th>
                  <th className="text-right px-2">CMA</th>
                  <th className="text-right px-3">α (residual)</th>
                </tr>
              </thead>
              <tbody>
                {analysis.rows.filter(r => r.attribution).slice(0, 15).map(r => {
                  const a = r.attribution;
                  const cellColor = (v) =>
                    v > 1 ? COLORS.green
                    : v < -1 ? COLORS.red
                    : COLORS.textDim;
                  return (
                    <tr key={`attr-${r.sym}`} style={{ borderTop: `1px solid ${COLORS.border}` }}>
                      <td className="px-3 py-1" style={{ color: COLORS.text, fontWeight: 500 }}>
                        {r.sym}
                      </td>
                      <td className="text-right px-2"
                          style={{ color: a.totalRet >= 0 ? COLORS.green : COLORS.red, fontWeight: 500 }}>
                        {a.totalRet >= 0 ? '+' : ''}{a.totalRet.toFixed(1)}%
                      </td>
                      <td className="text-right px-2" style={{ color: cellColor(a.contribMkt) }}>
                        {a.contribMkt >= 0 ? '+' : ''}{a.contribMkt.toFixed(1)}
                      </td>
                      <td className="text-right px-2" style={{ color: cellColor(a.contribSMB) }}>
                        {a.contribSMB >= 0 ? '+' : ''}{a.contribSMB.toFixed(1)}
                      </td>
                      <td className="text-right px-2" style={{ color: cellColor(a.contribHML) }}>
                        {a.contribHML >= 0 ? '+' : ''}{a.contribHML.toFixed(1)}
                      </td>
                      <td className="text-right px-2" style={{ color: cellColor(a.contribRMW) }}>
                        {a.contribRMW >= 0 ? '+' : ''}{a.contribRMW.toFixed(1)}
                      </td>
                      <td className="text-right px-2" style={{ color: cellColor(a.contribCMA) }}>
                        {a.contribCMA >= 0 ? '+' : ''}{a.contribCMA.toFixed(1)}
                      </td>
                      <td className="text-right px-3"
                          style={{
                            color: a.periodAlpha > 2 ? COLORS.green
                                 : a.periodAlpha < -2 ? COLORS.red
                                 : COLORS.text,
                            fontWeight: 500,
                          }}>
                        {a.periodAlpha >= 0 ? '+' : ''}{a.periodAlpha.toFixed(1)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="text-[9.5px] mt-1.5" style={{ color: COLORS.textDim }}>
            Decomposes total period return into factor contributions: r_total ≈ α +
            β_mkt × r_mkt + β_SMB × r_SMB + β_HML × r_HML + β_RMW × r_RMW + β_CMA × r_CMA.
            <strong> Mkt</strong> contribution: how much of the return came from market
            exposure × market move. <strong>α (residual)</strong>: idiosyncratic excess
            return not explained by factors. Numbers in % over the lookback period (not
            annualized). A name where Total = Mkt + SMB + HML, with α near zero, is
            cleanly explained by factor exposures. A name where α &gt;&gt; factor sums has
            stock-specific alpha (or model misspecification).
          </div>
        </div>
      )}

      <div className="text-[10px] mt-2" style={{ color: COLORS.textDim }}>
        <strong>Single-factor decomposition</strong>: r_i = α + β × r_market + ε.
        <strong> α (alpha)</strong>: annualized excess return NOT explained by market beta.
        <strong> β</strong>: market sensitivity. <strong>From β</strong>: return that
        pure-market exposure would have produced. <strong>Idio vol</strong>: std of
        residuals annualized. <strong>R²</strong>: % of variance explained by market.
        <strong> 3o.79 upgrade · Fama-French 3-factor</strong>: extends to
        r_i = α + β_mkt·r_mkt + β_SMB·r_SMB + β_HML·r_HML + ε. <strong>SMB</strong>
        (Small Minus Big, proxied by IWM−SPY): positive β = small-cap tilt.
        <strong> HML</strong> (High Minus Low book-to-market, proxied by VTV−VUG):
        positive β = value tilt; negative β = growth tilt. <strong>FF α</strong> is
        excess return after explaining BOTH market AND size/value factors.
        <strong> 3o.80 upgrade · Fama-French 5-factor</strong>: extends to
        r_i = α + β_mkt·r_mkt + β_SMB·r_SMB + β_HML·r_HML + β_RMW·r_RMW + β_CMA·r_CMA + ε.
        <strong> RMW</strong> (Robust Minus Weak profitability, proxied by QUAL−SPY):
        positive β = quality/profitability tilt. <strong>CMA</strong> (Conservative
        Minus Aggressive investment, proxied by VYM−VUG): positive β = high-payout/
        low-investment tilt; negative β = high-investment growth tilt. <strong>FF5 α</strong>
        is the residual excess return after explaining all 5 factors — typically smaller
        than 3-factor α; closer to true skill measure if proxies were exact.
        <strong> Caveats</strong>: ETF-spread proxies (IWM−SPY, VTV−VUG, QUAL−SPY,
        VYM−VUG) approximate but don't match French's CRSP-universe portfolios. CMA
        proxy is the weakest of the 5 (CMA construction involves balance-sheet ratios
        not directly captured by VYM−VUG spread). Multi-factor regression with 6
        parameters (intercept + 5 betas) needs ≥30 daily observations minimum but
        more reliable with ≥120. 5×5 system solved via Gaussian elimination with
        partial pivoting; falls back to NULL if matrix is singular (factors highly
        correlated). True FF data requires Kenneth French data library download.
      </div>
    </div>
  );
};
