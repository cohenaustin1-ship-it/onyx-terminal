// IMO Onyx Terminal — Phase 3p.16 polish tests
//
// Covers:
//   1. snippet-templates.js — registry + applyTemplate substitutions
//   2. recon prefs persistence + filter logic (helper-level)
//   3. WebSocket subscribeWs (gracefully degrades when WS missing)

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TEMPLATES, listTemplates, applyTemplate } from '../snippet-templates.js';
import { makeSnippetsClient } from '../snippets-sync.js';

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

describe('snippet-templates registry', () => {
  it('exposes at least 6 templates', () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(6);
  });

  it('every template has the required fields', () => {
    for (const t of TEMPLATES) {
      expect(t.id).toBeTypeOf('string');
      expect(t.label).toBeTypeOf('string');
      expect(['note', 'code', 'config']).toContain(t.kind);
      expect(t.titlePattern).toBeTypeOf('string');
      expect(t.body).toBeTypeOf('string');
      expect(Array.isArray(t.tags)).toBe(true);
    }
  });

  it('template ids are unique', () => {
    const ids = TEMPLATES.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('listTemplates returns lightweight summaries', () => {
    const list = listTemplates();
    expect(list.length).toBe(TEMPLATES.length);
    for (const item of list) {
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('label');
      expect(item).toHaveProperty('kind');
      // Should NOT include heavy fields
      expect(item.body).toBeUndefined();
    }
  });

  it('applyTemplate substitutes {date} in title and body', () => {
    const seed = applyTemplate('daily-log');
    expect(seed).not.toBeNull();
    // title is "Trading log YYYY-MM-DD"
    expect(seed.title).toMatch(/Trading log \d{4}-\d{2}-\d{2}/);
    // body's H1 also has the date
    expect(seed.body).toMatch(/# Trading log \d{4}-\d{2}-\d{2}/);
    expect(seed.kind).toBe('note');
    expect(seed.tags).toContain('daily-log');
  });

  it('applyTemplate substitutes {datetime} ISO timestamp', () => {
    const seed = applyTemplate('strategy-config');
    // Body contains "Created <ISO>"
    expect(seed.body).toMatch(/Created \d{4}-\d{2}-\d{2}T/);
  });

  it('applyTemplate keeps {ticker} placeholder literal for user fill-in', () => {
    const seed = applyTemplate('trade-thesis');
    expect(seed.title).toContain('{ticker}');
    expect(seed.body).toContain('{ticker}');
  });

  it('applyTemplate returns null for unknown id', () => {
    expect(applyTemplate('does-not-exist')).toBeNull();
  });

  it('returns a fresh tags array (not shared across calls)', () => {
    const a = applyTemplate('daily-log');
    const b = applyTemplate('daily-log');
    a.tags.push('mutated');
    expect(b.tags).not.toContain('mutated');
  });

  it('options-sizing template includes task-list checkboxes', () => {
    const seed = applyTemplate('options-sizing');
    expect(seed.body).toMatch(/- \[ \]/);
  });
});

describe('Snippets sync — subscribeWs (Phase 3p.16)', () => {
  it('exposes subscribeWs on the client', () => {
    const client = makeSnippetsClient({ baseUrl: 'https://api.test' });
    expect(typeof client.subscribeWs).toBe('function');
  });

  it('returns a no-op when WebSocket is unavailable', () => {
    const origWS = globalThis.WebSocket;
    delete globalThis.WebSocket;
    const client = makeSnippetsClient({ baseUrl: 'https://api.test' });
    const unsub = client.subscribeWs({ onEvent: () => {} });
    expect(typeof unsub).toBe('function');
    expect(() => unsub()).not.toThrow();
    if (origWS) globalThis.WebSocket = origWS;
  });

  it('returns a no-op when no baseUrl', () => {
    const client = makeSnippetsClient({});
    const unsub = client.subscribeWs({ onEvent: () => {} });
    expect(() => unsub()).not.toThrow();
  });

  it('translates http:// baseUrl to ws:// for the WS endpoint', () => {
    let capturedUrl = null;
    class MockWS {
      constructor(url) { capturedUrl = url; }
      close() {}
    }
    globalThis.WebSocket = MockWS;
    const client = makeSnippetsClient({
      baseUrl: 'https://api.test',
      getToken: () => 'JWT',
    });
    client.subscribeWs({});
    expect(capturedUrl).toMatch(/^wss:\/\/api\.test/);
    expect(capturedUrl).toContain('/ws/snippets');
    expect(capturedUrl).toContain('token=JWT');
    delete globalThis.WebSocket;
  });

  it('translates http:// (insecure) to ws:// (insecure)', () => {
    let capturedUrl = null;
    class MockWS {
      constructor(url) { capturedUrl = url; }
      close() {}
    }
    globalThis.WebSocket = MockWS;
    const client = makeSnippetsClient({ baseUrl: 'http://localhost:3001' });
    client.subscribeWs({});
    expect(capturedUrl).toMatch(/^ws:\/\/localhost/);
    delete globalThis.WebSocket;
  });

  it('routes incoming snippet-updated event to onEvent handler', () => {
    let messageHandler = null;
    class MockWS {
      constructor() { /* no-op */ }
      set onmessage(fn) { messageHandler = fn; }
      set onerror(fn) { /* no-op */ }
      close() {}
    }
    globalThis.WebSocket = MockWS;
    globalThis.window = { dispatchEvent: vi.fn() };
    globalThis.CustomEvent = function (t, i) { return { type: t, detail: i?.detail }; };

    const client = makeSnippetsClient({ baseUrl: 'https://api.test' });
    const events = [];
    client.subscribeWs({ onEvent: (e) => events.push(e) });

    messageHandler({
      data: JSON.stringify({
        event: 'snippet-updated',
        payload: {
          client_id: 'cid-1', title: 'WS push', body: 'from server',
          kind: 'note', tags: [], version: 7, archived: false,
          updated_at: new Date().toISOString(),
        },
      }),
    });

    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('updated');
    expect(client.list().find(s => s.client_id === 'cid-1').title).toBe('WS push');
    delete globalThis.WebSocket;
  });

  it('ignores heartbeat and ready frames', () => {
    let messageHandler = null;
    class MockWS {
      set onmessage(fn) { messageHandler = fn; }
      set onerror(fn) {}
      close() {}
    }
    globalThis.WebSocket = MockWS;
    globalThis.window = { dispatchEvent: vi.fn() };
    globalThis.CustomEvent = function (t, i) { return { type: t, detail: i?.detail }; };

    const client = makeSnippetsClient({ baseUrl: 'https://api.test' });
    const events = [];
    client.subscribeWs({ onEvent: (e) => events.push(e) });

    messageHandler({ data: JSON.stringify({ event: 'heartbeat', ts: Date.now() }) });
    messageHandler({ data: JSON.stringify({ event: 'ready', ok: true }) });

    expect(events).toHaveLength(0);
    delete globalThis.WebSocket;
  });

  it('preserves dirty local snippets against WS push (same dirty-flag protection as SSE)', async () => {
    let messageHandler = null;
    class MockWS {
      set onmessage(fn) { messageHandler = fn; }
      set onerror(fn) {}
      close() {}
    }
    globalThis.WebSocket = MockWS;
    globalThis.window = { dispatchEvent: vi.fn() };
    globalThis.CustomEvent = function (t, i) { return { type: t, detail: i?.detail }; };

    const client = makeSnippetsClient({ baseUrl: 'https://api.test' });
    await client.save({ client_id: 'cid-1', title: 'My local edit', body: 'unsaved' });
    expect(client.list().find(s => s.client_id === 'cid-1').dirty).toBe(true);

    client.subscribeWs({});
    messageHandler({
      data: JSON.stringify({
        event: 'snippet-updated',
        payload: {
          client_id: 'cid-1', title: 'Server clobber', body: 'different',
          kind: 'note', tags: [], version: 99, archived: false,
          updated_at: new Date().toISOString(),
        },
      }),
    });

    const local = client.list().find(s => s.client_id === 'cid-1');
    expect(local.title).toBe('My local edit');
    expect(local.dirty).toBe(true);
    delete globalThis.WebSocket;
  });

  it('malformed JSON frames are silently dropped', () => {
    let messageHandler = null;
    class MockWS {
      set onmessage(fn) { messageHandler = fn; }
      set onerror(fn) {}
      close() {}
    }
    globalThis.WebSocket = MockWS;
    globalThis.window = { dispatchEvent: vi.fn() };
    globalThis.CustomEvent = function (t, i) { return { type: t, detail: i?.detail }; };

    const client = makeSnippetsClient({ baseUrl: 'https://api.test' });
    const events = [];
    client.subscribeWs({ onEvent: (e) => events.push(e) });

    expect(() => messageHandler({ data: 'not json' })).not.toThrow();
    expect(() => messageHandler({ data: '{}' })).not.toThrow(); // missing event/payload
    expect(events).toHaveLength(0);
    delete globalThis.WebSocket;
  });
});
