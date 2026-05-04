// IMO Onyx Terminal — tax-lots tests
//
// IRS Sec. 1091 substantially-identical detection + TLH swap pair table.

import { describe, it, expect } from 'vitest';
import { areSubstantiallyIdentical, TLH_SWAP_MAP } from '../tax-lots.js';

describe('areSubstantiallyIdentical', () => {
  it('treats SPY/IVV/VOO as substantially identical (S&P 500 trackers)', () => {
    expect(areSubstantiallyIdentical('SPY', 'IVV')).toBe(true);
    expect(areSubstantiallyIdentical('SPY', 'VOO')).toBe(true);
    expect(areSubstantiallyIdentical('IVV', 'VOO')).toBe(true);
  });

  it('treats QQQ and QQQM as identical', () => {
    expect(areSubstantiallyIdentical('QQQ', 'QQQM')).toBe(true);
  });

  it('treats VTI and ITOT as identical (total market trackers)', () => {
    expect(areSubstantiallyIdentical('VTI', 'ITOT')).toBe(true);
  });

  it('returns true for the same symbol', () => {
    expect(areSubstantiallyIdentical('AAPL', 'AAPL')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(areSubstantiallyIdentical('spy', 'IVV')).toBe(true);
    expect(areSubstantiallyIdentical('Spy', 'ivv')).toBe(true);
  });

  it('treats unrelated tickers as NOT identical', () => {
    expect(areSubstantiallyIdentical('SPY', 'AAPL')).toBe(false);
    expect(areSubstantiallyIdentical('AAPL', 'TSLA')).toBe(false);
    expect(areSubstantiallyIdentical('TLT', 'XLK')).toBe(false);
  });

  it('treats different sector ETFs as NOT identical', () => {
    expect(areSubstantiallyIdentical('XLK', 'XLF')).toBe(false);
    expect(areSubstantiallyIdentical('XLE', 'XLV')).toBe(false);
  });

  it('handles null/undefined safely', () => {
    expect(areSubstantiallyIdentical(null, 'SPY')).toBe(false);
    expect(areSubstantiallyIdentical('SPY', null)).toBe(false);
    expect(areSubstantiallyIdentical(undefined, undefined)).toBe(false);
    expect(areSubstantiallyIdentical('', 'SPY')).toBe(false);
  });
});

describe('TLH_SWAP_MAP', () => {
  it('is a Map instance', () => {
    expect(TLH_SWAP_MAP).toBeInstanceOf(Map);
  });

  it('has SPY swap targets', () => {
    const swaps = TLH_SWAP_MAP.get('SPY');
    expect(Array.isArray(swaps)).toBe(true);
    expect(swaps.length).toBeGreaterThan(0);
  });

  it('SPY swap targets are different tickers (no self-references)', () => {
    const swaps = TLH_SWAP_MAP.get('SPY');
    for (const sw of swaps) {
      expect(sw.to).not.toContain('SPY');
    }
  });

  it('SPY swaps include broad-market alternatives (VTI/ITOT)', () => {
    const swaps = TLH_SWAP_MAP.get('SPY') || [];
    const allTargets = swaps.flatMap(s => s.to);
    // At least one S&P 500 → broad market swap should exist
    expect(allTargets.some(t => ['VTI', 'ITOT', 'SCHB', 'VV'].includes(t))).toBe(true);
  });

  it('every entry has from + to + note structure', () => {
    for (const swaps of TLH_SWAP_MAP.values()) {
      for (const sw of swaps) {
        expect(Array.isArray(sw.to)).toBe(true);
        expect(sw.note).toBeTypeOf('string');
      }
    }
  });
});
