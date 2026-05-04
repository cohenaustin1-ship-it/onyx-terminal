// @vitest-environment jsdom
//
// IMO Onyx Terminal — Phase 3p.16 component tests
//
// Covers:
//   1. SnippetsPanel template picker — button opens picker, picking
//      a template seeds the editor
//   2. HoldingsReconciliationPanel — discrepancies-only toggle, broker
//      hide/show chips, prefs persist to localStorage
//   3. MarkdownNoteRenderer — mermaid extraction renders placeholder

import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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

describe('SnippetsPanel — template picker', () => {
  it('+ Template button opens the picker overlay', async () => {
    const { SnippetsPanel } = await import('../snippets-panel.jsx');
    render(<SnippetsPanel />);
    fireEvent.click(screen.getByTestId('open-template-picker'));
    expect(screen.getByTestId('template-picker')).toBeDefined();
    // Each registered template has a clickable button
    expect(screen.getByTestId('template-daily-log')).toBeDefined();
    expect(screen.getByTestId('template-trade-thesis')).toBeDefined();
    expect(screen.getByTestId('template-options-sizing')).toBeDefined();
  });

  it('clicking a template seeds the editor with its content', async () => {
    const { SnippetsPanel } = await import('../snippets-panel.jsx');
    render(<SnippetsPanel />);
    fireEvent.click(screen.getByTestId('open-template-picker'));
    fireEvent.click(screen.getByTestId('template-daily-log'));
    // Editor should now be open with title = "Trading log YYYY-MM-DD"
    const titleInput = screen.getByTestId('editor-title');
    expect(titleInput.value).toMatch(/Trading log \d{4}-\d{2}-\d{2}/);
    // Body has the daily-log structure
    const bodyInput = screen.getByTestId('editor-body');
    expect(bodyInput.value).toMatch(/## Market context/);
  });

  it('picker closes after a template is picked', async () => {
    const { SnippetsPanel } = await import('../snippets-panel.jsx');
    render(<SnippetsPanel />);
    fireEvent.click(screen.getByTestId('open-template-picker'));
    fireEvent.click(screen.getByTestId('template-daily-log'));
    expect(screen.queryByTestId('template-picker')).toBeNull();
  });

  it('Cancel button closes the picker without seeding', async () => {
    const { SnippetsPanel } = await import('../snippets-panel.jsx');
    render(<SnippetsPanel />);
    fireEvent.click(screen.getByTestId('open-template-picker'));
    fireEvent.click(screen.getByTestId('close-template-picker'));
    expect(screen.queryByTestId('template-picker')).toBeNull();
    expect(screen.queryByTestId('editor-title')).toBeNull();
  });

  it('template kind sets the editor kind correctly', async () => {
    const { SnippetsPanel } = await import('../snippets-panel.jsx');
    render(<SnippetsPanel />);
    fireEvent.click(screen.getByTestId('open-template-picker'));
    fireEvent.click(screen.getByTestId('template-strategy-config'));
    const kindSelect = screen.getByTestId('editor-kind');
    expect(kindSelect.value).toBe('config');
  });

  it('template tags pre-populate the tag editor', async () => {
    const { SnippetsPanel } = await import('../snippets-panel.jsx');
    render(<SnippetsPanel />);
    fireEvent.click(screen.getByTestId('open-template-picker'));
    fireEvent.click(screen.getByTestId('template-options-sizing'));
    expect(screen.getByTestId('tag-options')).toBeDefined();
    expect(screen.getByTestId('tag-risk')).toBeDefined();
  });
});

describe('HoldingsReconciliationPanel — view controls', () => {
  const accounts = [
    { broker: 'schwab', holdings: [
        { sym: 'AAPL', qty: 100, avgCost: 150, mark: 175 },
        { sym: 'MSFT', qty: 50,  avgCost: 380, mark: 420 },
    ]},
    { broker: 'fidelity', holdings: [
        { sym: 'AAPL', qty: 50,  avgCost: 160, mark: 175 },
    ]},
  ];

  it('discrepancies-only toggle filters rows', async () => {
    const { HoldingsReconciliationPanel } = await import('../settings-panels.jsx');
    // Inject a discrepancy by giving a localTrades that differs from
    // the schwab AAPL holding
    const localTrades = [
      // 90 sh AAPL on schwab — but reported 100 → discrepancy
      { sym: 'AAPL', side: 'buy', size: 90, price: 150, time: Date.now() - 1e9, broker: 'schwab' },
    ];
    render(<HoldingsReconciliationPanel accounts={accounts} localTrades={localTrades} />);
    // Both rows visible by default
    expect(screen.getByTestId('recon-row-AAPL')).toBeDefined();
    expect(screen.getByTestId('recon-row-MSFT')).toBeDefined();
    // Turn on discrepancies-only
    fireEvent.click(screen.getByTestId('discrepancies-only'));
    expect(screen.getByTestId('recon-row-AAPL')).toBeDefined();
    expect(screen.queryByTestId('recon-row-MSFT')).toBeNull();
  });

  it('clicking a broker chip hides that column', async () => {
    const { HoldingsReconciliationPanel } = await import('../settings-panels.jsx');
    render(<HoldingsReconciliationPanel accounts={accounts} />);
    // Both columns visible
    expect(screen.getByTestId('col-schwab')).toBeDefined();
    expect(screen.getByTestId('col-fidelity')).toBeDefined();
    // Hide fidelity
    fireEvent.click(screen.getByTestId('broker-toggle-fidelity'));
    expect(screen.getByTestId('col-schwab')).toBeDefined();
    expect(screen.queryByTestId('col-fidelity')).toBeNull();
  });

  it('preferences persist to localStorage', async () => {
    const { HoldingsReconciliationPanel } = await import('../settings-panels.jsx');
    render(<HoldingsReconciliationPanel accounts={accounts} />);
    fireEvent.click(screen.getByTestId('discrepancies-only'));
    fireEvent.click(screen.getByTestId('broker-toggle-fidelity'));
    // localStorage now has the prefs
    const raw = localStorage.getItem('imo_recon_prefs');
    expect(raw).toBeTruthy();
    const prefs = JSON.parse(raw);
    expect(prefs.discrepanciesOnly).toBe(true);
    expect(prefs.hiddenBrokers).toContain('fidelity');
  });

  it('preferences restore on remount', async () => {
    localStorage.setItem('imo_recon_prefs', JSON.stringify({
      discrepanciesOnly: false,
      hiddenBrokers: ['schwab'],
      columnOrder: ['fidelity', 'schwab'],
    }));
    const { HoldingsReconciliationPanel } = await import('../settings-panels.jsx');
    render(<HoldingsReconciliationPanel accounts={accounts} />);
    // schwab column hidden on initial render
    expect(screen.queryByTestId('col-schwab')).toBeNull();
    expect(screen.getByTestId('col-fidelity')).toBeDefined();
  });

  it('"show only discrepancies" with zero discrepancies shows empty-state', async () => {
    const { HoldingsReconciliationPanel } = await import('../settings-panels.jsx');
    // No localTrades = no computed comparison = no discrepancies
    render(<HoldingsReconciliationPanel accounts={accounts} />);
    fireEvent.click(screen.getByTestId('discrepancies-only'));
    expect(screen.getByText(/No discrepancies in current view/i)).toBeDefined();
  });
});

describe('MarkdownNoteRenderer — markdown polish', () => {
  it('extracts ```mermaid fences into a placeholder', async () => {
    const { SnippetsPanel } = await import('../snippets-panel.jsx');
    render(<SnippetsPanel />);
    fireEvent.click(screen.getByTestId('new-snippet'));
    fireEvent.change(screen.getByTestId('editor-title'), { target: { value: 'Diagram note' } });
    fireEvent.change(screen.getByTestId('editor-kind'),  { target: { value: 'note' } });
    fireEvent.change(screen.getByTestId('editor-body'), {
      target: { value: 'Before\n\n```mermaid\ngraph TD\nA-->B\n```\n\nAfter' },
    });
    await act(async () => fireEvent.click(screen.getByTestId('save-snippet')));
    // Mermaid block placeholder is rendered
    expect(screen.getByTestId('mermaid-block')).toBeDefined();
    expect(screen.getByText(/Mermaid diagram/i)).toBeDefined();
    expect(screen.getByText(/graph TD/)).toBeDefined();
  });

  it('renders task-list markdown via Streamdown (gfm)', async () => {
    const { SnippetsPanel } = await import('../snippets-panel.jsx');
    render(<SnippetsPanel />);
    fireEvent.click(screen.getByTestId('new-snippet'));
    fireEvent.change(screen.getByTestId('editor-title'), { target: { value: 'Tasks' } });
    fireEvent.change(screen.getByTestId('editor-kind'),  { target: { value: 'note' } });
    fireEvent.change(screen.getByTestId('editor-body'), {
      target: { value: '- [ ] First\n- [x] Done\n- [ ] Pending' },
    });
    await act(async () => fireEvent.click(screen.getByTestId('save-snippet')));
    // The markdown render container exists
    expect(screen.getByTestId('markdown-render')).toBeDefined();
    // Task content appears (Streamdown renders the items somewhere in the tree)
    expect(screen.getByText(/First/)).toBeDefined();
    expect(screen.getByText(/Done/)).toBeDefined();
  });

  it('handles a body with only a mermaid fence', async () => {
    const { SnippetsPanel } = await import('../snippets-panel.jsx');
    render(<SnippetsPanel />);
    fireEvent.click(screen.getByTestId('new-snippet'));
    fireEvent.change(screen.getByTestId('editor-title'), { target: { value: 'Just a diagram' } });
    fireEvent.change(screen.getByTestId('editor-kind'),  { target: { value: 'note' } });
    fireEvent.change(screen.getByTestId('editor-body'), {
      target: { value: '```mermaid\nflowchart LR\nstart-->end\n```' },
    });
    await act(async () => fireEvent.click(screen.getByTestId('save-snippet')));
    expect(screen.getByTestId('mermaid-block')).toBeDefined();
  });

  it('handles body with no mermaid fences (Streamdown handles all)', async () => {
    const { SnippetsPanel } = await import('../snippets-panel.jsx');
    render(<SnippetsPanel />);
    fireEvent.click(screen.getByTestId('new-snippet'));
    fireEvent.change(screen.getByTestId('editor-title'), { target: { value: 'Plain note' } });
    fireEvent.change(screen.getByTestId('editor-kind'),  { target: { value: 'note' } });
    fireEvent.change(screen.getByTestId('editor-body'), {
      target: { value: '# Hello\n\nJust **markdown**.' },
    });
    await act(async () => fireEvent.click(screen.getByTestId('save-snippet')));
    expect(screen.queryByTestId('mermaid-block')).toBeNull();
    expect(screen.getByTestId('markdown-render')).toBeDefined();
  });

  it('handles multiple mermaid blocks interleaved with prose', async () => {
    const { SnippetsPanel } = await import('../snippets-panel.jsx');
    render(<SnippetsPanel />);
    fireEvent.click(screen.getByTestId('new-snippet'));
    fireEvent.change(screen.getByTestId('editor-title'), { target: { value: 'Multi' } });
    fireEvent.change(screen.getByTestId('editor-kind'),  { target: { value: 'note' } });
    fireEvent.change(screen.getByTestId('editor-body'), {
      target: {
        value: 'First\n\n```mermaid\ngraph A\n```\n\nMiddle\n\n```mermaid\ngraph B\n```\n\nLast',
      },
    });
    await act(async () => fireEvent.click(screen.getByTestId('save-snippet')));
    const blocks = screen.getAllByTestId('mermaid-block');
    expect(blocks.length).toBe(2);
  });
});
