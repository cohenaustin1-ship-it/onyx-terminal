// IMO Onyx Terminal — options-payoff tests
//
// Pricing tests use canonical textbook values. The Hull textbook
// (8th ed.) example 13.6: S=42, K=40, r=0.10, σ=0.20, T=0.5
// → call ≈ 4.76, put ≈ 0.81.
//
// Greeks are sanity-checked rather than exact-matched because greeks
// formulas have multiple conventions (per-day vs per-year theta,
// per-1% vs per-1.0 vega).

import { describe, it, expect } from 'vitest';
import { blackScholesAdvanced, computeOptionLegPnL } from '../options-payoff.js';

describe('blackScholesAdvanced', () => {
  it('matches Hull example 13.6 — call ≈ 4.76', () => {
    const r = blackScholesAdvanced(42, 40, 0.5, 0.10, 0.20, 'call');
    expect(r.price).toBeCloseTo(4.7594, 2);
  });

  it('matches Hull example 13.6 — put ≈ 0.81 via put-call parity', () => {
    const r = blackScholesAdvanced(42, 40, 0.5, 0.10, 0.20, 'put');
    expect(r.price).toBeCloseTo(0.8086, 2);
  });

  it('respects put-call parity: C − P = S − K·e^(−rT)', () => {
    // Strict identity for non-dividend European options
    const S = 100, K = 100, T = 1, r = 0.05, sigma = 0.25;
    const c = blackScholesAdvanced(S, K, T, r, sigma, 'call').price;
    const p = blackScholesAdvanced(S, K, T, r, sigma, 'put').price;
    const lhs = c - p;
    const rhs = S - K * Math.exp(-r * T);
    expect(lhs).toBeCloseTo(rhs, 6);
  });

  it('ATM call delta is approximately 0.5 + adjustment for drift', () => {
    // For deep ATM near expiry, delta should be close to 0.5
    const r = blackScholesAdvanced(100, 100, 0.01, 0.0, 0.20, 'call');
    expect(r.delta).toBeGreaterThan(0.45);
    expect(r.delta).toBeLessThan(0.55);
  });

  it('deep ITM call delta approaches 1.0', () => {
    const r = blackScholesAdvanced(150, 100, 0.5, 0.05, 0.20, 'call');
    expect(r.delta).toBeGreaterThan(0.95);
  });

  it('deep OTM call delta approaches 0', () => {
    const r = blackScholesAdvanced(50, 100, 0.5, 0.05, 0.20, 'call');
    expect(r.delta).toBeLessThan(0.05);
    expect(r.delta).toBeGreaterThanOrEqual(0);
  });

  it('put delta is negative and bounded by [-1, 0]', () => {
    const r = blackScholesAdvanced(100, 110, 0.5, 0.05, 0.30, 'put');
    expect(r.delta).toBeLessThan(0);
    expect(r.delta).toBeGreaterThan(-1);
  });

  it('call gamma equals put gamma (same underlying)', () => {
    const c = blackScholesAdvanced(100, 100, 0.5, 0.05, 0.25, 'call');
    const p = blackScholesAdvanced(100, 100, 0.5, 0.05, 0.25, 'put');
    expect(c.gamma).toBeCloseTo(p.gamma, 8);
  });

  it('call vega equals put vega (same underlying)', () => {
    const c = blackScholesAdvanced(100, 100, 0.5, 0.05, 0.25, 'call');
    const p = blackScholesAdvanced(100, 100, 0.5, 0.05, 0.25, 'put');
    expect(c.vega).toBeCloseTo(p.vega, 8);
  });

  it('handles T=0 (expiry) — returns intrinsic for ITM, zero for OTM', () => {
    expect(blackScholesAdvanced(110, 100, 0, 0.05, 0.25, 'call').price).toBe(10);
    expect(blackScholesAdvanced(90,  100, 0, 0.05, 0.25, 'call').price).toBe(0);
    expect(blackScholesAdvanced(90,  100, 0, 0.05, 0.25, 'put').price).toBe(10);
    expect(blackScholesAdvanced(110, 100, 0, 0.05, 0.25, 'put').price).toBe(0);
  });

  it('dividend yield reduces call value, raises put value', () => {
    const noDiv = blackScholesAdvanced(100, 100, 1, 0.05, 0.25, 'call', 0);
    const withDiv = blackScholesAdvanced(100, 100, 1, 0.05, 0.25, 'call', 0.04);
    expect(withDiv.price).toBeLessThan(noDiv.price);

    const noDivPut = blackScholesAdvanced(100, 100, 1, 0.05, 0.25, 'put', 0);
    const withDivPut = blackScholesAdvanced(100, 100, 1, 0.05, 0.25, 'put', 0.04);
    expect(withDivPut.price).toBeGreaterThan(noDivPut.price);
  });
});

describe('computeOptionLegPnL', () => {
  it('long call P&L is max(S−K, 0) − premium at expiry', () => {
    const leg = { side: 'long', type: 'call', strike: 100, qty: 1, premium: 5 };
    const grid = [80, 100, 105, 120];
    const pnls = computeOptionLegPnL(leg, grid);
    // 80: max(80-100,0)-5 = -5
    // 100: 0 - 5 = -5
    // 105: 5 - 5 = 0
    // 120: 20 - 5 = 15
    expect(pnls[0]).toBeCloseTo(-5);
    expect(pnls[1]).toBeCloseTo(-5);
    expect(pnls[2]).toBeCloseTo(0);
    expect(pnls[3]).toBeCloseTo(15);
  });

  it('short call P&L is premium − max(S−K, 0)', () => {
    const leg = { side: 'short', type: 'call', strike: 100, qty: 1, premium: 5 };
    const pnls = computeOptionLegPnL(leg, [80, 100, 110]);
    expect(pnls[0]).toBeCloseTo(5);   // 5 - 0
    expect(pnls[1]).toBeCloseTo(5);   // 5 - 0
    expect(pnls[2]).toBeCloseTo(-5);  // 5 - 10
  });

  it('long underlying is linear S − entry (strike acts as entry)', () => {
    const leg = { side: 'long', type: 'underlying', strike: 100, qty: 1 };
    const pnls = computeOptionLegPnL(leg, [80, 100, 120]);
    expect(pnls[0]).toBeCloseTo(-20);
    expect(pnls[1]).toBeCloseTo(0);
    expect(pnls[2]).toBeCloseTo(20);
  });

  it('quantity scales P&L linearly', () => {
    const single = { side: 'long', type: 'call', strike: 100, qty: 1, premium: 5 };
    const ten    = { side: 'long', type: 'call', strike: 100, qty: 10, premium: 5 };
    const pnl1  = computeOptionLegPnL(single, [120])[0];
    const pnl10 = computeOptionLegPnL(ten,    [120])[0];
    expect(pnl10).toBeCloseTo(pnl1 * 10);
  });
});
