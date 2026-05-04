// @vitest-environment jsdom
//
// IMO Onyx Terminal — TaxReportingPanel component test
//
// Verifies the panel renders correctly across input states:
//   - No trades → empty-state message
//   - With round-trips → year selector, summary table, export buttons
//   - Year selector picks years from the trade history
//   - Export buttons are disabled when no closed lots in selected year
//
// Note: file download (URL.createObjectURL + anchor click) is mocked
// in jsdom — we just verify the click handler is wired.

import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { TaxReportingPanel } from '../settings-panels.jsx';

afterEach(() => cleanup());

beforeEach(() => {
  // jsdom doesn't implement URL.createObjectURL — stub it so download works
  if (!URL.createObjectURL) {
    URL.createObjectURL = vi.fn(() => 'blob:mock');
  } else {
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:mock');
  }
  if (!URL.revokeObjectURL) {
    URL.revokeObjectURL = vi.fn();
  } else {
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  }
});

const ts = (year, month, day) => new Date(year, month - 1, day).getTime();

describe('<TaxReportingPanel />', () => {
  it('renders empty state when no trades are provided', () => {
    render(<TaxReportingPanel trades={[]} />);
    // "no trades" hint should be visible somewhere
    expect(screen.getByText(/no closed lots/i)).toBeDefined();
  });

  it('renders summary table when round-trips exist', () => {
    const trades = [
      { sym: 'AAPL', side: 'sell', size: 10, price: 175, time: ts(2024, 6, 15) },
      { sym: 'AAPL', side: 'buy',  size: 10, price: 150, time: ts(2024, 1, 10) },
    ];
    render(<TaxReportingPanel trades={trades} />);
    // Summary table headers
    expect(screen.getByText(/^count$/i)).toBeDefined();
    expect(screen.getByText(/^proceeds$/i)).toBeDefined();
    expect(screen.getByText(/cost basis/i)).toBeDefined();
    expect(screen.getByText(/gain ?\/ ?loss/i)).toBeDefined();
    // Three summary rows
    expect(screen.getByText('Short-term')).toBeDefined();
    expect(screen.getByText('Long-term')).toBeDefined();
    expect(screen.getByText('Total')).toBeDefined();
  });

  it('export buttons are enabled when there are closed lots', () => {
    const trades = [
      { sym: 'AAPL', side: 'sell', size: 10, price: 175, time: ts(2024, 6, 15) },
      { sym: 'AAPL', side: 'buy',  size: 10, price: 150, time: ts(2024, 1, 10) },
    ];
    render(<TaxReportingPanel trades={trades} />);
    const btn1099B = screen.getByRole('button', { name: /1099-?B/i });
    const btnSchedD = screen.getByRole('button', { name: /schedule d/i });
    expect(btn1099B.hasAttribute('disabled')).toBe(false);
    expect(btnSchedD.hasAttribute('disabled')).toBe(false);
  });

  it('export buttons are disabled with no trades', () => {
    render(<TaxReportingPanel trades={[]} />);
    const btn1099B = screen.getByRole('button', { name: /1099-?B/i });
    expect(btn1099B.hasAttribute('disabled')).toBe(true);
  });

  it('clicking 1099-B export triggers a CSV download', () => {
    const trades = [
      { sym: 'AAPL', side: 'sell', size: 10, price: 175, time: ts(2024, 6, 15) },
      { sym: 'AAPL', side: 'buy',  size: 10, price: 150, time: ts(2024, 1, 10) },
    ];
    render(<TaxReportingPanel trades={trades} />);
    const btn = screen.getByRole('button', { name: /1099-?B/i });
    fireEvent.click(btn);
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it('renders displayed gain in the totals row matching computed gain', () => {
    const trades = [
      { sym: 'AAPL', side: 'sell', size: 10, price: 175, time: ts(2024, 6, 15) },
      { sym: 'AAPL', side: 'buy',  size: 10, price: 150, time: ts(2024, 1, 10) },
    ];
    // Expected gain: 10 × ($175 - $150) = $250.00
    render(<TaxReportingPanel trades={trades} />);
    // Should appear at least once in formatted form
    const matches = screen.getAllByText(/\$250\.00/);
    expect(matches.length).toBeGreaterThan(0);
  });

  it('year dropdown contains every distinct sale year', () => {
    const trades = [
      { sym: 'AAPL', side: 'sell', size: 1, price: 100, time: ts(2024, 6, 1) },
      { sym: 'AAPL', side: 'buy',  size: 1, price: 90,  time: ts(2024, 1, 1) },
      { sym: 'MSFT', side: 'sell', size: 1, price: 400, time: ts(2023, 6, 1) },
      { sym: 'MSFT', side: 'buy',  size: 1, price: 380, time: ts(2023, 1, 1) },
    ];
    const { container } = render(<TaxReportingPanel trades={trades} />);
    const select = container.querySelector('select');
    expect(select).toBeDefined();
    const options = Array.from(select.querySelectorAll('option')).map(o => o.value);
    expect(options).toContain('2024');
    expect(options).toContain('2023');
  });

  it('changing year updates the visible summary', () => {
    const trades = [
      { sym: 'AAPL', side: 'sell', size: 10, price: 175, time: ts(2024, 6, 15) },
      { sym: 'AAPL', side: 'buy',  size: 10, price: 150, time: ts(2024, 1, 10) },
      { sym: 'MSFT', side: 'sell', size: 5,  price: 400, time: ts(2023, 6, 15) },
      { sym: 'MSFT', side: 'buy',  size: 5,  price: 350, time: ts(2023, 1, 10) },
    ];
    const { container } = render(<TaxReportingPanel trades={trades} />);
    const select = container.querySelector('select');
    // Default year should be 2024 (most recent). Switch to 2023.
    fireEvent.change(select, { target: { value: '2023' } });
    // 2023 gain: 5 × ($400 - $350) = $250
    expect(screen.getAllByText(/\$250\.00/).length).toBeGreaterThan(0);
  });

  it('shows the wash-sale honest-scope caveat', () => {
    render(<TaxReportingPanel trades={[]} />);
    // Phase 3p.09: wash sale IS detected, but cross-account / corp-action
    // adjustments aren't. The help text should mention wash sale either way.
    expect(screen.getByText(/wash sale/i)).toBeDefined();
  });
});

describe('<TaxReportingPanel /> wash-sale warnings', () => {
  it('shows wash-sale warning banner when there are flagged losses', () => {
    // Loss → re-buy within 30d → wash sale flagged
    const trades = [
      { sym: 'AAPL', side: 'buy',  size: 10, price: 200, time: ts(2024, 1, 10) },
      { sym: 'AAPL', side: 'sell', size: 10, price: 150, time: ts(2024, 6, 15) },
      { sym: 'AAPL', side: 'buy',  size: 10, price: 155, time: ts(2024, 6, 25) },
    ].reverse();
    render(<TaxReportingPanel trades={trades} />);
    expect(screen.getByText(/wash sale adjustment/i)).toBeDefined();
    // The disallowed amount should appear in the banner
    expect(screen.getAllByText(/\$500\.00/).length).toBeGreaterThan(0);
  });

  it('does NOT show wash-sale banner when no losses are flagged', () => {
    const trades = [
      { sym: 'AAPL', side: 'sell', size: 10, price: 175, time: ts(2024, 6, 15) },
      { sym: 'AAPL', side: 'buy',  size: 10, price: 150, time: ts(2024, 1, 10) },
    ];
    render(<TaxReportingPanel trades={trades} />);
    // No wash-sale banner should appear (only the help text mention)
    expect(screen.queryByText(/wash sale adjustment/i)).toBeNull();
  });
});
