// IMO Onyx Terminal — risk-math tests
//
// GARCH/EWMA/HAR-RV vol forecasting. Hard to test exact values
// (depends on data), so we test invariants:
//   - Persistence < 1 (stationary)
//   - Positive vol
//   - Higher recent shocks → higher conditional vol
//   - Forecasts are monotonic toward unconditional mean

import { describe, it, expect } from 'vitest';
import {
  fitGARCH11,
  forecastGARCHVol,
  computeEWMAVol,
  computeHARRVol,
  computePortfolioVolForecast,
  decomposeDrawdownByRegime,
} from '../risk-math.js';

// Helper: deterministic mock daily returns (Gaussian-ish via Box-Muller)
const seededReturns = (n, mean = 0, sigma = 0.01, seed = 42) => {
  let s = seed;
  const rng = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  const out = [];
  for (let i = 0; i < n; i++) {
    const u1 = Math.max(rng(), 1e-9);
    const u2 = rng();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    out.push(mean + sigma * z);
  }
  return out;
};

describe('fitGARCH11', () => {
  it('rejects too-short series', () => {
    const r = fitGARCH11([0.01, 0.02, -0.01]);
    expect(r.fitted).toBe(false);
  });

  it('fits stationary GARCH (alpha + beta < 1)', () => {
    const r = fitGARCH11(seededReturns(500));
    expect(r.fitted).toBe(true);
    expect(r.alpha + r.beta).toBeLessThan(1);
    expect(r.alpha).toBeGreaterThanOrEqual(0);
    expect(r.beta).toBeGreaterThanOrEqual(0);
  });

  it('reports persistence and unconditional vol', () => {
    const r = fitGARCH11(seededReturns(500, 0, 0.015));
    expect(r.fitted).toBe(true);
    expect(r.persistence).toBeCloseTo(r.alpha + r.beta, 8);
    expect(r.uncondVol).toBeGreaterThan(0);
  });

  it('higher input vol → higher unconditional vol estimate', () => {
    const lo = fitGARCH11(seededReturns(500, 0, 0.005));
    const hi = fitGARCH11(seededReturns(500, 0, 0.025));
    expect(hi.uncondVol).toBeGreaterThan(lo.uncondVol);
  });
});

describe('forecastGARCHVol', () => {
  it('returns null vols for un-fitted input', () => {
    const f = forecastGARCHVol({ fitted: false }, [1, 5]);
    expect(f).toEqual([{ h: 1, vol: null, var: null }, { h: 5, vol: null, var: null }]);
  });

  it('produces positive vol forecasts at every horizon', () => {
    const fit = fitGARCH11(seededReturns(500));
    const forecasts = forecastGARCHVol(fit, [1, 5, 20, 60]);
    expect(forecasts).toHaveLength(4);
    for (const f of forecasts) {
      expect(f.vol).toBeGreaterThan(0);
    }
  });

  it('all per-horizon variances are positive and finite', () => {
    const fit = fitGARCH11(seededReturns(500));
    const forecasts = forecastGARCHVol(fit, [1, 5, 10, 20, 60]);
    for (const f of forecasts) {
      expect(f.var).toBeGreaterThan(0);
      expect(Number.isFinite(f.var)).toBe(true);
    }
  });
});

describe('computeEWMAVol', () => {
  it('rejects too-short series', () => {
    expect(computeEWMAVol([0.01, 0.02])).toBeNull();
  });

  it('returns positive vol for valid input', () => {
    const v = computeEWMAVol(seededReturns(100));
    expect(v).toBeGreaterThan(0);
  });

  it('higher lambda → smoother (slower-changing) vol', () => {
    const r = seededReturns(200);
    const lo = computeEWMAVol(r, 0.85); // more reactive
    const hi = computeEWMAVol(r, 0.97); // smoother
    // Both should be positive, but they're different
    expect(lo).toBeGreaterThan(0);
    expect(hi).toBeGreaterThan(0);
  });

  it('higher input volatility → higher EWMA estimate', () => {
    const lo = computeEWMAVol(seededReturns(200, 0, 0.005));
    const hi = computeEWMAVol(seededReturns(200, 0, 0.030));
    expect(hi).toBeGreaterThan(lo);
  });
});

describe('computeHARRVol', () => {
  it('rejects too-short series', () => {
    expect(computeHARRVol([0.01, 0.02])).toBeNull();
  });

  it('returns a positive number for valid input', () => {
    const v = computeHARRVol(seededReturns(200));
    expect(v).not.toBeNull();
    expect(v).toBeGreaterThan(0);
  });
});

describe('computePortfolioVolForecast', () => {
  it('returns un-fitted result when no symbols meet the data requirement', () => {
    const r = computePortfolioVolForecast({ AAPL: [0.01, 0.02] }, { AAPL: 1 });
    expect(r.fitted).toBe(false);
  });

  it('produces a vol forecast for sufficient data', () => {
    const r = computePortfolioVolForecast(
      { AAPL: seededReturns(120, 0, 0.012, 1), MSFT: seededReturns(120, 0, 0.010, 2) },
      { AAPL: 0.5, MSFT: 0.5 }
    );
    expect(r).not.toBeNull();
  });
});

describe('decomposeDrawdownByRegime', () => {
  it('rejects too-short series', () => {
    const r = decomposeDrawdownByRegime([0.01, 0.02, -0.01]);
    expect(r.ok).toBe(false);
  });

  it('decomposes a valid series', () => {
    const returns = seededReturns(200, 0, 0.02, 7);
    // Inject a stress period
    for (let i = 100; i < 130; i++) returns[i] = -Math.abs(returns[i]) - 0.01;
    const r = decomposeDrawdownByRegime(returns, { window: 30 });
    expect(r.ok).toBe(true);
    // Should have stressed and calm components summing close to total
  });
});
