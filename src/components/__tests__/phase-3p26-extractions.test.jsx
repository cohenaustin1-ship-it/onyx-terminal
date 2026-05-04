// @vitest-environment jsdom
//
// IMO Onyx Terminal — Phase 3p.26 component smoke tests
//
// Tests Chart (largest single component extraction yet) plus
// FundamentalsModal (shared between Chart and TradePage). Also
// includes a unit test for ta-helpers.js and indicator-impls.js
// since those are foundational lib modules.

import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';

afterEach(() => cleanup());

describe('ta-helpers (Phase 3p.26)', () => {
  it('exports core math functions', async () => {
    const m = await import('../../lib/ta-helpers.js');
    expect(typeof m.sma).toBe('function');
    expect(typeof m.ema).toBe('function');
    expect(typeof m.rsi).toBe('function');
    expect(typeof m.macd).toBe('function');
    expect(typeof m._flat).toBe('function');
  });

  it('sma + ema produce sensible results', async () => {
    const { sma, ema } = await import('../../lib/ta-helpers.js');
    const bars = Array(50).fill(0).map((_, i) => ({
      price: 100 + i, t: i * 1000,
      high: 101 + i, low: 99 + i, close: 100 + i, volume: 1e6,
    }));
    const smaResult = sma(bars, 10);
    const emaResult = ema(bars, 10);
    expect(smaResult.length).toBe(50);
    expect(emaResult.length).toBe(50);
    // The last few values should be close to the recent prices
    const lastSma = smaResult[49].v;
    expect(lastSma).toBeGreaterThan(140); // recent prices were ~145
  });
});

describe('indicator-impls (Phase 3p.26)', () => {
  it('exports INDICATOR_IMPLS with many indicators', async () => {
    const m = await import('../../lib/indicator-impls.js');
    expect(typeof m.INDICATOR_IMPLS).toBe('object');
    const keys = Object.keys(m.INDICATOR_IMPLS);
    expect(keys.length).toBeGreaterThan(50);
    expect(keys).toContain('sma');
    expect(keys).toContain('ema');
    expect(keys).toContain('rsi');
  });

  it('each indicator has panel + series + lines (or special markers)', async () => {
    const { INDICATOR_IMPLS } = await import('../../lib/indicator-impls.js');
    for (const [id, impl] of Object.entries(INDICATOR_IMPLS)) {
      expect(['overlay', 'sub', 'special']).toContain(impl.panel);
      // Standard indicators have series + lines; 'special' ones use
      // bespoke render paths and don't need them
      if (impl.panel !== 'special') {
        expect(typeof impl.series).toBe('function');
        expect(Array.isArray(impl.lines)).toBe(true);
      }
    }
  });
});

describe('FundamentalsModal (Phase 3p.26)', () => {
  it('mounts without throwing', async () => {
    const { FundamentalsModal } = await import('../fundamentals-modal.jsx');
    const props = {
      instrument: { ticker: 'AAPL', name: 'Apple Inc.' },
      onClose:    vi.fn(),
    };
    expect(() => render(<FundamentalsModal {...props} />)).not.toThrow();
  });
});

describe('Chart (Phase 3p.26)', () => {
  it('mounts without throwing', async () => {
    const { Chart } = await import('../chart-page.jsx');
    const props = {
      instrument: { ticker: 'AAPL', name: 'Apple Inc.', cls: 'equity' },
      livePrice: 150.0,
      instanceId: 'test-chart',
    };
    expect(() => render(<Chart {...props} />)).not.toThrow();
  });
});
