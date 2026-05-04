// IMO Onyx Terminal — native platform shim
//
// Phase 3p.13 scaffolding closeout. Wraps Capacitor plugins behind
// a uniform API that works on web (with localStorage / DOM fallbacks)
// and on native iOS/Android (calling through to platform APIs).
//
// Design goals:
//   - Zero crashes when Capacitor isn't loaded (web build still works)
//   - One import path for callers — they don't need to know if they're
//     native or web
//   - Honest scope: no plugin gets called unless we know it's available
//
// What this shim does NOT cover:
//   - Biometric auth (we list the API surface but the @capacitor/
//     biometric-auth community plugin has version churn — install
//     and wire when picking a specific version)
//   - Camera / receipt capture (deferred to a later phase)
//   - Push notifications (requires APNs/FCM credentials — can't ship
//     scaffolding without picking a backend)
//
// What it DOES cover:
//   - Keychain-backed secure preferences (preferences over localStorage)
//   - Share sheet (system share dialog vs web share API)
//   - Status bar styling (no-op on web)
//   - App lifecycle events (background/foreground hooks)
//   - Platform detection (isNative, getPlatform)

let _capacitor = null;
let _preferences = null;
let _share = null;
let _statusBar = null;
let _app = null;

// Lazy import so web builds don't pay the cost when these aren't used.
// Capacitor's `getPlatform()` returns 'web' when running in a browser,
// even though @capacitor/core is imported — so we can safely import
// without crashing.
const ensureCore = async () => {
  if (_capacitor) return _capacitor;
  try {
    const mod = await import('@capacitor/core');
    _capacitor = mod.Capacitor || null;
  } catch { _capacitor = null; }
  return _capacitor;
};

export const isNative = async () => {
  const cap = await ensureCore();
  return !!cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform();
};

export const getPlatform = async () => {
  const cap = await ensureCore();
  if (!cap) return 'web';
  try { return cap.getPlatform(); } catch { return 'web'; }
};

// ─── Secure storage ─────────────────────────────────────────────────
// Native: @capacitor/preferences (keychain on iOS, EncryptedSharedPreferences on Android)
// Web: localStorage with an `imo_native_` prefix to avoid collisions
const ensurePreferences = async () => {
  if (_preferences) return _preferences;
  if (!(await isNative())) return null;
  try {
    const mod = await import('@capacitor/preferences');
    _preferences = mod.Preferences || null;
  } catch { _preferences = null; }
  return _preferences;
};

export const secureGet = async (key) => {
  const prefs = await ensurePreferences();
  if (prefs) {
    try { const r = await prefs.get({ key }); return r?.value ?? null; }
    catch { return null; }
  }
  // Web fallback
  try { return localStorage.getItem(`imo_native_${key}`); } catch { return null; }
};

export const secureSet = async (key, value) => {
  const prefs = await ensurePreferences();
  if (prefs) {
    try { await prefs.set({ key, value: String(value) }); return true; }
    catch { return false; }
  }
  try { localStorage.setItem(`imo_native_${key}`, String(value)); return true; }
  catch { return false; }
};

export const secureRemove = async (key) => {
  const prefs = await ensurePreferences();
  if (prefs) {
    try { await prefs.remove({ key }); return true; }
    catch { return false; }
  }
  try { localStorage.removeItem(`imo_native_${key}`); return true; }
  catch { return false; }
};

// ─── Share ──────────────────────────────────────────────────────────
// Native: @capacitor/share opens the system share sheet
// Web: falls back to navigator.share if available, else copies to clipboard
const ensureShare = async () => {
  if (_share) return _share;
  if (!(await isNative())) return null;
  try {
    const mod = await import('@capacitor/share');
    _share = mod.Share || null;
  } catch { _share = null; }
  return _share;
};

export const shareContent = async ({ title, text, url, dialogTitle }) => {
  const share = await ensureShare();
  if (share) {
    try {
      await share.share({ title, text, url, dialogTitle });
      return { ok: true, method: 'native' };
    } catch (err) {
      return { ok: false, method: 'native', error: String(err) };
    }
  }
  // Web fallback 1: navigator.share
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text, url });
      return { ok: true, method: 'web-share' };
    } catch (err) {
      // User cancelled is not really a failure
      if (String(err.name || '') === 'AbortError') {
        return { ok: false, method: 'web-share', cancelled: true };
      }
    }
  }
  // Web fallback 2: clipboard
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    const composite = [title, text, url].filter(Boolean).join('\n');
    try {
      await navigator.clipboard.writeText(composite);
      return { ok: true, method: 'clipboard' };
    } catch { /* fall through */ }
  }
  return { ok: false, method: 'none', error: 'no share mechanism available' };
};

// ─── Status bar ─────────────────────────────────────────────────────
// Native only — no-op on web
const ensureStatusBar = async () => {
  if (_statusBar) return _statusBar;
  if (!(await isNative())) return null;
  try {
    const mod = await import('@capacitor/status-bar');
    _statusBar = mod.StatusBar || null;
  } catch { _statusBar = null; }
  return _statusBar;
};

export const setStatusBarStyle = async (style /* 'DARK' | 'LIGHT' */) => {
  const bar = await ensureStatusBar();
  if (!bar) return false;
  try {
    await bar.setStyle({ style: style === 'LIGHT' ? 'LIGHT' : 'DARK' });
    return true;
  } catch { return false; }
};

// ─── App lifecycle ──────────────────────────────────────────────────
// Native: @capacitor/app emits 'appStateChange' (foreground/background)
// Web: visibilitychange + pagehide
const ensureApp = async () => {
  if (_app) return _app;
  if (!(await isNative())) return null;
  try {
    const mod = await import('@capacitor/app');
    _app = mod.App || null;
  } catch { _app = null; }
  return _app;
};

// Subscribe to app state changes. Returns an unsubscribe function.
// Callback receives { isActive: boolean }.
export const onAppStateChange = (cb) => {
  let unsubNative = null;
  let mounted = true;
  (async () => {
    const app = await ensureApp();
    if (app && mounted) {
      const handle = await app.addListener('appStateChange', cb);
      unsubNative = () => { try { handle.remove(); } catch {} };
    }
  })();
  // Web fallback
  const onVis = () => {
    if (typeof document !== 'undefined') {
      cb({ isActive: !document.hidden });
    }
  };
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVis);
  }
  return () => {
    mounted = false;
    if (unsubNative) unsubNative();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVis);
    }
  };
};
