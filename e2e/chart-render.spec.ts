// IMO Onyx Terminal — Chart visual regression smoke test
//
// HONEST SCOPE NOTICE
// ===================
// This test cannot run in this repo's current test environment
// (Vitest + jsdom). It requires a live Chromium browser via
// Playwright. To run:
//
//   npm install --save-dev @playwright/test
//   npx playwright install
//   npm run dev          (in one terminal)
//   npm run test:e2e     (in another)
//
// The first run with `--update-snapshots` generates baselines.
// Subsequent runs compare against baselines and fail on diffs.

import { test, expect } from '@playwright/test';

test.describe('Chart visual regression', () => {
  test.beforeEach(async ({ page }) => {
    // Mock the chart's price data so renders are deterministic.
    // Without this, the chart pulls live prices and screenshots vary.
    await page.addInitScript(() => {
      window.__IMO_FROZEN_TS__ = Date.parse('2024-06-15T00:00:00Z');
      window.__IMO_FROZEN_PRICES__ = true;
    });
    await page.goto('/');
    // Dismiss onboarding modal if present
    await page.locator('button:has-text("Skip")').click({ timeout: 2000 }).catch(() => {});
  });

  test('renders BTC-PERP chart at 1D × 1m', async ({ page }) => {
    // Navigate to the trade page
    await page.locator('a:has-text("Trade")').click();
    // Pick BTC-PERP (it's the default, but be explicit)
    await page.locator('[data-testid="ticker-search"]').fill('BTC-PERP');
    await page.locator('[data-testid="ticker-result-BTC-PERP"]').click();
    // Range = 1D, Interval = 1m
    await page.locator('[data-testid="range-1D"]').click();
    await page.locator('[data-testid="interval-1m"]').click();
    await page.waitForTimeout(500); // chart settle

    const chart = page.locator('[data-testid="price-chart"]');
    await expect(chart).toHaveScreenshot('btc-perp-1d-1m.png');
  });

  test('renders AAPL chart at 1Y × 1d', async ({ page }) => {
    await page.locator('a:has-text("Trade")').click();
    await page.locator('[data-testid="ticker-search"]').fill('AAPL');
    await page.locator('[data-testid="ticker-result-AAPL"]').click();
    await page.locator('[data-testid="range-1Y"]').click();
    await page.locator('[data-testid="interval-1d"]').click();
    await page.waitForTimeout(500);

    const chart = page.locator('[data-testid="price-chart"]');
    await expect(chart).toHaveScreenshot('aapl-1y-1d.png');
  });

  test('disables invalid frequency combinations', async ({ page }) => {
    await page.locator('a:has-text("Trade")').click();
    await page.locator('[data-testid="range-5Y"]').click();
    // 1m on 5Y should be disabled
    const btn1m = page.locator('[data-testid="interval-1m"]');
    await expect(btn1m).toBeDisabled();
  });

  test('frequency reconciliation on range change', async ({ page }) => {
    await page.locator('a:has-text("Trade")').click();
    // Pick a sticky 1m frequency on 1D range
    await page.locator('[data-testid="range-1D"]').click();
    await page.locator('[data-testid="interval-1m"]').click();
    // Switch to 5Y — 1m should auto-reconcile to weekly
    await page.locator('[data-testid="range-5Y"]').click();
    const interval1m = page.locator('[data-testid="interval-1m"]');
    await expect(interval1m).not.toHaveAttribute('aria-pressed', 'true');
  });
});
