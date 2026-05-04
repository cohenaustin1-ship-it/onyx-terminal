// IMO Onyx Terminal — trade journal + broker import tests

import { describe, it, expect } from 'vitest';
import { exportTradeJournalCSV } from '../trade-journal.js';
import { parseBrokerCSV, detectCSVFormat } from '../broker-import.js';

const ts = (year, month, day) => new Date(year, month - 1, day).getTime();

describe('exportTradeJournalCSV', () => {
  it('produces header-only CSV for empty input', () => {
    const csv = exportTradeJournalCSV([]);
    expect(csv).toMatch(/^timestamp,iso_time,symbol,side,qty,price,/);
    expect(csv.split('\r\n')).toHaveLength(1);
  });

  it('one row per trade in newest-first order', () => {
    const trades = [
      { sym: 'AAPL', side: 'buy',  size: 10, price: 150, time: ts(2024, 1, 10) },
      { sym: 'AAPL', side: 'sell', size: 10, price: 175, time: ts(2024, 6, 15) },
    ];
    const csv = exportTradeJournalCSV(trades);
    const lines = csv.split('\r\n');
    expect(lines).toHaveLength(3); // header + 2 rows
    // Newest first → sell row before buy row
    expect(lines[1]).toContain('sell');
    expect(lines[2]).toContain('buy');
  });

  it('includes notional (qty * price)', () => {
    const trades = [
      { sym: 'AAPL', side: 'buy', size: 10, price: 175, time: ts(2024, 6, 15) },
    ];
    const csv = exportTradeJournalCSV(trades);
    expect(csv).toContain('1750.00'); // notional
  });

  it('respects fromTs / toTs window', () => {
    const trades = [
      { sym: 'AAPL', side: 'buy', size: 1, price: 100, time: ts(2023, 1, 1) },
      { sym: 'AAPL', side: 'buy', size: 1, price: 100, time: ts(2024, 6, 1) },
      { sym: 'AAPL', side: 'buy', size: 1, price: 100, time: ts(2025, 1, 1) },
    ];
    const csv = exportTradeJournalCSV(trades, {
      fromTs: ts(2024, 1, 1),
      toTs:   ts(2024, 12, 31),
    });
    expect(csv.split('\r\n')).toHaveLength(2); // header + 1 row
    expect(csv).toContain('2024-06-01');
  });

  it('falls back gracefully for missing optional fields', () => {
    const trades = [
      { sym: 'BTC-PERP', side: 'buy', size: 0.5, price: 60000, time: ts(2024, 6, 1) },
    ];
    const csv = exportTradeJournalCSV(trades);
    // No fee/pnl/order_id/notes — should still produce a valid row
    const lines = csv.split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('BTC-PERP');
    expect(lines[1]).toContain('paper'); // default account
  });

  it('escapes commas in notes per RFC 4180', () => {
    const trades = [
      { sym: 'AAPL', side: 'buy', size: 1, price: 100, time: ts(2024, 6, 1),
        notes: 'Bought after, considering, market open' },
    ];
    const csv = exportTradeJournalCSV(trades);
    expect(csv).toContain('"Bought after, considering, market open"');
  });
});

describe('detectCSVFormat', () => {
  it('detects Schwab format', () => {
    const header = '"Date","Action","Symbol","Description","Quantity","Price","Fees & Comm","Amount"';
    expect(detectCSVFormat(header)).toBe('schwab');
  });

  it('detects Fidelity format', () => {
    const header = '"Run Date","Account","Action","Symbol","Quantity","Price","Commission","Settlement Date"';
    expect(detectCSVFormat(header)).toBe('fidelity');
  });

  it('detects Robinhood format', () => {
    const header = '"Activity Date","Process Date","Settle Date","Instrument","Trans Code","Quantity","Price","Amount"';
    expect(detectCSVFormat(header)).toBe('robinhood');
  });

  it('falls back to generic for unknown formats', () => {
    expect(detectCSVFormat('symbol,side,qty,price,date')).toBe('generic');
  });

  it('returns generic for empty header', () => {
    expect(detectCSVFormat('')).toBe('generic');
    expect(detectCSVFormat(null)).toBe('generic');
  });
});

describe('parseBrokerCSV — Schwab format', () => {
  const SCHWAB_CSV = `"Date","Action","Symbol","Description","Quantity","Price","Fees & Comm","Amount"
"06/15/2024","Buy","AAPL","APPLE INC","100","175.50","1.00","-17551.00"
"06/20/2024","Sell","AAPL","APPLE INC","100","185.00","1.00","18499.00"
"07/01/2024","Bank Interest","","","","","","2.50"`;

  it('parses buys and sells with correct fields', () => {
    const r = parseBrokerCSV(SCHWAB_CSV);
    expect(r.format).toBe('schwab');
    expect(r.trades).toHaveLength(2);
    const buy = r.trades.find(t => t.side === 'buy');
    expect(buy.sym).toBe('AAPL');
    expect(buy.size).toBe(100);
    expect(buy.price).toBe(175.50);
    expect(buy.broker).toBe('schwab');
    expect(buy.fee).toBe(1);
  });

  it('skips non-trade rows (Bank Interest)', () => {
    const r = parseBrokerCSV(SCHWAB_CSV);
    expect(r.trades.find(t => t.sym === '')).toBeUndefined();
  });

  it('parses dates correctly from MM/DD/YYYY format', () => {
    const r = parseBrokerCSV(SCHWAB_CSV);
    const buy = r.trades.find(t => t.side === 'buy');
    const expectedTs = new Date(2024, 5, 15).getTime(); // June 15
    expect(buy.time).toBe(expectedTs);
  });
});

describe('parseBrokerCSV — Robinhood format', () => {
  const RH_CSV = `"Activity Date","Process Date","Settle Date","Instrument","Description","Trans Code","Quantity","Price","Amount"
"6/15/2024","6/15/2024","6/17/2024","TSLA","TESLA INC","Buy","10","220.00","-2200.00"
"6/20/2024","6/20/2024","6/22/2024","TSLA","TESLA INC","Sell","10","250.00","2500.00"
"6/30/2024","6/30/2024","6/30/2024","CASH","DIVIDEND","CDIV","","","100.00"`;

  it('parses Robinhood Buy and Sell codes', () => {
    const r = parseBrokerCSV(RH_CSV);
    expect(r.format).toBe('robinhood');
    expect(r.trades).toHaveLength(2);
    expect(r.trades.every(t => t.broker === 'robinhood')).toBe(true);
  });

  it('skips dividend (CDIV) rows', () => {
    const r = parseBrokerCSV(RH_CSV);
    expect(r.trades.find(t => t.sym === 'CASH')).toBeUndefined();
  });
});

describe('parseBrokerCSV — generic fallback', () => {
  const GENERIC = `symbol,side,quantity,price,date
AAPL,Buy,100,150.00,2024-01-15
MSFT,Sell,50,400.00,2024-06-15`;

  it('parses with common column names when format is unknown', () => {
    const r = parseBrokerCSV(GENERIC);
    expect(r.format).toBe('generic');
    expect(r.trades).toHaveLength(2);
    expect(r.trades.find(t => t.sym === 'AAPL').side).toBe('buy');
  });
});

describe('parseBrokerCSV — edge cases', () => {
  it('returns empty result for empty input', () => {
    const r = parseBrokerCSV('');
    expect(r.trades).toEqual([]);
    expect(r.skipped).toEqual([]);
  });

  it('returns empty for header-only CSV', () => {
    const r = parseBrokerCSV('symbol,side,qty,price');
    expect(r.trades).toEqual([]);
  });

  it('collects skipped lines when warnOnSkip is true', () => {
    const csv = `"Date","Action","Symbol","Quantity","Price","Fees & Comm","Amount"
"06/15/2024","Buy","AAPL","100","175.50","1.00","-17551.00"
"07/01/2024","Bank Interest","","","","","2.50"`;
    const r = parseBrokerCSV(csv, { warnOnSkip: true });
    expect(r.trades).toHaveLength(1);
    expect(r.skipped.length).toBeGreaterThan(0);
  });

  it('handles quoted fields with embedded commas', () => {
    const csv = `symbol,side,quantity,price,date,description
AAPL,Buy,100,150.00,2024-01-15,"shares, ordinary"`;
    const r = parseBrokerCSV(csv);
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0].sym).toBe('AAPL');
  });

  it('rejects rows with invalid qty or price', () => {
    const csv = `symbol,side,quantity,price,date
AAPL,Buy,0,150.00,2024-01-15
MSFT,Buy,100,0,2024-01-15
NVDA,Buy,abc,xyz,2024-01-15`;
    const r = parseBrokerCSV(csv);
    expect(r.trades).toEqual([]);
  });
});

describe('Round-trip: imported trades flow through tax pipeline', () => {
  it('Schwab import → tax report integration', async () => {
    // Critical end-to-end: imported trades should match buildTaxLotReport's
    // expected shape and produce sensible output.
    const { buildTaxLotReport } = await import('../tax-reporting.js');
    const SCHWAB = `"Date","Action","Symbol","Description","Quantity","Price","Fees & Comm","Amount"
"01/15/2024","Buy","AAPL","APPLE INC","100","150.00","1.00","-15001.00"
"06/15/2024","Sell","AAPL","APPLE INC","100","175.00","1.00","17499.00"`;
    const { trades } = parseBrokerCSV(SCHWAB);
    const report = buildTaxLotReport(trades);
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].ticker).toBe('AAPL');
    expect(report.rows[0].gain).toBeCloseTo(2500); // 100 × ($175 - $150)
    expect(report.rows[0].term).toBe('short');
  });
});
