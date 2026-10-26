import { describe, it, expect } from "vitest";
import { computeAnalytics } from "../../src/core/analytics.js";
import { contextForFinding, aiOutputCitesContext } from "../../src/core/agent-context.js";

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

  it("provides bounded context that cites real record IDs", () => {
    const ctx = contextForFinding("link-name", "https://assurity.nz/", "desktop", "fnd_test");
    // History has link-name on the homepage desktop, so there should be context.
    expect(ctx.items.length).toBeGreaterThan(0);
    expect(ctx.items.length).toBeLessThanOrEqual(5); // bounded
    for (const i of ctx.items) expect(typeof i.recordId).toBe("string");
  });

  it("enforces that AI output cites a provided record ID", () => {
    const ctx = contextForFinding("link-name", "https://assurity.nz/", "desktop", "fnd_test");
    const validId = ctx.items[0]?.recordId;
    expect(aiOutputCitesContext([validId], ctx)).toBe(true);
    expect(aiOutputCitesContext(["bogus-id"], ctx)).toBe(false);
  });

  it("returns empty bounded context for an unknown finding (no fabrication)", () => {
    const ctx = contextForFinding("does-not-exist", "https://assurity.nz/nope/", "desktop", "fnd_x");
    expect(ctx.items.length).toBe(0);
    // With nothing to cite, citation check is vacuously true.
    expect(aiOutputCitesContext([], ctx)).toBe(true);
  });
});
