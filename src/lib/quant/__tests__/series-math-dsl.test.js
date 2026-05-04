// IMO Onyx Terminal — series-math-dsl tests
//
// Tests the expression evaluator used by the macro/economic data
// overlay. Examples that are documented in the module:
//   "FED/H15/RIFLGFCY10_N.B - FED/H15/RIFLGFCY02_N.B"  (10s/2s spread)
//   "ma(series, 20) - series"                          (mean-rev signal)
//   "max(0, expr)"                                     (curve floor)

import { describe, it, expect } from 'vitest';
import { computeMathSeries } from '../series-math-dsl.js';

// Helper: build a synthetic series cache with one value per day.
// Use a 13-digit base timestamp so string-sort and numeric-sort agree
// (the DSL stores timestamps as object keys / Set members which sort
// as strings; this is fine for real-world timestamps but breaks for
// small ints).
const BASE_TS = 1_700_000_000_000;
const synth = (id, points) => ({
  [id]: { data: { points: points.map((v, i) => ({ t: BASE_TS + i * 86400000, v })) } },
});

describe('computeMathSeries — input handling', () => {
  it('returns null for an empty expression', () => {
    expect(computeMathSeries('', {})).toBeNull();
    expect(computeMathSeries('   ', {})).toBeNull();
  });

  it('returns null when the expression references no series', () => {
    expect(computeMathSeries('1 + 2', {})).toBeNull();
  });

  it('returns missing-flag when a referenced series is absent from cache', () => {
    // The DSL signals missing data with { points: [], missing: true }
    // rather than null, so the chart can show a placeholder.
    const r = computeMathSeries('FED/H15/RIFLGFCY10_N.B', {});
    expect(r).not.toBeNull();
    expect(r.missing).toBe(true);
    expect(r.points).toEqual([]);
  });
});

describe('computeMathSeries — single-series operations', () => {
  it('passes through a single series unchanged', () => {
    const cache = synth('FED/H15/X', [1, 2, 3, 4, 5]);
    const r = computeMathSeries('FED/H15/X', cache);
    expect(r).not.toBeNull();
    expect(r.points).toHaveLength(5);
    expect(r.points[2].v).toBe(3);
    expect(r.referencedSeriesIds).toEqual(['FED/H15/X']);
  });

  it('applies abs() correctly', () => {
    const cache = synth('A/B/C', [-3, 0, 5, -1.5]);
    const r = computeMathSeries('abs(A/B/C)', cache);
    expect(r.points.map(p => p.v)).toEqual([3, 0, 5, 1.5]);
  });
});

describe('computeMathSeries — two-series arithmetic', () => {
  it('subtracts two aligned series', () => {
    const cache = {
      ...synth('FED/H15/A', [10, 20, 30]),
      ...synth('FED/H15/B', [1, 2, 3]),
    };
    const r = computeMathSeries('FED/H15/A - FED/H15/B', cache);
    expect(r.points.map(p => p.v)).toEqual([9, 18, 27]);
    expect(r.referencedSeriesIds.sort()).toEqual(['FED/H15/A', 'FED/H15/B']);
  });

  it('adds two aligned series', () => {
    const cache = {
      ...synth('X/Y/Z', [1, 2, 3]),
      ...synth('A/B/C', [4, 5, 6]),
    };
    const r = computeMathSeries('X/Y/Z + A/B/C', cache);
    expect(r.points.map(p => p.v)).toEqual([5, 7, 9]);
  });

  it('multiplies two aligned series', () => {
    const cache = {
      ...synth('X/Y/Z', [2, 3, 4]),
      ...synth('A/B/C', [10, 100, 1000]),
    };
    const r = computeMathSeries('X/Y/Z * A/B/C', cache);
    expect(r.points.map(p => p.v)).toEqual([20, 300, 4000]);
  });
});

describe('computeMathSeries — functions', () => {
  it('max(0, x) floors a series at zero', () => {
    const cache = synth('A/B/C', [-5, -1, 0, 3, 10]);
    const r = computeMathSeries('max(0, A/B/C)', cache);
    expect(r.points.map(p => p.v)).toEqual([0, 0, 0, 3, 10]);
  });

  it('min(a, b) returns the smaller of two values', () => {
    const cache = synth('A/B/C', [1, 5, 10, 100]);
    const r = computeMathSeries('min(7, A/B/C)', cache);
    expect(r.points.map(p => p.v)).toEqual([1, 5, 7, 7]);
  });
});
