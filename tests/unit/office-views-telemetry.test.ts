import { describe, it, expect } from "vitest";
// @ts-expect-error plain browser ES module without type declarations
import { telemetryRows } from "../../office/views/telemetry-panel.js";
// @ts-expect-error plain browser ES module without type declarations
import { swimlaneModel, markerX, barState, barLabel } from "../../office/views/swimlane.js";

function step(id: string, stepName: string, station: string, startMs: number, endMs: number, extra: object = {}) {
  return {
    id, index: 0, kind: "step", step: stepName, station, agent: "A", template: false,
    pageUrl: "https://x.test/a", slug: "a", viewport: "desktop", startMs, endMs,
    result: null, findingKeys: [], findingIds: {}, label: stepName, ...extra,
  };
}

const tl = {
  mode: "enriched", durationMs: 1000, pagesTotal: 1,
  entries: [
    step("s1", "load", "browser-bay", 100, 300),
    step("s2", "accessibility-scan", "accessibility-check", 300, 700),
    step("s3", "notes", "review-desk", 800, 900),
  ],
  notices: { notRecorded: [] },
};

describe("office telemetry panel rows", () => {
  it("shares sum to 100 and unattributed time is separate", () => {
    const r = telemetryRows(tl, 1000);
    const pct = r.stations.map((s: { share: string }) => parseFloat(s.share)).filter((n: number) => !isNaN(n));
    expect(pct.reduce((a: number, b: number) => a + b, 0)).toBeCloseTo(100, 5);
    const un = r.summary.find((x: { key: string }) => x.key === "unattributed");
    expect(un.value).toBe("300 ms");
  });

  it("running step counts only include finished entries", () => {
    expect(telemetryRows(tl, 250).steps).toEqual([]);
    expect(telemetryRows(tl, 350).steps.map((s: { step: string }) => s.step)).toEqual(["load"]);
  });

  it("prints not recorded for an empty timeline", () => {
    const r = telemetryRows({ mode: "empty", entries: [], durationMs: 0 }, 0);
    expect(r.summary.find((x: { key: string }) => x.key === "pages").value).toBe("not recorded");
  });
});

describe("office swimlane model", () => {
  const m = swimlaneModel(tl);

  it("positions bars in time order with a minimum width", () => {
    expect(m.bars.map((b: { id: string }) => b.id)).toEqual(["s1", "s2", "s3"]);
    expect(m.bars[0].x).toBeCloseTo(m.labelW + 0.1 * m.plotW);
    const tiny = swimlaneModel({ durationMs: 1000, entries: [step("z", "load", "browser-bay", 10, 10)] });
    expect(tiny.bars[0].w).toBe(2);
  });

  it("moves the marker and classifies bars", () => {
    expect(markerX(m, 0)).toBe(m.labelW);
    expect(markerX(m, 1000)).toBe(m.labelW + m.plotW);
    expect(barState(m.bars[0], 200)).toBe("active");
    expect(barState(m.bars[0], 400)).toBe("done");
    expect(barState(m.bars[2], 400)).toBe("future");
  });

  it("names bars with step, page, viewport and start time", () => {
    const l = barLabel(tl.entries[0]);
    expect(l).toContain("load");
    expect(l).toContain("https://x.test/a");
    expect(l).toContain("desktop");
    expect(l).toContain("starts at 00:00.1");
  });
});
