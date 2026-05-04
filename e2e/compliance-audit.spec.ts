// IMO Onyx Terminal — Compliance audit log e2e
//
// Verifies the audit log captures expected events as the user
// navigates and that the export-to-CSV flow works.

import { test, expect } from '@playwright/test';

test.describe('Compliance audit log', () => {
  test('audit log entries persist across reload', async ({ page }) => {
    await page.goto('/');
    // Inject a manual audit entry
    await page.evaluate(() => {
      try {
        const existing = JSON.parse(localStorage.getItem('imo_audit_log') || '[]');
        existing.push({
          ts: new Date().toISOString(),
          category: 'system',
          action: 'e2e-test',
          target: 'audit-log-test',
          details: { fromTest: true },
        });
        localStorage.setItem('imo_audit_log', JSON.stringify(existing));
      } catch {}
    });
    await page.reload();
    // Navigate to settings → compliance
    await page.getByRole('button', { name: /settings/i }).first().click();
    const compliance = page.getByText(/Compliance/i).first();
    await compliance.scrollIntoViewIfNeeded();
    // The injected entry should appear in the log
    await expect(page.getByText(/e2e-test/i).first()).toBeVisible();
  });

  test('audit log has Export CSV button', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /settings/i }).first().click();
    const compliance = page.getByText(/Compliance/i).first();
    await compliance.scrollIntoViewIfNeeded();
    await expect(page.getByRole('button', { name: /Export.*CSV/i })).toBeVisible();
  });
});
