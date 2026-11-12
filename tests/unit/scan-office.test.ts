// Unit tests for the pure Virtual Office self-scan helpers (task 11.7).
// Validates: Requirements 8.6, 15.3, 16.6, 17.4
import { describe, it, expect } from "vitest";
import {
  shapeResults,
  summaryMarkdown,
  deepLinkPath,
  isForeignUrl,
  deepLinkRestored,
  idleFramesUnchanged,
  AXE_TAGS,
  // @ts-expect-error plain .mjs module without type declarations
} from "../../scripts/scan-office.mjs";

describe("scan-office pure helpers", () => {
  it("imports without launching anything and exposes axe tags", () => {
    expect(AXE_TAGS).toEqual(["wcag2a", "wcag2aa", "wcag22aa"]);
  });

  it("builds a deep link path", () => {
    expect(deepLinkPath("2025-01-01T00-00-00Z", 1000)).toBe("office/#/run/2025-01-01T00-00-00Z?t=1000");
  });

  it("flags only non-127.0.0.1 hosts as foreign", () => {
    expect(isForeignUrl("http://127.0.0.1:5000/office/")).toBe(false);
    expect(isForeignUrl("data:text/plain,x")).toBe(false);
    expect(isForeignUrl("https://example.com/a.js")).toBe(true);
    expect(isForeignUrl("http://localhost:5000/")).toBe(true);
    expect(isForeignUrl("not a url")).toBe(true);
  });

  it("checks deep link restore against the clamped position", () => {
    expect(deepLinkRestored({ value: "1000", max: "5000", valueText: "00:01.0 of 00:05.0", t: 1000 })).toBe(true);
    expect(deepLinkRestored({ value: "3000", max: "3000", valueText: "x", t: 9000 })).toBe(true);
    expect(deepLinkRestored({ value: "0", max: "5000", valueText: "x", t: 1000 })).toBe(false);
    expect(deepLinkRestored({ value: "1000", max: "5000", valueText: "", t: 1000 })).toBe(false);
  });

  it("compares idle frame counts", () => {
    expect(idleFramesUnchanged("4", "4")).toBe(true);
    expect(idleFramesUnchanged("4", "5")).toBe(false);
    expect(idleFramesUnchanged(null, null)).toBe(false);
  });

  it("shapes views and checks and counts failures", () => {
    const out = shapeResults({
      generatedAt: "2025-01-01T00:00:00Z",
      views: [
        {
          name: "Office",
          route: "office/",
          status: "scanned",
          violations: [
            { id: "color-contrast", impact: "serious", nodes: [{}, {}] },
            { id: "region", impact: "weird" },
          ],
        },
        { name: "Other", route: "x", status: "bogus", reason: "why" },
      ],
      checks: [
        { name: "a", status: "pass" },
        { name: "b", status: "fail", note: "n" },
        { name: "c", status: "nonsense" },
      ],
    });
    expect(out.totals).toEqual({ critical: 0, serious: 2, moderate: 0, minor: 1, all: 3 });
    expect(out.views[1].status).toBe("skipped");
    expect(out.views[1].reason).toBe("why");
    expect(out.checks.map((c: { status: string }) => c.status)).toEqual(["pass", "fail", "skipped"]);
    expect(out.checksFailed).toBe(1);
    expect(shapeResults(null).views).toEqual([]);
    const md = summaryMarkdown(out);
    expect(md).toContain("Virtual Office accessibility self-scan");
    expect(md).toContain("| b | fail | n |");
  });
});
