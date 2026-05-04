// IMO Onyx Terminal — storage modules tests
//
// Tests the three storage modules together because they share an
// audit-log integration: every save records an entry in the unified
// audit log. Verifying that integration in one place makes the
// coupling explicit and catches drift if any module skips logging.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  LOCK_KEY,
  loadLockState,
  saveLockState,
  hashPin,
} from '../lock-storage.js';
import {
  BROKERS_STORAGE,
  ACTIVE_BROKER_STORAGE,
  loadBrokerConfigs,
  saveBrokerConfigs,
  loadActiveBroker,
  saveActiveBroker,
} from '../broker-storage.js';
import {
  SAFETY_KEY,
  loadSafetyState,
  saveSafetyState,
  loadSafetyAudit,
  appendSafetyAudit,
  DEFAULT_SAFETY,
} from '../safety-storage.js';
import {
  AUDIT_LOG_KEY,
  loadAuditLog,
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
    CustomEvent: function (type, init) { return { type, detail: init?.detail }; },
  };
  globalThis.CustomEvent = globalThis.window.CustomEvent;
});

describe('lock-storage', () => {
  describe('loadLockState', () => {
    it('returns sensible defaults when no state exists', () => {
      const s = loadLockState();
      expect(s.locked).toBe(false);
      expect(s.pinHash).toBeNull();
      expect(s.enabled).toBe(false);
      expect(s.idleMins).toBe(5);
    });

    it('returns defaults on malformed JSON', () => {
      localStorage.setItem(LOCK_KEY, '{garbage');
      const s = loadLockState();
      expect(s.locked).toBe(false);
    });

    it('coerces non-numeric idleMins to default', () => {
      localStorage.setItem(LOCK_KEY, JSON.stringify({ idleMins: 'not a number' }));
      expect(loadLockState().idleMins).toBe(5);
    });

    it('preserves explicit boolean false vs missing', () => {
      localStorage.setItem(LOCK_KEY, JSON.stringify({ locked: false, enabled: false }));
      const s = loadLockState();
      expect(s.locked).toBe(false);
      expect(s.enabled).toBe(false);
    });
  });

  describe('saveLockState + audit log integration', () => {
    it('round-trips state through localStorage', () => {
      const state = { locked: true, pinHash: 'abc', lockedAt: 123, idleMins: 10, enabled: true };
      saveLockState(state);
      const loaded = loadLockState();
      expect(loaded.locked).toBe(true);
      expect(loaded.idleMins).toBe(10);
      expect(loaded.enabled).toBe(true);
    });

    it('logs to audit when enabling lock for the first time', () => {
      saveLockState({ locked: false, pinHash: null, lockedAt: 0, idleMins: 5, enabled: true });
      const log = loadAuditLog();
      expect(log.length).toBeGreaterThan(0);
      expect(log[0].category).toBe('lock');
      expect(log[0].action).toBe('enabled');
    });

    it('logs as "disabled" when toggling enabled false', () => {
      saveLockState({ locked: false, pinHash: null, lockedAt: 0, idleMins: 5, enabled: true });
      saveLockState({ locked: false, pinHash: null, lockedAt: 0, idleMins: 5, enabled: false });
      const log = loadAuditLog();
      expect(log[0].action).toBe('disabled');
    });

    it('logs pin-set in details when pin is added', () => {
      saveLockState({ locked: false, pinHash: 'newhash', lockedAt: 0, idleMins: 5, enabled: true });
      const log = loadAuditLog();
      expect(log[0].details).toContain('pin-set');
    });

    it('logs pin-removed when pin is cleared', () => {
      saveLockState({ locked: false, pinHash: 'x', lockedAt: 0, idleMins: 5, enabled: true });
      saveLockState({ locked: false, pinHash: null, lockedAt: 0, idleMins: 5, enabled: true });
      const log = loadAuditLog();
      expect(log[0].details).toContain('pin-removed');
    });

    it('logs idle-mins delta when changed', () => {
      saveLockState({ locked: false, pinHash: null, lockedAt: 0, idleMins: 5, enabled: true });
      saveLockState({ locked: false, pinHash: null, lockedAt: 0, idleMins: 10, enabled: true });
      const log = loadAuditLog();
      expect(log[0].details).toMatch(/idle-mins:5.*10/);
    });
  });

  describe('hashPin', () => {
    it('returns a hex string', async () => {
      // hashPin is async — uses crypto.subtle in browser, may need polyfill
      // Skip if crypto.subtle isn't available in the test env
      if (typeof crypto !== 'undefined' && crypto.subtle) {
        const h = await hashPin('1234');
        expect(typeof h).toBe('string');
        expect(h.length).toBeGreaterThan(0);
      }
    });

    it('produces the same hash for the same pin', async () => {
      if (typeof crypto !== 'undefined' && crypto.subtle) {
        const h1 = await hashPin('1234');
        const h2 = await hashPin('1234');
        expect(h1).toBe(h2);
      }
    });

    it('produces different hashes for different pins', async () => {
      if (typeof crypto !== 'undefined' && crypto.subtle) {
        const h1 = await hashPin('1234');
        const h2 = await hashPin('5678');
        expect(h1).not.toBe(h2);
      }
    });
  });
});

describe('broker-storage', () => {
  describe('loadBrokerConfigs', () => {
    it('returns empty object when no config exists', () => {
      expect(loadBrokerConfigs()).toEqual({});
    });

    it('returns empty object on malformed JSON', () => {
      localStorage.setItem(BROKERS_STORAGE, '{not valid');
      expect(loadBrokerConfigs()).toEqual({});
    });

    it('round-trips a stored config', () => {
      const config = {
        ibkr:     { providerId: 'ibkr',     accountId: 'U1234', baseUrl: 'https://localhost:5000' },
        alpaca:   { providerId: 'alpaca',   accountId: 'PA001',  apiKey: '••••' },
      };
      saveBrokerConfigs(config);
      expect(loadBrokerConfigs()).toEqual(config);
    });
  });

  describe('saveBrokerConfigs + audit log integration', () => {
    it('logs broker added on first save', () => {
      saveBrokerConfigs({ ibkr: { providerId: 'ibkr', accountId: 'U1' } });
      const log = loadAuditLog();
      const ibkrLog = log.find(e => e.target === 'ibkr');
      expect(ibkrLog).toBeDefined();
      expect(ibkrLog.action).toBe('added');
    });

    it('logs broker updated when config changes', () => {
      saveBrokerConfigs({ ibkr: { providerId: 'ibkr', accountId: 'U1' } });
      saveBrokerConfigs({ ibkr: { providerId: 'ibkr', accountId: 'U2' } });
      const log = loadAuditLog();
      // Most recent should be 'updated'
      const updates = log.filter(e => e.target === 'ibkr' && e.action === 'updated');
      expect(updates.length).toBeGreaterThan(0);
    });

    it('logs broker removed when entry disappears', () => {
      saveBrokerConfigs({ ibkr: { providerId: 'ibkr', accountId: 'U1' } });
      saveBrokerConfigs({}); // remove all
      const log = loadAuditLog();
      const removes = log.filter(e => e.target === 'ibkr' && e.action === 'removed');
      expect(removes.length).toBe(1);
    });

    it('does not log when config is byte-identical', () => {
      const cfg = { ibkr: { providerId: 'ibkr', accountId: 'U1' } };
      saveBrokerConfigs(cfg);
      const before = loadAuditLog().length;
      saveBrokerConfigs(cfg); // idempotent save
      const after = loadAuditLog().length;
      expect(after).toBe(before);
    });

    it('dispatches imo:broker-config-changed CustomEvent', () => {
      saveBrokerConfigs({ ibkr: { providerId: 'ibkr', accountId: 'U1' } });
      const events = window.dispatchEvent.mock.calls.map(c => c[0].type);
      expect(events).toContain('imo:broker-config-changed');
    });
  });

  describe('saveActiveBroker', () => {
    it('defaults to paper account when not set', () => {
      const a = loadActiveBroker();
      expect(a.providerId).toBe('paper');
      expect(a.accountId).toBeNull();
    });

    it('round-trips active broker', () => {
      saveActiveBroker({ providerId: 'ibkr', accountId: 'U1234' });
      expect(loadActiveBroker()).toEqual({ providerId: 'ibkr', accountId: 'U1234' });
    });

    it('logs switched action when active broker changes', () => {
      saveActiveBroker({ providerId: 'ibkr', accountId: 'U1' });
      const log = loadAuditLog();
      const switched = log.find(e => e.action === 'switched');
      expect(switched).toBeDefined();
      expect(switched.target).toBe('ibkr');
    });

    it('does not log when broker is unchanged', () => {
      saveActiveBroker({ providerId: 'ibkr', accountId: 'U1' });
      const before = loadAuditLog().length;
      saveActiveBroker({ providerId: 'ibkr', accountId: 'U1' });
      const after = loadAuditLog().length;
      expect(after).toBe(before);
    });
  });
});

describe('safety-storage', () => {
  describe('loadSafetyState', () => {
    it('returns DEFAULT_SAFETY when no state exists', () => {
      expect(loadSafetyState()).toEqual(DEFAULT_SAFETY);
    });

    it('clamps countdownSec to [0, 15]', () => {
      localStorage.setItem(SAFETY_KEY, JSON.stringify({ countdownSec: 100 }));
      expect(loadSafetyState().countdownSec).toBe(15);
      localStorage.setItem(SAFETY_KEY, JSON.stringify({ countdownSec: -5 }));
      expect(loadSafetyState().countdownSec).toBe(0);
    });

    it('rejects negative thresholdUsd and falls back to default', () => {
      localStorage.setItem(SAFETY_KEY, JSON.stringify({ thresholdUsd: -1000 }));
      expect(loadSafetyState().thresholdUsd).toBe(DEFAULT_SAFETY.thresholdUsd);
    });
  });

  describe('saveSafetyState + audit log integration', () => {
    it('round-trips state', () => {
      const state = { enabled: true, thresholdUsd: 50_000, confirmAll: true, countdownSec: 5 };
      saveSafetyState(state);
      expect(loadSafetyState()).toEqual(state);
    });

    it('logs settings change on enable toggle', () => {
      saveSafetyState({ enabled: true, thresholdUsd: 10000, confirmAll: false, countdownSec: 3 });
      const log = loadAuditLog();
      const safety = log.find(e => e.category === 'settings' && e.action === 'safety-updated');
      expect(safety).toBeDefined();
      expect(safety.next.enabled).toBe(true);
    });

    it('does not log on no-op save', () => {
      saveSafetyState({ ...DEFAULT_SAFETY });
      const before = loadAuditLog().length;
      saveSafetyState({ ...DEFAULT_SAFETY }); // identical
      const after = loadAuditLog().length;
      expect(after).toBe(before);
    });
  });

  describe('appendSafetyAudit (legacy + unified mirror)', () => {
    it('writes to legacy storage AND to unified log', () => {
      appendSafetyAudit({ decision: 'confirmed', instrument: 'AAPL', notional: 25_000 });
      const legacy = loadSafetyAudit();
      const unified = loadAuditLog();
      expect(legacy.length).toBe(1);
      // Unified log should have a mirrored entry
      const mirrored = unified.find(e => e.action === 'safety-confirmed');
      expect(mirrored).toBeDefined();
      expect(mirrored.target).toBe('AAPL');
    });

    it('caps legacy storage at 100 entries', () => {
      for (let i = 0; i < 150; i++) {
        appendSafetyAudit({ decision: 'confirmed', instrument: `T${i}` });
      }
      expect(loadSafetyAudit().length).toBe(100);
    });
  });
});
