import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

/**
 * Test_Generator (Req 5, 24.7-24.8). Generates Playwright test source from an
 * APPROVED baseline only (Req 5.2). The source is written to the
 * version-controlled tests/generated/ dir and references the baseline version
 * (Req 5.4). The Evidence_Store keeps a manifest but is never the sole source.
 */
export interface GeneratedTest {
  slug: string;
  baselineVersion: number;
  specPath: string;
}

export function latestBaselineVersion(slug: string, baselinesRoot = "baselines"): number | null {
  const dir = resolve(baselinesRoot, slug);
  if (!existsSync(dir)) return null;
  const versions = readdirSync(dir)
    .map((f) => /^baseline\.v(\d+)\.md$/.exec(f))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => Number(m[1]));
  return versions.length ? Math.max(...versions) : null;
}

export function generateTestFromBaseline(
  slug: string,
  url: string,
  baselinesRoot = "baselines",
  outDir = "tests/generated",
): GeneratedTest {
  const version = latestBaselineVersion(slug, baselinesRoot);
  if (version === null) {
    throw new Error(`No approved baseline for slug "${slug}"; cannot generate tests (Req 5.2).`);
  }
  const baselinePath = resolve(baselinesRoot, slug, `baseline.v${version}.md`);
  const baselineText = readFileSync(baselinePath, "utf8");
  // Pull expected image count from the baseline, if present.
  const imgMatch = /Expect all (\d+) images to load/.exec(baselineText);
  const expectedImages = imgMatch ? Number(imgMatch[1]) : 0;

  const spec = `// GENERATED from baseline ${slug} v${version} — do not edit by hand.
// Source baseline: baselines/${slug}/baseline.v${version}.md (Req 5.4)
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const URL = ${JSON.stringify(url)};
const BASELINE_VERSION = ${version};
const EXPECTED_IMAGES_MIN = ${Math.max(0, expectedImages - 2)};

test.describe("Baseline-derived checks (${slug} v${version})", () => {
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
`;
  // Write the spec file to its absolute location on disk (behavior unchanged).
  const absSpecPath = join(resolve(outDir), `${slug}.baseline-v${version}.spec.ts`);
  writeFileSync(absSpecPath, spec, "utf8");
  // Phase 2 migration (Req 8.2, 11.8): the STORED specPath must be repo-relative
  // with forward slashes (e.g. "tests/generated/<slug>.baseline-v<N>.spec.ts"),
  // never an absolute/internal filesystem path. Absolute paths must not leak
  // into published data. Existing on-disk manifests are left untouched and are
  // sanitized at publish time. `outDir` is already repo-relative (default
  // "tests/generated"); normalize separators for cross-platform stability.
  const specPath = `${outDir}/${slug}.baseline-v${version}.spec.ts`.replace(/\\/g, "/");
  return { slug, baselineVersion: version, specPath };
}

/** Writes a test manifest into the run's evidence dir (Req 24.7). */
export function writeTestManifest(
  runDir: string,
  tests: GeneratedTest[],
): string {
  const manifest = {
    generatedAt: new Date().toISOString(),
    testSuiteVersion: "milestone-1",
    tests: tests.map((t) => ({
      slug: t.slug,
      baselineVersion: t.baselineVersion,
      specPath: t.specPath,
    })),
  };
  const p = join(runDir, "test-manifest.json");
  writeFileSync(p, JSON.stringify(manifest, null, 2), "utf8");
  return p;
}
