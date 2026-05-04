// @vitest-environment jsdom
//
// IMO Onyx Terminal — Phase 3p.29 component smoke tests
//
// Tests the ChartWithSubcharts extraction. ChartWithSubcharts is
// the wrapper TradePage uses to display the main Chart component
// alongside a stack of optional subchart panels.

import React from 'react';
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';

beforeAll(() => {
  global.ResizeObserver = global.ResizeObserver || class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => cleanup());

describe('chart-with-subcharts (Phase 3p.29)', () => {
  it('exports ChartWithSubcharts and SubChartFull', async () => {
    const m = await import('../chart-with-subcharts.jsx');
    expect(typeof m.ChartWithSubcharts).toBe('function');
    expect(typeof m.SubChartFull).toBe('function');
  });

  it('ChartWithSubcharts mounts without throwing', async () => {
    const { ChartWithSubcharts } = await import('../chart-with-subcharts.jsx');
    const props = {
      instrument: { ticker: 'AAPL', name: 'Apple Inc.', cls: 'equity' },
      livePrice: 150,
      instanceId: 'test-cws',
      user: { username: 'alice' },
      account: { positions: [] },
    };
    expect(() => render(<ChartWithSubcharts {...props} />)).not.toThrow();
  });

  it('SubChartFull mounts with a known type', async () => {
    const { SubChartFull } = await import('../chart-with-subcharts.jsx');
    const props = {
      type: 'net-flow',
      instrument: { ticker: 'AAPL' },
      onClose: vi.fn(),
    };
    expect(() => render(<SubChartFull {...props} />)).not.toThrow();
  });
});
