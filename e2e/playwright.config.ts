import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  // Fail with a Playwright report before CI's harder job-level timeout-minutes kicks in.
  globalTimeout: 8 * 60 * 1000,
  use: {
    baseURL: 'http://localhost:3000',
    extraHTTPHeaders: {
      'Content-Type': 'application/json',
    },
  },
  // API-only tests: no browser projects needed.
  // If you add browser tests later, add them here.
  projects: [{ name: 'api' }],
});
