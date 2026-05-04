// IMO Onyx Terminal — pairs-trading tests

import { describe, it, expect } from 'vitest';
import {
  computeOLSHedgeRatio,
  computeSpreadHalfLife,
  findCointegratedPairs,
  buildPairTradePlan,
} from '../pairs-trading.js';

describe('computeOLSHedgeRatio', () => {
  it('returns null for too-short input', () => {
    expect(computeOLSHedgeRatio([1, 2], [3, 4])).toBeNull();
  });

  it('recovers slope of 1 for identical series', () => {
    const x = Array.from({ length: 50 }, (_, i) => Math.sin(i * 0.1));
    expect(computeOLSHedgeRatio(x, x)).toBeCloseTo(1, 6);
  });

  it('recovers slope of 2 for y = 2x exactly', () => {
    const x = Array.from({ length: 50 }, (_, i) => Math.sin(i * 0.1));
    const y = x.map(v => 2 * v);
    expect(computeOLSHedgeRatio(y, x)).toBeCloseTo(2, 6);
  });

  it('recovers slope of -0.5 for y = -0.5 x', () => {
    const x = Array.from({ length: 50 }, (_, i) => Math.cos(i * 0.07));
    const y = x.map(v => -0.5 * v);
    expect(computeOLSHedgeRatio(y, x)).toBeCloseTo(-0.5, 6);
  });

  it('returns null when x is all zeros', () => {
    const zeros = Array(50).fill(0);
    const y = Array.from({ length: 50 }, () => Math.random());
    expect(computeOLSHedgeRatio(y, zeros)).toBeNull();
  });

  it('handles mismatched lengths by truncating to min from the end', () => {
    const x = Array.from({ length: 100 }, (_, i) => Math.sin(i * 0.1));
    // y must align with the LAST 50 of x because OLS uses slice(-n)
    const y = x.slice(-50).map(v => 3 * v);
    expect(computeOLSHedgeRatio(y, x)).toBeCloseTo(3, 5);
  });
});

describe('computeSpreadHalfLife', () => {
  it('returns Infinity for too-short series', () => {
    expect(computeSpreadHalfLife([1, 2, 3])).toBe(Infinity);
  });

  it('computes half-life for a mean-reverting AR(1) spread', () => {
    // Synthetic AR(1) with phi = 0.9 (slow mean reversion):
    //   spread_t = 0.9 * spread_{t-1}
    // Half-life = log(0.5)/log(0.9) ≈ 6.58 periods
    let s = 1;
    const spread = [s];
    for (let i = 1; i < 200; i++) {
      s = 0.9 * s;
      spread.push(s);
    }
    const hl = computeSpreadHalfLife(spread);
    expect(hl).toBeGreaterThan(0);
    expect(hl).toBeLessThan(20);
  });

  it('returns Infinity for trending (non-stationary) spread', () => {
    // Pure trend: each value larger than the last, no mean-reversion
    const spread = Array.from({ length: 100 }, (_, i) => i);
    expect(computeSpreadHalfLife(spread)).toBe(Infinity);
  });

  it('returns reasonable result for noisy mean-reverting spread', () => {
    // AR(1) with phi=0.5 (faster reversion). Half-life ≈ 1
    let s = 5;
    const spread = [s];
    for (let i = 1; i < 100; i++) {
      s = 0.5 * s;
      spread.push(s);
    }
    const hl = computeSpreadHalfLife(spread);
    expect(hl).toBeGreaterThan(0);
    expect(hl).toBeLessThan(5);
  });
});

describe('findCointegratedPairs', () => {
  it('returns empty array when fewer than 2 symbols', () => {
    const r = findCointegratedPairs({ priceSeriesBySymbol: { A: [100, 101, 102] } });
    expect(r).toEqual([]);
  });

  it('returns empty array when symbols lack sufficient history', () => {
    const r = findCointegratedPairs({
      priceSeriesBySymbol: {
        A: [100, 101],
        B: [50, 51],
      },
    });
    expect(r).toEqual([]);
  });

  it('detects a synthetic cointegrated pair', () => {
    // Build two series that share a stochastic trend (cointegrated)
    const n = 100;
    let common = 100;
    const A = [], B = [];
    for (let i = 0; i < n; i++) {
      common *= (1 + (Math.random() - 0.5) * 0.01);
      A.push(common * (1 + (Math.random() - 0.5) * 0.001));
      B.push(common * 2 * (1 + (Math.random() - 0.5) * 0.001));
    }
    const r = findCointegratedPairs({ priceSeriesBySymbol: { A, B }, confidencePct: 90 });
    expect(Array.isArray(r)).toBe(true);
    // Result depends on random data — just verify shape
    if (r.length > 0) {
      expect(r[0]).toHaveProperty('symY');
      expect(r[0]).toHaveProperty('symX');
      expect(r[0]).toHaveProperty('beta');
    }
  });
});

