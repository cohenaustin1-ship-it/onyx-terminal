// @vitest-environment jsdom
//
// IMO Onyx Terminal — Phase 3p.22 component smoke tests
//
// Same pattern as 3p.19/3p.20/3p.21: jsdom-rendered minimal-props
// mounts to catch missing-reference regressions.

import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';

afterEach(() => cleanup());

describe('MarketScreenerModal (Phase 3p.22)', () => {
  it('mounts without throwing', async () => {
    const { MarketScreenerModal } = await import('../market-screener-modal.jsx');
    const props = {
      onClose: vi.fn(),
      onAdd: vi.fn(),
      onSelect: vi.fn(),
      watchedTickers: [],
    };
    expect(() => render(<MarketScreenerModal {...props} />)).not.toThrow();
  });

  it('mounts with a populated watchlist', async () => {
    const { MarketScreenerModal } = await import('../market-screener-modal.jsx');
    const props = {
      onClose: vi.fn(),
      onAdd: vi.fn(),
      onSelect: vi.fn(),
      watchedTickers: ['AAPL', 'MSFT', 'NVDA'],
    };
    expect(() => render(<MarketScreenerModal {...props} />)).not.toThrow();
  });
});

describe('PerPositionAlphaDecompositionPanel (Phase 3p.22)', () => {
  it('mounts with empty inputs', async () => {
    const { PerPositionAlphaDecompositionPanel } =
      await import('../per-position-alpha-decomposition-panel.jsx');
    expect(() => render(
      <PerPositionAlphaDecompositionPanel augmented={[]} benchmarkReturns={[]} />
    )).not.toThrow();
  });

  it('mounts with a small position list', async () => {
    const { PerPositionAlphaDecompositionPanel } =
      await import('../per-position-alpha-decomposition-panel.jsx');
    const augmented = [
      { id: 'AAPL', cls: 'equity', qty: 10, avgPx: 180, mark: 195, name: 'Apple Inc.' },
      { id: 'MSFT', cls: 'equity', qty: 5,  avgPx: 380, mark: 410, name: 'Microsoft' },
    ];
    const benchmarkReturns = Array.from({ length: 60 }, () => (Math.random() - 0.5) * 0.02);
    expect(() => render(
      <PerPositionAlphaDecompositionPanel augmented={augmented} benchmarkReturns={benchmarkReturns} />
    )).not.toThrow();
  });
});
