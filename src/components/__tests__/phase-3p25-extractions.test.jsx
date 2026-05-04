// @vitest-environment jsdom
//
// IMO Onyx Terminal — Phase 3p.25 component smoke tests
//
// Tests the QuantLabPage extraction (Tier C, first cut). The page is
// huge (~4,800 lines including VolForecastMode + 4 inlined fixtures
// + workflow compiler) so smoke-mounting catches missing-reference
// regressions efficiently.

import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';

afterEach(() => cleanup());

describe('QuantLabPage (Phase 3p.25)', () => {
  it('mounts without throwing', async () => {
    const { QuantLabPage } = await import('../quant-lab-page.jsx');
    const props = {
      instrument: { ticker: 'AAPL', name: 'Apple Inc.', sector: 'Tech' },
      setActive:  vi.fn(),
    };
    expect(() => render(<QuantLabPage {...props} />)).not.toThrow();
  });

  it('mounts with a different instrument', async () => {
    const { QuantLabPage } = await import('../quant-lab-page.jsx');
    const props = {
      instrument: { ticker: 'SPY', name: 'SPDR S&P 500 ETF Trust', sector: 'ETF' },
      setActive:  vi.fn(),
    };
    expect(() => render(<QuantLabPage {...props} />)).not.toThrow();
  });

  it('mounts with no instrument (guest)', async () => {
    const { QuantLabPage } = await import('../quant-lab-page.jsx');
    // The component may guard against null props or it may not.
    // Smoke test catches missing-reference errors only.
    try {
      render(<QuantLabPage instrument={null} setActive={vi.fn()} />);
    } catch (e) {
      expect(e.message).not.toMatch(/is not defined/);
    }
  });
});
