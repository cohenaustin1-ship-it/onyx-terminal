// @vitest-environment jsdom
//
// IMO Onyx Terminal — Phase 3p.27 component smoke tests
//
// Tests the 12 Compact* tab components extracted from TradePage's
// bottom panel. All small (25-101 lines each) and only depend on
// COLORS from constants.

import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';

afterEach(() => cleanup());

describe('compact-tabs (Phase 3p.27)', () => {
  it('exports all 12 expected tab components', async () => {
    const m = await import('../compact-tabs.jsx');
    const expected = [
      'CompactPositions', 'CompactOrders', 'CompactHistory',
      'CompactChainEvents', 'CompactRisk', 'CompactSentiment',
      'CompactOptions', 'CompactTrends', 'CompactPriceAnalysis',
      'CompactESG', 'CompactMoat', 'CompactNewsTab',
    ];
    for (const name of expected) {
      expect(typeof m[name]).toBe('function');
    }
  });

  it('CompactPositions mounts', async () => {
    const { CompactPositions } = await import('../compact-tabs.jsx');
    const props = {
      account: { positions: [], cash: 1000 },
      markPrice: 150,
      instrument: { ticker: 'AAPL' },
    };
    expect(() => render(<CompactPositions {...props} />)).not.toThrow();
  });

  it('CompactOrders mounts with empty orders', async () => {
    const { CompactOrders } = await import('../compact-tabs.jsx');
    expect(() =>
      render(<CompactOrders account={{ orders: [] }} />)
    ).not.toThrow();
  });

  it('CompactOptions mounts', async () => {
    const { CompactOptions } = await import('../compact-tabs.jsx');
    const props = {
      instrument: { ticker: 'AAPL', cls: 'equity' },
      markPrice: 150,
    };
    expect(() => render(<CompactOptions {...props} />)).not.toThrow();
  });

  it('CompactSentiment mounts', async () => {
    const { CompactSentiment } = await import('../compact-tabs.jsx');
    expect(() =>
      render(<CompactSentiment instrument={{ ticker: 'AAPL' }} />)
    ).not.toThrow();
  });

  it('CompactNewsTab mounts', async () => {
    const { CompactNewsTab } = await import('../compact-tabs.jsx');
    expect(() =>
      render(<CompactNewsTab instrument={{ ticker: 'AAPL' }} />)
    ).not.toThrow();
  });
});
