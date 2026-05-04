// IMO Onyx Terminal — holdings reconciliation + corporate actions tests

import { describe, it, expect } from 'vitest';
import {
  buildHoldingsFromTrades,
  buildHoldingsReconciliation,
} from '../holdings-recon.js';
import {
  applyCorporateActions,
  validateAction,
  ACTION_TYPES,
  COMMON_SPLIT_HISTORY,
} from '../corporate-actions.js';

const ts = (year, month, day) => new Date(year, month - 1, day).getTime();

// ════════════════════════════════════════════════════════════════════
// Holdings reconciliation
// ════════════════════════════════════════════════════════════════════

describe('buildHoldingsFromTrades', () => {
  it('returns empty for no trades', () => {
    expect(buildHoldingsFromTrades([])).toEqual([]);
  });

  it('computes a single open position from one buy', () => {
    const trades = [
      { sym: 'AAPL', side: 'buy', size: 10, price: 150, time: ts(2024, 1, 10) },
    ];
    const h = buildHoldingsFromTrades(trades);
    expect(h).toHaveLength(1);
    expect(h[0].sym).toBe('AAPL');
    expect(h[0].qty).toBe(10);
    expect(h[0].avgCost).toBe(150);
  });

  it('blends avg cost across multiple buys', () => {
    const trades = [
      { sym: 'AAPL', side: 'buy', size: 10, price: 100, time: ts(2024, 1, 10) },
      { sym: 'AAPL', side: 'buy', size: 10, price: 200, time: ts(2024, 2, 10) },
    ];
    const h = buildHoldingsFromTrades(trades);
    expect(h[0].qty).toBe(20);
    expect(h[0].avgCost).toBeCloseTo(150);
  });

  it('reduces qty on FIFO sells', () => {
    const trades = [
      { sym: 'AAPL', side: 'buy',  size: 10, price: 100, time: ts(2024, 1, 10) },
      { sym: 'AAPL', side: 'buy',  size: 10, price: 200, time: ts(2024, 2, 10) },
      { sym: 'AAPL', side: 'sell', size: 8,  price: 175, time: ts(2024, 3, 10) },
    ];
    const h = buildHoldingsFromTrades(trades);
    // 8 sold from $100 lot → 2@$100 + 10@$200 remain
    expect(h[0].qty).toBe(12);
    expect(h[0].avgCost).toBeCloseTo((2 * 100 + 10 * 200) / 12);
  });

  it('omits fully-closed positions', () => {
    const trades = [
      { sym: 'AAPL', side: 'buy',  size: 10, price: 150, time: ts(2024, 1, 10) },
      { sym: 'AAPL', side: 'sell', size: 10, price: 175, time: ts(2024, 6, 10) },
    ];
    const h = buildHoldingsFromTrades(trades);
    expect(h).toEqual([]);
  });

  it('separates by ticker', () => {
    const trades = [
      { sym: 'AAPL', side: 'buy', size: 10, price: 150, time: ts(2024, 1, 10) },
      { sym: 'MSFT', side: 'buy', size: 5,  price: 400, time: ts(2024, 1, 10) },
    ];
    const h = buildHoldingsFromTrades(trades);
    expect(h).toHaveLength(2);
    expect(h.map(x => x.sym).sort()).toEqual(['AAPL', 'MSFT']);
  });
});

describe('buildHoldingsReconciliation', () => {
  it('returns empty rows when no accounts', () => {
    const r = buildHoldingsReconciliation({ accounts: [] });
    expect(r.rows).toEqual([]);
    expect(r.summary.totalSymbols).toBe(0);
    expect(r.discrepancies).toEqual([]);
  });

  it('aggregates qty across multiple brokers per symbol', () => {
    const accounts = [
      { broker: 'schwab',   holdings: [{ sym: 'AAPL', qty: 100, avgCost: 150, mark: 175 }] },
      { broker: 'fidelity', holdings: [{ sym: 'AAPL', qty: 50,  avgCost: 160, mark: 175 }] },
    ];
    const r = buildHoldingsReconciliation({ accounts });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].totalQty).toBe(150);
    expect(r.rows[0].brokerCount).toBe(2);
    // Blended avg cost: (100*150 + 50*160) / 150 = 153.33
    expect(r.rows[0].avgCostBlended).toBeCloseTo(153.33, 1);
    expect(r.rows[0].marketValue).toBeCloseTo(150 * 175);
  });

  it('flags multi-broker holdings in summary', () => {
    const accounts = [
      { broker: 'schwab',   holdings: [{ sym: 'AAPL', qty: 100 }] },
      { broker: 'fidelity', holdings: [{ sym: 'AAPL', qty: 50 }, { sym: 'MSFT', qty: 30 }] },
    ];
    const r = buildHoldingsReconciliation({ accounts });
    expect(r.summary.multiBrokerSymbols).toBe(1); // only AAPL
  });

  it('detects discrepancies between reported and computed qty', () => {
    const accounts = [
      { broker: 'schwab', holdings: [{ sym: 'AAPL', qty: 100 }] },
    ];
    // Trade history says we should have 90 shares, broker reports 100
    const computedFromTrades = {
      schwab: [{ sym: 'AAPL', qty: 90, avgCost: 150 }],
    };
    const r = buildHoldingsReconciliation({ accounts, computedFromTrades });
    expect(r.discrepancies).toHaveLength(1);
    expect(r.discrepancies[0].sym).toBe('AAPL');
    expect(r.discrepancies[0].broker).toBe('schwab');
    expect(r.discrepancies[0].delta).toBe(10);
    expect(r.discrepancies[0].severity).toBe('major');
  });

  it('flags sub-1% deltas as minor', () => {
    const accounts = [
      { broker: 'schwab', holdings: [{ sym: 'AAPL', qty: 1000.005 }] },
    ];
    const computedFromTrades = {
      schwab: [{ sym: 'AAPL', qty: 1000, avgCost: 150 }],
    };
    const r = buildHoldingsReconciliation({ accounts, computedFromTrades });
    expect(r.discrepancies[0].severity).toBe('minor');
  });

  it('does NOT flag discrepancy when reported and computed match', () => {
    const accounts = [
      { broker: 'schwab', holdings: [{ sym: 'AAPL', qty: 100 }] },
    ];
    const computedFromTrades = {
      schwab: [{ sym: 'AAPL', qty: 100, avgCost: 150 }],
    };
    const r = buildHoldingsReconciliation({ accounts, computedFromTrades });
    expect(r.discrepancies).toEqual([]);
  });

  it('summary totals match per-row aggregation', () => {
    const accounts = [
      { broker: 'schwab', holdings: [
          { sym: 'AAPL', qty: 100, avgCost: 150, mark: 175 },
          { sym: 'MSFT', qty: 50,  avgCost: 380, mark: 420 },
      ]},
    ];
    const r = buildHoldingsReconciliation({ accounts });
    expect(r.summary.totalSymbols).toBe(2);
    expect(r.summary.totalMarketValue).toBeCloseTo(100 * 175 + 50 * 420);
  });

  it('skips fully-closed positions across all brokers', () => {
    const accounts = [
      { broker: 'schwab',   holdings: [{ sym: 'AAPL', qty: 0 }] },
      { broker: 'fidelity', holdings: [{ sym: 'AAPL', qty: 0 }] },
    ];
    const r = buildHoldingsReconciliation({ accounts });
    expect(r.rows).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════
// Corporate actions
// ════════════════════════════════════════════════════════════════════

describe('validateAction', () => {
  it('accepts a valid forward split', () => {
    const r = validateAction({
      type: 'FORWARD_SPLIT', sym: 'AAPL',
      date: '2020-08-31', ratio: 4,
    });
    expect(r.ok).toBe(true);
  });

  it('rejects unknown type', () => {
    const r = validateAction({ type: 'UNKNOWN', sym: 'X', date: '2024-01-01' });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/type/);
  });

  it('requires sym', () => {
    const r = validateAction({ type: 'FORWARD_SPLIT', date: '2024-01-01', ratio: 2 });
    expect(r.ok).toBe(false);
  });

  it('requires positive ratio for splits', () => {
    const r = validateAction({ type: 'FORWARD_SPLIT', sym: 'X', date: '2024-01-01', ratio: 0 });
    expect(r.ok).toBe(false);
  });

  it('requires basisAllocationPct in [0,1] for spin-off', () => {
    const r = validateAction({
      type: 'SPIN_OFF', sym: 'X', date: '2024-01-01',
      newSym: 'Y', basisAllocationPct: 1.5, newSharesPerOldShare: 1,
    });
    expect(r.ok).toBe(false);
  });

  it('catches multiple errors at once', () => {
    const r = validateAction({});
    expect(r.errors.length).toBeGreaterThan(1);
  });

  it('null returns ok=false with sensible error', () => {
    const r = validateAction(null);
    expect(r.ok).toBe(false);
  });
});

describe('applyCorporateActions — splits', () => {
  it('FORWARD_SPLIT 4:1 quadruples qty and quarters basis', () => {
    const trades = [
      { sym: 'AAPL', side: 'buy', size: 10, price: 400, time: ts(2020, 1, 1) },
    ];
    const actions = [
      { type: 'FORWARD_SPLIT', sym: 'AAPL', date: '2020-08-31', ratio: 4 },
    ];
    const { adjustedTrades, realizedFromActions } = applyCorporateActions(trades, actions);
    expect(realizedFromActions).toEqual([]);
    // Compute holdings from adjusted trades — should show 40 sh @ $100
    const h = buildHoldingsFromTrades(adjustedTrades);
    expect(h[0].qty).toBe(40);
    expect(h[0].avgCost).toBeCloseTo(100);
  });

  it('REVERSE_SPLIT 1:8 divides qty and multiplies basis', () => {
    const trades = [
      { sym: 'GE', side: 'buy', size: 80, price: 10, time: ts(2021, 1, 1) },
    ];
    const actions = [
      { type: 'REVERSE_SPLIT', sym: 'GE', date: '2021-08-02', ratio: 8 },
    ];
    const { adjustedTrades } = applyCorporateActions(trades, actions);
    const h = buildHoldingsFromTrades(adjustedTrades);
    expect(h[0].qty).toBe(10);
    expect(h[0].avgCost).toBeCloseTo(80);
  });

  it('multiple sequential splits compose correctly (AAPL 7:1 then 4:1)', () => {
    const trades = [
      { sym: 'AAPL', side: 'buy', size: 1, price: 700, time: ts(2010, 1, 1) },
    ];
    const actions = [
      { type: 'FORWARD_SPLIT', sym: 'AAPL', date: '2014-06-09', ratio: 7 },
      { type: 'FORWARD_SPLIT', sym: 'AAPL', date: '2020-08-31', ratio: 4 },
    ];
    const { adjustedTrades } = applyCorporateActions(trades, actions);
    const h = buildHoldingsFromTrades(adjustedTrades);
    // 1 share → 7 shares → 28 shares
    expect(h[0].qty).toBe(28);
    // basis: 700 → 100 → 25
    expect(h[0].avgCost).toBeCloseTo(25);
  });

  it('action only affects lots OPEN at the effective date (sells before splits unaffected)', () => {
    const trades = [
      { sym: 'AAPL', side: 'buy',  size: 10, price: 100, time: ts(2020, 1, 1) },
      { sym: 'AAPL', side: 'sell', size: 5,  price: 110, time: ts(2020, 6, 1) },
      // Split happens AFTER the partial sell
    ];
    const actions = [
      { type: 'FORWARD_SPLIT', sym: 'AAPL', date: '2020-08-31', ratio: 2 },
    ];
    const { adjustedTrades } = applyCorporateActions(trades, actions);
    const h = buildHoldingsFromTrades(adjustedTrades);
    // 5 sh remaining at split → 10 sh post-split @ $50
    expect(h[0].qty).toBe(10);
    expect(h[0].avgCost).toBeCloseTo(50);
  });

  it('STOCK_DIVIDEND 5% bumps qty and dilutes basis', () => {
    const trades = [
      { sym: 'KO', side: 'buy', size: 100, price: 50, time: ts(2024, 1, 1) },
    ];
    const actions = [
      { type: 'STOCK_DIVIDEND', sym: 'KO', date: '2024-06-01', percentage: 5 },
    ];
    const { adjustedTrades } = applyCorporateActions(trades, actions);
    const h = buildHoldingsFromTrades(adjustedTrades);
    expect(h[0].qty).toBeCloseTo(105);
    // Basis spread: 100 * 50 / 105 ≈ 47.62
    expect(h[0].avgCost).toBeCloseTo(47.62, 1);
  });
});

describe('applyCorporateActions — mergers', () => {
  it('CASH_MERGER closes the position and emits a synthetic sell', () => {
    const trades = [
      { sym: 'XYZ', side: 'buy', size: 100, price: 50, time: ts(2023, 1, 1) },
    ];
    const actions = [
      { type: 'CASH_MERGER', sym: 'XYZ', date: '2024-06-01', cashPerShare: 75 },
    ];
    const { adjustedTrades, realizedFromActions } = applyCorporateActions(trades, actions);
    expect(realizedFromActions).toHaveLength(1);
    // Holdings should be empty now
    const h = buildHoldingsFromTrades(adjustedTrades);
    expect(h.find(x => x.sym === 'XYZ')).toBeUndefined();
    // The synthetic trade should be a sell at $75
    const synth = realizedFromActions[0].syntheticTrade;
    expect(synth.side).toBe('sell');
    expect(synth.size).toBe(100);
    expect(synth.price).toBe(75);
  });

  it('STOCK_MERGER replaces position with new ticker preserving basis', () => {
    const trades = [
      { sym: 'OLD', side: 'buy', size: 100, price: 50, time: ts(2023, 1, 1) },
    ];
    const actions = [
      { type: 'STOCK_MERGER', sym: 'OLD', date: '2024-06-01',
        newSym: 'NEW', exchangeRatio: 0.5 },
    ];
    const { adjustedTrades, realizedFromActions } = applyCorporateActions(trades, actions);
    expect(realizedFromActions).toEqual([]); // no realization
    const h = buildHoldingsFromTrades(adjustedTrades);
    expect(h.find(x => x.sym === 'OLD')).toBeUndefined();
    const newPos = h.find(x => x.sym === 'NEW');
    expect(newPos.qty).toBe(50);
    // Basis preserved: $5000 total / 50 sh = $100
    expect(newPos.avgCost).toBeCloseTo(100);
  });

  it('SPIN_OFF allocates basis between original and new ticker', () => {
    const trades = [
      { sym: 'PARENT', side: 'buy', size: 100, price: 100, time: ts(2023, 1, 1) },
    ];
    const actions = [
      { type: 'SPIN_OFF', sym: 'PARENT', date: '2024-06-01',
        newSym: 'CHILD', basisAllocationPct: 0.2, newSharesPerOldShare: 0.5 },
    ];
    const { adjustedTrades } = applyCorporateActions(trades, actions);
    const h = buildHoldingsFromTrades(adjustedTrades);
    const parent = h.find(x => x.sym === 'PARENT');
    const child  = h.find(x => x.sym === 'CHILD');
    expect(parent.qty).toBe(100);
    expect(parent.avgCost).toBeCloseTo(80); // 80% retained
    expect(child.qty).toBe(50);              // 100 * 0.5
    // Child basis = 20% of $10000 = $2000, /50 = $40
    expect(child.avgCost).toBeCloseTo(40);
  });

  it('CASH_AND_STOCK_MERGER splits proceeds between cash boot and stock', () => {
    // Held 100 sh OLD @ $50, total basis $5000.
    // Merger: 0.5 NEW per old share + $20 cash per old share.
    // basisCashAllocationPct = 0.4 → 40% of basis ($2000) allocated to cash.
    // Cash boot: 100 sh × $20 proceeds = $2000, basis $2000 → gain $0
    // Stock: 50 sh NEW with basis $3000 → $60/sh
    const trades = [
      { sym: 'OLD', side: 'buy', size: 100, price: 50, time: ts(2023, 1, 1) },
    ];
    const actions = [{
      type: 'CASH_AND_STOCK_MERGER', sym: 'OLD', date: '2024-06-01',
      newSym: 'NEW', exchangeRatio: 0.5, cashPerShare: 20,
      basisCashAllocationPct: 0.4,
    }];
    const { adjustedTrades, realizedFromActions } = applyCorporateActions(trades, actions);
    expect(realizedFromActions).toHaveLength(1);
    const h = buildHoldingsFromTrades(adjustedTrades);
    expect(h.find(x => x.sym === 'OLD')).toBeUndefined();
    const newPos = h.find(x => x.sym === 'NEW');
    expect(newPos.qty).toBe(50);
    expect(newPos.avgCost).toBeCloseTo(60);
  });

  it('CASH_AND_STOCK_MERGER produces correct gain through tax pipeline', async () => {
    const { buildTaxLotReport } = await import('../tax-reporting.js');
    // 100 sh OLD @ $50, merger gives 0.5 NEW + $30 cash, basisCashAllocationPct = 0.3
    // Cash boot proceeds: 100 × $30 = $3000
    // Cash boot basis:    100 × $50 × 0.3 = $1500
    // Cash boot gain:     $3000 - $1500 = $1500
    const trades = [
      { sym: 'OLD', side: 'buy', size: 100, price: 50, time: ts(2023, 1, 1) },
    ];
    const actions = [{
      type: 'CASH_AND_STOCK_MERGER', sym: 'OLD', date: '2024-06-01',
      newSym: 'NEW', exchangeRatio: 0.5, cashPerShare: 30,
      basisCashAllocationPct: 0.3,
    }];
    const { adjustedTrades } = applyCorporateActions(trades, actions);
    const report = buildTaxLotReport(adjustedTrades);
    expect(report.summary.total.gain).toBeCloseTo(1500);
  });

  it('CASH_AND_STOCK_MERGER with cashPct=0 transfers all basis to stock', () => {
    // Default basisCashAllocationPct (0) — pure stock basis carryover
    // 100 sh OLD @ $50 → 50 sh NEW @ $100, plus $20 × 100 cash with $0 basis
    // Cash boot becomes a $2000 gain (proceeds $2000, basis $0)
    const trades = [
      { sym: 'OLD', side: 'buy', size: 100, price: 50, time: ts(2023, 1, 1) },
    ];
    const actions = [{
      type: 'CASH_AND_STOCK_MERGER', sym: 'OLD', date: '2024-06-01',
      newSym: 'NEW', exchangeRatio: 0.5, cashPerShare: 20,
    }];
    const { adjustedTrades } = applyCorporateActions(trades, actions);
    const h = buildHoldingsFromTrades(adjustedTrades);
    const newPos = h.find(x => x.sym === 'NEW');
    expect(newPos.qty).toBe(50);
    expect(newPos.avgCost).toBeCloseTo(100); // full $5000 basis on 50 sh
  });

  it('CASH_AND_STOCK_MERGER validation requires all fields', () => {
    expect(validateAction({
      type: 'CASH_AND_STOCK_MERGER', sym: 'X', date: '2024-01-01',
      newSym: 'Y', exchangeRatio: 0.5, cashPerShare: 10,
    }).ok).toBe(true);
    expect(validateAction({
      type: 'CASH_AND_STOCK_MERGER', sym: 'X', date: '2024-01-01',
      newSym: 'Y', exchangeRatio: 0.5, // missing cashPerShare
    }).ok).toBe(false);
    expect(validateAction({
      type: 'CASH_AND_STOCK_MERGER', sym: 'X', date: '2024-01-01',
      cashPerShare: 10, exchangeRatio: 0.5, // missing newSym
    }).ok).toBe(false);
  });
});

describe('applyCorporateActions — edge cases', () => {
  it('returns trades unchanged when no actions provided', () => {
    const trades = [
      { sym: 'AAPL', side: 'buy', size: 10, price: 150, time: ts(2024, 1, 1) },
    ];
    const r = applyCorporateActions(trades, []);
    expect(r.adjustedTrades).toBe(trades); // same reference (no copy)
    expect(r.realizedFromActions).toEqual([]);
  });

  it('skips invalid actions silently', () => {
    const trades = [
      { sym: 'AAPL', side: 'buy', size: 10, price: 100, time: ts(2024, 1, 1) },
    ];
    const actions = [
      { type: 'BOGUS', sym: 'AAPL', date: '2024-06-01' }, // invalid type
      { type: 'FORWARD_SPLIT', sym: 'AAPL', date: '2024-06-01', ratio: 2 },
    ];
    const { adjustedTrades } = applyCorporateActions(trades, actions);
    const h = buildHoldingsFromTrades(adjustedTrades);
    expect(h[0].qty).toBe(20); // only the valid split applied
  });

  it('action with no matching open lots is a no-op', () => {
    const trades = [
      { sym: 'AAPL', side: 'buy', size: 10, price: 100, time: ts(2024, 1, 1) },
    ];
    const actions = [
      { type: 'FORWARD_SPLIT', sym: 'TSLA', date: '2024-06-01', ratio: 2 },
    ];
    const { adjustedTrades } = applyCorporateActions(trades, actions);
    const h = buildHoldingsFromTrades(adjustedTrades);
    expect(h[0].qty).toBe(10); // unchanged
  });
});

describe('COMMON_SPLIT_HISTORY registry', () => {
  it('contains AAPL 4:1 from 2020', () => {
    const aapl = COMMON_SPLIT_HISTORY.find(s => s.sym === 'AAPL');
    expect(aapl).toBeDefined();
    expect(aapl.ratio).toBe(4);
    expect(aapl.date).toBe('2020-08-31');
  });

  it('all entries pass validation', () => {
    for (const action of COMMON_SPLIT_HISTORY) {
      expect(validateAction(action).ok).toBe(true);
    }
  });
});

describe('Round-trip integration: corporate actions → tax pipeline', () => {
  it('split-adjusted trades produce correct realized gain', async () => {
    const { buildTaxLotReport } = await import('../tax-reporting.js');
    // Bought 10 shares AAPL @ $400 in 2020, then 4:1 split, then sold all 40 @ $150
    const trades = [
      { sym: 'AAPL', side: 'buy',  size: 10, price: 400, time: ts(2020, 1, 1) },
      { sym: 'AAPL', side: 'sell', size: 40, price: 150, time: ts(2024, 6, 1) },
    ];
    const actions = [
      { type: 'FORWARD_SPLIT', sym: 'AAPL', date: '2020-08-31', ratio: 4 },
    ];
    const { adjustedTrades } = applyCorporateActions(trades, actions);
    const report = buildTaxLotReport(adjustedTrades);
    // Without split adjustment: would compute gain on 10 sh @ $400 → 40 sh @ $150 = wrong
    // With split: cost basis becomes $100/sh, sold @ $150 → +$50 × 40 = +$2000
    expect(report.summary.total.gain).toBeCloseTo(2000);
    expect(report.summary.long.count).toBe(1); // long-term (>1 year)
  });
});
