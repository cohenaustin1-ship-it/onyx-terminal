// IMO Onyx Terminal — fixed-income-fx tests
//
// Bond math validated against canonical results:
//   - Par bond (coupon = yield) → price = face
//   - Premium bond (coupon > yield) → price > face
//   - Discount bond (coupon < yield) → price < face
//   - Modified duration = Macaulay duration / (1 + y/freq)
//   - Convexity is positive (option-free bonds have positive convexity)

import { describe, it, expect } from 'vitest';
import {
  computeBondPrice,
  computeBondAnalytics,
  CURATED_FX_RATES,
  computeCrossRate,
  computeForwardRate,
} from '../fixed-income-fx.js';

describe('computeBondPrice', () => {
  it('par bond (coupon = yield) prices at face value', () => {
    const p = computeBondPrice({ face: 1000, couponRate: 0.05, yieldRate: 0.05, yearsToMaturity: 10 });
    expect(p).toBeCloseTo(1000, 2);
  });

  it('premium bond (coupon > yield) prices above face', () => {
    const p = computeBondPrice({ face: 1000, couponRate: 0.07, yieldRate: 0.05, yearsToMaturity: 10 });
    expect(p).toBeGreaterThan(1000);
  });

  it('discount bond (coupon < yield) prices below face', () => {
    const p = computeBondPrice({ face: 1000, couponRate: 0.03, yieldRate: 0.05, yearsToMaturity: 10 });
    expect(p).toBeLessThan(1000);
  });

  it('zero-coupon bond price = face / (1+y)^n', () => {
    // 10y zero, y=5%, semi-annual: face / (1.025)^20
    const p = computeBondPrice({ face: 1000, couponRate: 0, yieldRate: 0.05, yearsToMaturity: 10 });
    const expected = 1000 / Math.pow(1.025, 20);
    expect(p).toBeCloseTo(expected, 2);
  });

  it('longer maturity → more price sensitivity to yield change', () => {
    const short = computeBondPrice({ face: 1000, couponRate: 0.04, yieldRate: 0.05, yearsToMaturity: 2 });
    const long  = computeBondPrice({ face: 1000, couponRate: 0.04, yieldRate: 0.05, yearsToMaturity: 30 });
    // For coupon < yield, longer bond should be more discounted
    expect(long).toBeLessThan(short);
  });
});

describe('computeBondAnalytics', () => {
  it('returns price, durations, convexity, DV01 for a 10y 5% par bond', () => {
    const r = computeBondAnalytics({
      face: 1000, couponRate: 0.05, yieldRate: 0.05, yearsToMaturity: 10,
    });
    expect(r).not.toBeNull();
    expect(r.price).toBeCloseTo(1000, 2);
    // Par 10y bond: Macaulay duration is around 7.99 years
    expect(r.macaulayDuration).toBeGreaterThan(7);
    expect(r.macaulayDuration).toBeLessThan(9);
  });

  it('modified duration = macaulay duration / (1 + y/freq)', () => {
    const r = computeBondAnalytics({
      face: 1000, couponRate: 0.04, yieldRate: 0.06, yearsToMaturity: 5,
    });
    const expectedMod = r.macaulayDuration / (1 + 0.06 / 2);
    expect(r.modifiedDuration).toBeCloseTo(expectedMod, 6);
  });

  it('convexity is positive for plain-vanilla bonds', () => {
    const r = computeBondAnalytics({
      face: 1000, couponRate: 0.05, yieldRate: 0.05, yearsToMaturity: 10,
    });
    expect(r.convexity).toBeGreaterThan(0);
  });

  it('DV01 is positive and equals price × modDur × 0.0001', () => {
    const r = computeBondAnalytics({
      face: 1000, couponRate: 0.04, yieldRate: 0.05, yearsToMaturity: 10,
    });
    expect(r.dv01).toBeCloseTo(r.price * r.modifiedDuration * 0.0001, 8);
  });

  it('rejects invalid inputs', () => {
    expect(computeBondAnalytics({ couponRate: NaN, yieldRate: 0.05, yearsToMaturity: 10 })).toBeNull();
    expect(computeBondAnalytics({ couponRate: 0.05, yieldRate: NaN, yearsToMaturity: 10 })).toBeNull();
    expect(computeBondAnalytics({ couponRate: 0.05, yieldRate: 0.05, yearsToMaturity: 0 })).toBeNull();
  });

  it('cashflow array has correct length and structure', () => {
    const r = computeBondAnalytics({
      face: 1000, couponRate: 0.05, yieldRate: 0.05, yearsToMaturity: 5, freq: 2,
    });
    expect(r.cashflows).toHaveLength(10); // 5 years × 2/yr
    // Final cashflow includes face redemption
    const last = r.cashflows[9];
    expect(last.cashflow).toBeCloseTo(25 + 1000); // last coupon + face
    // Earlier cashflows are just coupons
    expect(r.cashflows[0].cashflow).toBeCloseTo(25);
  });
});

describe('computeCrossRate', () => {
  it('derives EUR/JPY from EUR/USD and JPY/USD', () => {
    // Given EUR=1.08 USD/EUR, JPY=0.00665 USD/JPY → EUR/JPY ≈ 162.4
    const cross = computeCrossRate(1.08, 0.00665);
    expect(cross).toBeCloseTo(1.08 / 0.00665, 4);
  });

  it('returns null on invalid inputs', () => {
    expect(computeCrossRate(NaN, 1)).toBeNull();
    expect(computeCrossRate(1, NaN)).toBeNull();
    expect(computeCrossRate(1, 0)).toBeNull();   // div by zero
    expect(computeCrossRate(1, -1)).toBeNull();  // negative quote
  });
});

describe('computeForwardRate', () => {
  it('matches interest-rate parity formula', () => {
    // Spot = 1.10, base rate (USD) = 5%, quote rate (EUR) = 3%, T = 1 year
    // F = 1.10 × (1 + 0.03×1) / (1 + 0.05×1) ≈ 1.10 × 1.03 / 1.05 ≈ 1.0790
    const f = computeForwardRate({ spot: 1.10, baseRate: 5, quoteRate: 3, years: 1 });
    expect(f).toBeCloseTo(1.10 * 1.03 / 1.05, 6);
  });

  it('returns spot when years = 0', () => {
    expect(computeForwardRate({ spot: 1.10, baseRate: 5, quoteRate: 3, years: 0 })).toBe(1.10);
  });

  it('returns null for invalid spot', () => {
    expect(computeForwardRate({ spot: NaN, baseRate: 5, quoteRate: 3, years: 1 })).toBeNull();
    expect(computeForwardRate({ spot: -1, baseRate: 5, quoteRate: 3, years: 1 })).toBeNull();
  });

  it('higher base rate → forward discount on base currency', () => {
    // If base (e.g. USD) has higher rate than quote (e.g. EUR),
    // then F < S (USD weakens forward; you need fewer EUR per USD)
    const f = computeForwardRate({ spot: 1.10, baseRate: 5, quoteRate: 3, years: 1 });
    expect(f).toBeLessThan(1.10);
  });
});

describe('CURATED_FX_RATES', () => {
  it('has spotUSD and policyRates structure', () => {
    expect(CURATED_FX_RATES).toHaveProperty('spotUSD');
    expect(CURATED_FX_RATES).toHaveProperty('policyRates');
    expect(CURATED_FX_RATES.spotUSD).toBeTypeOf('object');
    expect(CURATED_FX_RATES.policyRates).toBeTypeOf('object');
  });

  it('every spot rate is a finite positive number', () => {
    for (const [ccy, rate] of Object.entries(CURATED_FX_RATES.spotUSD)) {
      expect(Number.isFinite(rate), `${ccy} should be finite`).toBe(true);
      expect(rate, `${ccy} should be > 0`).toBeGreaterThan(0);
    }
  });

  it('USD policy rate is plausible (between 0% and 20%)', () => {
    const usd = CURATED_FX_RATES.policyRates.USD;
    expect(usd).toBeGreaterThanOrEqual(0);
    expect(usd).toBeLessThan(20);
  });
});
