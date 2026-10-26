import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const HOMEPAGE = "https://assurity.nz/";
const APPROVED_DOMAIN = "assurity.nz";

function isApprovedDomain(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === APPROVED_DOMAIN || host.endsWith("." + APPROVED_DOMAIN);
  } catch {
    return false;
  }
}

interface CheckResult {
  name: string;
  status: "pass" | "fail";
  classification: "deterministic-test-evidence";
  detail: string;
}

// One describe per project (desktop/mobile) is driven by playwright projects.
test.describe("Assurity homepage deterministic checks", () => {
  test("homepage quality checks", async ({ page }, testInfo) => {
    const viewport = testInfo.project.name; // "desktop" | "mobile"
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const failedRequests: { url: string; failure: string }[] = [];
    const results: CheckResult[] = [];

    // Monitor browser console errors (Req 6.6).
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    // Monitor uncaught page errors.
    page.on("pageerror", (err) => pageErrors.push(err.message));
    // Monitor failed network requests on the approved domain (Req 6; same-domain only).
    page.on("requestfailed", (req) => {
      const url = req.url();
      if (isApprovedDomain(url)) {
        failedRequests.push({ url, failure: req.failure()?.errorText ?? "unknown" });
      }
    });

    // --- Document response (Req 6.1) ---
    const response = await page.goto(HOMEPAGE, { waitUntil: "load", timeout: 30_000 });
    const ok = !!response && response.status() >= 200 && response.status() < 400;
    results.push({
      name: "http-document-response",
      status: ok ? "pass" : "fail",
      classification: "deterministic-test-evidence",
      detail: `HTTP ${response?.status() ?? "none"}`,
    });
    expect(response, "document response should exist").toBeTruthy();

    // --- Non-empty title (Req 6.3 critical content) ---
    const title = (await page.title()).trim();
    results.push({
      name: "non-empty-title",
      status: title.length > 0 ? "pass" : "fail",
      classification: "deterministic-test-evidence",
      detail: title ? `title="${title}"` : "empty title",
    });

    // --- Visible H1 ---
    const h1 = page.locator("h1").first();
    const h1Visible = await h1.isVisible().catch(() => false);
    results.push({
      name: "visible-h1",
      status: h1Visible ? "pass" : "fail",
      classification: "deterministic-test-evidence",
      detail: h1Visible ? `h1="${(await h1.textContent())?.trim() ?? ""}"` : "no visible h1",
    });

    // --- Primary navigation present ---
    const navCount = await page.locator("nav").count();
    results.push({
      name: "primary-navigation-present",
      status: navCount > 0 ? "pass" : "fail",
      classification: "deterministic-test-evidence",
      detail: `nav elements: ${navCount}`,
    });

    // --- Failed-image detection (Req 6.5): only after the image check runs ---
    const imgHandles = await page.locator("img").all();
    const brokenImages: string[] = [];
    for (const img of imgHandles) {
      const src = (await img.getAttribute("src")) ?? "";
      const naturalWidth = await img.evaluate(
        (el) => (el as HTMLImageElement).naturalWidth,
      ).catch(() => 0);
      const complete = await img.evaluate(
        (el) => (el as HTMLImageElement).complete,
      ).catch(() => false);
      if (complete && naturalWidth === 0 && src) brokenImages.push(src);
    }
    results.push({
      name: "no-broken-images",
      status: brokenImages.length === 0 ? "pass" : "fail",
      classification: "deterministic-test-evidence",
      detail: brokenImages.length === 0 ? `checked ${imgHandles.length} images` : `broken: ${brokenImages.join(", ")}`,
    });

    // --- Screenshots (Req 7) ---
    const runDir = resolve("artifacts", "phase2", viewport);
    mkdirSync(runDir, { recursive: true });
    await page.screenshot({ path: resolve(runDir, "homepage.png"), fullPage: true });

    // --- Axe WCAG 2.2 AA accessibility scan (Req 6.7) ---
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    const criticalSerious = axe.violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious",
    );
    results.push({
      name: "axe-critical-serious",
      status: criticalSerious.length === 0 ? "pass" : "fail",
      classification: "deterministic-test-evidence",
      detail: `violations total=${axe.violations.length}, critical/serious=${criticalSerious.length}`,
    });

    // --- Console / page-error / failed-request evidence (non-blocking records) ---
    results.push({
      name: "console-errors",
      status: consoleErrors.length === 0 ? "pass" : "fail",
      classification: "deterministic-test-evidence",
      detail: consoleErrors.length ? consoleErrors.slice(0, 20).join(" | ") : "none",
    });
    results.push({
      name: "page-errors",
      status: pageErrors.length === 0 ? "pass" : "fail",
      classification: "deterministic-test-evidence",
      detail: pageErrors.length ? pageErrors.slice(0, 20).join(" | ") : "none",
    });
    results.push({
      name: "failed-same-domain-requests",
      status: failedRequests.length === 0 ? "pass" : "fail",
      classification: "deterministic-test-evidence",
      detail: failedRequests.length ? failedRequests.map((f) => `${f.url} (${f.failure})`).slice(0, 20).join(" | ") : "none",
    });

    // --- Persist structured results JSON ---
    const summary = {
      page: HOMEPAGE,
      viewport,
      timestamp: new Date().toISOString(),
      accessibilityDisclaimer:
        "Automated WCAG 2.2 AA checks do not establish full conformance; manual accessibility testing remains necessary.",
      consoleErrors,
      pageErrors,
      failedRequests,
      axeViolations: axe.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        nodes: v.nodes.length,
      })),
      results,
    };
    writeFileSync(resolve(runDir, "results.json"), JSON.stringify(summary, null, 2));

    // Hard failures: document response, title, h1, nav, broken images, critical a11y.
    expect(ok, "document HTTP response should be 2xx/3xx").toBeTruthy();
    expect(title.length, "title should be non-empty").toBeGreaterThan(0);
    expect(h1Visible, "an h1 should be visible").toBeTruthy();
    expect(navCount, "primary navigation should be present").toBeGreaterThan(0);
    expect(brokenImages, "no broken images on approved domain").toEqual([]);
    // Critical/serious a11y violations are failures requiring review (Req 6.8).
    expect(criticalSerious.length, `critical/serious a11y violations: ${criticalSerious.map((v) => v.id).join(", ")}`).toBe(0);
  });
});
