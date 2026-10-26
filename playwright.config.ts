import { defineConfig, devices } from '@playwright/test';

// Chromium-only. Two projects: desktop 1440x900 and mobile 390x844.
// No Safari/Firefox/extra devices (Req 16.5).
export default defineConfig({
  testDir: './tests/generated',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['html', { outputFolder: 'artifacts/playwright-report', open: 'never' }], ['list']],
  use: {
    baseURL: 'https://assurity.nz',
    trace: 'on',
    screenshot: 'on',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'desktop',
      use: { browserName: 'chromium', viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'mobile',
      use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
  ],
});
