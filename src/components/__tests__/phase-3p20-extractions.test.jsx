// @vitest-environment jsdom
//
// IMO Onyx Terminal — Phase 3p.20 component smoke tests
//
// Verifies the four newly-extracted components mount without
// throwing. Same approach as 3p.19: jsdom-rendered with minimal
// props, focused on catching import/wiring regressions like the
// generateLEI bug that 3p.19 caught for CreateAccountModal.

import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';

afterEach(() => cleanup());

describe('LockScreen (Phase 3p.20)', () => {
  it('mounts in unlock stage when pinHash is set', async () => {
    const { LockScreen } = await import('../lock-screen.jsx');
    const props = {
      user: { username: 'alice', name: 'Alice' },
      lockState: { pinHash: 'previously-set-hash', salt: 'previously-set-salt', attempts: 0 },
      onUnlock: vi.fn(),
      onSignOut: vi.fn(),
    };
    expect(() => render(<LockScreen {...props} />)).not.toThrow();
  });

  it('mounts in set stage on first run (no pinHash)', async () => {
    const { LockScreen } = await import('../lock-screen.jsx');
    const props = {
      user: { username: 'alice' },
      lockState: { pinHash: null, salt: null, attempts: 0 },
      onUnlock: vi.fn(),
      onSignOut: vi.fn(),
    };
    expect(() => render(<LockScreen {...props} />)).not.toThrow();
  });
});

describe('SmartMoneyTab (Phase 3p.20)', () => {
  it('mounts without throwing', async () => {
    const { SmartMoneyTab } = await import('../smart-money-tab.jsx');
    const setActive = vi.fn();
    const setPage = vi.fn();
    expect(() => render(<SmartMoneyTab setActive={setActive} setPage={setPage} />)).not.toThrow();
  });
});

describe('AIMarkdown (Phase 3p.20)', () => {
  it('mounts with empty children', async () => {
    const { AIMarkdown } = await import('../ai-markdown.jsx');
    expect(() => render(<AIMarkdown>{''}</AIMarkdown>)).not.toThrow();
  });

  it('mounts with simple markdown', async () => {
    const { AIMarkdown } = await import('../ai-markdown.jsx');
    expect(() => render(<AIMarkdown>**hello** world</AIMarkdown>)).not.toThrow();
  });

  it('accepts size prop without throwing', async () => {
    const { AIMarkdown } = await import('../ai-markdown.jsx');
    for (const size of ['xs', 'sm', 'md']) {
      expect(() => render(<AIMarkdown size={size}>test</AIMarkdown>)).not.toThrow();
      cleanup();
    }
  });
});

describe('AIAgentPanel (Phase 3p.20)', () => {
  it('mounts with minimal props', async () => {
    const { AIAgentPanel } = await import('../ai-agent-panel.jsx');
    const props = {
      instrument: { id: 'AAPL', label: 'Apple', cls: 'equity' },
      page: 'chart',
      account: { balance: 0, positions: [], orders: [], trades: [] },
      onClose: vi.fn(),
      setPage: vi.fn(),
    };
    expect(() => render(<AIAgentPanel {...props} />)).not.toThrow();
  });
});
