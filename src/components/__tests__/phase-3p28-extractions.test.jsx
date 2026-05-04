// @vitest-environment jsdom
//
// IMO Onyx Terminal — Phase 3p.28 component smoke tests
//
// Tests the 27 *Mini widgets + TradeMiniView wrapper extracted to
// mini-widgets.jsx. Most widgets fetch live data so we mount them
// with minimal props to ensure no missing-reference regressions.

import React from 'react';
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';

// jsdom doesn't have ResizeObserver, but recharts requires it.
beforeAll(() => {
  global.ResizeObserver = global.ResizeObserver || class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => cleanup());

describe('mini-widgets (Phase 3p.28)', () => {
  it('exports the expected set of widgets', async () => {
    const m = await import('../mini-widgets.jsx');
    const expected = [
      'TradeMiniView',
      'VolumeProfileMini', 'NetFlowMini', 'DarkFlowMini',
      'SectorHeatMapMini', 'MarketMapMini', 'CompWidget',
      'TerminalMini', 'GainersLosersMini', 'VolSkewMini',
      'VolDriftMini', 'WSBSentimentMini', 'SECFilingsMini',
      'TreasuryRatesMini', 'MacroIndicatorsMini', 'LocalConditionsMini',
      'CorporateActionsMini', 'NewsFeedMini', 'PortfolioMini',
      'CalendarMini', 'SwapMini', 'AutopilotMini', 'VideoMini',
      'FeedMini', 'DiscussMini', 'WatchlistMini', 'PredictionsMini',
      'MessagesMini', 'AvatarMini', 'AvatarModeScaffold',
      'FundamentalsMini',
    ];
    for (const name of expected) {
      expect(typeof m[name]).toBe('function');
    }
  });

  it('TradeMiniView mounts as a generic wrapper', async () => {
    const { TradeMiniView } = await import('../mini-widgets.jsx');
    expect(() =>
      render(
        <TradeMiniView title="Test" onExpand={vi.fn()} onStack={vi.fn()}>
          <div>content</div>
        </TradeMiniView>
      )
    ).not.toThrow();
  });

  it('VolumeProfileMini mounts with an instrument', async () => {
    const { VolumeProfileMini } = await import('../mini-widgets.jsx');
    expect(() =>
      render(<VolumeProfileMini instrument={{ ticker: 'AAPL' }} />)
    ).not.toThrow();
  });

  it('TreasuryRatesMini mounts (no props)', async () => {
    const { TreasuryRatesMini } = await import('../mini-widgets.jsx');
    expect(() => render(<TreasuryRatesMini />)).not.toThrow();
  });

  it('CalendarMini mounts with account+user', async () => {
    const { CalendarMini } = await import('../mini-widgets.jsx');
    const props = {
      account: { positions: [], orders: [] },
      user: { username: 'alice' },
    };
    expect(() => render(<CalendarMini {...props} />)).not.toThrow();
  });

  it('AutopilotMini mounts', async () => {
    const { AutopilotMini } = await import('../mini-widgets.jsx');
    const props = {
      user: { username: 'alice' },
      account: { positions: [], cash: 1000 },
      onOpenPosition: vi.fn(),
    };
    expect(() => render(<AutopilotMini {...props} />)).not.toThrow();
  });

  it('FundamentalsMini mounts', async () => {
    const { FundamentalsMini } = await import('../mini-widgets.jsx');
    const props = {
      instrument: { ticker: 'AAPL' },
      onOpenFundamentals: vi.fn(),
    };
    expect(() => render(<FundamentalsMini {...props} />)).not.toThrow();
  });

  it('PortfolioMini mounts', async () => {
    const { PortfolioMini } = await import('../mini-widgets.jsx');
    const props = {
      account: { positions: [], cash: 1000 },
    };
    expect(() => render(<PortfolioMini {...props} />)).not.toThrow();
  });
});
