// IMO Onyx Terminal — snippets sync tests

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeSnippetsClient } from '../snippets-sync.js';

const makeShim = () => {
  const store = new Map();
  return {
    getItem: (k) => store.has(k) ? store.get(k) : null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    get length() { return store.size; },
    _store: store,
  };
};

beforeEach(() => {
  globalThis.localStorage = makeShim();
  globalThis.window = { dispatchEvent: vi.fn() };
  globalThis.CustomEvent = function (type, init) { return { type, detail: init?.detail }; };
});

const okJson = (data) => Promise.resolve({
  ok: true, status: 200,
  json: () => Promise.resolve(data),
});
const conflictJson = (data) => Promise.resolve({
  ok: false, status: 409,
  json: () => Promise.resolve(data),
});

describe('makeSnippetsClient — local-only operation', () => {
  it('save persists to localStorage even with no baseUrl', async () => {
    const client = makeSnippetsClient({});
    const r = await client.save({ title: 'My note', body: 'hello world' });
    expect(r.ok).toBe(true);
    const list = client.list();
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe('My note');
  });

  it('save assigns a client_id when missing', async () => {
    const client = makeSnippetsClient({});
    const r = await client.save({ title: 'X', body: 'y' });
    expect(r.snippet.client_id).toBeTypeOf('string');
    expect(r.snippet.client_id.length).toBeGreaterThan(5);
  });

  it('save reuses existing client_id when provided', async () => {
    const client = makeSnippetsClient({});
    await client.save({ client_id: 'cid-fixed', title: 'one', body: 'a' });
    await client.save({ client_id: 'cid-fixed', title: 'two', body: 'b' });
    const list = client.list();
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe('two');
  });

  it('list excludes archived snippets', async () => {
    const client = makeSnippetsClient({});
    const r = await client.save({ client_id: 'a', title: 'A', body: 'a' });
    await client.save({ client_id: 'b', title: 'B', body: 'b' });
    await client.delete('a');
    const list = client.list();
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe('B');
  });

  it('marks saves as dirty when no baseUrl', async () => {
    const client = makeSnippetsClient({});
    const r = await client.save({ title: 'X', body: 'y' });
    expect(r.pendingSync).toBe(true);
  });
});

describe('makeSnippetsClient — sync', () => {
  it('clears dirty flag on successful push', async () => {
    const fetchImpl = vi.fn().mockImplementation((url, opts) => {
      if (opts?.method === 'POST') {
        const body = JSON.parse(opts.body);
        return okJson({ ...body, version: 1, id: 99 });
      }
      return okJson({ snippets: [] });
    });
    const client = makeSnippetsClient({
      baseUrl: 'https://api.test',
      getToken: () => 'jwt-test',
      fetchImpl,
    });
    await client.save({ client_id: 'abc', title: 'X', body: 'y' });
    // After save, the inline POST should have cleared dirty
    const list = client.list();
    expect(list[0].dirty).toBe(false);
  });

  it('sends Authorization header with Bearer token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: () => Promise.resolve({}),
    });
    const client = makeSnippetsClient({
      baseUrl: 'https://api.test',
      getToken: () => 'mytoken',
      fetchImpl,
    });
    await client.save({ title: 'X', body: 'y' });
    const callArgs = fetchImpl.mock.calls[0];
    expect(callArgs[1].headers.Authorization).toBe('Bearer mytoken');
  });

  it('exposes 409 conflict via onConflict callback', async () => {
    const onConflict = vi.fn();
    const serverCopy = { client_id: 'abc', title: 'server-side', body: 'newer', version: 5 };
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false, status: 409,
      json: () => Promise.resolve({ server: serverCopy }),
    });
    const client = makeSnippetsClient({
      baseUrl: 'https://api.test',
      getToken: () => 't',
      onConflict,
      fetchImpl,
    });
    const r = await client.save({ client_id: 'abc', title: 'local-side', body: 'older' });
    expect(r.ok).toBe(false);
    expect(r.conflict).toBeDefined();
    expect(onConflict).toHaveBeenCalledTimes(1);
    expect(onConflict.mock.calls[0][0].server.title).toBe('server-side');
  });

  it('sync pulls server updates and clears dirty on push', async () => {
    let store = [];
    const fetchImpl = vi.fn().mockImplementation((url, opts) => {
      if ((opts?.method ?? 'GET') === 'GET') {
        return okJson({ snippets: store });
      }
      const body = JSON.parse(opts.body);
      const updated = { ...body, version: (body.version || 0) + 1 };
      store.push(updated);
      return okJson(updated);
    });
    const client = makeSnippetsClient({ baseUrl: 'https://api.test', fetchImpl });

    // Pre-populate one dirty snippet
    await client.save({ client_id: 'local-1', title: 'local', body: 'l' });

    // Add a server-side snippet that the pull should fetch
    store.push({
      client_id: 'server-1', title: 'server',
      body: 's', version: 3, archived: false,
    });

    const result = await client.sync();
    expect(result.ok).toBe(true);
    expect(result.pulled).toBeGreaterThanOrEqual(1);
    // After sync, all locally-stored snippets should not be dirty
    const list = client.list();
    expect(list.find(s => s.client_id === 'server-1')).toBeDefined();
  });

  it('sync without baseUrl fails fast', async () => {
    const client = makeSnippetsClient({});
    const r = await client.sync();
    expect(r.ok).toBe(false);
    expect(r.error).toBe('no baseUrl');
  });

  it('network failure does not lose local changes', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('net error'));
    const client = makeSnippetsClient({ baseUrl: 'https://api.test', fetchImpl });
    const r = await client.save({ client_id: 'abc', title: 'X', body: 'y' });
    expect(r.ok).toBe(true);
    // The save still went into localStorage even though the network failed
    const list = client.list();
    expect(list).toHaveLength(1);
    expect(list[0].dirty).toBe(true);
  });
});
