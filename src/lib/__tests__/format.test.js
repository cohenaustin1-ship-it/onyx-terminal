// IMO Onyx Terminal — format helpers tests

import { describe, it, expect } from 'vitest';
import { formatTicker, TICKER_EXCHANGE } from '../format.js';

describe('TICKER_EXCHANGE', () => {
  it('contains every major equity ticker', () => {
    for (const sym of ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'GOOGL', 'AMZN', 'META', 'JPM', 'SPY', 'QQQ']) {
      expect(TICKER_EXCHANGE[sym], `missing ${sym}`).toBeDefined();
    }
  });

  it('every value is a known exchange', () => {
    const validExchanges = new Set(['NYSE', 'NASDAQ', 'ARCA']);
    for (const [sym, ex] of Object.entries(TICKER_EXCHANGE)) {
      expect(validExchanges, `${sym} → ${ex}`).toContain(ex);
    }
  });

  it('mega-cap NASDAQ tickers are correctly tagged', () => {
    expect(TICKER_EXCHANGE['AAPL']).toBe('NASDAQ');
    expect(TICKER_EXCHANGE['MSFT']).toBe('NASDAQ');
    expect(TICKER_EXCHANGE['NVDA']).toBe('NASDAQ');
  });

  it('NYSE-listed financials are correctly tagged', () => {
    expect(TICKER_EXCHANGE['JPM']).toBe('NYSE');
    expect(TICKER_EXCHANGE['BAC']).toBe('NYSE');
    expect(TICKER_EXCHANGE['GS']).toBe('NYSE');
  });

  it('SPY is on ARCA', () => {
    expect(TICKER_EXCHANGE['SPY']).toBe('ARCA');
  });
});

describe('formatTicker', () => {
  it('prefixes NASDAQ equities with NSDQ:', () => {
    expect(formatTicker('AAPL', 'equity')).toBe('NSDQ:AAPL');
    expect(formatTicker('MSFT', 'equity')).toBe('NSDQ:MSFT');
  });

  it('prefixes NYSE equities with NYSE:', () => {
    expect(formatTicker('JPM', 'equity')).toBe('NYSE:JPM');
    expect(formatTicker('BAC', 'equity')).toBe('NYSE:BAC');
  });

  it('prefixes ARCA ETFs with ARCA:', () => {
    expect(formatTicker('SPY', 'equity')).toBe('ARCA:SPY');
    expect(formatTicker('VTI', 'equity')).toBe('ARCA:VTI');
  });

  it('returns raw id for non-equity classes', () => {
    expect(formatTicker('BTC-PERP', 'crypto')).toBe('BTC-PERP');
    expect(formatTicker('EUR-USD', 'fx')).toBe('EUR-USD');
    expect(formatTicker('WTI-F26', 'futures')).toBe('WTI-F26');
  });

  it('returns raw id for unknown equity tickers (no exchange mapping)', () => {
    // For tickers we don't have a listing for, fall back to raw symbol
    expect(formatTicker('UNKNOWN_XYZ', 'equity')).toBe('UNKNOWN_XYZ');
  });

  it('returns raw id when cls is missing or undefined', () => {
    expect(formatTicker('AAPL')).toBe('NSDQ:AAPL'); // cls undefined → still treated as equity if in TICKER_EXCHANGE
    expect(formatTicker('UNKNOWN_XYZ')).toBe('UNKNOWN_XYZ');
  });

  it('returns empty string for empty input', () => {
    expect(formatTicker('')).toBe('');
    expect(formatTicker(null)).toBe('');
    expect(formatTicker(undefined)).toBe('');
  });

  it('crypto and fx are never exchange-prefixed even if their id collides', () => {
    // Defensive: if someone hypothetically had a crypto called "AAPL"
    // it should NOT get the NASDAQ prefix because cls='crypto' wins.
    expect(formatTicker('AAPL', 'crypto')).toBe('AAPL');
  });
});
