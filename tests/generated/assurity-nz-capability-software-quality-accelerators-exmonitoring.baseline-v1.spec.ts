// GENERATED from baseline assurity-nz-capability-software-quality-accelerators-exmonitoring v1 — do not edit by hand.
// Source baseline: baselines/assurity-nz-capability-software-quality-accelerators-exmonitoring/baseline.v1.md (Req 5.4)
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const URL = "https://assurity.nz/capability/software-quality-accelerators/exmonitoring/";
const BASELINE_VERSION = 1;
const EXPECTED_IMAGES_MIN = 9;

test.describe("Baseline-derived checks (assurity-nz-capability-software-quality-accelerators-exmonitoring v1)", () => {
  test("deterministic homepage checks", async ({ page }) => {
    const response = await page.goto(URL, { waitUntil: "load", timeout: 30_000 });
    expect(response?.status(), "HTTP 2xx/3xx").toBeLessThan(400);
    expect((await page.title()).trim().length, "non-empty title").toBeGreaterThan(0);
    await expect(page.locator("h1").first(), "visible h1").toBeVisible();
    expect(await page.locator("nav").count(), "primary nav present").toBeGreaterThan(0);
    const imgCount = await page.locator("img").count();
    expect(imgCount, "image count near baseline").toBeGreaterThanOrEqual(EXPECTED_IMAGES_MIN);
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
    const criticalSerious = axe.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
    // Critical/serious a11y => failing check requiring human review (Req 6.8).
    expect(criticalSerious.length, "critical/serious a11y: " + criticalSerious.map((v) => v.id).join(", ")).toBe(0);
  });
});
