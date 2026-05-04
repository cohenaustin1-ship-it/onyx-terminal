// IMO Onyx Terminal — chart picker (Range + Frequency)
//
// Phase 3p.06 (chart correctness tests). Extracted from the Chart
// component's range/frequency button row so it can be:
//   1. Mounted in tests without dragging in 5,000 lines of recharts
//   2. Reused for chart artifacts (export, AI Edit overlays, etc.)
//
// Behavior:
//   - Renders one button per TIME_RANGE
//   - Renders one button per INTERVAL
//   - Disables interval buttons that aren't valid for the active range
//     (per isValidCombination). Disabled buttons get aria-disabled and
//     a strikethrough style; clicking them is a no-op.
//   - Calls onRangeChange(rangeId) when the user picks a range —
//     parent applies reconcileFrequency to decide what to do with the
//     active interval.
//   - Calls onIntervalChange(intervalId, sticky=true) when the user
//     picks an interval (always sticky=true; sticky goes back to
//     false only via reconcileFrequency on a range change).
//
// This is the testable surface of the chart's picker UX. The actual
// recharts rendering happens elsewhere in JPMOnyxTerminal.jsx and
// doesn't affect picker correctness.

import React from 'react';
import { TIME_RANGES, INTERVALS, isValidCombination } from '../lib/chart-config.js';
import { COLORS } from '../lib/constants.js';

export const ChartRangePicker = ({ activeRange, onRangeChange }) => {
  return (
    <div className="flex items-center gap-1" role="group" aria-label="chart-range">
      {TIME_RANGES.map(r => {
        const isActive = r.id === activeRange;
        return (
          <button
            key={r.id}
            type="button"
            data-testid={`range-${r.id}`}
            aria-pressed={isActive}
            onClick={() => onRangeChange(r.id)}
            className="px-2 py-1 rounded text-[11px] font-medium tabular-nums"
            style={{
              background:  isActive ? COLORS.surface : 'transparent',
              color:       isActive ? COLORS.text : COLORS.textDim,
              border:      `1px solid ${isActive ? COLORS.border : 'transparent'}`,
            }}
            title={r.desc}
          >
            {r.label}
          </button>
        );
      })}
    </div>
  );
};

export const ChartFrequencyPicker = ({ activeRange, activeInterval, onIntervalChange }) => {
  return (
    <div className="flex items-center gap-1" role="group" aria-label="chart-frequency">
      {INTERVALS.map(i => {
        const valid = isValidCombination(activeRange, i.id);
        const isActive = i.id === activeInterval;
        return (
          <button
            key={i.id}
            type="button"
            data-testid={`interval-${i.id}`}
            aria-pressed={isActive}
            aria-disabled={!valid}
            disabled={!valid}
            onClick={() => valid && onIntervalChange(i.id)}
            className="px-2 py-1 rounded text-[11px] tabular-nums"
            style={{
              background:    isActive ? COLORS.surface : 'transparent',
              color:         !valid ? COLORS.textMute :
                             isActive ? COLORS.text : COLORS.textDim,
              border:        `1px solid ${isActive ? COLORS.border : 'transparent'}`,
              cursor:        valid ? 'pointer' : 'not-allowed',
              textDecoration: valid ? 'none' : 'line-through',
              opacity:       valid ? 1 : 0.5,
            }}
            title={valid ? i.label : `${i.label} not available for this range`}
          >
            {i.label}
          </button>
        );
      })}
    </div>
  );
};

// formatChartTicker — display label for the chart header. For equities
// uses the exchange-prefixed form (NSDQ:AAPL, NYSE:JPM), otherwise the
// raw symbol. Decimal precision comes from instrument.dec.
//
// Returns: { label, dec, mark }
//   label — display string (e.g. "NSDQ:AAPL · Apple Inc.")
//   dec   — decimal places to render the price with
//   mark  — current mark price
export const formatChartTicker = (instrument, formatTickerFn = null) => {
  if (!instrument) return { label: '—', dec: 2, mark: null };
  const symbol = formatTickerFn
    ? formatTickerFn(instrument.id, instrument.cls)
    : instrument.id;
  const name = instrument.name ? ` · ${instrument.name}` : '';
  return {
    label: `${symbol}${name}`,
    dec:   Number.isFinite(instrument.dec) ? instrument.dec : 2,
    mark:  Number.isFinite(instrument.mark) ? instrument.mark : null,
  };
};
