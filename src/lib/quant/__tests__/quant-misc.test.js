// IMO Onyx Terminal — quant-misc tests
//
// Insider velocity, paired-call/put Black-Scholes, bar count, hedge recs,
// round-trip matcher.

import { describe, it, expect } from 'vitest';
import {
  blackScholes,
  computeBarCount,
  computeInsiderVelocity,
  buildRoundTrips,
} from '../quant-misc.js';

describe('blackScholes (paired call/put)', () => {
  it('returns intrinsic for T=0', () => {
    const r = blackScholes(110, 100, 0, 0.05, 0.25);
    expect(r.call).toBe(10);
    expect(r.put).toBe(0);
  });

  it('matches Hull example via parity', () => {
    // S=42, K=40, r=0.10, σ=0.20, T=0.5
    const r = blackScholes(42, 40, 0.5, 0.10, 0.20);
    expect(r.call).toBeCloseTo(4.7594, 2);
    expect(r.put).toBeCloseTo(0.8086, 2);
  });

  it('respects put-call parity: C − P = S − K·e^(−rT)', () => {
    const S = 100, K = 100, T = 1, r = 0.05, sigma = 0.25;
    const result = blackScholes(S, K, T, r, sigma);
    const lhs = result.call - result.put;
    const rhs = S - K * Math.exp(-r * T);
    expect(lhs).toBeCloseTo(rhs, 6);
  });

  it('call delta in [0, 1], put delta in [-1, 0]', () => {
    const r = blackScholes(100, 100, 0.5, 0.05, 0.25);
    expect(r.callDelta).toBeGreaterThanOrEqual(0);
    expect(r.callDelta).toBeLessThanOrEqual(1);
    expect(r.putDelta).toBeLessThanOrEqual(0);
    expect(r.putDelta).toBeGreaterThanOrEqual(-1);
  });

  it('gamma and vega are non-negative', () => {
    const r = blackScholes(100, 100, 0.5, 0.05, 0.25);
    expect(r.gamma).toBeGreaterThanOrEqual(0);
    expect(r.vega).toBeGreaterThanOrEqual(0);
  });
});

describe('computeBarCount', () => {
  it('returns 0 for missing inputs', () => {
    expect(computeBarCount(0, 5)).toBe(0);
    expect(computeBarCount(null, 5)).toBe(0);
    expect(computeBarCount(60, 0)).toBe(0);
  });

  it('correctly divides range by interval', () => {
    expect(computeBarCount(60, 5)).toBe(12);
    expect(computeBarCount(390, 5)).toBe(78);  // trading day in 5-min bars
    expect(computeBarCount(1440, 60)).toBe(24); // a day in 1-hour bars
  });

  it('floors non-divisible quotients', () => {
    expect(computeBarCount(63, 5)).toBe(12); // 63/5 = 12.6 → 12
  });
});

describe('computeInsiderVelocity', () => {
  it('returns null for empty input', () => {
    expect(computeInsiderVelocity([])).toBeNull();
    expect(computeInsiderVelocity(null)).toBeNull();
  });

  it('aggregates net flow correctly', () => {
    const now = Date.now();
    const txns = [
      { date: now - 86400000 * 5,  code: 'P', shares: 1000, price: 100, value: 100_000, acquired: true,  insiderName: 'CEO' },
      { date: now - 86400000 * 10, code: 'P', shares: 500,  price: 100, value: 50_000,  acquired: true,  insiderName: 'CFO' },
      { date: now - 86400000 * 15, code: 'S', shares: 200,  price: 100, value: 20_000,  acquired: false, insiderName: 'COO' },
    ];
    const r = computeInsiderVelocity(txns, 90);
    expect(r).not.toBeNull();
    expect(r.buyDollars).toBeGreaterThan(0);
    expect(r.sellDollars).toBeGreaterThan(0);
    expect(r.netFlow).toBeCloseTo(r.buyDollars - r.sellDollars, 6);
  });

  it('detects cluster signal with ≥3 distinct buyers', () => {
    const now = Date.now();
    const txns = [
      { date: now - 86400000 * 1, code: 'P', shares: 1, price: 100, value: 100, acquired: true, insiderName: 'A' },
      { date: now - 86400000 * 2, code: 'P', shares: 1, price: 100, value: 100, acquired: true, insiderName: 'B' },
      { date: now - 86400000 * 3, code: 'P', shares: 1, price: 100, value: 100, acquired: true, insiderName: 'C' },
    ];
    const r = computeInsiderVelocity(txns, 90);
    expect(r.clusterSignal).toBe(true);
    expect(r.buyerCount).toBeGreaterThanOrEqual(3);
  });

  it('respects window cutoff', () => {
    const now = Date.now();
    const old = now - 86400000 * 200; // way outside 90d window
    const recent = now - 86400000 * 10;
    const txns = [
      { date: old,    code: 'P', shares: 1000, price: 100, value: 100_000, acquired: true, insiderName: 'X' },
      { date: recent, code: 'P', shares: 100,  price: 100, value: 10_000,  acquired: true, insiderName: 'Y' },
    ];
    const r = computeInsiderVelocity(txns, 90);
    // Old transaction should not be in the window
    expect(r.buyDollars).toBe(10_000);
  });
});

describe('buildRoundTrips', () => {
  it('returns empty for no trades', () => {
    expect(buildRoundTrips([])).toEqual([]);
    expect(buildRoundTrips()).toEqual([]);
  });

  it('matches a simple buy → sell round-trip', () => {
    // Trades come in REVERSE chronological order (newest first)
    const trades = [
      { sym: 'AAPL', side: 'sell', size: 10, price: 110, time: 2000 },
      { sym: 'AAPL', side: 'buy',  size: 10, price: 100, time: 1000 },
    ];
    const trips = buildRoundTrips(trades);
    expect(trips).toHaveLength(1);
    expect(trips[0].ticker).toBe('AAPL');
    expect(trips[0].pnl).toBeCloseTo(100); // (110-100) * 10
  });

  it('FIFO-matches partial sells against multiple buy lots', () => {
    const trades = [
      { sym: 'AAPL', side: 'sell', size: 15, price: 120, time: 3000 },
      { sym: 'AAPL', side: 'buy',  size: 10, price: 110, time: 2000 },
      { sym: 'AAPL', side: 'buy',  size: 10, price: 100, time: 1000 },
    ];
    const trips = buildRoundTrips(trades);
    expect(trips.length).toBeGreaterThanOrEqual(1);
    const totalPnl = trips.reduce((s, t) => s + t.pnl, 0);
    expect(totalPnl).toBeCloseTo(250); // (120-100)*10 + (120-110)*5
  });

  it('separates trips by ticker', () => {
    const trades = [
      { sym: 'AAPL', side: 'sell', size: 1, price: 110, time: 4000 },
      { sym: 'AAPL', side: 'buy',  size: 1, price: 100, time: 3000 },
      { sym: 'MSFT', side: 'sell', size: 1, price: 220, time: 2000 },
      { sym: 'MSFT', side: 'buy',  size: 1, price: 200, time: 1000 },
    ];
    const trips = buildRoundTrips(trades);
    expect(trips.length).toBe(2);
    expect(trips.map(t => t.ticker).sort()).toEqual(['AAPL', 'MSFT']);
  });
});
