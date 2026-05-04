// IMO Onyx Terminal — native platform shim tests
//
// Verifies the web-fallback paths work correctly. Native paths are
// not exercised here because Capacitor's runtime detection requires
// an actual native shell — those paths are covered by manual QA on
// device builds.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  isNative,
  getPlatform,
  secureGet,
  secureSet,
  secureRemove,
  shareContent,
  setStatusBarStyle,
  onAppStateChange,
} from '../native-platform.js';

const makeShim = () => {
  const store = new Map();
  return {
    getItem: (k) => store.has(k) ? store.get(k) : null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    get length() { return store.size; },
    _store: store,
  };
};

beforeEach(() => {
  globalThis.localStorage = makeShim();
});

describe('Platform detection', () => {
  it('isNative returns false in node test env', async () => {
    expect(await isNative()).toBe(false);
  });
  it('getPlatform returns "web" in node test env', async () => {
    expect(await getPlatform()).toBe('web');
  });
});

describe('Secure storage — web fallback', () => {
  it('secureSet stores under imo_native_ prefix', async () => {
    await secureSet('schwab.refresh', 'TOKEN123');
    expect(localStorage.getItem('imo_native_schwab.refresh')).toBe('TOKEN123');
  });
  it('secureGet retrieves what was stored', async () => {
    await secureSet('foo', 'bar');
    expect(await secureGet('foo')).toBe('bar');
  });
  it('secureGet returns null for missing keys', async () => {
    expect(await secureGet('does.not.exist')).toBeNull();
  });
  it('secureRemove deletes the key', async () => {
    await secureSet('temp', 'value');
    await secureRemove('temp');
    expect(await secureGet('temp')).toBeNull();
  });
  it('coerces non-string values to strings', async () => {
    await secureSet('num', 42);
    expect(await secureGet('num')).toBe('42');
  });
  it('isolates from non-prefixed localStorage keys', async () => {
    localStorage.setItem('foo', 'unprefixed');
    await secureSet('foo', 'prefixed');
    expect(await secureGet('foo')).toBe('prefixed');
    expect(localStorage.getItem('foo')).toBe('unprefixed');
    expect(localStorage.getItem('imo_native_foo')).toBe('prefixed');
  });
});

describe('Share — web fallback', () => {
  it('falls back to navigator.share when available', async () => {
    const shareMock = vi.fn().mockResolvedValue();
    vi.stubGlobal('navigator', { share: shareMock });
    const r = await shareContent({ title: 'hi', text: 'world' });
    expect(r.ok).toBe(true);
    expect(r.method).toBe('web-share');
    expect(shareMock).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it('falls back to clipboard when navigator.share is missing', async () => {
    const writeText = vi.fn().mockResolvedValue();
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const r = await shareContent({ title: 'T', text: 'X', url: 'https://u' });
    expect(r.ok).toBe(true);
    expect(r.method).toBe('clipboard');
    expect(writeText).toHaveBeenCalledOnce();
    const arg = writeText.mock.calls[0][0];
    expect(arg).toContain('T');
    expect(arg).toContain('X');
    expect(arg).toContain('https://u');
    vi.unstubAllGlobals();
  });

  it('returns ok=false with reason when no share mechanism', async () => {
    vi.stubGlobal('navigator', {});
    const r = await shareContent({ title: 'T', text: 'X' });
    expect(r.ok).toBe(false);
    expect(r.method).toBe('none');
    vi.unstubAllGlobals();
  });

  it('reports cancelled when user dismisses native share', async () => {
    const err = new Error('cancelled');
    err.name = 'AbortError';
    const shareMock = vi.fn().mockRejectedValue(err);
    vi.stubGlobal('navigator', { share: shareMock });
    const r = await shareContent({ title: 'T' });
    expect(r.ok).toBe(false);
    expect(r.cancelled).toBe(true);
    vi.unstubAllGlobals();
  });
});

describe('Status bar', () => {
  it('setStatusBarStyle returns false on web (no-op)', async () => {
    expect(await setStatusBarStyle('DARK')).toBe(false);
  });
});

describe('App state change subscription', () => {
  it('subscribes to visibilitychange on web', () => {
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    globalThis.document = { hidden: false, addEventListener, removeEventListener };
    const cb = vi.fn();
    const unsub = onAppStateChange(cb);
    expect(addEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    unsub();
    expect(removeEventListener).toHaveBeenCalled();
  });

  it('cb fires when document hidden flips', () => {
    let visListener;
    globalThis.document = {
      hidden: false,
      addEventListener: (evt, fn) => { if (evt === 'visibilitychange') visListener = fn; },
      removeEventListener: () => {},
    };
    const cb = vi.fn();
    onAppStateChange(cb);
    globalThis.document.hidden = true;
    visListener();
    expect(cb).toHaveBeenCalledWith({ isActive: false });
    globalThis.document.hidden = false;
    visListener();
    expect(cb).toHaveBeenCalledWith({ isActive: true });
  });
});
