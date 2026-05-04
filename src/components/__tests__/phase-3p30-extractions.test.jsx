// @vitest-environment jsdom
//
// IMO Onyx Terminal — Phase 3p.30 component smoke tests
//
// Tests the trading-panel extraction (OrderBook + TradesList +
// OptionsChain + OptionsStrategiesModal + OrderEntry).

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

describe('trading-panel (Phase 3p.30)', () => {
  it('exports the expected components', async () => {
    const m = await import('../trading-panel.jsx');
    expect(typeof m.OrderBook).toBe('function');
    expect(typeof m.TradesList).toBe('function');
    expect(typeof m.OptionsChain).toBe('function');
    expect(typeof m.OptionsStrategiesModal).toBe('function');
    expect(typeof m.OrderEntry).toBe('function');
  });

  it('OrderBook mounts with mock book data', async () => {
    const { OrderBook } = await import('../trading-panel.jsx');
    const props = {
      book: {
        bids: [
          { price: 100, size: 10, total: 10 },
          { price: 99.5, size: 5, total: 15 },
        ],
        asks: [
          { price: 100.5, size: 10, total: 10 },
          { price: 101, size: 5, total: 15 },
        ],
      },
      instrument: { ticker: 'AAPL', cls: 'equity' },
      mid: 100.25,
      onOptionTrade: vi.fn(),
    };
    expect(() => render(<OrderBook {...props} />)).not.toThrow();
  });

  it('TradesList mounts', async () => {
    const { TradesList } = await import('../trading-panel.jsx');
    expect(() =>
      render(<TradesList instrument={{
        ticker: 'AAPL', cls: 'equity', mark: 150, dec: 2, id: 'AAPL',
      }} />)
    ).not.toThrow();
  });

  it('OptionsChain mounts', async () => {
    const { OptionsChain } = await import('../trading-panel.jsx');
    const props = {
      instrument: { ticker: 'AAPL', cls: 'equity' },
      spot: 150,
      onOptionTrade: vi.fn(),
    };
    expect(() => render(<OptionsChain {...props} />)).not.toThrow();
  });

  it('OrderEntry mounts', async () => {
    const { OrderEntry } = await import('../trading-panel.jsx');
    const props = {
      instrument: { ticker: 'AAPL', cls: 'equity', minTick: 0.01 },
      markPrice: 150,
      account: { positions: [], cash: 10000, orders: [] },
      user: { username: 'alice' },
      onOpenPosition: vi.fn(),
      initialSide: 'buy',
    };
    expect(() => render(<OrderEntry {...props} />)).not.toThrow();
  });
});
