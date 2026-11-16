import { describe, it, expect } from "vitest";
import { computeAnalytics } from "../../src/core/analytics.js";
// @ts-expect-error plain JS helper without type declarations
import { inspectInstance, isStrict } from "../../scripts/lib/instance-data.mjs";

// artifacts/runs is local data and is not tracked, so a CI checkout has none.
// Skip there unless GUARDIAN_REQUIRE_INSTANCE_DATA=1 demands it.
const hasRuns = (inspectInstance(".") as { hasRuns: boolean }).hasRuns;
const needRuns = hasRuns || (isStrict() as boolean);

describe("analytics & context", () => {
  it.skipIf(!needRuns)("computes analytics deterministically over real run records (read-only)", () => {
    const a = computeAnalytics("artifacts/runs", "artifacts/a11y-history.json");
    expect(a.totalRuns).toBeGreaterThanOrEqual(1);
    expect(typeof a.deterministicFailuresLatest).toBe("number");
    // Finding lifecycle counts come from the stored run history.
    const lifecycleTotal = Object.values(a.findingLifecycle).reduce((s, n) => s + n, 0);
    expect(lifecycleTotal).toBeGreaterThan(0);
    // Severity map should include serious/critical from real findings.
    expect(Object.keys(a.a11yBySeverity).length).toBeGreaterThan(0);
  });
});
