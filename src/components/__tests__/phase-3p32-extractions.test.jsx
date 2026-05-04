// @vitest-environment jsdom
//
// IMO Onyx Terminal — Phase 3p.32 component smoke tests
//
// Tests TradePage extraction — the culmination of TIER C. After 5
// "lift the children" phases extracted all 51 of TradePage's
// monolith-defined children, the page itself is now a clean module.

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

describe('trade-page (Phase 3p.32)', () => {
  it('exports TradePage', async () => {
    const m = await import('../trade-page.jsx');
    expect(typeof m.TradePage).toBe('function');
  });

  it('TradePage mounts with mock children', async () => {
    const { TradePage } = await import('../trade-page.jsx');
    const MockBottomPanel = () => <div data-testid="bp">bottom</div>;
    const MockPositions = () => <div data-testid="pos">positions</div>;
    const props = {
      active: {
        ticker: 'AAPL', name: 'Apple Inc.', cls: 'equity',
        mark: 150, dec: 2, id: 'AAPL',
      },
      setActive: vi.fn(),
      pickerOpen: false,
      setPickerOpen: vi.fn(),
      account: { positions: [], cash: 10000, orders: [], watchlist: [] },
      portfolioSource: 'paper',
      user: { username: 'alice' },
      onOpenPosition: vi.fn(),
      onClosePosition: vi.fn(),
      onToggleWatch: vi.fn(),
      onOptionTrade: vi.fn(),
      onOpenTerminal: vi.fn(),
      setPage: vi.fn(),
      onOpenAI: vi.fn(),
      BottomPanel: MockBottomPanel,
      Positions: MockPositions,
    };
    expect(() => render(<TradePage {...props} />)).not.toThrow();
  });
});

describe('useOrderBook (moved to trade-feeds in 3p.32)', () => {
  it('is exported from trade-feeds', async () => {
    const m = await import('../../lib/trade-feeds.js');
    expect(typeof m.useOrderBook).toBe('function');
    expect(typeof m.usePriceFeed).toBe('function');
    expect(typeof m.useTradeFeed).toBe('function');
  });
});
