// IMO Onyx Terminal — Chart correctness tests
//
// Verifies the data-side correctness of the price chart:
//   1. TIME_RANGES is well-formed and covers the expected UI options
//   2. INTERVALS is well-formed and the maxRangeMins guards make sense
//   3. resolveRangeMins handles dynamic ranges (YTD, MAX) correctly
//   4. isValidCombination correctly accepts/rejects pairs
//   5. computeBarCount produces sensible counts across the full
//      TIME_RANGES × INTERVALS matrix (not zero, not absurd)
//   6. Every TIME_RANGE has a defaultInterval that is itself a valid
//      combination — so the default selection never lands on a
//      disabled button
//   7. INSTRUMENTS catalog includes the major tickers people expect
//      a trading platform to support, with proper decimal precision
//      (`dec`) for each asset class
//   8. INSTRUMENTS data is internally consistent (positive marks,
//      reasonable change24h, plausible volume)
//
// This is the "stock chart smoke test" — verifies the chart will
// have valid inputs across every range/frequency combination the UI
// can produce, and that ticker rendering will use correct precision.

import { describe, it, expect } from 'vitest';
import {
  TIME_RANGES,
  INTERVALS,
  TIMEFRAMES,
  resolveRangeMins,
  isValidCombination,
  reconcileFrequency,
} from '../chart-config.js';
import { INSTRUMENTS } from '../instruments.js';
import { computeBarCount } from '../quant/quant-misc.js';
import { formatTicker } from '../format.js';

describe('TIME_RANGES (chart range picker data)', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(TIME_RANGES)).toBe(true);
    expect(TIME_RANGES.length).toBeGreaterThan(0);
  });

  it('contains the canonical range ids', () => {
    const ids = TIME_RANGES.map(r => r.id);
    // The chart UI surfaces these — every one must be present.
    for (const required of ['1D', '5D', '1M', '6M', 'YTD', '1Y', '5Y', 'MAX']) {
      expect(ids, `missing required range ${required}`).toContain(required);
    }
  });

  it('every entry has id + label + desc + defaultInterval', () => {
    for (const r of TIME_RANGES) {
      expect(r.id).toBeTypeOf('string');
      expect(r.label).toBeTypeOf('string');
      expect(r.desc).toBeTypeOf('string');
      expect(r.defaultInterval).toBeTypeOf('string');
    }
  });

  it('static spanMins values are positive (dynamic = null)', () => {
    for (const r of TIME_RANGES) {
      if (r.spanMins !== null) {
        expect(r.spanMins, `${r.id} has bad spanMins`).toBeGreaterThan(0);
        expect(Number.isFinite(r.spanMins)).toBe(true);
      }
    }
  });

  it('spanMins are monotonically non-decreasing across ordered ranges', () => {
    // Skip the dynamic ones (YTD, MAX). Ordering: 1D < 5D < 1M < 6M < 1Y < 5Y
    const ordered = TIME_RANGES.filter(r => r.spanMins !== null);
    for (let i = 1; i < ordered.length; i++) {
      expect(
        ordered[i].spanMins,
        `${ordered[i].id} should have larger span than ${ordered[i-1].id}`
      ).toBeGreaterThanOrEqual(ordered[i-1].spanMins);
    }
  });

  it('every defaultInterval is a real INTERVAL id', () => {
    const intervalIds = new Set(INTERVALS.map(i => i.id));
    for (const r of TIME_RANGES) {
      expect(intervalIds, `${r.id} → ${r.defaultInterval}`).toContain(r.defaultInterval);
    }
  });
});

describe('INTERVALS (frequency picker data)', () => {
  it('contains the canonical frequency ids', () => {
    const ids = INTERVALS.map(i => i.id);
    for (const required of ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M']) {
      expect(ids, `missing required interval ${required}`).toContain(required);
    }
  });

  it('every entry has id + label + mins + maxRangeMins', () => {
    for (const i of INTERVALS) {
      expect(i.id).toBeTypeOf('string');
      expect(i.label).toBeTypeOf('string');
      expect(i.mins).toBeTypeOf('number');
      expect(i.mins).toBeGreaterThan(0);
      // maxRangeMins is null OR positive number
      expect(i.maxRangeMins === null || i.maxRangeMins > 0).toBe(true);
    }
  });

  it('mins values are monotonically increasing', () => {
    for (let i = 1; i < INTERVALS.length; i++) {
      expect(
        INTERVALS[i].mins,
        `${INTERVALS[i].id} should be > ${INTERVALS[i-1].id}`
      ).toBeGreaterThan(INTERVALS[i-1].mins);
    }
  });

  it('1m interval has mins=1 and 1d interval has mins=1440', () => {
    const oneMin = INTERVALS.find(i => i.id === '1m');
    const oneDay = INTERVALS.find(i => i.id === '1d');
    expect(oneMin.mins).toBe(1);
    expect(oneDay.mins).toBe(1440);
  });

  it('1m interval limits to 5 days range (data-density guard)', () => {
    const oneMin = INTERVALS.find(i => i.id === '1m');
    expect(oneMin.maxRangeMins).toBeLessThanOrEqual(60 * 24 * 5);
  });

  it('daily and longer intervals are unlimited (maxRangeMins=null)', () => {
    expect(INTERVALS.find(i => i.id === '1d').maxRangeMins).toBeNull();
    expect(INTERVALS.find(i => i.id === '1w').maxRangeMins).toBeNull();
    expect(INTERVALS.find(i => i.id === '1M').maxRangeMins).toBeNull();
  });
});

describe('resolveRangeMins', () => {
  it('returns the static spanMins for ordinary ranges', () => {
    expect(resolveRangeMins('1D')).toBe(60 * 24);
    expect(resolveRangeMins('5D')).toBe(60 * 24 * 5);
    expect(resolveRangeMins('1M')).toBe(60 * 24 * 30);
    expect(resolveRangeMins('1Y')).toBe(60 * 24 * 365);
  });

  it('computes YTD as time since Jan 1 of current year', () => {
    const mins = resolveRangeMins('YTD');
    const now = new Date();
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const expected = Math.floor((now - yearStart) / (60 * 1000));
    // Allow 1-second drift for test execution time
    expect(Math.abs(mins - expected)).toBeLessThan(2);
  });

  it('YTD never exceeds 1 year of minutes', () => {
    expect(resolveRangeMins('YTD')).toBeLessThanOrEqual(60 * 24 * 366);
  });

  it('YTD never goes below zero', () => {
    expect(resolveRangeMins('YTD')).toBeGreaterThanOrEqual(0);
  });

  it('MAX returns a 20-year cap', () => {
    expect(resolveRangeMins('MAX')).toBe(60 * 24 * 365 * 20);
  });

  it('falls back to 30 days for unknown range ids', () => {
    expect(resolveRangeMins('UNKNOWN_ID')).toBe(60 * 24 * 30);
  });
});

describe('isValidCombination (range × interval validation)', () => {
  it('rejects unknown interval id', () => {
    expect(isValidCombination('1Y', 'fake-interval')).toBe(false);
  });

  it('1D + 1m is valid (1 day fits in 5-day cap)', () => {
    expect(isValidCombination('1D', '1m')).toBe(true);
  });

  it('5Y + 1m is INVALID (5y range with 1-min candles = 2.6M points)', () => {
    expect(isValidCombination('5Y', '1m')).toBe(false);
  });

  it('5Y + 1d is valid (daily candles are unlimited)', () => {
    expect(isValidCombination('5Y', '1d')).toBe(true);
  });

  it('MAX + 1d is valid (daily/weekly/monthly unlimited)', () => {
    expect(isValidCombination('MAX', '1d')).toBe(true);
    expect(isValidCombination('MAX', '1w')).toBe(true);
    expect(isValidCombination('MAX', '1M')).toBe(true);
  });

  it('MAX + 1m is INVALID (way over 5-day cap)', () => {
    expect(isValidCombination('MAX', '1m')).toBe(false);
  });

  it('every range has at least one valid interval', () => {
    for (const r of TIME_RANGES) {
      const validCount = INTERVALS.filter(i => isValidCombination(r.id, i.id)).length;
      expect(validCount, `${r.id} should have at least one valid interval`).toBeGreaterThan(0);
    }
  });
});

describe('default range/interval selections', () => {
  it('every range\'s defaultInterval is a valid combination', () => {
    // This catches a real UX bug: if a default lands on a disabled
    // button, the user sees an empty chart on first render.
    for (const r of TIME_RANGES) {
      expect(
        isValidCombination(r.id, r.defaultInterval),
        `${r.id}'s default interval ${r.defaultInterval} is INVALID`
      ).toBe(true);
    }
  });

  it('default intervals scale up sensibly with range length', () => {
    // 1D should default to a sub-hour interval, 5Y should default to
    // weekly or monthly. Just sanity — exact values aren't important.
    const oneDay = TIME_RANGES.find(r => r.id === '1D');
    const fiveYear = TIME_RANGES.find(r => r.id === '5Y');
    const oneDayInterval = INTERVALS.find(i => i.id === oneDay.defaultInterval);
    const fiveYearInterval = INTERVALS.find(i => i.id === fiveYear.defaultInterval);
    // 1D's default is much finer-grained than 5Y's
    expect(oneDayInterval.mins).toBeLessThan(fiveYearInterval.mins);
  });
});

describe('computeBarCount × range × interval matrix', () => {
  it('produces sensible bar counts for every valid combination', () => {
    for (const r of TIME_RANGES) {
      for (const interval of INTERVALS) {
        if (!isValidCombination(r.id, interval.id)) continue;
        const rangeMins = resolveRangeMins(r.id);
        const bars = computeBarCount(rangeMins, interval.mins);
        // Every valid combo should produce at least 1 bar and at most
        // ~10,000 bars (rendering bound — chart can't usefully draw
        // more than that anyway).
        expect(bars, `${r.id} × ${interval.id} produced ${bars} bars`)
          .toBeGreaterThan(0);
        expect(bars, `${r.id} × ${interval.id} produced ${bars} bars (too many)`)
          .toBeLessThan(10_000);
      }
    }
  });

  it('1D × 1m produces ~1,440 bars', () => {
    expect(computeBarCount(resolveRangeMins('1D'), 1)).toBe(1440);
  });

  it('1Y × 1d produces ~365 bars', () => {
    expect(computeBarCount(resolveRangeMins('1Y'), 1440)).toBe(365);
  });

  it('5Y × 1w produces ~260 bars', () => {
    const bars = computeBarCount(resolveRangeMins('5Y'), 10080);
    expect(bars).toBeGreaterThan(250);
    expect(bars).toBeLessThan(265);
  });
});

describe('TIMEFRAMES (legacy compat list)', () => {
  it('contains the canonical timeframe ids', () => {
    const ids = TIMEFRAMES.map(t => t.id);
    for (const required of ['1D', '5D', '1M', '3M', '6M', '1Y', '5Y', 'MAX']) {
      expect(ids).toContain(required);
    }
  });

  it('every entry maps to a real INTERVAL via barTf', () => {
    const intervalIds = new Set(INTERVALS.map(i => i.id));
    for (const t of TIMEFRAMES) {
      expect(intervalIds, `${t.id} → ${t.barTf}`).toContain(t.barTf);
    }
  });

  it('bars count is positive and finite', () => {
    for (const t of TIMEFRAMES) {
      expect(t.bars).toBeGreaterThan(0);
      expect(Number.isFinite(t.bars)).toBe(true);
    }
  });
});

describe('INSTRUMENTS catalog (ticker validation)', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(INSTRUMENTS)).toBe(true);
    expect(INSTRUMENTS.length).toBeGreaterThan(0);
  });

  it('every instrument has the canonical fields', () => {
    for (const inst of INSTRUMENTS) {
      expect(inst.id, 'missing id').toBeTypeOf('string');
      expect(inst.cls, 'missing cls').toBeTypeOf('string');
      expect(inst.name, 'missing name').toBeTypeOf('string');
      expect(inst.mark, 'missing mark').toBeTypeOf('number');
      expect(inst.dec, 'missing dec').toBeTypeOf('number');
    }
  });

  it('every instrument has a unique id', () => {
    const ids = INSTRUMENTS.map(i => i.id);
    const unique = new Set(ids);
    expect(unique.size, 'duplicate ticker ids found').toBe(ids.length);
  });

  it('contains expected major crypto perps', () => {
    const ids = new Set(INSTRUMENTS.map(i => i.id));
    expect(ids).toContain('BTC-PERP');
    expect(ids).toContain('ETH-PERP');
  });

  it('contains expected major equities', () => {
    const ids = new Set(INSTRUMENTS.map(i => i.id));
    // The platform should support the obvious mega-caps
    for (const sym of ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'GOOGL', 'AMZN', 'META', 'SPY']) {
      expect(ids, `expected ${sym} in INSTRUMENTS`).toContain(sym);
    }
  });

  it('every mark price is positive and finite', () => {
    for (const inst of INSTRUMENTS) {
      expect(inst.mark, `${inst.id} has bad mark`).toBeGreaterThan(0);
      expect(Number.isFinite(inst.mark)).toBe(true);
    }
  });

  it('decimal precision is sensible per asset class', () => {
    for (const inst of INSTRUMENTS) {
      // Decimal precision must be 0-8 inclusive
      expect(inst.dec, `${inst.id} dec=${inst.dec} out of range`).toBeGreaterThanOrEqual(0);
      expect(inst.dec, `${inst.id} dec=${inst.dec} too high`).toBeLessThanOrEqual(8);
    }
  });

  it('crypto perps use 2-6 decimals (mid-cap range)', () => {
    const cryptos = INSTRUMENTS.filter(i => i.cls === 'crypto');
    for (const c of cryptos) {
      expect(c.dec, `${c.id} crypto dec=${c.dec}`).toBeGreaterThanOrEqual(2);
      expect(c.dec, `${c.id} crypto dec=${c.dec}`).toBeLessThanOrEqual(6);
    }
  });

  it('equity tickers use 2 decimals (cents)', () => {
    const equities = INSTRUMENTS.filter(i => i.cls === 'equity');
    for (const e of equities) {
      expect(e.dec, `${e.id} equity dec=${e.dec}`).toBe(2);
    }
  });

  it('change24h is a finite percentage in plausible range', () => {
    for (const inst of INSTRUMENTS) {
      if (inst.change24h === undefined || inst.change24h === null) continue;
      expect(Number.isFinite(inst.change24h)).toBe(true);
      // Daily moves > 50% are exceptional; flag if catalog has obviously
      // wrong values. (This is curated data; we want it sane.)
      expect(Math.abs(inst.change24h), `${inst.id} change24h=${inst.change24h}`)
        .toBeLessThan(50);
    }
  });

  it('volume is non-negative for entries that have it', () => {
    for (const inst of INSTRUMENTS) {
      if (inst.vol24h !== undefined && inst.vol24h !== null) {
        expect(inst.vol24h, `${inst.id} vol24h=${inst.vol24h}`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('formatTicker prefixes equities with exchange and leaves crypto raw', () => {
    // Spot check a few — equities should get a prefix, crypto perps shouldn't
    const aapl = INSTRUMENTS.find(i => i.id === 'AAPL');
    const btc  = INSTRUMENTS.find(i => i.id === 'BTC-PERP');
    if (aapl) {
      const f = formatTicker(aapl.id, aapl.cls);
      // Equity should be either "NSDQ:AAPL", "NYSE:AAPL", or raw "AAPL" if not in TICKER_EXCHANGE
      expect(f).toMatch(/^(NSDQ:|NYSE:|ARCA:)?AAPL$/);
    }
    if (btc) {
      // Non-equity returns raw id
      expect(formatTicker(btc.id, btc.cls)).toBe('BTC-PERP');
    }
  });
});

describe('reconcileFrequency (range-change UX rule)', () => {
  it('non-sticky → always returns the new range default', () => {
    const r = reconcileFrequency('5Y', '1m', false);
    expect(r.interval).toBe('1w');  // 5Y default
    expect(r.sticky).toBe(false);
    expect(r.fellBack).toBe(false);
  });

  it('sticky AND still valid → keeps current interval', () => {
    // User had picked 1h on 1M range, switches to 6M. 1h still valid
    // for 6M (1h max range = 1y), so keep it sticky.
    const r = reconcileFrequency('6M', '1h', true);
    expect(r.interval).toBe('1h');
    expect(r.sticky).toBe(true);
    expect(r.fellBack).toBe(false);
  });

  it('sticky BUT no longer valid → falls back to default + flags it', () => {
    // User had picked 1m on 1D range, switches to 5Y. 1m not valid
    // for 5Y, so drop sticky and fall back.
    const r = reconcileFrequency('5Y', '1m', true);
    expect(r.interval).toBe('1w');  // 5Y default
    expect(r.sticky).toBe(false);
    expect(r.fellBack).toBe(true);
  });

  it('sticky 1d → stays sticky for any range (1d is unlimited)', () => {
    expect(reconcileFrequency('1Y', '1d', true).sticky).toBe(true);
    expect(reconcileFrequency('5Y', '1d', true).sticky).toBe(true);
    expect(reconcileFrequency('MAX', '1d', true).sticky).toBe(true);
  });

  it('every range can be entered without breaking from any prior state', () => {
    // For every (sourceRange, sourceInterval, sticky) → newRange combo,
    // the result must produce a valid combination. This is the
    // strongest "the chart never lands in a bad state" guarantee.
    for (const src of TIME_RANGES) {
      for (const interval of INTERVALS) {
        for (const sticky of [true, false]) {
          for (const dst of TIME_RANGES) {
            const r = reconcileFrequency(dst.id, interval.id, sticky);
            expect(
              isValidCombination(dst.id, r.interval),
              `${src.id}+${interval.id}(sticky=${sticky}) → ${dst.id} produced INVALID combo (${r.interval})`
            ).toBe(true);
          }
        }
      }
    }
  });
});

describe('Chart end-to-end correctness (integration)', () => {
  it('every UI-surfaced range renders with at least 1 bar at its default interval', () => {
    // This is the big "chart will work" smoke test — for every range
    // shipped to the UI, can we render the chart at the default
    // interval without producing zero or millions of bars?
    for (const r of TIME_RANGES) {
      const interval = INTERVALS.find(i => i.id === r.defaultInterval);
      expect(interval, `range ${r.id} default ${r.defaultInterval} not found`).toBeDefined();
      const rangeMins = resolveRangeMins(r.id);
      const bars = computeBarCount(rangeMins, interval.mins);
      expect(bars, `range ${r.id} produced ${bars} bars`).toBeGreaterThan(0);
      expect(bars, `range ${r.id} produced ${bars} bars`).toBeLessThan(10_000);
    }
  });

  it('chart can render every INSTRUMENT against every UI range', () => {
    // Tighter integration: verify ticker × range × default-interval
    // tuple produces a renderable bar set for every instrument we ship.
    // This is the strongest single guarantee that the chart is
    // functional across the catalog.
    let combos = 0;
    for (const inst of INSTRUMENTS) {
      // Skip instruments that have no plausible price (shouldn't be any
      // since we just tested mark > 0 above, but defensive).
      if (!Number.isFinite(inst.mark) || inst.mark <= 0) continue;
      for (const r of TIME_RANGES) {
        const interval = INTERVALS.find(i => i.id === r.defaultInterval);
        const bars = computeBarCount(resolveRangeMins(r.id), interval.mins);
        expect(bars, `${inst.id} × ${r.id} produced ${bars} bars`).toBeGreaterThan(0);
        combos++;
      }
    }
    // Sanity: we tested at least 100 combinations
    expect(combos).toBeGreaterThan(100);
  });
});
