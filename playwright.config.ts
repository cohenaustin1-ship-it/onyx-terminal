// IMO Onyx Terminal — Playwright configuration (Phase 3p.11 / Addition 4)
//
// HONEST SCOPE NOTICE
// ===================
// This is SCAFFOLDING for visual regression testing of the Chart
// component. Real visual-regression CI requires:
//   - A consistent rendering environment (Linux Chromium in CI matches
//     local macOS Chromium *almost* but not exactly — anti-aliasing
//     differs, fonts differ)
//   - Baseline screenshots committed to git, regenerated when the UI
//     legitimately changes (`playwright test --update-snapshots`)
//   - A long-running CI step (~30-60s per snapshot at 4K resolution)
//   - Manual review of every diff to distinguish real regressions
//     from acceptable rendering noise
//
// What this scaffolding provides:
//   - playwright.config.ts with Chromium + Firefox + WebKit projects
//   - One example smoke test (e2e/chart-render.spec.ts) that loads
//     the dev server, navigates to the Trade page, and screenshots
//     the chart at multiple range/frequency combinations
//   - Threshold defaults reasonable for an institutional dashboard
//     (small-pixel-noise tolerated, large-pixel-shift caught)
//
// To go from this scaffold → working visual regression:
//   1. npm install --save-dev @playwright/test
//   2. npx playwright install (downloads browsers, ~500MB)
//   3. npm run dev   (in one terminal)
//   4. npx playwright test --update-snapshots (in another)
//   5. Commit the generated e2e/__screenshots__/ directory
//   6. CI runs `npx playwright test` against the same dev server

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,             // Snapshots are touchy — run serially
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  // Visual regression tolerance:
  //   maxDiffPixelRatio = 0.01 — up to 1% of pixels can differ before
  //   we call it a real regression. Tighter than this catches anti-
  //   aliasing noise and fails on CI vs local; looser than this misses
  //   actual UI bugs.
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
      threshold: 0.2,
    },
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Multi-browser is overkill for an institutional internal tool.
    // Uncomment for public-facing apps:
    // { name: 'firefox',  use: { ...devices['Desktop Firefox'] } },
    // { name: 'webkit',   use: { ...devices['Desktop Safari'] } },
  ],

  webServer: process.env.CI ? undefined : {
    // Locally, autostart the dev server. In CI, expect it to be
    // running already (faster, more deterministic).
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
