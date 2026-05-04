// @vitest-environment jsdom
//
// IMO Onyx Terminal — TLHRecommendationsPanel component test

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { TLHRecommendationsPanel } from '../settings-panels.jsx';

afterEach(() => cleanup());

const ts = (year, month, day) => new Date(year, month - 1, day).getTime();

describe('<TLHRecommendationsPanel />', () => {
  it('renders empty state when there are no positions', () => {
    render(<TLHRecommendationsPanel positions={[]} recentTrades={[]} />);
    expect(screen.getByText(/no harvestable losses/i)).toBeDefined();
  });

  it('renders empty state when all positions are profitable', () => {
    const positions = [
      { sym: 'AAPL', qty: 10, avgCost: 150, mark: 175 },
      { sym: 'MSFT', qty: 5,  avgCost: 380, mark: 420 },
    ];
    render(<TLHRecommendationsPanel positions={positions} recentTrades={[]} />);
    expect(screen.getByText(/no harvestable losses/i)).toBeDefined();
  });

  it('renders summary KPIs when there are loss positions', () => {
    const positions = [
      { sym: 'AAPL', qty: 10, avgCost: 200, mark: 150 }, // -$500
    ];
    render(<TLHRecommendationsPanel positions={positions} recentTrades={[]} />);
    expect(screen.getByText(/candidates/i)).toBeDefined();
    expect(screen.getByText(/total harvestable/i)).toBeDefined();
    expect(screen.getByText(/risky/i)).toBeDefined();
  });

  it('shows the harvestable loss amount in the position card', () => {
    const positions = [
      { sym: 'AAPL', qty: 10, avgCost: 200, mark: 150 },
    ];
    render(<TLHRecommendationsPanel positions={positions} recentTrades={[]} />);
    // Should appear as a negative red number
    expect(screen.getAllByText(/\$500\.00/).length).toBeGreaterThan(0);
  });

  it('shows replacement candidates for ETF tickers with curated swaps', () => {
    const positions = [
      { sym: 'SPY', qty: 100, avgCost: 500, mark: 450 },
    ];
    render(<TLHRecommendationsPanel positions={positions} recentTrades={[]} />);
    expect(screen.getByText(/replacements:/i)).toBeDefined();
    // Should show at least one of the curated alternatives
    const html = document.body.innerHTML;
    expect(/VTI|ITOT|RSP|VV|SCHB|SCHX/.test(html)).toBe(true);
  });

  it('shows individual-stock note for tickers without curated swaps', () => {
    const positions = [
      { sym: 'AAPL', qty: 100, avgCost: 200, mark: 150 },
    ];
    render(<TLHRecommendationsPanel positions={positions} recentTrades={[]} />);
    // The fallback note for individual stocks
    expect(screen.getByText(/individual stocks/i)).toBeDefined();
  });

  it('shows wash-sale warning when there is a recent same-ticker buy', () => {
    const positions = [
      { sym: 'AAPL', qty: 10, avgCost: 200, mark: 150 },
    ];
    const recentTrades = [
      { sym: 'AAPL', side: 'buy', size: 5, price: 160, time: Date.now() - 5 * 86400000 },
    ];
    render(<TLHRecommendationsPanel positions={positions} recentTrades={recentTrades} />);
    expect(screen.getByText(/would be a wash sale/i)).toBeDefined();
  });

  it('does NOT show wash-sale warning for clean positions', () => {
    const positions = [
      { sym: 'AAPL', qty: 10, avgCost: 200, mark: 150 },
    ];
    render(<TLHRecommendationsPanel positions={positions} recentTrades={[]} />);
    expect(screen.queryByText(/would be a wash sale/i)).toBeNull();
  });

  it('shows estimated tax savings at multiple bracket points', () => {
    const positions = [
      { sym: 'TSLA', qty: 10, avgCost: 200, mark: 100 }, // -$1,000 loss
    ];
    render(<TLHRecommendationsPanel positions={positions} recentTrades={[]} />);
    expect(screen.getByText(/22%/)).toBeDefined();
    expect(screen.getByText(/32%/)).toBeDefined();
    expect(screen.getByText(/15%/)).toBeDefined();
  });

  it('sorts position cards by largest loss first', () => {
    const positions = [
      { sym: 'AAA', qty: 1, avgCost: 1000, mark: 700 },  // -$300
      { sym: 'BBB', qty: 1, avgCost: 1000, mark: 100 },  // -$900 (biggest)
      { sym: 'CCC', qty: 1, avgCost: 1000, mark: 500 },  // -$500
    ];
    const { container } = render(<TLHRecommendationsPanel positions={positions} recentTrades={[]} />);
    // Find all ticker headers in render order
    const html = container.innerHTML;
    const idxA = html.indexOf('AAA');
    const idxB = html.indexOf('BBB');
    const idxC = html.indexOf('CCC');
    // BBB (largest loss) should appear first, then CCC, then AAA
    expect(idxB).toBeGreaterThan(0);
    expect(idxB).toBeLessThan(idxC);
    expect(idxC).toBeLessThan(idxA);
  });

  it('handles position field aliases (avgCost vs entry vs costBasis)', () => {
    // The monolith uses different field names depending on the code path.
    // Panel must accept all of them.
    const positions = [
      { sym: 'AAA', qty: 10, entry: 200,    mark: 150 },
      { sym: 'BBB', qty: 10, costBasis: 200, mark: 150 },
      { sym: 'CCC', qty: 10, avgCost: 200,   price: 150 }, // mark via 'price'
    ];
    render(<TLHRecommendationsPanel positions={positions} recentTrades={[]} />);
    expect(screen.getByText('AAA')).toBeDefined();
    expect(screen.getByText('BBB')).toBeDefined();
    expect(screen.getByText('CCC')).toBeDefined();
  });
});
