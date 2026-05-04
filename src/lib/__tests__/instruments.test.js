// IMO Onyx Terminal — INSTRUMENTS catalog tests
//
// Direct tests of the curated instrument catalog (originally tested
// indirectly via chart-config tests). This file owns the catalog
// invariants that other modules depend on:
//   - Every entry has the canonical fields
//   - IDs are unique
//   - Asset class taxonomy is correct
//   - Decimal precision is sensible per class
//   - Curated marks/vols are within plausible ranges (curated data
//     should never have an obvious typo like a $0.01 BTC mark)

import { describe, it, expect } from 'vitest';
import { INSTRUMENTS } from '../instruments.js';

describe('INSTRUMENTS structure', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(INSTRUMENTS)).toBe(true);
    expect(INSTRUMENTS.length).toBeGreaterThan(0);
  });

  it('has at least 50 instruments (substantial catalog)', () => {
    // The platform should ship with a meaningful catalog, not 5 placeholders
    expect(INSTRUMENTS.length).toBeGreaterThanOrEqual(50);
  });
});

describe('INSTRUMENTS canonical fields', () => {
  it('every instrument has id, cls, name, mark, dec', () => {
    for (const inst of INSTRUMENTS) {
      expect(inst.id).toBeTypeOf('string');
      expect(inst.id.length).toBeGreaterThan(0);
      expect(inst.cls).toBeTypeOf('string');
      expect(inst.name).toBeTypeOf('string');
      expect(Number.isFinite(inst.mark), `${inst.id} bad mark`).toBe(true);
      expect(inst.mark).toBeGreaterThan(0);
      expect(Number.isFinite(inst.dec), `${inst.id} bad dec`).toBe(true);
    }
  });

  it('every id is unique', () => {
    const ids = INSTRUMENTS.map(i => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every name is unique', () => {
    // Defensive — duplicate names suggest copy-paste errors in the catalog
    const names = INSTRUMENTS.map(i => i.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('INSTRUMENTS asset class taxonomy', () => {
  it('cls values are non-empty short identifiers', () => {
    // Don't enforce a fixed whitelist — the catalog is the source of
    // truth for what classes exist (energy, metals, agri, etc.).
    // Instead just verify they're well-formed.
    for (const inst of INSTRUMENTS) {
      expect(inst.cls).toBeTypeOf('string');
      expect(inst.cls.length).toBeGreaterThan(0);
      expect(inst.cls.length).toBeLessThan(20);
      // No whitespace in class names
      expect(/\s/.test(inst.cls)).toBe(false);
    }
  });

  it('cls vocabulary is reasonably small (not unique-per-instrument)', () => {
    const classes = new Set(INSTRUMENTS.map(i => i.cls));
    // If we have N instruments and N classes, something's wrong.
    // Real catalogs have a handful of classes (~5-15).
    expect(classes.size).toBeLessThan(20);
    expect(classes.size).toBeGreaterThan(2);
  });

  it('contains expected major crypto perps', () => {
    const ids = new Set(INSTRUMENTS.map(i => i.id));
    expect(ids).toContain('BTC-PERP');
    expect(ids).toContain('ETH-PERP');
  });

  it('contains expected major equities', () => {
    const ids = new Set(INSTRUMENTS.map(i => i.id));
    for (const sym of ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'GOOGL', 'AMZN', 'META']) {
      expect(ids, `expected ${sym}`).toContain(sym);
    }
  });

  it('contains expected major ETFs', () => {
    const ids = new Set(INSTRUMENTS.map(i => i.id));
    for (const sym of ['SPY']) {
      expect(ids, `expected ${sym}`).toContain(sym);
    }
  });
});

describe('INSTRUMENTS decimal precision (per asset class)', () => {
  it('all dec values are integers in [0, 8]', () => {
    for (const inst of INSTRUMENTS) {
      expect(Number.isInteger(inst.dec), `${inst.id} dec=${inst.dec} not int`).toBe(true);
      expect(inst.dec).toBeGreaterThanOrEqual(0);
      expect(inst.dec).toBeLessThanOrEqual(8);
    }
  });

  it('equity tickers all use dec=2 (cents)', () => {
    const equities = INSTRUMENTS.filter(i => i.cls === 'equity');
    expect(equities.length).toBeGreaterThan(0);
    for (const e of equities) {
      expect(e.dec, `${e.id} equity dec should be 2`).toBe(2);
    }
  });

  it('crypto perps use dec in [2, 6]', () => {
    const cryptos = INSTRUMENTS.filter(i => i.cls === 'crypto');
    for (const c of cryptos) {
      expect(c.dec, `${c.id} crypto dec=${c.dec}`).toBeGreaterThanOrEqual(2);
      expect(c.dec, `${c.id} crypto dec=${c.dec}`).toBeLessThanOrEqual(6);
    }
  });

  it('stablecoins use dec >= 4 (basis-point depeg detection)', () => {
    const stables = INSTRUMENTS.filter(i => i.cls === 'stablecoin');
    for (const s of stables) {
      expect(s.dec, `${s.id} stablecoin dec should be >= 4`).toBeGreaterThanOrEqual(4);
    }
  });
});

describe('INSTRUMENTS data sanity (curated values within plausible ranges)', () => {
  it('BTC-PERP mark is in plausible range for the era', () => {
    const btc = INSTRUMENTS.find(i => i.id === 'BTC-PERP');
    expect(btc).toBeDefined();
    // BTC has been between $10k and $250k in modern history
    expect(btc.mark).toBeGreaterThan(10_000);
    expect(btc.mark).toBeLessThan(250_000);
  });

  it('ETH-PERP mark is in plausible range', () => {
    const eth = INSTRUMENTS.find(i => i.id === 'ETH-PERP');
    expect(eth).toBeDefined();
    expect(eth.mark).toBeGreaterThan(500);
    expect(eth.mark).toBeLessThan(20_000);
  });

  it('stablecoin marks are within ±5% of $1.00 (depeg threshold)', () => {
    const stables = INSTRUMENTS.filter(i => i.cls === 'stablecoin');
    for (const s of stables) {
      expect(Math.abs(s.mark - 1), `${s.id} mark=${s.mark} suspiciously off-peg`)
        .toBeLessThan(0.05);
    }
  });

  it('equity marks are positive but capped at $10k (BRK.A is exception)', () => {
    const equities = INSTRUMENTS.filter(i => i.cls === 'equity');
    for (const e of equities) {
      expect(e.mark).toBeGreaterThan(0);
      // Almost no individual share trades over $10k except BRK.A
      if (e.id !== 'BRK.A') {
        expect(e.mark, `${e.id} mark=${e.mark} suspicious for a non-BRK.A stock`)
          .toBeLessThan(10_000);
      }
    }
  });

  it('change24h is a finite percentage in plausible range', () => {
    for (const inst of INSTRUMENTS) {
      if (inst.change24h === undefined || inst.change24h === null) continue;
      expect(Number.isFinite(inst.change24h)).toBe(true);
      // Daily moves > 50% are exceptional events; flag obvious typos
      expect(Math.abs(inst.change24h)).toBeLessThan(50);
    }
  });

  it('vol24h is non-negative when present', () => {
    for (const inst of INSTRUMENTS) {
      if (inst.vol24h === undefined || inst.vol24h === null) continue;
      expect(inst.vol24h).toBeGreaterThanOrEqual(0);
    }
  });

  it('open interest (oi) is non-negative when present', () => {
    for (const inst of INSTRUMENTS) {
      if (inst.oi === undefined || inst.oi === null) continue;
      expect(inst.oi).toBeGreaterThanOrEqual(0);
    }
  });

  it('funding rates are within ±10% (any higher is an obvious typo)', () => {
    for (const inst of INSTRUMENTS) {
      if (inst.funding === undefined || inst.funding === null) continue;
      expect(Math.abs(inst.funding), `${inst.id} funding=${inst.funding}`)
        .toBeLessThan(0.10);
    }
  });
});

describe('INSTRUMENTS lookups (search performance)', () => {
  it('find by id is O(n) but instant for small catalog', () => {
    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      INSTRUMENTS.find(inst => inst.id === 'AAPL');
    }
    const elapsed = performance.now() - start;
    // 1,000 catalog scans should complete in well under 100ms
    expect(elapsed).toBeLessThan(100);
  });

  it('case-insensitive search finds tickers regardless of input case', () => {
    // The chart's search input lowercases user input before matching.
    // Verify the catalog has consistent casing so lookups work.
    const ids = INSTRUMENTS.map(i => i.id);
    for (const id of ids) {
      // IDs should be uppercase (or mixed for compound tickers like BRK.B)
      expect(id, `${id} has lowercase letters`).toBe(id.toUpperCase());
    }
  });
});
