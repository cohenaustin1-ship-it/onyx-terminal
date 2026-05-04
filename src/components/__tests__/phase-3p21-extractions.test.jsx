// @vitest-environment jsdom
//
// IMO Onyx Terminal — Phase 3p.21 component smoke tests
//
// Same pattern as 3p.19 / 3p.20: jsdom-rendered minimal-props mounts
// to catch missing-reference regressions during extraction.

import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';

afterEach(() => cleanup());

describe('AlphaArenaPage (Phase 3p.21)', () => {
  it('mounts without throwing', async () => {
    const { AlphaArenaPage } = await import('../alpha-arena-page.jsx');
    const props = {
      user: { username: 'alice' },
      account: { balance: 0, positions: [], orders: [], trades: [] },
      setPage: vi.fn(),
    };
    expect(() => render(<AlphaArenaPage {...props} />)).not.toThrow();
  });

  it('handles a guest (no user.username)', async () => {
    const { AlphaArenaPage } = await import('../alpha-arena-page.jsx');
    const props = {
      user: null,
      account: { balance: 0, positions: [], orders: [], trades: [] },
      setPage: vi.fn(),
    };
    expect(() => render(<AlphaArenaPage {...props} />)).not.toThrow();
  });
});

describe('AITradeIdeaBacktesterTab (Phase 3p.21)', () => {
  it('mounts without throwing', async () => {
    const { AITradeIdeaBacktesterTab } = await import('../ai-trade-idea-backtester-tab.jsx');
    // Pass minimal props — the component may take instrument/account
    // depending on the signature. Try the no-prop case first to flush
    // out missing references.
    expect(() => render(<AITradeIdeaBacktesterTab />)).not.toThrow();
  });
});

describe('FeedPage + UserProfileModal (Phase 3p.21)', () => {
  it('FeedPage mounts without throwing', async () => {
    const { FeedPage } = await import('../feed-page.jsx');
    const props = {
      user: { username: 'alice', name: 'Alice', handle: '@alice' },
      account: { balance: 0, positions: [], orders: [], trades: [] },
      setPage: vi.fn(),
      updateUser: vi.fn(),
    };
    expect(() => render(<FeedPage {...props} />)).not.toThrow();
  });

  it('UserProfileModal mounts for a known handle', async () => {
    const { UserProfileModal } = await import('../feed-page.jsx');
    expect(() => render(<UserProfileModal handle="@lillywatch" onClose={vi.fn()} />)).not.toThrow();
  });

  it('UserProfileModal mounts for an unknown handle (fallback profile)', async () => {
    const { UserProfileModal } = await import('../feed-page.jsx');
    expect(() => render(<UserProfileModal handle="@some-stranger" onClose={vi.fn()} />)).not.toThrow();
  });
});
