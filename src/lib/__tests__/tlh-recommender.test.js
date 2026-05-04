// IMO Onyx Terminal — TLH recommender tests

import { describe, it, expect } from 'vitest';
import {
  buildTLHRecommendations,
  formatSafeRebuyDate,
} from '../tlh-recommender.js';

const ts = (year, month, day) => new Date(year, month - 1, day).getTime();
const DAY_MS = 86400000;

describe('formatSafeRebuyDate', () => {
  it('returns 31 days after the sale date by default', () => {
    const sale = ts(2024, 6, 1);
    const safe = formatSafeRebuyDate(sale);
    expect(safe).toBe('2024-07-02'); // June 1 + 31 days
  });

  it('accepts a Date object input', () => {
    const sale = new Date(2024, 5, 1); // June 1
    expect(formatSafeRebuyDate(sale)).toBe('2024-07-02');
  });

  it('accepts a custom days-ahead count', () => {
    const sale = ts(2024, 6, 1);
    expect(formatSafeRebuyDate(sale, 30)).toBe('2024-07-01');
    expect(formatSafeRebuyDate(sale, 0)).toBe('2024-06-01');
  });

  it('handles year boundary correctly', () => {
    const sale = ts(2024, 12, 15);
    // Dec 15 + 31 days = Jan 15
    expect(formatSafeRebuyDate(sale)).toBe('2025-01-15');
  });
});

describe('buildTLHRecommendations — basic filtering', () => {
  it('returns empty when no positions', () => {
    const r = buildTLHRecommendations({ positions: [] });
    expect(r.recommendations).toEqual([]);
    expect(r.summary.candidateCount).toBe(0);
    expect(r.summary.totalHarvestable).toBe(0);
  });

  it('filters out positions with no unrealized loss', () => {
    const positions = [
      { sym: 'AAPL', qty: 10, avgCost: 150, mark: 175 }, // gain
      { sym: 'MSFT', qty: 5,  avgCost: 400, mark: 400 }, // flat
    ];
    const r = buildTLHRecommendations({ positions });
    expect(r.recommendations).toEqual([]);
  });

  it('filters out losses below the min threshold', () => {
    const positions = [
      // Tiny loss: $5 — below default $100 threshold
      { sym: 'AAPL', qty: 1, avgCost: 100, mark: 95 },
    ];
    const r = buildTLHRecommendations({ positions });
    expect(r.recommendations).toEqual([]);
  });

  it('includes positions with loss above the min threshold', () => {
    const positions = [
      // Loss: $500
      { sym: 'AAPL', qty: 10, avgCost: 200, mark: 150 },
    ];
    const r = buildTLHRecommendations({ positions });
    expect(r.recommendations).toHaveLength(1);
    expect(r.recommendations[0].harvestableLoss).toBeCloseTo(500);
  });

  it('respects custom minLossUsd option', () => {
    const positions = [
      { sym: 'AAPL', qty: 1, avgCost: 100, mark: 50 }, // $50 loss
    ];
    const def = buildTLHRecommendations({ positions });
    const lo  = buildTLHRecommendations({ positions, opts: { minLossUsd: 25 } });
    expect(def.recommendations).toHaveLength(0);
    expect(lo.recommendations).toHaveLength(1);
  });

  it('skips invalid positions silently', () => {
    const positions = [
      { sym: 'AAPL', qty: 0, avgCost: 100, mark: 50 },   // zero qty
      { sym: 'MSFT', qty: 10, avgCost: 0, mark: 50 },    // zero cost
      { sym: '', qty: 10, avgCost: 100, mark: 50 },       // missing sym
      null,
      undefined,
    ];
    const r = buildTLHRecommendations({ positions });
    expect(r.recommendations).toEqual([]);
  });
});

describe('buildTLHRecommendations — math correctness', () => {
  it('harvestableLoss is absolute value of unrealized PnL', () => {
    const positions = [
      // 10 × ($150 − $200) = −$500
      { sym: 'AAPL', qty: 10, avgCost: 200, mark: 150 },
    ];
    const r = buildTLHRecommendations({ positions });
    expect(r.recommendations[0].harvestableLoss).toBeCloseTo(500);
  });

  it('pctLoss reflects the percentage decline', () => {
    const positions = [
      // 25% decline, $500 absolute (above $100 threshold)
      { sym: 'TSLA', qty: 10, avgCost: 200, mark: 150 },
    ];
    const r = buildTLHRecommendations({ positions });
    expect(r.recommendations[0].pctLoss).toBeCloseTo(-25);
  });

  it('estimatedTaxSavings scales with marginal rate', () => {
    const positions = [
      { sym: 'TSLA', qty: 10, avgCost: 200, mark: 100 }, // $1000 loss
    ];
    const r = buildTLHRecommendations({ positions });
    const t = r.recommendations[0].estimatedTaxSavings;
    expect(t.atShortTerm22).toBeCloseTo(220);
    expect(t.atShortTerm32).toBeCloseTo(320);
    expect(t.atLongTerm15).toBeCloseTo(150);
    expect(t.atLongTerm20).toBeCloseTo(200);
  });
});

describe('buildTLHRecommendations — replacement suggestions', () => {
  it('finds curated swaps for SPY (S&P 500 trackers)', () => {
    const positions = [
      { sym: 'SPY', qty: 100, avgCost: 500, mark: 450 }, // $5,000 loss
    ];
    const r = buildTLHRecommendations({ positions });
    const rec = r.recommendations[0];
    expect(rec.hasCuratedSwap).toBe(true);
    expect(rec.candidates.length).toBeGreaterThan(0);
    // Should NOT suggest substantially-identical SPY/IVV/VOO
    const symbols = rec.candidates.map(c => c.sym);
    expect(symbols).not.toContain('IVV');
    expect(symbols).not.toContain('VOO');
    // Should suggest acceptable alternatives like VTI, ITOT, RSP
    expect(symbols.some(s => ['VTI', 'ITOT', 'SCHB', 'RSP', 'VV', 'SCHX'].includes(s))).toBe(true);
  });

  it('finds curated swaps for QQQ (Nasdaq-100)', () => {
    const positions = [
      { sym: 'QQQ', qty: 50, avgCost: 400, mark: 350 }, // $2,500 loss
    ];
    const r = buildTLHRecommendations({ positions });
    const rec = r.recommendations[0];
    expect(rec.hasCuratedSwap).toBe(true);
    const symbols = rec.candidates.map(c => c.sym);
    expect(symbols).not.toContain('QQQM'); // substantially identical
    expect(symbols.some(s => ['VUG', 'IWF', 'VGT', 'XLK'].includes(s))).toBe(true);
  });

  it('returns hasCuratedSwap=false for individual stocks', () => {
    const positions = [
      { sym: 'AAPL', qty: 100, avgCost: 200, mark: 150 },
    ];
    const r = buildTLHRecommendations({ positions });
    const rec = r.recommendations[0];
    expect(rec.hasCuratedSwap).toBe(false);
    expect(rec.candidates).toEqual([]);
    // Helpful note explaining why
    expect(rec.replacementNote).toContain('individual');
  });

  it('candidate list deduplicates across multiple swap pairs', () => {
    // SPY appears in multiple swap pairs; ensure we don't repeat targets
    const positions = [
      { sym: 'SPY', qty: 100, avgCost: 500, mark: 450 },
    ];
    const r = buildTLHRecommendations({ positions });
    const symbols = r.recommendations[0].candidates.map(c => c.sym);
    const unique = new Set(symbols);
    expect(unique.size).toBe(symbols.length);
  });
});

describe('buildTLHRecommendations — wash-sale guardrails', () => {
  it('flags recentReplacementBuy when user bought same ticker recently', () => {
    const now = ts(2024, 6, 15);
    const positions = [
      { sym: 'AAPL', qty: 10, avgCost: 200, mark: 150 },
    ];
    const recentTrades = [
      // Bought 10 days ago — within ±30 day window
      { sym: 'AAPL', side: 'buy', size: 5, price: 160, time: ts(2024, 6, 5) },
    ];
    const r = buildTLHRecommendations({ positions, recentTrades, opts: { now } });
    const rec = r.recommendations[0];
    expect(rec.recentReplacementBuy).not.toBeNull();
    expect(rec.recentReplacementBuy.sym).toBe('AAPL');
  });

  it('does NOT flag when recent buy is OUTSIDE the 30-day window', () => {
    const now = ts(2024, 6, 15);
    const positions = [
      { sym: 'AAPL', qty: 10, avgCost: 200, mark: 150 },
    ];
    const recentTrades = [
      // Bought 60 days ago — outside window
      { sym: 'AAPL', side: 'buy', size: 5, price: 160, time: ts(2024, 4, 15) },
    ];
    const r = buildTLHRecommendations({ positions, recentTrades, opts: { now } });
    expect(r.recommendations[0].recentReplacementBuy).toBeNull();
  });

  it('flags when a substantially-identical purchase exists (SPY ↔ IVV)', () => {
    const now = ts(2024, 6, 15);
    const positions = [
      { sym: 'SPY', qty: 100, avgCost: 500, mark: 450 },
    ];
    const recentTrades = [
      { sym: 'IVV', side: 'buy', size: 50, price: 451, time: ts(2024, 6, 1) },
    ];
    const r = buildTLHRecommendations({ positions, recentTrades, opts: { now } });
    const rec = r.recommendations[0];
    expect(rec.recentReplacementBuy).not.toBeNull();
    expect(rec.recentReplacementBuy.sym).toBe('IVV');
  });

  it('does NOT flag unrelated tickers', () => {
    const now = ts(2024, 6, 15);
    const positions = [
      { sym: 'AAPL', qty: 10, avgCost: 200, mark: 150 },
    ];
    const recentTrades = [
      { sym: 'TSLA', side: 'buy', size: 5, price: 200, time: ts(2024, 6, 5) },
    ];
    const r = buildTLHRecommendations({ positions, recentTrades, opts: { now } });
    expect(r.recommendations[0].recentReplacementBuy).toBeNull();
  });

  it('safeRebuyDate is exactly 31 days after now', () => {
    const now = ts(2024, 6, 1);
    const positions = [
      { sym: 'AAPL', qty: 10, avgCost: 200, mark: 150 },
    ];
    const r = buildTLHRecommendations({ positions, opts: { now } });
    expect(r.recommendations[0].safeRebuyDate).toBe('2024-07-02');
  });
});

describe('buildTLHRecommendations — sorting and summary', () => {
  it('sorts recommendations by largest harvestable loss first', () => {
    const positions = [
      { sym: 'A', qty: 1, avgCost: 1000, mark: 700 },  // -$300
      { sym: 'B', qty: 1, avgCost: 1000, mark: 100 },  // -$900
      { sym: 'C', qty: 1, avgCost: 1000, mark: 500 },  // -$500
    ];
    const r = buildTLHRecommendations({ positions });
    expect(r.recommendations.map(rec => rec.sym)).toEqual(['B', 'C', 'A']);
  });

  it('summary.totalHarvestable equals sum of per-position losses', () => {
    const positions = [
      { sym: 'A', qty: 10, avgCost: 100, mark: 80 },  // -$200
      { sym: 'B', qty: 5,  avgCost: 200, mark: 130 }, // -$350
      { sym: 'C', qty: 1,  avgCost: 100, mark: 200 }, // gain (excluded)
    ];
    const r = buildTLHRecommendations({ positions });
    expect(r.summary.candidateCount).toBe(2);
    expect(r.summary.totalHarvestable).toBeCloseTo(550);
  });

  it('summary.riskyCount counts positions with recent replacement buys', () => {
    const now = ts(2024, 6, 15);
    const positions = [
      { sym: 'AAPL', qty: 10, avgCost: 200, mark: 150 }, // risky
      { sym: 'MSFT', qty: 5,  avgCost: 400, mark: 350 }, // safe
    ];
    const recentTrades = [
      { sym: 'AAPL', side: 'buy', size: 5, price: 160, time: ts(2024, 6, 1) },
    ];
    const r = buildTLHRecommendations({ positions, recentTrades, opts: { now } });
    expect(r.summary.riskyCount).toBe(1);
  });
});
