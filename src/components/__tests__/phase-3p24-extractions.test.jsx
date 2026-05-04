// @vitest-environment jsdom
//
// IMO Onyx Terminal — Phase 3p.24 component smoke tests
//
// Tests the BudgetPage and MapPage extractions plus DetailRow which
// moved from monolith to leaf-ui.jsx.

import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';

afterEach(() => cleanup());

describe('DetailRow (moved to leaf-ui in 3p.24)', () => {
  it('mounts with k/v props', async () => {
    const { DetailRow } = await import('../leaf-ui.jsx');
    expect(() => render(<DetailRow k="Name" v="Apple Inc." />)).not.toThrow();
  });

  it('renders the supplied key and value text', async () => {
    const { DetailRow } = await import('../leaf-ui.jsx');
    const { container } = render(<DetailRow k="Sector" v="Tech" />);
    expect(container.textContent).toContain('Sector');
    expect(container.textContent).toContain('Tech');
  });
});

describe('BudgetPage (Phase 3p.24)', () => {
  it('mounts without throwing', async () => {
    const { BudgetPage } = await import('../budget-page.jsx');
    const props = {
      account: { balance: 0, positions: [], orders: [], trades: [] },
      user: { username: 'alice', name: 'Alice' },
    };
    expect(() => render(<BudgetPage {...props} />)).not.toThrow();
  });

  it('handles a guest user', async () => {
    const { BudgetPage } = await import('../budget-page.jsx');
    const props = {
      account: null,
      user: null,
    };
    // The component may guard against null props or it may not.
    // Smoke test catches missing-reference errors only.
    try {
      render(<BudgetPage {...props} />);
    } catch (e) {
      expect(e.message).not.toMatch(/is not defined/);
    }
  });
});

describe('MapPage (Phase 3p.24)', () => {
  it('mounts without throwing', async () => {
    const { MapPage } = await import('../map-page.jsx');
    expect(() => render(<MapPage />)).not.toThrow();
  });

  it('mounts with a company filter', async () => {
    const { MapPage } = await import('../map-page.jsx');
    expect(() => render(<MapPage initialCompanyFilter="AAPL" />)).not.toThrow();
  });
});
