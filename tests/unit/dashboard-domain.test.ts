import { describe, it, expect } from "vitest";
// @ts-expect-error plain browser ES module without type declarations
import { runDomain, isDifferentSite, differentSiteLabel, trendGaps, gapNote } from "../../dashboard/lib/domain.js";
// @ts-expect-error plain browser ES module without type declarations
import { runOptionText, buildRunList } from "../../dashboard/views/overview.js";
// @ts-expect-error plain browser ES module without type declarations
import { trendRows } from "../../dashboard/views/charts.js";

describe("dashboard domain helpers", () => {
  it("tolerates missing or odd domain values", () => {
    expect(runDomain({})).toBe("");
    expect(runDomain(null)).toBe("");
    expect(runDomain({ domain: 5 })).toBe("");
    expect(runDomain({ domain: " Example.NZ " })).toBe("example.nz");
  });

  it("labels only when both domains are known and differ", () => {
    expect(isDifferentSite({ domain: "a.nz" }, { domain: "b.nz" })).toBe(true);
    expect(isDifferentSite({ domain: "a.nz" }, { domain: "a.nz" })).toBe(false);
    expect(isDifferentSite({}, { domain: "b.nz" })).toBe(false);
    expect(isDifferentSite({ domain: "a.nz" }, {})).toBe(false);
    expect(differentSiteLabel({ domain: "a.nz" }, { domain: "b.nz" })).toBe("Different site: a.nz");
    expect(differentSiteLabel({}, { domain: "b.nz" })).toBe("");
  });

  it("finds one gap at the domain boundary and skips legacy runs", () => {
    const rows = [{ domain: "a.nz" }, {}, { domain: "b.nz", dateText: "2026-01-02 08:00 UTC" }, { domain: "b.nz" }];
    const gaps = trendGaps(rows);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ index: 2, from: "a.nz", to: "b.nz" });
    expect(gapNote(gaps[0])).toContain("changed from a.nz to b.nz");
    expect(trendGaps([{}, {}])).toEqual([]);
    expect(trendGaps(undefined)).toEqual([]);
  });

  it("carries domain through run list, option text and trend rows", () => {
    const dash = { runs: [{ runId: "run_a", finishedAt: "2026-01-01T00:00:00Z", domain: "a.nz" }, { runId: "run_b", finishedAt: "2026-01-02T00:00:00Z", domain: "b.nz" }, { runId: "run_c", finishedAt: "2025-12-01T00:00:00Z" }] };
    const list = buildRunList(dash, null);
    expect(list.map((r: { domain: string }) => r.domain)).toEqual(["b.nz", "a.nz", ""]);
    expect(runOptionText(list[1], list[0])).toContain("Different site: a.nz");
    expect(runOptionText(list[2], list[0])).not.toContain("Different site");
    expect(trendRows(dash.runs).map((r: { domain: string }) => r.domain)).toEqual(["", "a.nz", "b.nz"]);
  });
});
