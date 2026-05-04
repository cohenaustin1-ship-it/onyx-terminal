// IMO Onyx Terminal — tax reporting tests
//
// Verifies 1099-B / Schedule D output is correctly classified
// (short vs long-term), proceeds/basis/gain compute correctly,
// CSV escapes properly, and tax year filtering works.

import { describe, it, expect } from 'vitest';
import {
  buildTaxLotReport,
  exportSchedule1099B,
  exportScheduleD,
  filterByTaxYear,
} from '../tax-reporting.js';

// Helper: build trades in REVERSE-chronological order (newest first)
// matching the buildRoundTrips API contract.
const ts = (year, month, day) => new Date(year, month - 1, day).getTime();

describe('buildTaxLotReport', () => {
  it('returns empty report for no trades', () => {
    const r = buildTaxLotReport([]);
    expect(r.rows).toEqual([]);
    expect(r.summary.total.count).toBe(0);
    expect(r.summary.total.gain).toBe(0);
  });

  it('builds a single round-trip row from a buy/sell pair', () => {
    const trades = [
      { sym: 'AAPL', side: 'sell', size: 100, price: 175, time: ts(2024, 6, 15) },
      { sym: 'AAPL', side: 'buy',  size: 100, price: 150, time: ts(2024, 1, 10) },
    ];
    const r = buildTaxLotReport(trades);
    expect(r.rows).toHaveLength(1);
    const row = r.rows[0];
    expect(row.ticker).toBe('AAPL');
    expect(row.qty).toBe(100);
    expect(row.proceeds).toBeCloseTo(17500);
    expect(row.basis).toBeCloseTo(15000);
    expect(row.gain).toBeCloseTo(2500);
    expect(row.acquiredDate).toBe('2024-01-10');
    expect(row.soldDate).toBe('2024-06-15');
  });

  it('classifies as short-term when held ≤ 1 year', () => {
    const trades = [
      { sym: 'AAPL', side: 'sell', size: 50, price: 200, time: ts(2024, 6, 15) },
      { sym: 'AAPL', side: 'buy',  size: 50, price: 150, time: ts(2024, 1, 10) },
    ];
    const r = buildTaxLotReport(trades);
    expect(r.rows[0].term).toBe('short');
  });

  it('classifies as long-term when held > 1 year', () => {
    const trades = [
      { sym: 'AAPL', side: 'sell', size: 50, price: 200, time: ts(2024, 6, 15) },
      { sym: 'AAPL', side: 'buy',  size: 50, price: 100, time: ts(2022, 1, 10) }, // 2.5y hold
    ];
    const r = buildTaxLotReport(trades);
    expect(r.rows[0].term).toBe('long');
  });

  it('handles a loss correctly (negative gain)', () => {
    const trades = [
      { sym: 'TSLA', side: 'sell', size: 10, price: 200, time: ts(2024, 12, 1) },
      { sym: 'TSLA', side: 'buy',  size: 10, price: 250, time: ts(2024, 6, 1) },
    ];
    const r = buildTaxLotReport(trades);
    expect(r.rows[0].gain).toBeCloseTo(-500);
    expect(r.rows[0].term).toBe('short');
  });

  it('aggregates summary correctly across short and long-term trips', () => {
    const trades = [
      // Long-term loss: bought 2020, sold 2024
      { sym: 'NFLX', side: 'sell', size: 5,  price: 400, time: ts(2024, 7, 1) },
      { sym: 'NFLX', side: 'buy',  size: 5,  price: 500, time: ts(2020, 6, 1) },
      // Short-term gain: same year
      { sym: 'AAPL', side: 'sell', size: 10, price: 175, time: ts(2024, 6, 15) },
      { sym: 'AAPL', side: 'buy',  size: 10, price: 150, time: ts(2024, 1, 10) },
    ];
    const r = buildTaxLotReport(trades);
    expect(r.rows.length).toBe(2);
    // Short-term: 10 × (175-150) = +250
    expect(r.summary.short.gain).toBeCloseTo(250);
    expect(r.summary.short.count).toBe(1);
    // Long-term: 5 × (400-500) = -500
    expect(r.summary.long.gain).toBeCloseTo(-500);
    expect(r.summary.long.count).toBe(1);
    // Total gain = 250 + (-500) = -250
    expect(r.summary.total.gain).toBeCloseTo(-250);
    expect(r.summary.total.count).toBe(2);
  });

  it('separates round-trips by ticker', () => {
    const trades = [
      { sym: 'AAPL', side: 'sell', size: 1, price: 175, time: ts(2024, 6, 15) },
      { sym: 'AAPL', side: 'buy',  size: 1, price: 150, time: ts(2024, 1, 10) },
      { sym: 'MSFT', side: 'sell', size: 1, price: 420, time: ts(2024, 6, 15) },
      { sym: 'MSFT', side: 'buy',  size: 1, price: 380, time: ts(2024, 1, 10) },
    ];
    const r = buildTaxLotReport(trades);
    expect(r.rows.length).toBe(2);
    const tickers = r.rows.map(row => row.ticker).sort();
    expect(tickers).toEqual(['AAPL', 'MSFT']);
  });

  it('FIFO-matches partial sells and reports two lots for one sale', () => {
    const trades = [
      // Sell 15 against 10@100 + 10@110 → lot A: 10 sh @100 → 10×(120-100)=200
      //                                  → lot B:  5 sh @110 →  5×(120-110)=50
      { sym: 'AAPL', side: 'sell', size: 15, price: 120, time: ts(2024, 6, 1) },
      { sym: 'AAPL', side: 'buy',  size: 10, price: 110, time: ts(2024, 4, 1) },
      { sym: 'AAPL', side: 'buy',  size: 10, price: 100, time: ts(2024, 1, 1) },
    ];
    const r = buildTaxLotReport(trades);
    expect(r.rows.length).toBe(2);
    const totalGain = r.rows.reduce((s, row) => s + row.gain, 0);
    expect(totalGain).toBeCloseTo(250); // 200 + 50
  });

  it('proceeds = qty × exitPrice and basis = qty × entryPrice', () => {
    const trades = [
      { sym: 'AAPL', side: 'sell', size: 7, price: 200.50, time: ts(2024, 6, 1) },
      { sym: 'AAPL', side: 'buy',  size: 7, price: 100.25, time: ts(2024, 1, 1) },
    ];
    const r = buildTaxLotReport(trades);
    expect(r.rows[0].proceeds).toBeCloseTo(7 * 200.50);
    expect(r.rows[0].basis).toBeCloseTo(7 * 100.25);
    expect(r.rows[0].gain).toBeCloseTo(7 * (200.50 - 100.25));
  });

  it('respects taxYear option in metadata', () => {
    const r = buildTaxLotReport([], { taxYear: 2024 });
    expect(r.taxYear).toBe(2024);
    expect(r.generatedAt).toBeGreaterThan(0);
  });
});

describe('filterByTaxYear', () => {
  const trades = [
    { sym: 'AAPL', side: 'sell', size: 1, price: 100, time: ts(2024, 6, 15) },
    { sym: 'AAPL', side: 'buy',  size: 1, price: 90,  time: ts(2024, 1, 10) },
    { sym: 'MSFT', side: 'sell', size: 1, price: 400, time: ts(2023, 11, 1) },
    { sym: 'MSFT', side: 'buy',  size: 1, price: 380, time: ts(2023, 1, 1) },
  ];

  it('subsets to a specific calendar year by sale date', () => {
    const full = buildTaxLotReport(trades);
    const fy24 = filterByTaxYear(full, 2024);
    expect(fy24.rows.length).toBe(1);
    expect(fy24.rows[0].ticker).toBe('AAPL');
  });

  it('recomputes summary against the filtered subset', () => {
    const full = buildTaxLotReport(trades);
    const fy23 = filterByTaxYear(full, 2023);
    expect(fy23.summary.total.gain).toBeCloseTo(20); // 1 × (400-380)
    expect(fy23.summary.short.count).toBe(1);
  });

  it('returns empty rows for a year with no sales', () => {
    const full = buildTaxLotReport(trades);
    const fy20 = filterByTaxYear(full, 2020);
    expect(fy20.rows).toEqual([]);
    expect(fy20.summary.total.count).toBe(0);
  });

  it('preserves original report when year is invalid', () => {
    const full = buildTaxLotReport(trades);
    expect(filterByTaxYear(full, NaN)).toBe(full);
    expect(filterByTaxYear(null, 2024)).toBeNull();
  });
});

describe('exportSchedule1099B', () => {
  it('produces a header-only CSV for empty report', () => {
    const r = buildTaxLotReport([]);
    const csv = exportSchedule1099B(r);
    expect(csv).toMatch(/^1a_Description,1b_DateAcquired,/);
    expect(csv.split('\r\n')).toHaveLength(1);
  });

  it('one row per closed lot in 1099-B column order', () => {
    const trades = [
      { sym: 'AAPL', side: 'sell', size: 100, price: 175, time: ts(2024, 6, 15) },
      { sym: 'AAPL', side: 'buy',  size: 100, price: 150, time: ts(2024, 1, 10) },
    ];
    const r = buildTaxLotReport(trades);
    const csv = exportSchedule1099B(r);
    const lines = csv.split('\r\n');
    expect(lines).toHaveLength(2); // header + 1 row
    expect(lines[1]).toContain('100 sh AAPL');
    expect(lines[1]).toContain('2024-01-10');
    expect(lines[1]).toContain('2024-06-15');
    expect(lines[1]).toContain('17500.00');
    expect(lines[1]).toContain('15000.00');
    expect(lines[1]).toContain('short-term');
    expect(lines[1]).toContain('2500.00');
  });

  it('escapes commas and quotes per RFC 4180', () => {
    // Synthesize a ticker with commas in its display name (degenerate case)
    const trades = [
      { sym: 'COMMA,IN,NAME', side: 'sell', size: 1, price: 100, time: ts(2024, 6, 1) },
      { sym: 'COMMA,IN,NAME', side: 'buy',  size: 1, price: 50,  time: ts(2024, 1, 1) },
    ];
    const r = buildTaxLotReport(trades);
    const csv = exportSchedule1099B(r);
    // The description cell with embedded commas must be quoted
    expect(csv).toMatch(/"1 sh COMMA,IN,NAME"/);
  });

  it('long-term and short-term are tagged correctly in the term column', () => {
    const trades = [
      // Long-term: bought 2020, sold 2024
      { sym: 'A', side: 'sell', size: 1, price: 200, time: ts(2024, 7, 1) },
      { sym: 'A', side: 'buy',  size: 1, price: 100, time: ts(2020, 6, 1) },
    ];
    const r = buildTaxLotReport(trades);
    const csv = exportSchedule1099B(r);
    expect(csv).toContain('long-term');
    expect(csv).not.toContain('short-term');
  });
});

describe('exportScheduleD', () => {
  it('produces 4-line CSV (header + short + long + total)', () => {
    const trades = [
      { sym: 'AAPL', side: 'sell', size: 10, price: 175, time: ts(2024, 6, 15) },
      { sym: 'AAPL', side: 'buy',  size: 10, price: 150, time: ts(2024, 1, 10) },
    ];
    const r = buildTaxLotReport(trades);
    const csv = exportScheduleD(r);
    const lines = csv.split('\r\n');
    expect(lines).toHaveLength(4);
    // Phase 3p.09: header now includes WashSaleAdj + GainAfterWash
    expect(lines[0]).toBe('Term,Count,Proceeds,CostBasis,GainLoss,WashSaleAdj,GainAfterWash');
    expect(lines[1]).toContain('Short-term');
    expect(lines[2]).toContain('Long-term');
    expect(lines[3]).toContain('Total');
  });

  it('totals match short + long rows', () => {
    const trades = [
      { sym: 'AAPL', side: 'sell', size: 10, price: 175, time: ts(2024, 6, 15) },
      { sym: 'AAPL', side: 'buy',  size: 10, price: 150, time: ts(2024, 1, 10) },
      { sym: 'NFLX', side: 'sell', size: 5,  price: 400, time: ts(2024, 7, 1) },
      { sym: 'NFLX', side: 'buy',  size: 5,  price: 500, time: ts(2020, 6, 1) },
    ];
    const r = buildTaxLotReport(trades);
    // Short gain: 10 × (175-150) = 250
    // Long gain: 5 × (400-500) = -500
    // Total: -250
    expect(r.summary.total.gain).toBeCloseTo(-250);
  });

  it('returns empty string for null report', () => {
    expect(exportScheduleD(null)).toBe('');
  });
});

describe('1099-B totals match Schedule D summary', () => {
  it('sum of per-lot gains in 1099-B equals Schedule D total gain', () => {
    const trades = [
      { sym: 'AAPL', side: 'sell', size: 10, price: 175, time: ts(2024, 6, 15) },
      { sym: 'AAPL', side: 'buy',  size: 10, price: 150, time: ts(2024, 1, 10) },
      { sym: 'MSFT', side: 'sell', size: 5,  price: 420, time: ts(2024, 8, 1) },
      { sym: 'MSFT', side: 'buy',  size: 5,  price: 400, time: ts(2024, 3, 1) },
      { sym: 'NFLX', side: 'sell', size: 1,  price: 600, time: ts(2024, 9, 1) },
      { sym: 'NFLX', side: 'buy',  size: 1,  price: 500, time: ts(2020, 9, 1) },
    ];
    const r = buildTaxLotReport(trades);
    const perLotSum = r.rows.reduce((s, row) => s + row.gain, 0);
    expect(perLotSum).toBeCloseTo(r.summary.total.gain);
    // Sanity: it's the sum we'd compute by hand
    // AAPL: 10×25 = 250 (short)
    // MSFT:  5×20 = 100 (short)
    // NFLX:  1×100 = 100 (long)
    // Total 450
    expect(r.summary.total.gain).toBeCloseTo(450);
    expect(r.summary.short.gain).toBeCloseTo(350);
    expect(r.summary.long.gain).toBeCloseTo(100);
  });
});

// ════════════════════════════════════════════════════════════════════
// Phase 3p.09 — Wash-sale detection tests
// ════════════════════════════════════════════════════════════════════
import { detectWashSales } from '../tax-reporting.js';
import { buildRoundTrips } from '../quant/quant-misc.js';

const dayMs = 86400000;

describe('detectWashSales', () => {
  it('returns empty Map for empty input', () => {
    expect(detectWashSales([], [])).toBeInstanceOf(Map);
    expect(detectWashSales([], []).size).toBe(0);
  });

  it('does NOT flag a clean profitable round-trip', () => {
    // Buy AAPL@150, sell @175 — profit, no wash sale possible
    const trades = [
      { sym: 'AAPL', side: 'sell', size: 10, price: 175, time: ts(2024, 6, 15) },
      { sym: 'AAPL', side: 'buy',  size: 10, price: 150, time: ts(2024, 1, 10) },
    ];
    const r = buildTaxLotReport(trades);
    expect(r.rows[0].code).toBe('');
    expect(r.rows[0].washSaleAdj).toBe(0);
  });

  it('does NOT flag a loss with no replacement buy', () => {
    // Buy AAPL @ 200, sell @ 150 — loss, but no replacement
    const trades = [
      { sym: 'AAPL', side: 'sell', size: 10, price: 150, time: ts(2024, 6, 15) },
      { sym: 'AAPL', side: 'buy',  size: 10, price: 200, time: ts(2024, 1, 10) },
    ];
    const r = buildTaxLotReport(trades);
    expect(r.rows[0].gain).toBeCloseTo(-500);
    expect(r.rows[0].code).toBe('');
    expect(r.rows[0].washSaleAdj).toBe(0);
  });

  it('FLAGS a loss when same ticker repurchased within 30 days AFTER sale', () => {
    // Sell at loss June 15, re-buy same ticker June 25 (within 30d)
    const trades = [
      { sym: 'AAPL', side: 'buy',  size: 10, price: 200, time: ts(2024, 1, 10) },
      { sym: 'AAPL', side: 'sell', size: 10, price: 150, time: ts(2024, 6, 15) },
      { sym: 'AAPL', side: 'buy',  size: 10, price: 155, time: ts(2024, 6, 25) },
    ].reverse(); // newest-first per buildRoundTrips contract
    const r = buildTaxLotReport(trades);
    const lossRow = r.rows.find(row => row.gain < 0);
    expect(lossRow).toBeDefined();
    expect(lossRow.code).toBe('W');
    expect(lossRow.washSaleAdj).toBeCloseTo(500); // |loss|
    expect(lossRow.replacementSym).toBe('AAPL');
  });

  it('FLAGS a loss when same ticker repurchased within 30 days BEFORE sale', () => {
    // Buy May 25 (within 30d before sale), buy original Jan 10, sell at loss June 15
    const trades = [
      { sym: 'AAPL', side: 'buy',  size: 10, price: 200, time: ts(2024, 1, 10) },
      { sym: 'AAPL', side: 'buy',  size: 10, price: 195, time: ts(2024, 5, 25) },
      { sym: 'AAPL', side: 'sell', size: 10, price: 150, time: ts(2024, 6, 15) },
    ].reverse();
    const r = buildTaxLotReport(trades);
    // First sold lot (FIFO Jan 10 buy) is the one we examine
    const lossRow = r.rows[0];
    expect(lossRow.code).toBe('W');
    expect(lossRow.washSaleAdj).toBeGreaterThan(0);
    expect(lossRow.replacementSym).toBe('AAPL');
  });

  it('does NOT flag a loss when replacement is OUTSIDE the 30-day window', () => {
    // Buy AAPL Jan 10 @ 200, sell @ 150 May 1, re-buy 35 days later (June 5)
    const trades = [
      { sym: 'AAPL', side: 'buy',  size: 10, price: 200, time: ts(2024, 1, 10) },
      { sym: 'AAPL', side: 'sell', size: 10, price: 150, time: ts(2024, 5, 1) },
      { sym: 'AAPL', side: 'buy',  size: 10, price: 155, time: ts(2024, 6, 5) }, // 35 days later
    ].reverse();
    const r = buildTaxLotReport(trades);
    const lossRow = r.rows.find(row => row.gain < 0);
    expect(lossRow.code).toBe('');
    expect(lossRow.washSaleAdj).toBe(0);
  });

  it('FLAGS wash sale when substantially-identical ETF is bought (SPY → IVV)', () => {
    // Sell SPY at a loss, then immediately buy IVV (S&P tracker)
    const trades = [
      { sym: 'SPY', side: 'buy',  size: 100, price: 500, time: ts(2024, 1, 10) },
      { sym: 'SPY', side: 'sell', size: 100, price: 450, time: ts(2024, 6, 15) },
      { sym: 'IVV', side: 'buy',  size: 100, price: 451, time: ts(2024, 6, 20) },
    ].reverse();
    const r = buildTaxLotReport(trades);
    const lossRow = r.rows.find(row => row.gain < 0);
    expect(lossRow.code).toBe('W');
    expect(lossRow.replacementSym).toBe('IVV');
    expect(lossRow.washSaleAdj).toBeCloseTo(5000); // |loss|
  });

  it('FLAGS wash sale across QQQ → QQQM substantially-identical pair', () => {
    const trades = [
      { sym: 'QQQ',  side: 'buy',  size: 50, price: 400, time: ts(2024, 1, 10) },
      { sym: 'QQQ',  side: 'sell', size: 50, price: 350, time: ts(2024, 6, 15) },
      { sym: 'QQQM', side: 'buy',  size: 50, price: 351, time: ts(2024, 7, 1) }, // 16 days
    ].reverse();
    const r = buildTaxLotReport(trades);
    const lossRow = r.rows.find(row => row.gain < 0);
    expect(lossRow.code).toBe('W');
    expect(lossRow.replacementSym).toBe('QQQM');
  });

  it('does NOT flag when replacement is unrelated (XLK → XLF)', () => {
    // Sell tech sector ETF, buy financials sector — different exposures
    const trades = [
      { sym: 'XLK', side: 'buy',  size: 100, price: 200, time: ts(2024, 1, 10) },
      { sym: 'XLK', side: 'sell', size: 100, price: 150, time: ts(2024, 6, 15) },
      { sym: 'XLF', side: 'buy',  size: 100, price: 40,  time: ts(2024, 6, 20) },
    ].reverse();
    const r = buildTaxLotReport(trades);
    const lossRow = r.rows.find(row => row.gain < 0);
    expect(lossRow.code).toBe('');
    expect(lossRow.washSaleAdj).toBe(0);
  });

  it('summary aggregates washSaleAdj and gainAfterWash correctly', () => {
    // Two losses: one wash-sale-flagged, one clean
    const trades = [
      // Wash-sale loss: -500, flagged
      { sym: 'AAPL', side: 'buy',  size: 10, price: 200, time: ts(2024, 1, 10) },
      { sym: 'AAPL', side: 'sell', size: 10, price: 150, time: ts(2024, 6, 15) },
      { sym: 'AAPL', side: 'buy',  size: 10, price: 155, time: ts(2024, 6, 25) },
      // Clean loss: -300, allowed
      { sym: 'NVDA', side: 'buy',  size: 5,  price: 800, time: ts(2024, 1, 10) },
      { sym: 'NVDA', side: 'sell', size: 5,  price: 740, time: ts(2024, 6, 15) },
      // Gain: +200
      { sym: 'MSFT', side: 'buy',  size: 5,  price: 380, time: ts(2024, 1, 10) },
      { sym: 'MSFT', side: 'sell', size: 5,  price: 420, time: ts(2024, 6, 15) },
    ].reverse();
    const r = buildTaxLotReport(trades);
    // Total raw gain = -500 + -300 + 200 = -600
    // Wash-sale adj = 500 (only the AAPL loss)
    // GainAfterWash = -600 + 500 = -100 (only NVDA's -300 + MSFT's +200 are recognized)
    expect(r.summary.total.gain).toBeCloseTo(-600);
    expect(r.summary.total.washSaleAdj).toBeCloseTo(500);
    expect(r.summary.total.gainAfterWash).toBeCloseTo(-100);
  });

  it('1099-B export shows W code in the 1g column for wash-flagged rows', () => {
    const trades = [
      { sym: 'AAPL', side: 'buy',  size: 10, price: 200, time: ts(2024, 1, 10) },
      { sym: 'AAPL', side: 'sell', size: 10, price: 150, time: ts(2024, 6, 15) },
      { sym: 'AAPL', side: 'buy',  size: 10, price: 155, time: ts(2024, 6, 25) },
    ].reverse();
    const r = buildTaxLotReport(trades);
    const csv = exportSchedule1099B(r);
    // The wash-sale row should have W in the code column AND a non-zero
    // disallowed amount in the 1f column (washSaleAdj)
    const dataLines = csv.split('\r\n').slice(1); // skip header
    const washLine = dataLines.find(l => l.includes(',W,'));
    expect(washLine).toBeDefined();
    expect(washLine).toContain('500.00'); // disallowed amount
  });

  it('Schedule D export shows positive WashSaleAdj column when applicable', () => {
    const trades = [
      { sym: 'AAPL', side: 'buy',  size: 10, price: 200, time: ts(2024, 1, 10) },
      { sym: 'AAPL', side: 'sell', size: 10, price: 150, time: ts(2024, 6, 15) },
      { sym: 'AAPL', side: 'buy',  size: 10, price: 155, time: ts(2024, 6, 25) },
    ].reverse();
    const r = buildTaxLotReport(trades);
    const csv = exportScheduleD(r);
    expect(csv).toContain('WashSaleAdj');
    // Total row should show 500.00 in the WashSaleAdj column
    const lines = csv.split('\r\n');
    const totalLine = lines.find(l => l.startsWith('Total,'));
    expect(totalLine).toContain('500.00');
  });

  it('does NOT count the original entry buy as a "replacement" (avoids self-trigger)', () => {
    // Single buy → single sell at loss, no other buys.
    // The original buy must NOT be treated as a replacement of itself.
    const trades = [
      { sym: 'AAPL', side: 'buy',  size: 10, price: 200, time: ts(2024, 6, 1) },
      { sym: 'AAPL', side: 'sell', size: 10, price: 150, time: ts(2024, 6, 15) }, // 14 days later
    ].reverse();
    const r = buildTaxLotReport(trades);
    expect(r.rows[0].gain).toBeCloseTo(-500);
    // Even though the buy is within 30 days of the sale, it IS the
    // entry of this exact trip — not a replacement. Should NOT flag.
    expect(r.rows[0].code).toBe('');
    expect(r.rows[0].washSaleAdj).toBe(0);
  });
});
