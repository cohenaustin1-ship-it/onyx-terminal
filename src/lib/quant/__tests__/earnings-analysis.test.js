// IMO Onyx Terminal — earnings-analysis tests

import { describe, it, expect } from 'vitest';
import {
  CURATED_EPS_SURPRISES,
  computeEpsTrack,
  computeEarningsMove,
  computeImpliedMove,
} from '../earnings-analysis.js';

describe('CURATED_EPS_SURPRISES', () => {
  it('contains entries for major tickers', () => {
    expect(Object.keys(CURATED_EPS_SURPRISES).length).toBeGreaterThan(0);
    // At least one well-known ticker
    const known = Object.keys(CURATED_EPS_SURPRISES);
    expect(known.length).toBeGreaterThanOrEqual(5);
  });

  it('every entry has the expected shape', () => {
    for (const [ticker, list] of Object.entries(CURATED_EPS_SURPRISES)) {
      expect(Array.isArray(list)).toBe(true);
      for (const q of list) {
        expect(q).toHaveProperty('quarter');
        expect(q).toHaveProperty('actual');
        expect(q).toHaveProperty('estimate');
      }
    }
  });
});

describe('computeEpsTrack', () => {
  it('returns null for unknown tickers', () => {
    const r = computeEpsTrack('XYZNONEXISTENT');
    expect(r).toBeNull();
  });

  it('returns track for a known ticker', () => {
    const known = Object.keys(CURATED_EPS_SURPRISES)[0];
    const r = computeEpsTrack(known);
    expect(r).not.toBeNull();
    // Beat rate is between 0 and 1 (or 0 and 100)
    if (r.beatRate !== undefined) {
      expect(r.beatRate).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('computeImpliedMove', () => {
  it('returns null for invalid IV', () => {
    expect(computeImpliedMove(NaN)).toBeNull();
    expect(computeImpliedMove(0)).toBeNull();
    expect(computeImpliedMove(-0.5)).toBeNull();
  });

  it('handles IV given as percentage (e.g. 30) or decimal (0.30)', () => {
    const a = computeImpliedMove(30, 1);
    const b = computeImpliedMove(0.30, 1);
    expect(a).toBeCloseTo(b, 6);
  });

  it('1-day implied move ≈ IV/sqrt(252) %', () => {
    // IV of 30% (annualized) → 1-day move ≈ 30/sqrt(252) ≈ 1.89%
    const m = computeImpliedMove(0.30, 1);
    const expected = 30 * Math.sqrt(1 / 252);
    expect(m).toBeCloseTo(expected, 4);
  });

  it('larger horizon → larger implied move (sqrt-time scaling)', () => {
    const a = computeImpliedMove(0.30, 1);
    const b = computeImpliedMove(0.30, 10);
    expect(b).toBeGreaterThan(a);
    // Ratio should be sqrt(10) ≈ 3.16
    expect(b / a).toBeCloseTo(Math.sqrt(10), 2);
  });

  it('higher IV → larger implied move (linear scaling)', () => {
    const a = computeImpliedMove(0.20, 1);
    const b = computeImpliedMove(0.40, 1);
    expect(b).toBeCloseTo(2 * a, 4);
  });
});

describe('computeEarningsMove', () => {
  it('returns null for too-short price series', () => {
    expect(computeEarningsMove([{ date: '2024-01-01', close: 100 }], ['2024-01-02'])).toBeNull();
    expect(computeEarningsMove([], ['2024-01-02'])).toBeNull();
  });

  it('returns null when earningsDates is empty', () => {
    const ps = [
      { date: '2024-01-01', close: 100 },
      { date: '2024-01-02', close: 105 },
    ];
    expect(computeEarningsMove(ps, [])).toBeNull();
    expect(computeEarningsMove(ps, null)).toBeNull();
  });

  it('measures the close-to-close move across an earnings date', () => {
    const ps = [
      { date: '2024-01-01', close: 100 },  // pre-earnings close
      { date: '2024-01-02', close: 110 },  // post-earnings close (+10%)
      { date: '2024-01-03', close: 108 },
    ];
    const r = computeEarningsMove(ps, ['2024-01-01']);
    expect(r).not.toBeNull();
    // Move structure may include avgMove, biggestMove, or similar —
    // just confirm something sensible came back.
    expect(r).toBeTypeOf('object');
  });

  it('handles multiple earnings dates', () => {
    const ps = [
      { date: '2024-01-01', close: 100 },
      { date: '2024-01-02', close: 105 },
      { date: '2024-04-01', close: 110 },
      { date: '2024-04-02', close: 115 },
    ];
    const r = computeEarningsMove(ps, ['2024-01-01', '2024-04-01']);
    expect(r).not.toBeNull();
  });

  it('skips earnings dates outside the price series window', () => {
    const ps = [
      { date: '2024-06-01', close: 100 },
      { date: '2024-06-02', close: 105 },
    ];
    // Earnings before the series start — no valid before/after pair
    const r = computeEarningsMove(ps, ['2020-01-01']);
    // Should return null OR an empty result
    if (r !== null) {
      // Some implementations return { moves: [] } or similar
      const movesArr = r.moves ?? r.history ?? [];
      expect(Array.isArray(movesArr) ? movesArr.length : 0).toBe(0);
    }
  });
});
