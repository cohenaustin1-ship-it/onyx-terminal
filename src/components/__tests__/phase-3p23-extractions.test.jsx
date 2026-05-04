// @vitest-environment jsdom
//
// IMO Onyx Terminal — Phase 3p.23 component smoke tests
//
// Pattern: jsdom-rendered minimal-props mounts to catch missing-
// reference regressions. Plus a unit test for scanner-config.js
// since it's a lib module (not a component).

import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';

afterEach(() => cleanup());

describe('scanner-config (Phase 3p.23)', () => {
  it('exports the expected surface', async () => {
    const m = await import('../../lib/scanner-config.js');
    expect(typeof m.DETECTOR_DEFAULTS).toBe('object');
    expect(Object.keys(m.DETECTOR_DEFAULTS).length).toBeGreaterThan(10);
    expect(Array.isArray(m.SETUP_RULES)).toBe(true);
    expect(m.SETUP_RULES.length).toBeGreaterThan(10);
    expect(Array.isArray(m.INVESTOR_LENSES)).toBe(true);
    expect(m.INVESTOR_LENSES.length).toBeGreaterThan(5);
    expect(Array.isArray(m.HEDGE_FUND_AGENTS)).toBe(true);
    expect(m.HEDGE_FUND_AGENTS.length).toBe(5);
    expect(typeof m.SCANNER_DEFAULT_WATCHLIST).toBe('string');
    expect(m.SCANNER_DEFAULT_WATCHLIST.length).toBeGreaterThan(50);
    expect(m.SCANNER_CONFIG_KEY).toBe('imo_scanner_config');
    expect(m.SCANNER_HISTORY_KEY).toBe('imo_scanner_history');
  });

  it('SETUP_RULES detectors all have id + label + detect()', async () => {
    const { SETUP_RULES } = await import('../../lib/scanner-config.js');
    for (const r of SETUP_RULES) {
      expect(typeof r.id).toBe('string');
      expect(typeof r.label).toBe('string');
      expect(typeof r.detect).toBe('function');
    }
  });

  it('INVESTOR_LENSES all have id + promptCore + horizon', async () => {
    const { INVESTOR_LENSES } = await import('../../lib/scanner-config.js');
    for (const l of INVESTOR_LENSES) {
      expect(typeof l.id).toBe('string');
      expect(typeof l.promptCore).toBe('string');
      expect(['short', 'medium', 'long']).toContain(l.horizon);
    }
  });
});

describe('ScannerPage (Phase 3p.23)', () => {
  it('mounts without throwing', async () => {
    const { ScannerPage } = await import('../scanner-page.jsx');
    const props = {
      setActive: vi.fn(),
      setPage:   vi.fn(),
    };
    expect(() => render(<ScannerPage {...props} />)).not.toThrow();
  });
});
