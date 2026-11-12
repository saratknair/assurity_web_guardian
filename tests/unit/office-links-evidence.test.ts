import { describe, it, expect } from "vitest";
// @ts-expect-error plain browser ES module without type declarations
import * as links from "../../office/lib/links.js";
// @ts-expect-error plain browser ES module without type declarations
import { evidenceAt } from "../../office/lib/evidence.js";
// @ts-expect-error plain browser ES module without type declarations
import { buildTimeline } from "../../office/lib/timeline.js";

const T0 = Date.parse("2025-01-01T00:00:00Z");
const iso = (ms: number) => new Date(T0 + ms).toISOString();
function step(seq: number, name: string, s: number, e: number, extra: Record<string, unknown>) {
  return {
    kind: "step.completed", ts: iso(e),
    data: { seq, step: name, startedAt: iso(s), endedAt: iso(e), pageUrl: "https://x.test/a", slug: "a", viewport: "desktop", ...extra },
  };
}
const events = [
  { kind: "run.started", runId: "r1", ts: iso(0), data: { replaySchema: 1, pages: 1 } },
  step(1, "screenshot", 100, 200, { result: { saved: true } }),
  step(2, "accessibility-scan", 200, 300, { findings: ["color-contrast"], findingIds: { "color-contrast": "f1" } }),
  step(3, "visual-compare", 300, 400, { result: { differs: true } }),
];
const tl = buildTimeline(events);

describe("links", () => {
  it("builds dashboard hash routes and no link without ids", () => {
    expect(links.runLink("r1")).toBe("../#/run/r1");
    expect(links.visualLink("r1", "a", "mobile")).toBe("../#/visual/r1/a/mobile");
    expect(links.visualLink("r1", "a", "tablet")).toBeNull();
    expect(links.findingLinkFromKey("r1", "https://x.test/a|desktop|color-contrast", { "color-contrast": "f1" })).toBe("../#/finding/r1/f1");
    expect(links.findingLinkFromKey("r1", "https://x.test/a|desktop|other", { "color-contrast": "f1" })).toBeNull();
    expect(links.pageLink("")).toBeNull();
  });
});

describe("evidenceAt", () => {
  const index = { imageRetentionRuns: 10, runs: [{ runId: "r1", hasImages: true }] };
  const run = { findings: [{ id: "f1", kind: "a11y-rule", slug: "a", viewport: "desktop", ruleId: "color-contrast", severity: "serious" }], ignored: [] };

  it("gates on step completion", () => {
    expect(evidenceAt(tl, 150, run, index).screenshot).toBeNull();
    expect(evidenceAt(tl, 250, run, index).screenshot.imageSrc).toContain("screenshots/a.desktop.png");
  });
  it("shows rule ids and visual result with links", () => {
    const ev = evidenceAt(tl, 500, run, index);
    expect(ev.a11y.rules[0].ruleId).toBe("color-contrast");
    expect(ev.a11y.rules[0].link).toBe("../#/finding/r1/f1");
    expect(ev.visual.text).toBe("Visual difference: yes");
    expect(ev.visual.link).toBe("../#/visual/r1/a/desktop");
  });
  it("creates no image when images are not published or load failed", () => {
    const off = evidenceAt(tl, 500, run, { runs: [{ runId: "r1", hasImages: false }] });
    expect(off.screenshot.imageSrc).toBeNull();
    expect(off.screenshot.message).toContain("not published");
    const bad = evidenceAt(tl, 500, run, index, { failedImages: ["a.desktop"] });
    expect(bad.screenshot.imageSrc).toBeNull();
    expect(bad.screenshot.message).toContain("a.desktop.png");
  });
  it("says rule ids are unavailable when no finding is published", () => {
    const ev = evidenceAt(tl, 500, { findings: [], ignored: [] }, index);
    expect(ev.a11y.message).toContain("not available");
  });
  it("never throws on bad input", () => {
    expect(evidenceAt(null, NaN, null, null).screenshot).toBeNull();
  });
});
