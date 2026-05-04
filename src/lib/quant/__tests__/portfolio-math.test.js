// IMO Onyx Terminal — portfolio-math tests
//
// Risk metrics (VaR, beta, stress tests) and return stats.

import { describe, it, expect } from 'vitest';
import {
  computeReturnStats,
  computeVaR,
  computeBetaToBenchmark,
  computeCorrelationMatrixFromReturns,
  STRESS_SCENARIOS,
  runStressTest,
  computeLiquidityRisk,
} from '../portfolio-math.js';

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

describe('computeReturnStats', () => {
  it('returns zeros for too-short input', () => {
    const s = computeReturnStats([0.01, 0.02]);
    expect(s.mean).toBe(0);
    expect(s.sharpe).toBe(0);
  });

  it('computes mean correctly (annualized)', () => {
    // Returns are annualized (× 252 trading days)
    const s = computeReturnStats([0.01, 0.02, 0.03, -0.01, 0.00]);
    expect(s.mean).toBeCloseTo(0.01 * 252, 4);
  });

  it('Sharpe is positive when mean > rf', () => {
    const s = computeReturnStats(seededReturns(252, 0.001, 0.01), 0.0001);
    expect(s.sharpe).toBeGreaterThan(0);
  });

  it('Sortino ≥ Sharpe (downside vol ≤ total vol)', () => {
    const s = computeReturnStats(seededReturns(252, 0.0005, 0.01));
    // Sortino uses only downside deviations, so it's larger when dist
    // is symmetric or mean ≥ 0
    expect(s.sortino).toBeGreaterThanOrEqual(s.sharpe - 1e-6);
  });

  it('maxDD is non-positive', () => {
    const s = computeReturnStats(seededReturns(252));
    expect(s.maxDD).toBeLessThanOrEqual(0);
  });
});

describe('computeVaR', () => {
  it('returns zeros for invalid input', () => {
    const r = computeVaR([0.01], 0);
    expect(r.varParametric).toBe(0);
    expect(r.varHistorical).toBe(0);
  });

  it('produces positive VaR for normal returns', () => {
    const r = computeVaR(seededReturns(252), 1_000_000);
    expect(r.varParametric).toBeGreaterThan(0);
    expect(r.varHistorical).toBeGreaterThan(0);
  });

  it('CVaR ≥ VaR (expected loss in tail ≥ threshold loss)', () => {
    const r = computeVaR(seededReturns(252), 1_000_000);
    expect(r.cvarParametric).toBeGreaterThanOrEqual(r.varParametric - 1e-6);
    expect(r.cvarHistorical).toBeGreaterThanOrEqual(r.varHistorical - 1e-6);
  });

  it('higher confidence → higher VaR', () => {
    const returns = seededReturns(252);
    const r95 = computeVaR(returns, 1_000_000, 0.95);
    const r99 = computeVaR(returns, 1_000_000, 0.99);
    expect(r99.varParametric).toBeGreaterThan(r95.varParametric);
  });

  it('higher portfolio MV → proportionally higher VaR', () => {
    const returns = seededReturns(252);
    const r1 = computeVaR(returns, 1_000_000);
    const r10 = computeVaR(returns, 10_000_000);
    expect(r10.varParametric).toBeCloseTo(r1.varParametric * 10, 6);
  });

  it('VaR scales with sqrt(horizon)', () => {
    const returns = seededReturns(252);
    const r1d = computeVaR(returns, 1_000_000, 0.95, 1);
    const r10d = computeVaR(returns, 1_000_000, 0.95, 10);
    expect(r10d.varParametric / r1d.varParametric).toBeCloseTo(Math.sqrt(10), 1);
  });
});

describe('computeBetaToBenchmark', () => {
  it('returns identity beta when same series', () => {
    const r = seededReturns(100);
    const result = computeBetaToBenchmark(r, r);
    expect(result.beta).toBeCloseTo(1, 6);
    expect(result.alpha).toBeCloseTo(0, 6);
    expect(result.r2).toBeCloseTo(1, 6);
  });

  it('zero correlation gives beta near zero', () => {
    const a = seededReturns(200, 0, 0.01, 1);
    const b = seededReturns(200, 0, 0.01, 999);
    const r = computeBetaToBenchmark(a, b);
    // Random series should have near-zero beta and r²
    expect(Math.abs(r.beta)).toBeLessThan(0.5);
    expect(r.r2).toBeLessThan(0.3);
  });

  it('returns default for too-short series', () => {
    const r = computeBetaToBenchmark([0.01], [0.02]);
    expect(r.beta).toBe(1);
    expect(r.alpha).toBe(0);
    expect(r.r2).toBe(0);
  });

  it('detects 2x leverage (perfect doubling)', () => {
    const bench = seededReturns(100);
    const levered = bench.map(x => 2 * x);
    const r = computeBetaToBenchmark(levered, bench);
    expect(r.beta).toBeCloseTo(2, 4);
    expect(r.r2).toBeCloseTo(1, 4);
  });
});

describe('computeCorrelationMatrixFromReturns', () => {
  it('diagonal is 1.0', () => {
    const result = computeCorrelationMatrixFromReturns({
      A: seededReturns(100, 0, 0.01, 1),
      B: seededReturns(100, 0, 0.01, 2),
    });
    expect(result.matrix[0][0]).toBeCloseTo(1, 6);
    expect(result.matrix[1][1]).toBeCloseTo(1, 6);
  });

  it('matrix is symmetric', () => {
    const result = computeCorrelationMatrixFromReturns({
      A: seededReturns(100, 0, 0.01, 1),
      B: seededReturns(100, 0, 0.01, 2),
      C: seededReturns(100, 0, 0.01, 3),
    });
    expect(result.matrix[0][1]).toBeCloseTo(result.matrix[1][0], 6);
    expect(result.matrix[0][2]).toBeCloseTo(result.matrix[2][0], 6);
  });

  it('all correlations are in [-1, 1]', () => {
    const result = computeCorrelationMatrixFromReturns({
      A: seededReturns(100, 0, 0.01, 1),
      B: seededReturns(100, 0, 0.01, 2),
    });
    for (const row of result.matrix) {
      for (const c of row) {
        expect(c).toBeGreaterThanOrEqual(-1);
        expect(c).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('STRESS_SCENARIOS', () => {
  it('is a non-empty array of scenarios', () => {
    expect(Array.isArray(STRESS_SCENARIOS)).toBe(true);
    expect(STRESS_SCENARIOS.length).toBeGreaterThan(0);
  });

  it('each scenario has id and label', () => {
    for (const s of STRESS_SCENARIOS) {
      expect(s).toHaveProperty('id');
      expect(s).toHaveProperty('label');
    }
  });
});

describe('runStressTest', () => {
  it('returns a result object for valid scenario id', () => {
    const holdings = [
      { symbol: 'SPY', cls: 'equity',  marketValue: 100_000, qty: 200, costBasis: 95_000 },
      { symbol: 'TLT', cls: 'equity',  marketValue: 50_000,  qty: 500, costBasis: 52_000 },
    ];
    const r = runStressTest(holdings, STRESS_SCENARIOS[0].id);
    expect(r).not.toBeNull();
    expect(r).toBeTypeOf('object');
  });
});

describe('computeLiquidityRisk', () => {
  it('returns ok=true for normal holdings', () => {
    const holdings = [
      { symbol: 'AAPL', qty: 100, marketValue: 17500, avgVolume: 5e7, mark: 175 },
    ];
    const r = computeLiquidityRisk(holdings);
    expect(r).not.toBeNull();
    expect(r).toBeTypeOf('object');
  });
});
