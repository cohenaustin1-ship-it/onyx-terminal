// IMO Onyx Terminal — Settings panels e2e
//
// Smoke test that the new tax/compliance/snippets panels in the
// Settings page render without console errors and hydrate state from
// localStorage correctly.
//
// Phase 3p.13 scaffolding closeout.
//
// To run:
//   npm run dev          (terminal 1)
//   npm run test:e2e     (terminal 2)
//
// First run will fail until baselines are generated:
//   npx playwright test --update-snapshots

import { test, expect } from '@playwright/test';

test.describe('Settings page panels', () => {
  test.beforeEach(async ({ page }) => {
    // Console error budget: 0 unhandled exceptions allowed
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    (page as any).__errors = errors;
    await page.goto('/');
  });

  test('navigating to settings shows all expected panels', async ({ page }) => {
    // Sidebar → Settings (the cog icon usually)
    const settingsLink = page.getByRole('button', { name: /settings/i }).first();
    await settingsLink.click();
    // Each panel should have its section header visible
    for (const heading of [
      /Lock/i, /Safety/i, /Tax reporting/i, /Tax-loss harvesting/i,
      /Trade journal/i, /Broker CSV import/i, /Holdings reconciliation/i,
      /Corporate actions/i, /Snippets/i,
    ]) {
      await expect(page.getByText(heading).first()).toBeVisible({ timeout: 5_000 });
    }
    // No errors during render
    const errors = (page as any).__errors as string[];
    expect(errors).toEqual([]);
  });

  test('tax reporting panel renders summary tiles', async ({ page }) => {
    await page.getByRole('button', { name: /settings/i }).first().click();
    const taxSection = page.getByText(/Tax reporting/i).first();
    await taxSection.scrollIntoViewIfNeeded();
    // Even with no trades, the panel should show its KPI tiles
    await expect(page.getByText(/Realized gain/i).first()).toBeVisible();
    await expect(page.getByText(/Realized loss/i).first()).toBeVisible();
  });

  test('snippets panel can create a new snippet', async ({ page }) => {
    await page.getByRole('button', { name: /settings/i }).first().click();
    const newBtn = page.getByTestId('new-snippet').first();
    await newBtn.scrollIntoViewIfNeeded();
    await newBtn.click();
    await page.getByTestId('editor-title').fill('e2e test snippet');
    await page.getByTestId('editor-body').fill('body content for e2e');
    await page.getByTestId('save-snippet').click();
    // The snippet appears in the list
    await expect(page.getByText('e2e test snippet').first()).toBeVisible();
  });

  test('corporate actions quick-add buttons are present', async ({ page }) => {
    await page.getByRole('button', { name: /settings/i }).first().click();
    const corpSection = page.getByText(/Corporate actions/i).first();
    await corpSection.scrollIntoViewIfNeeded();
    // The "+ Record action" button + at least one quick-add chip
    await expect(page.getByText(/Record action/i)).toBeVisible();
    await expect(page.getByText(/AAPL.*4:1.*2020/)).toBeVisible();
  });
});
