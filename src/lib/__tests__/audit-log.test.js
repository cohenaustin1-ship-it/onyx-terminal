// IMO Onyx Terminal — audit-log tests
//
// Uses an in-memory localStorage shim so tests are isolated and
// don't depend on a real browser environment.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  AUDIT_LOG_KEY,
  AUDIT_LOG_CAP,
  loadAuditLog,
  appendAuditEntry,
  clearAuditLog,
  exportAuditLogCSV,
  filterAuditLog,
} from '../audit-log.js';

// In-memory localStorage shim — fresh per test
const makeShim = () => {
  const store = new Map();
  return {
    getItem:    (k) => (store.has(k) ? store.get(k) : null),
    setItem:    (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear:      () => store.clear(),
    key:        (i) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
    _store: store,
  };
};

beforeEach(() => {
  globalThis.localStorage = makeShim();
  globalThis.window = {
    dispatchEvent: vi.fn(),
  };
});

describe('loadAuditLog', () => {
  it('returns empty array when no log exists', () => {
    expect(loadAuditLog()).toEqual([]);
  });

  it('returns empty array on malformed JSON', () => {
    localStorage.setItem(AUDIT_LOG_KEY, '{not valid json}');
    expect(loadAuditLog()).toEqual([]);
  });

  it('returns empty array if stored value is not an array', () => {
    localStorage.setItem(AUDIT_LOG_KEY, JSON.stringify({ wrong: 'shape' }));
    expect(loadAuditLog()).toEqual([]);
  });
});

describe('appendAuditEntry', () => {
  it('rejects null/undefined entries', () => {
    expect(appendAuditEntry(null)).toBeNull();
    expect(appendAuditEntry(undefined)).toBeNull();
  });

  it('rejects entries missing category or action', () => {
    expect(appendAuditEntry({ category: 'order' })).toBeNull();
    expect(appendAuditEntry({ action: 'placed' })).toBeNull();
    expect(appendAuditEntry({})).toBeNull();
  });

  it('appends a valid entry and returns the full record', () => {
    const r = appendAuditEntry({
      category: 'order', action: 'placed',
      actor: 'user', target: 'AAPL',
      details: { side: 'buy', qty: 100, price: 175 },
    });
    expect(r).not.toBeNull();
    expect(r.id).toBeTypeOf('string');
    expect(r.ts).toBeGreaterThan(0);
    expect(r.category).toBe('order');
    expect(r.action).toBe('placed');
  });

  it('persists to localStorage', () => {
    appendAuditEntry({ category: 'order', action: 'placed' });
    const stored = JSON.parse(localStorage.getItem(AUDIT_LOG_KEY));
    expect(Array.isArray(stored)).toBe(true);
    expect(stored).toHaveLength(1);
  });

  it('newest entries are first (FIFO from front)', () => {
    appendAuditEntry({ category: 'order', action: 'first' });
    appendAuditEntry({ category: 'order', action: 'second' });
    appendAuditEntry({ category: 'order', action: 'third' });
    const log = loadAuditLog();
    expect(log[0].action).toBe('third');
    expect(log[2].action).toBe('first');
  });

  it('caps the log at AUDIT_LOG_CAP entries', () => {
    // Pre-populate beyond the cap
    const big = Array.from({ length: AUDIT_LOG_CAP + 100 }, (_, i) => ({
      id: `pre-${i}`, ts: i, category: 'order', action: 'pre',
    }));
    localStorage.setItem(AUDIT_LOG_KEY, JSON.stringify(big));
    appendAuditEntry({ category: 'order', action: 'newest' });
    const log = loadAuditLog();
    expect(log.length).toBe(AUDIT_LOG_CAP);
    expect(log[0].action).toBe('newest');
  });

  it('dispatches imo:audit-log-changed event', () => {
    appendAuditEntry({ category: 'order', action: 'placed' });
    expect(window.dispatchEvent).toHaveBeenCalledTimes(1);
    const ev = window.dispatchEvent.mock.calls[0][0];
    expect(ev.type).toBe('imo:audit-log-changed');
  });

  it('preserves caller-supplied id and timestamp', () => {
    const r = appendAuditEntry({
      id: 'custom-id-123',
      ts: 1700000000000,
      category: 'order', action: 'placed',
    });
    expect(r.id).toBe('custom-id-123');
    expect(r.ts).toBe(1700000000000);
  });
});

describe('clearAuditLog', () => {
  it('removes the log from storage', () => {
    appendAuditEntry({ category: 'order', action: 'placed' });
    expect(loadAuditLog()).toHaveLength(1);
    clearAuditLog();
    expect(loadAuditLog()).toEqual([]);
  });

  it('dispatches the changed event', () => {
    clearAuditLog();
    expect(window.dispatchEvent).toHaveBeenCalledTimes(1);
  });
});

describe('exportAuditLogCSV', () => {
  it('produces a header-only CSV when log is empty', () => {
    const csv = exportAuditLogCSV();
    expect(csv).toMatch(/^id,timestamp,iso_time,category,action,actor,target,details,prev,next$/);
  });

  it('serializes a row per entry with ISO timestamp', () => {
    appendAuditEntry({
      category: 'order', action: 'placed',
      actor: 'user', target: 'AAPL',
      ts: 1700000000000,
    });
    const csv = exportAuditLogCSV();
    const lines = csv.split('\r\n');
    expect(lines).toHaveLength(2); // header + one row
    expect(lines[1]).toContain('order');
    expect(lines[1]).toContain('placed');
    expect(lines[1]).toContain('AAPL');
    expect(lines[1]).toContain('2023-11-14'); // ISO date for that ts
  });

  it('escapes commas + quotes per RFC 4180', () => {
    appendAuditEntry({
      category: 'order',
      action: 'placed',
      details: 'Buy 100 AAPL, "limit" order at $175',
    });
    const csv = exportAuditLogCSV();
    // The details cell should be wrapped in quotes and have doubled inner quotes
    expect(csv).toContain('"Buy 100 AAPL, ""limit"" order at $175"');
  });

  it('handles object details by JSON-stringifying', () => {
    appendAuditEntry({
      category: 'settings', action: 'changed',
      details: { key: 'theme', from: 'dark', to: 'light' },
    });
    const csv = exportAuditLogCSV();
    // Object should be quoted (because JSON contains quotes) and serialized
    expect(csv).toContain('theme');
    expect(csv).toContain('dark');
    expect(csv).toContain('light');
  });

  it('accepts a pre-filtered list', () => {
    appendAuditEntry({ category: 'order',    action: 'placed' });
    appendAuditEntry({ category: 'settings', action: 'changed' });
    const orderOnly = loadAuditLog().filter(e => e.category === 'order');
    const csv = exportAuditLogCSV(orderOnly);
    const lines = csv.split('\r\n');
    expect(lines).toHaveLength(2); // header + 1 row
    expect(lines[1]).toContain('order');
    expect(lines[1]).not.toContain('settings');
  });
});

describe('filterAuditLog', () => {
  beforeEach(() => {
    appendAuditEntry({ category: 'order',    action: 'placed',  ts: 1000, target: 'AAPL' });
    appendAuditEntry({ category: 'order',    action: 'cancelled', ts: 2000, target: 'AAPL' });
    appendAuditEntry({ category: 'settings', action: 'changed', ts: 3000, target: 'theme' });
    appendAuditEntry({ category: 'auth',     action: 'login',    ts: 4000, actor: 'alice' });
  });

  it('returns all entries when query is empty', () => {
    expect(filterAuditLog({})).toHaveLength(4);
  });

  it('filters by category', () => {
    const r = filterAuditLog({ category: 'order' });
    expect(r).toHaveLength(2);
    expect(r.every(e => e.category === 'order')).toBe(true);
  });

  it('filters by action', () => {
    const r = filterAuditLog({ action: 'login' });
    expect(r).toHaveLength(1);
    expect(r[0].actor).toBe('alice');
  });

  it('filters by time window', () => {
    const r = filterAuditLog({ sinceTs: 2000, untilTs: 3000 });
    expect(r).toHaveLength(2);
  });

  it('text search matches across the JSON-serialized record', () => {
    expect(filterAuditLog({ search: 'AAPL' })).toHaveLength(2);
    expect(filterAuditLog({ search: 'theme' })).toHaveLength(1);
    expect(filterAuditLog({ search: 'alice' })).toHaveLength(1);
  });

  it('combines multiple filters with AND', () => {
    const r = filterAuditLog({ category: 'order', action: 'cancelled' });
    expect(r).toHaveLength(1);
    expect(r[0].action).toBe('cancelled');
  });
});
