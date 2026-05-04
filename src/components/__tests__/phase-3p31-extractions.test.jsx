// @vitest-environment jsdom
//
// IMO Onyx Terminal — Phase 3p.31 component smoke tests
//
// Tests the basket-components and instrument-header extractions —
// 6 components total + SectorLetter moved to leaf-ui.

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

describe('SectorLetter (moved to leaf-ui in 3p.31)', () => {
  it('mounts with cls prop', async () => {
    const { SectorLetter } = await import('../leaf-ui.jsx');
    expect(() => render(<SectorLetter cls="equity" size={16} />)).not.toThrow();
  });

  it('handles unknown cls gracefully', async () => {
    const { SectorLetter } = await import('../leaf-ui.jsx');
    expect(() => render(<SectorLetter cls="unknown" />)).not.toThrow();
  });
});

describe('basket-components (Phase 3p.31)', () => {
  it('exports the expected components', async () => {
    const m = await import('../basket-components.jsx');
    expect(typeof m.MarketBasketsModal).toBe('function');
    expect(typeof m.BasketIcon).toBe('function');
    expect(typeof m.AutopilotMiniSubpage).toBe('function');
  });

  it('BasketIcon mounts', async () => {
    const { BasketIcon } = await import('../basket-components.jsx');
    expect(() =>
      render(<BasketIcon iconKey="ai-infra" color="#7AC8FF" size={32} />)
    ).not.toThrow();
  });

  it('MarketBasketsModal mounts', async () => {
    const { MarketBasketsModal } = await import('../basket-components.jsx');
    const props = {
      account: { positions: [], cash: 10000 },
      onClose: vi.fn(),
      onBuy: vi.fn(),
      onOpenPosition: vi.fn(),
    };
    expect(() => render(<MarketBasketsModal {...props} />)).not.toThrow();
  });
});

describe('instrument-header (Phase 3p.31)', () => {
  it('exports the expected components', async () => {
    const m = await import('../instrument-header.jsx');
    expect(typeof m.InstrumentHeader).toBe('function');
    expect(typeof m.InstrumentPicker).toBe('function');
    expect(typeof m.AnalyzeChartButton).toBe('function');
  });

  it('InstrumentHeader mounts', async () => {
    const { InstrumentHeader } = await import('../instrument-header.jsx');
    const props = {
      instrument: {
        ticker: 'AAPL', name: 'Apple Inc.', cls: 'equity',
        mark: 150, dec: 2, id: 'AAPL',
      },
      feed: {
        price: 150,
        change: 0.5,
        change24h: 0.5,
        history: Array(50).fill(0).map((_, i) => ({ t: i, price: 150 + i * 0.1 })),
        source: 'sim',
      },
      account: { positions: [], cash: 10000 },
      onOpenPicker: vi.fn(),
      isWatched: false,
      onToggleWatch: vi.fn(),
      onOpenTerminal: vi.fn(),
      onSelect: vi.fn(),
      onEditLayout: vi.fn(),
      hasOrderEntry: false,
      onQuickTrade: vi.fn(),
      onOpenAI: vi.fn(),
      onOpenScreener: vi.fn(),
    };
    expect(() => render(<InstrumentHeader {...props} />)).not.toThrow();
  });

  it('InstrumentPicker mounts', async () => {
    const { InstrumentPicker } = await import('../instrument-header.jsx');
    const props = {
      active: { ticker: 'AAPL', cls: 'equity', id: 'AAPL' },
      onSelect: vi.fn(),
      onClose: vi.fn(),
      watchlist: [],
      onToggleWatch: vi.fn(),
    };
    expect(() => render(<InstrumentPicker {...props} />)).not.toThrow();
  });
});
