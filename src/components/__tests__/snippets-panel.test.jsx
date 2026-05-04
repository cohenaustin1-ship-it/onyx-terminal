// @vitest-environment jsdom
//
// IMO Onyx Terminal — SnippetsPanel component test
//
// Verifies UI rendering, list/edit/delete flows, search, sync button
// invocation, and conflict resolution UI.
//
// Tests run in offline mode (no executorUrl) by default to keep them
// fast and deterministic. The "executor configured" path is exercised
// with a mocked fetch that returns canned responses.

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { SnippetsPanel } from '../snippets-panel.jsx';

// localStorage shim shared across tests (the sync client uses it)
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

describe('<SnippetsPanel /> — empty state', () => {
  it('renders the panel header', () => {
    render(<SnippetsPanel executorUrl="" />);
    expect(screen.getByText(/^Snippets$/)).toBeDefined();
  });

  it('shows offline-mode hint when no executorUrl is configured', () => {
    render(<SnippetsPanel executorUrl="" />);
    expect(screen.getByText(/saved locally only/i)).toBeDefined();
  });

  it('shows empty list message when no snippets exist', () => {
    render(<SnippetsPanel executorUrl="" />);
    expect(screen.getByText(/No snippets yet/i)).toBeDefined();
  });
});

describe('<SnippetsPanel /> — create flow', () => {
  it('+ New button opens an empty editor', () => {
    render(<SnippetsPanel executorUrl="" />);
    fireEvent.click(screen.getByTestId('new-snippet'));
    expect(screen.getByTestId('editor-title')).toBeDefined();
    expect(screen.getByTestId('editor-body')).toBeDefined();
    expect(screen.getByTestId('save-snippet')).toBeDefined();
  });

  it('Save button is disabled when title is blank', () => {
    render(<SnippetsPanel executorUrl="" />);
    fireEvent.click(screen.getByTestId('new-snippet'));
    const saveBtn = screen.getByTestId('save-snippet');
    expect(saveBtn.hasAttribute('disabled')).toBe(true);
  });

  it('Save persists the snippet and refreshes the list', async () => {
    render(<SnippetsPanel executorUrl="" />);
    fireEvent.click(screen.getByTestId('new-snippet'));
    fireEvent.change(screen.getByTestId('editor-title'), { target: { value: 'Test note' } });
    fireEvent.change(screen.getByTestId('editor-body'),  { target: { value: 'hello world' } });
    fireEvent.click(screen.getByTestId('save-snippet'));

    await waitFor(() => {
      expect(screen.getByText('Test note')).toBeDefined();
    });
  });

  it('Cancel button discards the editor without saving', () => {
    render(<SnippetsPanel executorUrl="" />);
    fireEvent.click(screen.getByTestId('new-snippet'));
    fireEvent.change(screen.getByTestId('editor-title'), { target: { value: 'Throwaway' } });
    fireEvent.click(screen.getByTestId('cancel-edit'));
    // Empty list shouldn't show "Throwaway" anywhere
    expect(screen.queryByText('Throwaway')).toBeNull();
  });

  it('saving with a kind selection persists kind correctly', async () => {
    render(<SnippetsPanel executorUrl="" />);
    fireEvent.click(screen.getByTestId('new-snippet'));
    fireEvent.change(screen.getByTestId('editor-title'), { target: { value: 'My code' } });
    fireEvent.change(screen.getByTestId('editor-kind'),  { target: { value: 'code' } });
    fireEvent.change(screen.getByTestId('editor-body'),  { target: { value: 'console.log(42)' } });
    fireEvent.click(screen.getByTestId('save-snippet'));
    await waitFor(() => {
      // The list item should show kind label "Code"
      expect(screen.getByText(/Code · /)).toBeDefined();
    });
  });
});

describe('<SnippetsPanel /> — search and select', () => {
  const seed = (panel) => {
    fireEvent.click(panel.getByTestId('new-snippet'));
    fireEvent.change(panel.getByTestId('editor-title'), { target: { value: 'Alpha note' } });
    fireEvent.change(panel.getByTestId('editor-body'),  { target: { value: 'aaa' } });
    fireEvent.click(panel.getByTestId('save-snippet'));
  };

  it('search filters by title (case-insensitive)', async () => {
    const panel = render(<SnippetsPanel executorUrl="" />);
    seed(panel);
    // Add another with different title
    fireEvent.click(panel.getByTestId('new-snippet'));
    fireEvent.change(panel.getByTestId('editor-title'), { target: { value: 'Beta config' } });
    fireEvent.change(panel.getByTestId('editor-body'),  { target: { value: 'bbb' } });
    fireEvent.click(panel.getByTestId('save-snippet'));

    await waitFor(() => {
      expect(panel.getByText('Alpha note')).toBeDefined();
      expect(panel.getByText('Beta config')).toBeDefined();
    });

    fireEvent.change(panel.getByTestId('search-input'), { target: { value: 'alpha' } });

    expect(panel.queryByText('Beta config')).toBeNull();
    expect(panel.getByText('Alpha note')).toBeDefined();
  });

  it('search filters by body text', async () => {
    const panel = render(<SnippetsPanel executorUrl="" />);
    seed(panel);
    fireEvent.click(panel.getByTestId('new-snippet'));
    fireEvent.change(panel.getByTestId('editor-title'), { target: { value: 'Beta' } });
    fireEvent.change(panel.getByTestId('editor-body'),  { target: { value: 'unique-token-xyz' } });
    fireEvent.click(panel.getByTestId('save-snippet'));

    await waitFor(() => expect(panel.getAllByText('Beta').length).toBeGreaterThan(0));
    fireEvent.change(panel.getByTestId('search-input'), { target: { value: 'unique-token' } });
    expect(panel.queryByText('Alpha note')).toBeNull();
    expect(panel.getAllByText('Beta').length).toBeGreaterThan(0);
  });

  it('shows "No matches" when search has no results', async () => {
    const panel = render(<SnippetsPanel executorUrl="" />);
    seed(panel);
    await waitFor(() => expect(panel.getByText('Alpha note')).toBeDefined());
    fireEvent.change(panel.getByTestId('search-input'), { target: { value: 'qqqq-no-match' } });
    expect(panel.getByText(/No matches/i)).toBeDefined();
  });
});

describe('<SnippetsPanel /> — edit existing', () => {
  it('clicking a snippet selects it and shows view mode', async () => {
    render(<SnippetsPanel executorUrl="" />);
    fireEvent.click(screen.getByTestId('new-snippet'));
    fireEvent.change(screen.getByTestId('editor-title'), { target: { value: 'Original title' } });
    fireEvent.change(screen.getByTestId('editor-body'),  { target: { value: 'original body' } });
    fireEvent.click(screen.getByTestId('save-snippet'));

    await waitFor(() => expect(screen.getByText('Original title')).toBeDefined());
    // Click the list item to select
    const listItem = screen.getAllByText('Original title')[0].closest('button');
    fireEvent.click(listItem);
    // Should show view mode with Edit/Delete
    expect(screen.getByTestId('edit-snippet')).toBeDefined();
    expect(screen.getByTestId('delete-snippet')).toBeDefined();
  });

  it('Edit button switches to editor with prefilled fields', async () => {
    render(<SnippetsPanel executorUrl="" />);
    fireEvent.click(screen.getByTestId('new-snippet'));
    fireEvent.change(screen.getByTestId('editor-title'), { target: { value: 'Edit me' } });
    fireEvent.change(screen.getByTestId('editor-body'),  { target: { value: 'original' } });
    fireEvent.click(screen.getByTestId('save-snippet'));

    await waitFor(() => expect(screen.getByText('Edit me')).toBeDefined());
    fireEvent.click(screen.getAllByText('Edit me')[0].closest('button'));
    fireEvent.click(screen.getByTestId('edit-snippet'));

    const titleInput = screen.getByTestId('editor-title');
    expect(titleInput.value).toBe('Edit me');
  });

  it('saving an edit updates the snippet', async () => {
    render(<SnippetsPanel executorUrl="" />);
    fireEvent.click(screen.getByTestId('new-snippet'));
    fireEvent.change(screen.getByTestId('editor-title'), { target: { value: 'Old title' } });
    fireEvent.change(screen.getByTestId('editor-body'),  { target: { value: 'x' } });
    fireEvent.click(screen.getByTestId('save-snippet'));

    await waitFor(() => expect(screen.getByText('Old title')).toBeDefined());
    fireEvent.click(screen.getAllByText('Old title')[0].closest('button'));
    fireEvent.click(screen.getByTestId('edit-snippet'));
    fireEvent.change(screen.getByTestId('editor-title'), { target: { value: 'New title' } });
    fireEvent.click(screen.getByTestId('save-snippet'));

    await waitFor(() => expect(screen.getByText('New title')).toBeDefined());
    expect(screen.queryByText('Old title')).toBeNull();
  });
});

describe('<SnippetsPanel /> — delete', () => {
  it('Delete with confirm removes the snippet', async () => {
    const confirmSpy = vi.fn(() => true);
    globalThis.window = globalThis.window ?? {};
    globalThis.window.confirm = confirmSpy;

    render(<SnippetsPanel executorUrl="" />);
    fireEvent.click(screen.getByTestId('new-snippet'));
    fireEvent.change(screen.getByTestId('editor-title'), { target: { value: 'To be deleted' } });
    fireEvent.change(screen.getByTestId('editor-body'),  { target: { value: 'x' } });
    fireEvent.click(screen.getByTestId('save-snippet'));

    await waitFor(() => expect(screen.getByText('To be deleted')).toBeDefined());
    fireEvent.click(screen.getAllByText('To be deleted')[0].closest('button'));
    fireEvent.click(screen.getByTestId('delete-snippet'));

    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText('To be deleted')).toBeNull());
  });

  it('Cancel on confirm dialog does NOT delete', async () => {
    globalThis.window = globalThis.window ?? {};
    globalThis.window.confirm = vi.fn(() => false);

    render(<SnippetsPanel executorUrl="" />);
    fireEvent.click(screen.getByTestId('new-snippet'));
    fireEvent.change(screen.getByTestId('editor-title'), { target: { value: 'Keep me' } });
    fireEvent.change(screen.getByTestId('editor-body'),  { target: { value: 'x' } });
    fireEvent.click(screen.getByTestId('save-snippet'));

    await waitFor(() => expect(screen.getByText('Keep me')).toBeDefined());
    fireEvent.click(screen.getAllByText('Keep me')[0].closest('button'));
    fireEvent.click(screen.getByTestId('delete-snippet'));

    // Still there
    expect(screen.getAllByText('Keep me').length).toBeGreaterThan(0);
  });
});

describe('<SnippetsPanel /> — sync', () => {
  it('shows sync controls when executorUrl is configured', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: () => Promise.resolve({ snippets: [] }),
    });
    globalThis.fetch = fetchImpl;

    render(<SnippetsPanel executorUrl="https://api.test" />);
    expect(screen.getByTestId('sync-now')).toBeDefined();
  });

  it('does NOT show sync controls when executorUrl is empty', () => {
    render(<SnippetsPanel executorUrl="" />);
    expect(screen.queryByTestId('sync-now')).toBeNull();
  });

  it('Sync now button triggers a fetch', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: () => Promise.resolve({ snippets: [] }),
    });
    globalThis.fetch = fetchImpl;

    render(<SnippetsPanel executorUrl="https://api.test" />);

    // Wait for initial mount tick to settle, then click manual
    await waitFor(() => {
      expect(fetchImpl).toHaveBeenCalled();
    });
    const initialCalls = fetchImpl.mock.calls.length;

    fireEvent.click(screen.getByTestId('sync-now'));
    await waitFor(() => {
      expect(fetchImpl.mock.calls.length).toBeGreaterThan(initialCalls);
    });
  });
});

describe('<SnippetsPanel /> — conflict resolution', () => {
  it('conflict resolver appears when 409 fires during save', async () => {
    // Mock fetch to return 409 with a server copy
    const serverCopy = {
      client_id: 'cid-1',
      title: 'Server version',
      body: 'server body',
      version: 5,
      kind: 'note',
      tags: [],
      updated_at: new Date().toISOString(),
    };
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation((url, opts) => {
      callCount++;
      if (opts?.method === 'POST') {
        return Promise.resolve({
          ok: false, status: 409,
          json: () => Promise.resolve({ server: serverCopy }),
        });
      }
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ snippets: [] }),
      });
    });

    render(<SnippetsPanel executorUrl="https://api.test" />);

    // Create a snippet — the POST will 409, triggering the conflict UI
    fireEvent.click(screen.getByTestId('new-snippet'));
    fireEvent.change(screen.getByTestId('editor-title'), { target: { value: 'Local version' } });
    fireEvent.change(screen.getByTestId('editor-body'),  { target: { value: 'local body' } });
    fireEvent.click(screen.getByTestId('save-snippet'));

    await waitFor(() => {
      expect(screen.queryByTestId('conflict-resolver')).not.toBeNull();
    }, { timeout: 2000 });

    expect(screen.getByTestId('keep-mine')).toBeDefined();
    expect(screen.getByTestId('take-theirs')).toBeDefined();
  });
});
