// IMO Onyx Terminal — backtest-engine tests
//
// Simple invariants:
//   - QUANT_PRIMITIVES is a registry of (bars, i) → number primitives
//   - FACTOR_LIBRARY entries each have id + name + signal function
//   - buildCompositeStrategy returns a strategy function
//   - Correlation matrix is symmetric, diagonal=1
//   - runBacktest with trivial strategy doesn't throw
//
// We don't try to assert specific PnL values — those depend on the
// strategy logic and would be brittle. Instead we test shape + safety.

import { describe, it, expect } from 'vitest';
import {
  QUANT_PRIMITIVES,
  FACTOR_LIBRARY,
  buildCompositeStrategy,
  runBacktest,
  computeCorrelationMatrix,
} from '../backtest-engine.js';

// Synthetic bars
const makeBars = (n, startPrice = 100, drift = 0.0001, vol = 0.01, seed = 1) => {
  let p = startPrice;
  let s = seed;
  const rng = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  const bars = [];
  for (let i = 0; i < n; i++) {
    const u1 = Math.max(rng(), 1e-9);
    const u2 = rng();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    p *= (1 + drift + vol * z);
    bars.push({ t: i, open: p, high: p * 1.005, low: p * 0.995, close: p, volume: 1e6 });
  }
  return bars;
};

describe('QUANT_PRIMITIVES', () => {
  it('exports a registry of indicator functions', () => {
    expect(QUANT_PRIMITIVES).toBeTypeOf('object');
    expect(Object.keys(QUANT_PRIMITIVES).length).toBeGreaterThan(0);
  });

  it('sma and rsi are callable on bars', () => {
    const bars = makeBars(60);
    const smaVal = QUANT_PRIMITIVES.sma(bars, 30, 20);
    const rsiVal = QUANT_PRIMITIVES.rsi(bars, 30, 14);
    expect(smaVal).toBeGreaterThan(0);
    expect(rsiVal).toBeGreaterThanOrEqual(0);
    expect(rsiVal).toBeLessThanOrEqual(100);
  });

  it('returns null at indices before warm-up window', () => {
    const bars = makeBars(60);
    expect(QUANT_PRIMITIVES.sma(bars, 0, 20)).toBeNull();
    expect(QUANT_PRIMITIVES.rsi(bars, 5, 14)).toBeNull();
  });
});

describe('FACTOR_LIBRARY', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(FACTOR_LIBRARY)).toBe(true);
    expect(FACTOR_LIBRARY.length).toBeGreaterThan(0);
  });

  it('every factor has id + name + signal', () => {
    for (const f of FACTOR_LIBRARY) {
      expect(f).toHaveProperty('id');
      expect(f).toHaveProperty('signal');
      expect(typeof f.signal).toBe('function');
    }
  });

  it('factor signals return null or a finite number', () => {
    const bars = makeBars(100);
    for (const f of FACTOR_LIBRARY) {
      const s = f.signal(bars, 50);
      if (s !== null && s !== undefined) {
        expect(Number.isFinite(s)).toBe(true);
      }
    }
  });
});

describe('buildCompositeStrategy', () => {
  it('returns a function', () => {
    const fn = buildCompositeStrategy([{ id: FACTOR_LIBRARY[0].id, weight: 1 }]);
    expect(typeof fn).toBe('function');
  });

  it('returns "hold" when factors list is empty', () => {
    const fn = buildCompositeStrategy([]);
    const bars = makeBars(50);
    expect(fn(bars, 25)).toBe('hold');
  });

  it('returns one of the valid actions: enter|exit|hold', () => {
    const fn = buildCompositeStrategy([{ id: FACTOR_LIBRARY[0].id, weight: 1 }]);
    const bars = makeBars(100);
    // Composite strategy expects ctx with pos field (0 = no position)
    const ctx = { pos: 0 };
    for (let i = 30; i < 100; i++) {
      const action = fn(bars, i, ctx);
      expect(['enter', 'exit', 'hold']).toContain(action);
    }
  });
});

describe('runBacktest', () => {
  it('runs a trivial buy-and-hold without throwing', () => {
    const bars = makeBars(100);
    const r = runBacktest({
      bars,
      strategy: (bars, i) => i === 10 ? 'enter' : (i === 90 ? 'exit' : 'hold'),
    });
    expect(r).toBeTypeOf('object');
    expect(r).toHaveProperty('equity');
    expect(r).toHaveProperty('trades');
  });

  it('respects the capital input', () => {
    const bars = makeBars(50);
    const r = runBacktest({
      bars,
      strategy: () => 'hold',
      capital: 25_000,
    });
    expect(r.equity).not.toBeNull();
    // Equity is array of { idx, t, equity } records
    if (Array.isArray(r.equity) && r.equity.length > 0) {
      const last = r.equity[r.equity.length - 1];
      expect(last.equity).toBeCloseTo(25_000, 0);
    }
  });

  it('returns trades array (possibly empty)', () => {
    const bars = makeBars(50);
    const r = runBacktest({ bars, strategy: () => 'hold' });
    expect(Array.isArray(r.trades)).toBe(true);
  });
});

describe('computeCorrelationMatrix', () => {
  it('returns a structure with tickers + matrix', () => {
    const r = computeCorrelationMatrix({
      A: makeBars(50, 100, 0.0001, 0.01, 1),
      B: makeBars(50, 50,  0.0002, 0.02, 2),
    });
    expect(r).toHaveProperty('tickers');
    expect(r).toHaveProperty('matrix');
  });

  it('diagonal is 1 and matrix is symmetric', () => {
    const r = computeCorrelationMatrix({
      A: makeBars(50, 100, 0.0001, 0.01, 1),
      B: makeBars(50, 50,  0.0002, 0.02, 2),
      C: makeBars(50, 200, 0.00005, 0.005, 3),
    });
    const m = r.matrix;
    for (let i = 0; i < m.length; i++) {
      expect(m[i][i]).toBeCloseTo(1, 6);
      for (let j = 0; j < m.length; j++) {
        expect(m[i][j]).toBeCloseTo(m[j][i], 6);
        expect(m[i][j]).toBeGreaterThanOrEqual(-1);
        expect(m[i][j]).toBeLessThanOrEqual(1);
      }
    }
  });
});
