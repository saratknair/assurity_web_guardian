// Unit tests for the pure self-scan helpers (Requirements 15.11).
import { describe, it, expect } from "vitest";
// @ts-expect-error plain .mjs module without type declarations
import { shapeResults, summaryMarkdown, planViews, AXE_TAGS, IMPACTS, SELF_SCAN_NOTE } from "../../scripts/scan-dashboard.mjs";

const nodes = (n: number) => Array.from({ length: n }, () => ({}));

describe("shapeResults", () => {
  it("importing the module does not start anything and exposes constants", () => {
    expect(AXE_TAGS).toEqual(["wcag2a", "wcag2aa", "wcag22aa"]);
    expect(IMPACTS).toEqual(["critical", "serious", "moderate", "minor"]);
  });

  it("counts per impact by node count, or 1 when no nodes", () => {
    const out = shapeResults({
      generatedAt: "2025-01-01T00:00:00Z",
      views: [
        {
          name: "Overview",
          route: "#/",
          status: "scanned",
          violations: [
            { id: "color-contrast", impact: "serious", nodes: nodes(3) },
            { id: "label", impact: "critical" },
            { id: "region", impact: "moderate", nodes: [] },
          ],
        },
      ],
    });
    expect(out.views[0].violations).toEqual({ critical: 1, serious: 3, moderate: 1, minor: 0 });
    expect(out.totals).toEqual({ critical: 1, serious: 3, moderate: 1, minor: 0, all: 5 });
    expect(out.generatedAt).toBe("2025-01-01T00:00:00Z");
  });

  it("counts unknown or missing impact as minor", () => {
    const out = shapeResults({
      views: [
        {
          name: "A",
          route: "#/",
          status: "scanned",
          violations: [
            { id: "x", impact: "weird", nodes: nodes(2) },
            { id: "y", impact: null },
          ],
        },
      ],
    });
    expect(out.views[0].violations.minor).toBe(3);
    expect(out.totals.all).toBe(3);
  });

  it("merges rules per id+impact and sorts by impact then id", () => {
    const out = shapeResults({
      views: [
        {
          name: "A",
          route: "#/",
          status: "scanned",
          violations: [
            { id: "b-rule", impact: "minor", nodes: nodes(1) },
            { id: "z-rule", impact: "critical", nodes: nodes(1) },
            { id: "a-rule", impact: "serious", nodes: nodes(2) },
            { id: "a-rule", impact: "serious", nodes: nodes(3) },
            { id: "a-rule", impact: "minor", nodes: nodes(1) },
          ],
        },
      ],
    });
    expect(out.views[0].rules).toEqual([
      { id: "z-rule", impact: "critical", count: 1 },
      { id: "a-rule", impact: "serious", count: 5 },
      { id: "a-rule", impact: "minor", count: 1 },
      { id: "b-rule", impact: "minor", count: 1 },
    ]);
  });

  it("keeps reason on skipped/error views and counts nothing for them", () => {
    const out = shapeResults({
      views: [
        { name: "S", route: "-", status: "skipped", reason: "no findings", violations: [{ id: "x", impact: "critical" }] },
        { name: "E", route: "#/", status: "error", reason: "TimeoutError" },
        { name: "O", route: "#/", status: "scanned", violations: [{ id: "x", impact: "minor" }] },
      ],
    });
    expect(out.views[0]).toMatchObject({ status: "skipped", reason: "no findings" });
    expect(out.views[0].violations).toEqual({ critical: 0, serious: 0, moderate: 0, minor: 0 });
    expect(out.views[0].rules).toEqual([]);
    expect(out.views[1]).toMatchObject({ status: "error", reason: "TimeoutError" });
    expect(out.views[2].reason).toBeUndefined();
    expect(out.totals.all).toBe(1);
  });

  it("is safe for non-array / missing input", () => {
    for (const raw of [null, undefined, {}, { views: "nope" }, 5]) {
      const out = shapeResults(raw as unknown);
      expect(out.views).toEqual([]);
      expect(out.totals).toEqual({ critical: 0, serious: 0, moderate: 0, minor: 0, all: 0 });
      expect(out.generatedAt).toBeNull();
    }
    const out = shapeResults({ views: [{ name: "A", route: "#/", status: "scanned", violations: "bad" }] });
    expect(out.views[0].violations.minor).toBe(0);
  });

  it("includes a note that makes no conformance claim", () => {
    const out = shapeResults({ views: [] });
    expect(out.note).toBe(SELF_SCAN_NOTE);
    expect(out.note).toMatch(/not a conformance claim/i);
    expect(out.note).not.toMatch(/\b(conforms|compliant|passes wcag)\b/i);
    expect(out.tags).toEqual(AXE_TAGS);
  });
});

describe("summaryMarkdown", () => {
  it("has a row per view plus a total row and a disclaimer", () => {
    const shaped = shapeResults({
      views: [
        { name: "Overview", route: "#/", status: "scanned", violations: [{ id: "x", impact: "serious", nodes: nodes(2) }] },
        { name: "Finding detail", route: "-", status: "skipped", reason: "no findings in latest run" },
      ],
    });
    const md = summaryMarkdown(shaped);
    const lines = md.split("\n");
    expect(lines.filter((l: string) => l.startsWith("| Overview "))).toHaveLength(1);
    expect(md).toContain("| Finding detail | skipped (no findings in latest run) | 0 | 0 | 0 | 0 |");
    expect(md).toContain("| **Total** |  | 0 | 2 | 0 | 0 |");
    expect(md).toMatch(/cannot confirm WCAG conformance/);
  });
});

describe("planViews", () => {
  const index = { runs: [{ runId: "run-1" }] };

  it("picks routes for every view with URI-encoded ids", () => {
    const plan = planViews({
      index,
      dashboard: { latest: { runId: "r/1 a", pages: [{ slug: "p q" }] } },
      runFindings: { findings: [{ id: "f#1" }] },
      visual: { items: [{ slug: "s/1", viewport: "desk top" }] },
    });
    expect(plan.runId).toBe("r/1 a");
    expect(plan.views).toEqual([
      { name: "Overview", route: "#/" },
      { name: "Run view", route: "#/run/r%2F1%20a" },
      { name: "Page detail", route: "#/page/p%20q?run=r%2F1%20a" },
      { name: "Finding detail", route: "#/finding/r%2F1%20a/f%231" },
      { name: "Visual comparison", route: "#/visual/r%2F1%20a/s%2F1/desk%20top" },
    ]);
  });

  it("falls back to the first index run when dashboard has no latest", () => {
    const plan = planViews({ index, dashboard: null, runFindings: null, visual: null });
    expect(plan.runId).toBe("run-1");
    expect(plan.views[1]).toEqual({ name: "Run view", route: "#/run/run-1" });
  });

  it("marks missing data as skipped with reasons", () => {
    const plan = planViews({ index, dashboard: null, runFindings: { findings: [] }, visual: { items: [] } });
    expect(plan.views.slice(2)).toEqual([
      { name: "Page detail", skip: "no page data" },
      { name: "Finding detail", skip: "no findings in latest run" },
      { name: "Visual comparison", skip: "no visual items in latest run" },
    ]);
  });

  it("skips everything but Overview when there is no published run", () => {
    const plan = planViews({ index: null, dashboard: null, runFindings: null, visual: null });
    expect(plan.runId).toBeNull();
    expect(plan.views[0]).toEqual({ name: "Overview", route: "#/" });
    expect(plan.views.slice(1).every((v: { skip?: string }) => v.skip === "no published run")).toBe(true);
    expect(plan.views).toHaveLength(5);
  });
});
