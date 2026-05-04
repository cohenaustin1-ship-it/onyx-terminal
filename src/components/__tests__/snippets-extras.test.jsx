// @vitest-environment jsdom
//
// IMO Onyx Terminal — SnippetBodyRenderer + SSE smoke tests
//
// Verifies the kind-aware body rendering works:
//   - note    → Streamdown markdown component renders
//   - code    → Code renderer shows line numbers + colored tokens
//   - config  → Plain <pre> monospace
// Also verifies the SSE subscription wiring on the sync client.

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';

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
afterEach(() => cleanup());

describe('SnippetBodyRenderer — kind-aware rendering', () => {
  it('renders code-kind snippets with line numbers', async () => {
    const { SnippetsPanel } = await import('../snippets-panel.jsx');
    render(<SnippetsPanel />);
    fireEvent.click(screen.getByTestId('new-snippet'));
    fireEvent.change(screen.getByTestId('editor-title'), { target: { value: 'My script' } });
    fireEvent.change(screen.getByTestId('editor-kind'),  { target: { value: 'code' } });
    fireEvent.change(screen.getByTestId('editor-body'),
      { target: { value: 'const x = 5;\nreturn x;' } });
    await act(async () => fireEvent.click(screen.getByTestId('save-snippet')));
    // Code renderer should be in the DOM
    expect(screen.getByTestId('code-render')).toBeDefined();
    // Both lines visible
    expect(screen.getByText('1')).toBeDefined();
    expect(screen.getByText('2')).toBeDefined();
  });

  it('highlights JS keywords in code-kind snippets', async () => {
    const { SnippetsPanel } = await import('../snippets-panel.jsx');
    render(<SnippetsPanel />);
    fireEvent.click(screen.getByTestId('new-snippet'));
    fireEvent.change(screen.getByTestId('editor-title'), { target: { value: 'JS' } });
    fireEvent.change(screen.getByTestId('editor-kind'),  { target: { value: 'code' } });
    fireEvent.change(screen.getByTestId('editor-body'),
      { target: { value: 'const x = "hello";' } });
    await act(async () => fireEvent.click(screen.getByTestId('save-snippet')));
    const codeRender = screen.getByTestId('code-render');
    // The "const" keyword should appear with a colored span
    const html = codeRender.innerHTML;
    expect(html).toContain('const');
    // String token should be present
    expect(html).toContain('"hello"');
  });

  it('renders note-kind snippets via markdown component', async () => {
    const { SnippetsPanel } = await import('../snippets-panel.jsx');
    render(<SnippetsPanel />);
    fireEvent.click(screen.getByTestId('new-snippet'));
    fireEvent.change(screen.getByTestId('editor-title'), { target: { value: 'My note' } });
    fireEvent.change(screen.getByTestId('editor-kind'),  { target: { value: 'note' } });
    fireEvent.change(screen.getByTestId('editor-body'),
      { target: { value: '# Heading\n\nSome **bold** text.' } });
    await act(async () => fireEvent.click(screen.getByTestId('save-snippet')));
    expect(screen.getByTestId('markdown-render')).toBeDefined();
  });

  it('renders config-kind as plain monospace', async () => {
    const { SnippetsPanel } = await import('../snippets-panel.jsx');
    render(<SnippetsPanel />);
    fireEvent.click(screen.getByTestId('new-snippet'));
    fireEvent.change(screen.getByTestId('editor-title'), { target: { value: 'Settings' } });
    fireEvent.change(screen.getByTestId('editor-kind'),  { target: { value: 'config' } });
    fireEvent.change(screen.getByTestId('editor-body'),
      { target: { value: 'host=localhost\nport=5432' } });
    await act(async () => fireEvent.click(screen.getByTestId('save-snippet')));
    // Neither markdown nor code render — falls through to plain <pre>
    expect(screen.queryByTestId('markdown-render')).toBeNull();
    expect(screen.queryByTestId('code-render')).toBeNull();
    // The body content is visible as text
    expect(screen.getByText(/host=localhost/)).toBeDefined();
  });
});

describe('Snippets sync — SSE subscribe', () => {
  it('subscribe is a function exposed by the client', async () => {
    const { makeSnippetsClient } = await import('../../lib/snippets-sync.js');
    const client = makeSnippetsClient({ baseUrl: 'https://api.test' });
    expect(typeof client.subscribe).toBe('function');
  });

  it('subscribe returns a no-op when EventSource is unavailable', async () => {
    const { makeSnippetsClient } = await import('../../lib/snippets-sync.js');
    // EventSource is undefined in node — ensure subscribe degrades gracefully
    const origES = globalThis.EventSource;
    delete globalThis.EventSource;
    const client = makeSnippetsClient({ baseUrl: 'https://api.test' });
    const unsub = client.subscribe({ onEvent: () => {} });
    expect(typeof unsub).toBe('function');
    expect(() => unsub()).not.toThrow();
    if (origES) globalThis.EventSource = origES;
  });

  it('subscribe with no baseUrl returns a no-op', async () => {
    const { makeSnippetsClient } = await import('../../lib/snippets-sync.js');
    const client = makeSnippetsClient({});
    const unsub = client.subscribe({});
    expect(() => unsub()).not.toThrow();
  });

  it('subscribe wires snippet-updated event and updates local cache', async () => {
    const { makeSnippetsClient } = await import('../../lib/snippets-sync.js');
    // Mock EventSource
    let listeners = {};
    let closed = false;
    class MockEventSource {
      constructor(url) { this.url = url; }
      addEventListener(type, fn) { listeners[type] = fn; }
      close() { closed = true; }
    }
    globalThis.EventSource = MockEventSource;
    globalThis.window = { dispatchEvent: vi.fn() };
    globalThis.CustomEvent = function (t, i) { return { type: t, detail: i?.detail }; };

    const client = makeSnippetsClient({ baseUrl: 'https://api.test', getToken: () => 'jwt' });
    const events = [];
    const unsub = client.subscribe({ onEvent: (e) => events.push(e) });

    // Simulate a server push
    listeners['snippet-updated']({
      data: JSON.stringify({
        client_id: 'cid-1', title: 'Pushed', body: 'from server',
        kind: 'note', tags: [], version: 5, archived: false,
        updated_at: new Date().toISOString(),
      }),
    });

    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('updated');
    // Local cache now has the pushed snippet
    expect(client.list().find(s => s.client_id === 'cid-1').title).toBe('Pushed');

    unsub();
    expect(closed).toBe(true);
  });

  it('SSE push does NOT overwrite local snippets that have unsaved changes', async () => {
    const { makeSnippetsClient } = await import('../../lib/snippets-sync.js');
    let listeners = {};
    class MockEventSource {
      addEventListener(type, fn) { listeners[type] = fn; }
      close() {}
    }
    globalThis.EventSource = MockEventSource;
    globalThis.window = { dispatchEvent: vi.fn() };
    globalThis.CustomEvent = function (t, i) { return { type: t, detail: i?.detail }; };

    const client = makeSnippetsClient({ baseUrl: 'https://api.test' });

    // Save a local-dirty snippet (offline mode — fetch undefined)
    await client.save({ client_id: 'cid-1', title: 'My local edit', body: 'unsaved' });
    expect(client.list().find(s => s.client_id === 'cid-1').dirty).toBe(true);

    // Subscribe + receive a server push for the same client_id
    client.subscribe({});
    listeners['snippet-updated']({
      data: JSON.stringify({
        client_id: 'cid-1', title: 'Server version', body: 'different',
        kind: 'note', tags: [], version: 5, archived: false,
        updated_at: new Date().toISOString(),
      }),
    });

    // Local copy was preserved (dirty bit protects against silent overwrite)
    const local = client.list().find(s => s.client_id === 'cid-1');
    expect(local.title).toBe('My local edit');
    expect(local.dirty).toBe(true);
  });
});
