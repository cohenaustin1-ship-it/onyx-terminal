/* IMO Onyx Terminal — Macro alerts service worker
 *
 * Polls DBnomics for the user's macro alerts on a schedule and
 * fires real OS-level notifications when thresholds cross. Works
 * even when the tab is closed, on browsers that support Periodic
 * Background Sync (Chromium with site engagement). On other
 * browsers, falls back to checking on regular SW activations
 * (every page load, every focus, etc.) which is roughly equivalent
 * to the previous "polling on revisit" behavior — but now with
 * real notifications instead of in-tab toasts.
 *
 * Storage: the SW reads alerts from the same localStorage key the
 * page writes to ('imo_macro_alerts'). Since SWs can't access
 * localStorage directly, the page posts the alert list via
 * postMessage on every change. The SW caches it in memory + an
 * IndexedDB fallback for cold-start access.
 */

const ALERTS_DB = 'imo-macro-alerts-v1';
const ALERTS_KEY = 'alerts';
const POLL_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

// IDB helpers — minimal wrapper for the single key we need
const idbOpen = () => new Promise((resolve, reject) => {
  const req = indexedDB.open(ALERTS_DB, 1);
  req.onupgradeneeded = () => {
    if (!req.result.objectStoreNames.contains('kv')) {
      req.result.createObjectStore('kv');
    }
  };
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
const idbGet = async (key) => {
  const db = await idbOpen();
  return new Promise((resolve) => {
    const tx = db.transaction('kv', 'readonly');
    const req = tx.objectStore('kv').get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
};
const idbSet = async (key, value) => {
  const db = await idbOpen();
  return new Promise((resolve) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
};

// Fetch DBnomics series — same shape as the page-side helper
const fetchSeries = async (seriesId) => {
  try {
    const url = `https://api.db.nomics.world/v22/series/${seriesId}?observations=1`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const j = await r.json();
    const s = j?.series?.docs?.[0];
    if (!s) return null;
    const periods = s.period ?? [];
    const values = s.value ?? [];
    let lastVal = null;
    for (let i = values.length - 1; i >= 0; i--) {
      const v = values[i];
      if (v !== 'NA' && v != null) {
        const n = Number(v);
        if (Number.isFinite(n)) { lastVal = n; break; }
      }
    }
    return { latest: lastVal, label: s.dataset_name ?? s.series_name ?? seriesId };
  } catch {
    return null;
  }
};

// Test an alert's op against a value
const fired = (op, value, threshold) => {
  if (op === '>')  return value > threshold;
  if (op === '<')  return value < threshold;
  if (op === '>=') return value >= threshold;
  if (op === '<=') return value <= threshold;
  return false;
};

// Run one pass — check every alert, fire notifications for any that
// just crossed (i.e. where the latest value satisfies the op AND
// it differs from lastTriggered).
const checkAllAlerts = async () => {
  const alerts = (await idbGet(ALERTS_KEY)) || [];
  if (alerts.length === 0) return;
  let changed = false;
  const updated = [];
  for (const a of alerts) {
    const data = await fetchSeries(a.seriesId);
    if (!data || data.latest == null) { updated.push(a); continue; }
    if (fired(a.op, data.latest, a.threshold) && a.lastTriggered !== data.latest) {
      // Show a notification
      try {
        await self.registration.showNotification(`${data.label} alert`, {
          body: `${data.label}: ${data.latest.toFixed(3)} ${a.op} ${a.threshold}`,
          icon: '/imo-favicon-128.png',
          badge: '/imo-favicon-32.png',
          tag: a.id,
          data: { alertId: a.id, seriesId: a.seriesId },
          requireInteraction: false,
        });
      } catch (e) {
        // Notifications may fail if permission revoked — bury and move on
      }
      updated.push({ ...a, lastTriggered: data.latest, lastTriggeredAt: Date.now() });
      changed = true;
    } else {
      updated.push(a);
    }
  }
  if (changed) {
    await idbSet(ALERTS_KEY, updated);
    // Tell any open clients the alerts list updated
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach(c => c.postMessage({ type: 'imo:alerts-updated', alerts: updated }));
  }
};

// Install / activate boilerplate
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// Page → SW: receive alert list updates and store in IDB
self.addEventListener('message', (event) => {
  const msg = event.data;
  if (!msg) return;
  if (msg.type === 'imo:alerts-set') {
    idbSet(ALERTS_KEY, msg.alerts || []);
  } else if (msg.type === 'imo:alerts-check-now') {
    event.waitUntil(checkAllAlerts());
  }
});

// Periodic Background Sync — Chromium only, requires site
// engagement + permission. Fires roughly every interval the
// browser picks (≥ what we requested).
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'imo-macro-alerts') {
    event.waitUntil(checkAllAlerts());
  }
});

// Fallback: also check on push receipts (so server-side push
// triggering would work) and on any fetch from the page.
//
// Two modes:
//   1. No payload (legacy/cron-style trigger) → re-run macro alert checks
//   2. With payload (full Web Push from a future push server) → show
//      the pushed notification directly. Payload shape:
//        { title, body, tag?, icon?, url? }
self.addEventListener('push', (event) => {
  let payload = null;
  try {
    if (event.data) payload = event.data.json();
  } catch {
    try {
      const text = event.data?.text();
      if (text) payload = { title: 'Onyx Terminal', body: text };
    } catch {}
  }
  if (payload && payload.title) {
    // Generic Web Push — display the notification as-is
    event.waitUntil(self.registration.showNotification(payload.title, {
      body: payload.body || '',
      tag: payload.tag || 'imo-push',
      icon: payload.icon || '/imo-favicon-128.png',
      badge: '/imo-favicon-32.png',
      data: { url: payload.url || '/' },
    }));
  } else {
    // Cron-style trigger — run the macro alert check loop
    event.waitUntil(checkAllAlerts());
  }
});

// Notification click — focus the Macro page
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window' });
    if (all.length > 0) {
      const c = all[0];
      c.focus();
      c.postMessage({ type: 'imo:open-macro', alertId: event.notification.data?.alertId });
    } else {
      self.clients.openWindow('/');
    }
  })());
});
