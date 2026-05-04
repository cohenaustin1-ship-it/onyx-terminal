// IMO Onyx Terminal — lot-methods tests

import { describe, it, expect } from 'vitest';
import { buildRoundTripsWithMethod, compareLotMethods } from '../lot-methods.js';

const ts = (year, month, day) => new Date(year, month - 1, day).getTime();

describe('buildRoundTripsWithMethod', () => {
  it('FIFO matches first-bought lots first', () => {
    const trades = [
      { sym: 'AAPL', side: 'buy',  size: 10, price: 100, time: ts(2024, 1, 1) },
      { sym: 'AAPL', side: 'buy',  size: 10, price: 200, time: ts(2024, 2, 1) },
      { sym: 'AAPL', side: 'sell', size: 10, price: 150, time: ts(2024, 6, 1) },
    ];
    const trips = buildRoundTripsWithMethod(trades, 'fifo');
    expect(trips).toHaveLength(1);
    // FIFO took the $100 lot first → realized gain (150-100)*10 = +500
    expect(trips[0].entryPrice).toBe(100);
    expect(trips[0].pnl).toBeCloseTo(500);
  });

  it('LIFO matches last-bought lots first', () => {
    const trades = [
      { sym: 'AAPL', side: 'buy',  size: 10, price: 100, time: ts(2024, 1, 1) },
      { sym: 'AAPL', side: 'buy',  size: 10, price: 200, time: ts(2024, 2, 1) },
      { sym: 'AAPL', side: 'sell', size: 10, price: 150, time: ts(2024, 6, 1) },
    ];
    const trips = buildRoundTripsWithMethod(trades, 'lifo');
    // LIFO took the $200 lot first → realized loss (150-200)*10 = -500
    expect(trips[0].entryPrice).toBe(200);
    expect(trips[0].pnl).toBeCloseTo(-500);
  });

  it('HIFO matches highest-cost lots first (minimizes gain)', () => {
    const trades = [
      { sym: 'AAPL', side: 'buy',  size: 10, price: 100, time: ts(2024, 1, 1) },
      { sym: 'AAPL', side: 'buy',  size: 10, price: 250, time: ts(2024, 2, 1) },
      { sym: 'AAPL', side: 'buy',  size: 10, price: 200, time: ts(2024, 3, 1) },
      { sym: 'AAPL', side: 'sell', size: 10, price: 180, time: ts(2024, 6, 1) },
    ];
    const trips = buildRoundTripsWithMethod(trades, 'hifo');
    // HIFO picks the $250 lot → realized loss (180-250)*10 = -700
    expect(trips[0].entryPrice).toBe(250);
    expect(trips[0].pnl).toBeCloseTo(-700);
  });

  it('FIFO and HIFO agree when all lots have the same price', () => {
    const trades = [
      { sym: 'AAPL', side: 'buy',  size: 10, price: 100, time: ts(2024, 1, 1) },
      { sym: 'AAPL', side: 'buy',  size: 10, price: 100, time: ts(2024, 2, 1) },
      { sym: 'AAPL', side: 'sell', size: 10, price: 150, time: ts(2024, 6, 1) },
    ];
    const fifo = buildRoundTripsWithMethod(trades, 'fifo');
    const hifo = buildRoundTripsWithMethod(trades, 'hifo');
    expect(fifo[0].pnl).toBeCloseTo(hifo[0].pnl);
  });

  it('handles partial lot consumption correctly', () => {
    const trades = [
      { sym: 'AAPL', side: 'buy',  size: 10, price: 100, time: ts(2024, 1, 1) },
      { sym: 'AAPL', side: 'buy',  size: 10, price: 200, time: ts(2024, 2, 1) },
      // Sell 15 — partial across two lots under FIFO
      { sym: 'AAPL', side: 'sell', size: 15, price: 150, time: ts(2024, 6, 1) },
    ];
    const fifo = buildRoundTripsWithMethod(trades, 'fifo');
    expect(fifo).toHaveLength(2);
    // First trip: 10 shares from $100 lot → +$500
    // Second trip: 5 shares from $200 lot → −$250
    expect(fifo.reduce((s, t) => s + t.pnl, 0)).toBeCloseTo(250);
  });

  it('returns empty for empty input', () => {
    expect(buildRoundTripsWithMethod([], 'fifo')).toEqual([]);
    expect(buildRoundTripsWithMethod([], 'hifo')).toEqual([]);
  });

  it('unknown method falls back to FIFO', () => {
    const trades = [
      { sym: 'AAPL', side: 'buy',  size: 10, price: 100, time: ts(2024, 1, 1) },
      { sym: 'AAPL', side: 'buy',  size: 10, price: 200, time: ts(2024, 2, 1) },
      { sym: 'AAPL', side: 'sell', size: 10, price: 150, time: ts(2024, 6, 1) },
    ];
    const result = buildRoundTripsWithMethod(trades, 'unknown_method');
    expect(result[0].entryPrice).toBe(100); // FIFO behavior
  });

  it('separates round-trips by ticker', () => {
    const trades = [
      { sym: 'AAPL', side: 'buy',  size: 5, price: 100, time: ts(2024, 1, 1) },
      { sym: 'MSFT', side: 'buy',  size: 5, price: 300, time: ts(2024, 1, 1) },
      { sym: 'AAPL', side: 'sell', size: 5, price: 150, time: ts(2024, 6, 1) },
      { sym: 'MSFT', side: 'sell', size: 5, price: 350, time: ts(2024, 6, 1) },
    ];
    const trips = buildRoundTripsWithMethod(trades, 'hifo');
    expect(trips).toHaveLength(2);
    const tickers = trips.map(t => t.ticker).sort();
    expect(tickers).toEqual(['AAPL', 'MSFT']);
  });
});

describe('compareLotMethods', () => {
  it('returns side-by-side summary for all three methods', () => {
    const trades = [
      { sym: 'AAPL', side: 'buy',  size: 10, price: 100, time: ts(2024, 1, 1) },
      { sym: 'AAPL', side: 'buy',  size: 10, price: 250, time: ts(2024, 2, 1) },
      { sym: 'AAPL', side: 'sell', size: 10, price: 180, time: ts(2024, 6, 1) },
    ];
    const r = compareLotMethods(trades);
    expect(r).toHaveProperty('fifo');
    expect(r).toHaveProperty('lifo');
    expect(r).toHaveProperty('hifo');
    // FIFO: took $100 lot → +$800
    expect(r.fifo.totalRealized).toBeCloseTo(800);
    // LIFO: took $250 lot → −$700
    expect(r.lifo.totalRealized).toBeCloseTo(-700);
    // HIFO: took $250 lot (highest) → −$700
    expect(r.hifo.totalRealized).toBeCloseTo(-700);
  });

  it('count is consistent across methods (same trades, different lot picks)', () => {
    const trades = [
      { sym: 'AAPL', side: 'buy',  size: 10, price: 100, time: ts(2024, 1, 1) },
      { sym: 'AAPL', side: 'buy',  size: 10, price: 200, time: ts(2024, 2, 1) },
      { sym: 'AAPL', side: 'sell', size: 10, price: 150, time: ts(2024, 6, 1) },
    ];
    const r = compareLotMethods(trades);
    expect(r.fifo.count).toBe(r.lifo.count);
    expect(r.fifo.count).toBe(r.hifo.count);
  });

  it('HIFO never produces a realized gain greater than FIFO when prices vary', () => {
    // Property test: HIFO's whole purpose is to minimize realized
    // gains. Across any varied-price trade history, HIFO total <= FIFO.
    const trades = [
      { sym: 'A', side: 'buy',  size: 5, price: 50,  time: ts(2024, 1, 1) },
      { sym: 'A', side: 'buy',  size: 5, price: 200, time: ts(2024, 2, 1) },
      { sym: 'A', side: 'buy',  size: 5, price: 100, time: ts(2024, 3, 1) },
      { sym: 'A', side: 'sell', size: 8, price: 150, time: ts(2024, 6, 1) },
    ];
    const r = compareLotMethods(trades);
    expect(r.hifo.totalRealized).toBeLessThanOrEqual(r.fifo.totalRealized);
  });

  it('long-term and short-term split correctly', () => {
    const trades = [
      // Long-term lot
      { sym: 'A', side: 'buy',  size: 10, price: 100, time: ts(2020, 1, 1) },
      // Short-term lot
      { sym: 'A', side: 'buy',  size: 10, price: 200, time: ts(2024, 4, 1) },
      // Sell 10 in 2024
      { sym: 'A', side: 'sell', size: 10, price: 150, time: ts(2024, 6, 1) },
    ];
    const r = compareLotMethods(trades);
    // FIFO picks long-term ($100) → +$500 long-term gain
    expect(r.fifo.longTermRealized).toBeCloseTo(500);
    expect(r.fifo.shortTermRealized).toBeCloseTo(0);
    // HIFO picks short-term ($200) → −$500 short-term loss
    expect(r.hifo.shortTermRealized).toBeCloseTo(-500);
    expect(r.hifo.longTermRealized).toBeCloseTo(0);
  });
});
