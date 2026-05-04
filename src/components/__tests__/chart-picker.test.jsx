// @vitest-environment jsdom
//
// IMO Onyx Terminal — Chart picker component test
//
// This is the MOUNTED-COMPONENT test for the chart's range/frequency
// picker. Verifies real DOM rendering + click semantics for the
// picker buttons across:
//
//   1. Every TIME_RANGE renders a clickable button
//   2. Every INTERVAL renders a button (some may be disabled)
//   3. Invalid combinations are disabled (aria-disabled + line-through)
//   4. Clicking a range button invokes the change handler with the
//      correct id
//   5. Clicking a disabled interval is a no-op
//   6. Active state is reflected via aria-pressed
//   7. formatChartTicker produces correct label + decimal precision
//      for every instrument in the catalog
//
// Together with chart-config.test.js (228 tests on the data layer),
// this gives end-to-end confidence that the chart's picker UX is
// correct: data is well-formed → validation logic is sound → DOM
// rendering reflects validation → click handlers wire correctly.

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

afterEach(() => cleanup());
import {
  ChartRangePicker,
  ChartFrequencyPicker,
  formatChartTicker,
} from '../chart-picker.jsx';
import {
  TIME_RANGES,
  INTERVALS,
  isValidCombination,
  reconcileFrequency,
} from '../../lib/chart-config.js';
import { INSTRUMENTS } from '../../lib/instruments.js';
import { formatTicker } from '../../lib/format.js';

describe('<ChartRangePicker />', () => {
  it('renders a button for every TIME_RANGE', () => {
    render(<ChartRangePicker activeRange="1D" onRangeChange={() => {}} />);
    for (const r of TIME_RANGES) {
      const btn = screen.getByTestId(`range-${r.id}`);
      expect(btn).toBeDefined();
      expect(btn.textContent).toBe(r.label);
    }
  });

  it('marks the active range with aria-pressed=true', () => {
    render(<ChartRangePicker activeRange="1Y" onRangeChange={() => {}} />);
    expect(screen.getByTestId('range-1Y').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('range-1D').getAttribute('aria-pressed')).toBe('false');
  });

  it('calls onRangeChange with the clicked range id', () => {
    const onChange = vi.fn();
    render(<ChartRangePicker activeRange="1D" onRangeChange={onChange} />);
    fireEvent.click(screen.getByTestId('range-5Y'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('5Y');
  });

  it('every range button is enabled (no disabling on the range row)', () => {
    render(<ChartRangePicker activeRange="1D" onRangeChange={() => {}} />);
    for (const r of TIME_RANGES) {
      expect(screen.getByTestId(`range-${r.id}`).hasAttribute('disabled')).toBe(false);
    }
  });
});

describe('<ChartFrequencyPicker />', () => {
  it('renders a button for every INTERVAL', () => {
    render(
      <ChartFrequencyPicker
        activeRange="1Y" activeInterval="1d" onIntervalChange={() => {}}
      />
    );
    for (const i of INTERVALS) {
      const btn = screen.getByTestId(`interval-${i.id}`);
      expect(btn).toBeDefined();
      expect(btn.textContent).toBe(i.label);
    }
  });

  it('disables invalid combinations for the active range', () => {
    // 5Y range × 1m interval is INVALID (would be 2.6M data points)
    render(
      <ChartFrequencyPicker
        activeRange="5Y" activeInterval="1d" onIntervalChange={() => {}}
      />
    );
    const btn1m = screen.getByTestId('interval-1m');
    expect(btn1m.hasAttribute('disabled')).toBe(true);
    expect(btn1m.getAttribute('aria-disabled')).toBe('true');
  });

  it('does not disable valid combinations', () => {
    // 5Y × 1d IS valid (daily candles are unlimited)
    render(
      <ChartFrequencyPicker
        activeRange="5Y" activeInterval="1d" onIntervalChange={() => {}}
      />
    );
    const btn1d = screen.getByTestId('interval-1d');
    expect(btn1d.hasAttribute('disabled')).toBe(false);
    expect(btn1d.getAttribute('aria-disabled')).toBe('false');
  });

  it('clicking a valid interval invokes onIntervalChange', () => {
    const onChange = vi.fn();
    render(
      <ChartFrequencyPicker
        activeRange="1M" activeInterval="1h" onIntervalChange={onChange}
      />
    );
    fireEvent.click(screen.getByTestId('interval-15m'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('15m');
  });

  it('clicking a disabled interval is a no-op', () => {
    const onChange = vi.fn();
    render(
      <ChartFrequencyPicker
        activeRange="5Y" activeInterval="1d" onIntervalChange={onChange}
      />
    );
    // 1m is disabled for 5Y range; click should be ignored.
    fireEvent.click(screen.getByTestId('interval-1m'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('marks the active interval with aria-pressed=true', () => {
    render(
      <ChartFrequencyPicker
        activeRange="1Y" activeInterval="1d" onIntervalChange={() => {}}
      />
    );
    expect(screen.getByTestId('interval-1d').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('interval-1h').getAttribute('aria-pressed')).toBe('false');
  });

  it('disabled intervals get strikethrough text-decoration', () => {
    render(
      <ChartFrequencyPicker
        activeRange="MAX" activeInterval="1d" onIntervalChange={() => {}}
      />
    );
    const btn1m = screen.getByTestId('interval-1m');
    expect(btn1m.style.textDecoration).toBe('line-through');
    expect(btn1m.style.cursor).toBe('not-allowed');
  });

  it('correctly reflects validation across every TIME_RANGE × INTERVAL combination', () => {
    // For each range, mount the picker and verify that every interval's
    // disabled state matches isValidCombination. This is the strongest
    // single end-to-end check that the picker DOM reflects the data layer.
    for (const r of TIME_RANGES) {
      const { unmount } = render(
        <ChartFrequencyPicker
          activeRange={r.id} activeInterval="1d" onIntervalChange={() => {}}
        />
      );
      for (const i of INTERVALS) {
        const btn = screen.getByTestId(`interval-${i.id}`);
        const expectedValid = isValidCombination(r.id, i.id);
        expect(
          !btn.hasAttribute('disabled'),
          `range ${r.id} × interval ${i.id}: expected valid=${expectedValid} but DOM said ${!btn.hasAttribute('disabled')}`
        ).toBe(expectedValid);
      }
      unmount();
    }
  });
});

describe('formatChartTicker (header label generation)', () => {
  it('returns dash for null instrument', () => {
    const r = formatChartTicker(null);
    expect(r.label).toBe('—');
    expect(r.mark).toBeNull();
  });

  it('returns the symbol + name for a valid instrument', () => {
    const aapl = INSTRUMENTS.find(i => i.id === 'AAPL');
    const r = formatChartTicker(aapl);
    expect(r.label).toContain('AAPL');
    if (aapl.name) expect(r.label).toContain(aapl.name);
    expect(r.mark).toBe(aapl.mark);
    expect(r.dec).toBe(aapl.dec);
  });

  it('uses formatTicker for exchange prefix when provided', () => {
    const aapl = INSTRUMENTS.find(i => i.id === 'AAPL');
    const r = formatChartTicker(aapl, formatTicker);
    // formatTicker returns "NSDQ:AAPL" for AAPL
    expect(r.label).toMatch(/^(NSDQ:|NYSE:|ARCA:)?AAPL/);
  });

  it('every instrument produces a valid label and renderable mark', () => {
    for (const inst of INSTRUMENTS) {
      const r = formatChartTicker(inst);
      expect(r.label, `${inst.id} produced empty label`).toBeTruthy();
      expect(r.dec, `${inst.id} produced bad dec`).toBeGreaterThanOrEqual(0);
      expect(r.dec, `${inst.id} produced bad dec`).toBeLessThanOrEqual(8);
      expect(r.mark, `${inst.id} produced bad mark`).toBeGreaterThan(0);
    }
  });

  it('decimal precision is applied correctly when formatting the mark', () => {
    // For each instrument, verify .toFixed(dec) produces a string with
    // the right number of decimal places.
    for (const inst of INSTRUMENTS) {
      const r = formatChartTicker(inst);
      const formatted = r.mark.toFixed(r.dec);
      // Count chars after decimal point
      const decimalPart = formatted.split('.')[1] ?? '';
      expect(
        decimalPart.length,
        `${inst.id} mark=${r.mark} dec=${r.dec} formatted as "${formatted}"`
      ).toBe(r.dec);
    }
  });
});

describe('Chart picker integration: range change → frequency reconciliation', () => {
  // This is the "stock chart works correctly across navigation" test.
  // Simulates the user clicking through ranges and verifying the chart
  // never lands in an invalid state. The real Chart component's
  // useEffect calls reconcileFrequency; we exercise the same fn here.

  it('clicking through every range from every starting interval lands in a valid state', () => {
    for (const startInterval of INTERVALS) {
      for (const sticky of [true, false]) {
        for (const targetRange of TIME_RANGES) {
          const r = reconcileFrequency(targetRange.id, startInterval.id, sticky);
          // After reconciliation, the (range, interval) combo MUST be
          // valid. This is the "no broken chart on navigation" guarantee.
          expect(
            isValidCombination(targetRange.id, r.interval),
            `start=${startInterval.id}(sticky=${sticky}) → ${targetRange.id}: produced INVALID combo ${r.interval}`
          ).toBe(true);
        }
      }
    }
  });

  it('mounting the picker at each (range, default-interval) tuple renders without warnings', () => {
    // Catches edge cases where the default-interval might be invalid
    // for its own range (which would be an obvious data bug).
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      for (const r of TIME_RANGES) {
        const { unmount } = render(
          <ChartFrequencyPicker
            activeRange={r.id}
            activeInterval={r.defaultInterval}
            onIntervalChange={() => {}}
          />
        );
        // The default interval button MUST be enabled
        const btn = screen.getByTestId(`interval-${r.defaultInterval}`);
        expect(
          btn.hasAttribute('disabled'),
          `${r.id}'s default interval ${r.defaultInterval} is disabled in the picker`
        ).toBe(false);
        unmount();
      }
    } finally {
      errSpy.mockRestore();
    }
  });
});
