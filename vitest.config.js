import { defineConfig } from 'vitest/config';

// IMO Onyx Terminal — Vitest configuration
//
// Tests live alongside source under src/lib/quant/__tests__/ for
// quant modules and src/lib/__tests__/ for general lib helpers.
// Run via `npm test` (one-shot) or `npm run test:watch` (TDD).
//
// Using node environment (not jsdom) because all the modules under
// test are pure JavaScript — no React, no DOM. If/when component
// tests get added, switch to jsdom or set per-file via // @vitest-environment

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: [
      'src/**/*.test.js',
      'src/**/*.test.ts',
      'src/**/*.test.jsx',
      'src/**/*.test.tsx',
    ],
    // Pool: forks (default) to avoid worker-thread overhead for fast tests.
    pool: 'forks',
    // Surface a coverage summary in CI without enforcing thresholds yet.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/lib/**/*.js'],
      exclude: ['src/**/__tests__/**', 'src/**/*.test.js'],
    },
  },
});
