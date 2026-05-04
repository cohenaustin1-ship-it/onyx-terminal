// IMO Onyx Terminal — api-cache tests
//
// Phase 3p.17 file-splitting. The cache helpers are tiny but shared
// across many call sites (broker providers, AI calls, Polygon
// fetchers, external-data module), so a regression here cascades.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  cacheGet,
  cacheSet,
  _cacheClear,
  _cacheSize,
} from '../api-cache.js';

beforeEach(() => {
  _cacheClear();
});

describe('cacheGet / cacheSet', () => {
  it('returns null for missing keys', () => {
    expect(cacheGet('nope', 1000)).toBeNull();
  });

  it('returns the stored value when present and not expired', () => {
    cacheSet('foo', { x: 1 });
    expect(cacheGet('foo', 1000)).toEqual({ x: 1 });
  });

  it('returns null and evicts when entry is older than ttl', async () => {
    cacheSet('stale', 'value');
    await new Promise(r => setTimeout(r, 5));
    expect(cacheGet('stale', 1)).toBeNull();
    // entry was deleted on read, not just hidden
    expect(_cacheSize()).toBe(0);
  });

  it('returns the value when ttl is large enough', () => {
    cacheSet('fresh', 'value');
    expect(cacheGet('fresh', 60_000)).toBe('value');
  });

  it('overwrites on re-set with same key', () => {
    cacheSet('k', 'v1');
    cacheSet('k', 'v2');
    expect(cacheGet('k', 1000)).toBe('v2');
  });

  it('handles complex values (arrays, objects, nested)', () => {
    const value = { a: [1, 2, { b: 'nested' }], c: null };
    cacheSet('complex', value);
    expect(cacheGet('complex', 1000)).toEqual(value);
  });

  it('different keys are isolated', () => {
    cacheSet('a', 1);
    cacheSet('b', 2);
    expect(cacheGet('a', 1000)).toBe(1);
    expect(cacheGet('b', 1000)).toBe(2);
  });

  it('false / 0 / empty-string are valid stored values (not treated as missing)', () => {
    cacheSet('zero', 0);
    cacheSet('empty', '');
    cacheSet('false', false);
    expect(cacheGet('zero', 1000)).toBe(0);
    expect(cacheGet('empty', 1000)).toBe('');
    expect(cacheGet('false', 1000)).toBe(false);
  });

  it('_cacheSize reflects entry count', () => {
    expect(_cacheSize()).toBe(0);
    cacheSet('a', 1); cacheSet('b', 2); cacheSet('c', 3);
    expect(_cacheSize()).toBe(3);
    cacheSet('a', 99); // overwrite, not new entry
    expect(_cacheSize()).toBe(3);
  });

  it('_cacheClear removes everything', () => {
    cacheSet('a', 1); cacheSet('b', 2);
    expect(_cacheSize()).toBe(2);
    _cacheClear();
    expect(_cacheSize()).toBe(0);
    expect(cacheGet('a', 1000)).toBeNull();
  });
});

describe('external-data + llm-providers exports (smoke)', () => {
  it('external-data module exports the expected surface', async () => {
    const m = await import('../external-data.js');
    // Symbol maps
    expect(m.COINBASE_SYMBOL_MAP).toBeDefined();
    expect(m.MASSIVE_TICKERS).toBeInstanceOf(Set);
    expect(m.EIA_SERIES_MAP).toBeDefined();
    // A representative slice of fetchers
    for (const fn of ['fetchWSBTickers', 'fetchSecFilings', 'fetchTreasuryRates',
                      'fetchOpenFigi', 'fetchMediaStackNews', 'fetchFxRates',
                      'fetchWeather', 'fetchOptimalWeights']) {
      expect(typeof m[fn]).toBe('function');
    }
  });

  it('llm-providers module exports the expected surface', async () => {
    const m = await import('../llm-providers.js');
    expect(m.LLM_PROVIDERS).toHaveLength(4);
    expect(m.LLM_PROVIDERS.map(p => p.id)).toEqual(['anthropic', 'openai', 'gemini', 'ollama']);
    expect(typeof m.getProvider).toBe('function');
    expect(typeof m.resolveActiveProvider).toBe('function');
    expect(typeof m.resolveLlmKey).toBe('function');
    expect(m.getProvider('anthropic').id).toBe('anthropic');
    expect(m.getProvider('does-not-exist')).toBeNull();
  });
});

describe('broker-providers + ai-calls + polygon-api exports (3p.18 smoke)', () => {
  it('broker-providers exports 5 brokers + lookup', async () => {
    const m = await import('../broker-providers.js');
    expect(m.BROKER_PROVIDERS).toHaveLength(5);
    expect(m.BROKER_PROVIDERS.map(p => p.id).sort())
      .toEqual(['alpaca', 'ibkr', 'paper', 'schwab', 'tradier']);
    expect(m.getBrokerProvider('paper').id).toBe('paper');
    expect(m.getBrokerProvider('does-not-exist')).toBeNull();
    // Each provider implements the contract
    for (const p of m.BROKER_PROVIDERS) {
      expect(typeof p.getStatus).toBe('function');
      expect(Array.isArray(p.configFields)).toBe(true);
    }
  });

  it('ai-calls exports the call layer', async () => {
    const m = await import('../ai-calls.js');
    for (const fn of ['callAnthropic', 'callAI', 'exaSearch',
                      'exaGetContents', 'exaGroundedAI', 'callOpenAI']) {
      expect(typeof m[fn]).toBe('function');
    }
  });

  it('polygon-api exports the equity-data layer', async () => {
    const m = await import('../polygon-api.js');
    expect(typeof m.SECTOR_ETF_MAP).toBe('object');
    expect(Object.keys(m.SECTOR_ETF_MAP).length).toBeGreaterThan(8);
    expect(typeof m.SECTOR_CONSTITUENTS).toBe('object');
    for (const fn of ['fetchPolygonFinancials', 'fetchPolygonShortInterest',
                      'fetchPolygonLastQuote', 'fetchPolygonRecentTrades',
                      'fetchPolygonTickerDetails', 'fetchPolygonMovers',
                      'fetchPolygonSectorMap', 'fetchPolygonMarketMap',
                      'fetchPolygonAggs', 'reconstructOrderBookFromTrades',
                      'deriveFundamentalsFromPolygon']) {
      expect(typeof m[fn]).toBe('function');
    }
  });
});
