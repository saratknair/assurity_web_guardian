/**
 * The one screenshot call shared by the orchestrator and the baseline capture,
 * so any future setting applies to both and baselines match what CI compares.
 */
import type { Page } from "@playwright/test";

export async function takeScreenshot(page: Page, path: string): Promise<void> {
  await page.screenshot({ path, fullPage: true });
}
