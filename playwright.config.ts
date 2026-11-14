import { defineConfig } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Base URL for generated specs: GUARDIAN_BASE_URL, else baseUrl from config/app.config.json.
function resolveBaseUrl(): string | undefined {
  const fromEnv = (process.env.GUARDIAN_BASE_URL ?? '').trim();
  if (fromEnv) return fromEnv;
  const file = resolve('config/app.config.json');
  if (!existsSync(file)) return undefined;
  try {
    const cfg = JSON.parse(readFileSync(file, 'utf8')) as { baseUrl?: unknown };
    return typeof cfg.baseUrl === 'string' && cfg.baseUrl ? cfg.baseUrl : undefined;
  } catch {
    return undefined;
  }
}

// Chromium-only. Two projects: desktop 1440x900 and mobile 390x844.
// No Safari/Firefox/extra devices.
export default defineConfig({
  testDir: './tests/generated',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['html', { outputFolder: 'artifacts/playwright-report', open: 'never' }], ['list']],
  use: {
    baseURL: resolveBaseUrl(),
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
