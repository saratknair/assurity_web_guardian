import { describe, it, expect } from "vitest";
import { computeAnalytics } from "../../src/core/analytics.js";

describe("Feature: assurity-web-guardian — Phase 4 analytics & context", () => {
  it("computes analytics deterministically over real run records (read-only)", () => {
    const a = computeAnalytics("artifacts/runs", "artifacts/a11y-history.json");
    expect(a.totalRuns).toBeGreaterThanOrEqual(1);
    expect(typeof a.deterministicFailuresLatest).toBe("number");
    // Finding lifecycle counts come from the history we populated in Phase 3.
    const lifecycleTotal = Object.values(a.findingLifecycle).reduce((s, n) => s + n, 0);
    expect(lifecycleTotal).toBeGreaterThan(0);
    // Severity map should include serious/critical from real findings.
    expect(Object.keys(a.a11yBySeverity).length).toBeGreaterThan(0);
  });

});
