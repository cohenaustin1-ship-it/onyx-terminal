// IMO Onyx Terminal — snippets cloud sync client
//
// Phase 3p.11 / Addition 1. Client-side complement to the executor's
// /snippets endpoints. Owns:
//   - Local cache in localStorage (imo_snippets)
//   - Background sync via timer + visibility events
//   - Conflict resolution UX (HTTP 409 → expose server copy + local
//     copy so the user can pick)
//   - Stable client_id generation (UUID v4-ish, persisted)
//
// Storage shape:
//   imo_snippets = { [client_id]: { client_id, title, body, kind,
//                                    tags, version, archived,
//                                    updated_at, dirty: bool } }
//   imo_snippets_lastSync = unix timestamp of last successful pull
//
// `dirty: true` marks a snippet that has local changes not yet pushed.
// On sync, dirty snippets get pushed; non-dirty snippets accept server
// updates as authoritative.
//
// Honest scope:
//   - Only network connectivity, no operational transformation.
//     Last-write-wins by version. Conflicts exposed to caller as a
//     resolution choice rather than auto-merged.
//   - No realtime push (no SSE/WebSocket). Pull on-demand or on a
//     timer (default 60s).
//   - Encryption is the server's job (TLS + at-rest encrypted PG
//     volume). Client doesn't double-encrypt.
//
// Public exports:
//   makeSnippetsClient({ baseUrl, getToken, onConflict })
//                              Returns { list, save, delete, sync }
//                              with the user's snippets API.

const STORAGE_KEY = 'imo_snippets';
const LAST_SYNC_KEY = 'imo_snippets_lastSync';

const generateClientId = () => {
  // Crypto-quality if available, fallback to Math.random
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `snip-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const loadLocal = () => {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return (typeof parsed === 'object' && parsed !== null) ? parsed : {};
  } catch { return {}; }
};

const saveLocal = (snippets) => {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snippets));
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('imo:snippets-changed'));
    }
  } catch {}
};

const getLastSync = () => {
  try {
    return parseInt(localStorage.getItem(LAST_SYNC_KEY), 10) || 0;
  } catch { return 0; }
};

const setLastSync = (ts) => {
  try { localStorage.setItem(LAST_SYNC_KEY, String(ts)); } catch {}
};

export const makeSnippetsClient = ({
  baseUrl,
  getToken = () => '',
  onConflict = null,
  fetchImpl = (typeof fetch !== 'undefined' ? fetch : null),
} = {}) => {
  const headers = () => {
    const h = { 'Content-Type': 'application/json' };
    const t = getToken();
    if (t) h['Authorization'] = `Bearer ${t}`;
    return h;
  };

  const list = () => {
    const local = loadLocal();
    return Object.values(local).filter(s => !s.archived);
  };

  const save = async (input) => {
    // Input: { client_id?, title, body, kind?, tags? }
    const local = loadLocal();
    const client_id = input.client_id || generateClientId();
    const existing = local[client_id];
    const updated = {
      client_id,
      title: input.title,
      body:  input.body,
      kind:  input.kind ?? 'note',
      tags:  Array.isArray(input.tags) ? input.tags : [],
      version: existing?.version ?? 0,
      archived: false,
      updated_at: new Date().toISOString(),
      dirty: true,
    };
    local[client_id] = updated;
    saveLocal(local);

    // Try push immediately. Failures stay marked dirty for retry.
    if (baseUrl && fetchImpl) {
      try {
        const r = await fetchImpl(`${baseUrl}/snippets`, {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify(updated),
        });
        if (r.status === 409) {
          // Conflict — expose to caller for resolution
          const data = await r.json();
          if (typeof onConflict === 'function') {
            onConflict({ local: updated, server: data.server });
          }
          return { ok: false, conflict: data };
        }
        if (r.ok) {
          const server = await r.json();
          local[client_id] = { ...server, dirty: false };
          saveLocal(local);
          return { ok: true, snippet: server };
        }
      } catch {
        // Network error — local copy is dirty, will retry next sync
      }
    }
    return { ok: true, snippet: updated, pendingSync: true };
  };

  const remove = async (client_id) => {
    const local = loadLocal();
    if (!local[client_id]) return { ok: false, error: 'not found' };
    local[client_id].archived = true;
    local[client_id].dirty = true;
    saveLocal(local);

    if (baseUrl && fetchImpl) {
      try {
        await fetchImpl(`${baseUrl}/snippets/${encodeURIComponent(client_id)}`, {
          method: 'DELETE',
          headers: headers(),
        });
        local[client_id].dirty = false;
        saveLocal(local);
      } catch {}
    }
    return { ok: true };
  };

  const sync = async () => {
    if (!baseUrl || !fetchImpl) return { ok: false, error: 'no baseUrl' };
    const since = getLastSync();
    let pulled = 0, pushed = 0, conflicts = 0;

    // Pull: fetch updates since last sync
    try {
      const url = `${baseUrl}/snippets${since ? `?sinceTs=${since}` : ''}`;
      const r = await fetchImpl(url, { headers: headers() });
      if (r.ok) {
        const data = await r.json();
        const local = loadLocal();
        for (const server of data.snippets || []) {
          const cid = server.client_id;
          const localCopy = local[cid];
          if (!localCopy || !localCopy.dirty) {
            // Server is authoritative
            local[cid] = { ...server, dirty: false };
            pulled++;
          }
          // If localCopy.dirty, the push pass below will handle it.
        }
        saveLocal(local);
        setLastSync(Date.now());
      }
    } catch {}

    // Push: send any dirty local snippets
    const local = loadLocal();
    for (const snippet of Object.values(local)) {
      if (!snippet.dirty) continue;
      try {
        const r = await fetchImpl(`${baseUrl}/snippets`, {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify(snippet),
        });
        if (r.status === 409) {
          conflicts++;
          if (typeof onConflict === 'function') {
            const data = await r.json();
            onConflict({ local: snippet, server: data.server });
          }
        } else if (r.ok) {
          const server = await r.json();
          local[snippet.client_id] = { ...server, dirty: false };
          pushed++;
        }
      } catch {}
    }
    saveLocal(local);
    return { ok: true, pulled, pushed, conflicts };
  };

  // Subscribe to server-side push events via SSE. When supported,
  // this replaces (or augments) the 60s poll. Returns an unsubscribe
  // function. Fails gracefully if EventSource is unavailable or the
  // connection drops — caller can still rely on the poll.
  //
  // Note: the browser EventSource API doesn't accept Authorization
  // headers, so the JWT travels as a query param. The server must
  // accept tokens that way for /snippets/stream specifically.
  const subscribe = (handlers = {}) => {
    if (!baseUrl) return () => {};
    if (typeof EventSource === 'undefined') return () => {};
    const t = getToken();
    const url = `${baseUrl}/snippets/stream${t ? `?token=${encodeURIComponent(t)}` : ''}`;
    let es;
    try { es = new EventSource(url); }
    catch { return () => {}; }

    const handleSnippet = (event, payload) => {
      // Server pushes us the canonical record. Merge into local cache,
      // preserving any local dirty state (the user may be editing).
      const local = loadLocal();
      const existing = local[payload.client_id];
      if (existing && existing.dirty) return; // user has unsaved changes; ignore
      local[payload.client_id] = { ...payload, dirty: false };
      saveLocal(local);
      if (typeof handlers.onEvent === 'function') {
        handlers.onEvent({ event, payload });
      }
    };

    es.addEventListener('snippet-created', (e) => {
      try { handleSnippet('created', JSON.parse(e.data)); } catch {}
    });
    es.addEventListener('snippet-updated', (e) => {
      try { handleSnippet('updated', JSON.parse(e.data)); } catch {}
    });
    es.addEventListener('snippet-deleted', (e) => {
      try { handleSnippet('deleted', JSON.parse(e.data)); } catch {}
    });
    es.addEventListener('error', (e) => {
      if (typeof handlers.onError === 'function') handlers.onError(e);
    });

    return () => {
      try { es.close(); } catch {}
    };
  };

  // WebSocket-based alternative to subscribe() (Phase 3p.16). Same
  // semantics — the local cache is updated when server pushes arrive,
  // dirty-flag protection still applies. Useful when SSE is blocked
  // by intermediate proxies or when bidirectional transport is desired
  // for future features (typing indicators, presence).
  //
  // Honest scope: WS is more infra than SSE for the SAME delivery
  // semantics. We use it via /ws/snippets only when the caller opts
  // in. JWT auth via ?token= query param (browser WS can't set headers).
  // No client-side reconnect; if the connection drops, fall back to
  // the next sync().
  const subscribeWs = (handlers = {}) => {
    if (!baseUrl) return () => {};
    if (typeof WebSocket === 'undefined') return () => {};
    // Translate baseUrl http(s) → ws(s)
    const wsBase = baseUrl.replace(/^http/, 'ws');
    const t = getToken();
    const url = `${wsBase}/ws/snippets${t ? `?token=${encodeURIComponent(t)}` : ''}`;
    let ws;
    try { ws = new WebSocket(url); }
    catch { return () => {}; }

    ws.onmessage = (msg) => {
      let payload;
      try { payload = JSON.parse(msg.data); } catch { return; }
      const evtName = payload?.event;
      const data = payload?.payload;
      if (!evtName || !data) return;
      if (evtName === 'heartbeat' || evtName === 'ready') return;
      // Same handling as SSE: respect dirty flag
      const local = loadLocal();
      const existing = local[data.client_id];
      if (existing && existing.dirty) return;
      local[data.client_id] = { ...data, dirty: false };
      saveLocal(local);
      if (typeof handlers.onEvent === 'function') {
        handlers.onEvent({ event: evtName.replace(/^snippet-/, ''), payload: data });
      }
    };
    ws.onerror = (e) => {
      if (typeof handlers.onError === 'function') handlers.onError(e);
    };

    return () => {
      try { ws.close(); } catch {}
    };
  };

  return { list, save, delete: remove, sync, subscribe, subscribeWs };
};
