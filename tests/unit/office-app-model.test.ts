import { describe, it, expect } from "vitest";
// @ts-expect-error plain browser ES module without type declarations
import { sortedRuns, resolveInitialState, clampToDuration, hasImagesFor, routeFromState, buildControlsModel, buildStationsModel, buildRunPickerModel, initialState } from "../../office/lib/app-model.js";
// @ts-expect-error plain browser ES module without type declarations
import { buildTimeline } from "../../office/lib/timeline.js";

const index = {
  runs: [
    { runId: "r-old", finishedAt: "2025-01-01T00:00:00Z", hasImages: false },
    { runId: "r-new", finishedAt: "2025-02-01T00:00:00Z", hasImages: true },
  ],
};

describe("office app-model", () => {
  it("sorts runs newest first", () => {
    expect(sortedRuns(index).map((r: { runId: string }) => r.runId)).toEqual(["r-new", "r-old"]);
    expect(sortedRuns(null)).toEqual([]);
  });

  it("picks the newest run when the route has none", () => {
    const s = resolveInitialState({ runId: null, t: 0, station: null }, index);
    expect(s).toEqual({ runId: "r-new", runNotFound: null, t: 0, station: null });
  });

  it("restores run, t and station from a deep link", () => {
    const s = resolveInitialState({ runId: "r-old", t: 4200, station: "browser-bay" }, index);
    expect(s).toEqual({ runId: "r-old", runNotFound: null, t: 4200, station: "browser-bay" });
  });

  it("reports an unknown run and falls back to the newest", () => {
    const s = resolveInitialState({ runId: "missing", t: 900, station: "browser-bay" }, index);
    expect(s.runId).toBe("r-new");
    expect(s.runNotFound).toBe("missing");
    expect(s.t).toBe(0);
    expect(s.station).toBeNull();
  });

  it("handles an empty index", () => {
    expect(resolveInitialState({ runId: "x", t: 1, station: null }, {}).runId).toBeNull();
  });

  it("clamps t to the timeline duration", () => {
    const tl = buildTimeline([]);
    expect(clampToDuration(5000, tl)).toBe(0);
    expect(clampToDuration(5000, { durationMs: 3000 })).toBe(3000);
    expect(clampToDuration(-4, { durationMs: 3000 })).toBe(0);
  });

  it("reads hasImages from the index", () => {
    expect(hasImagesFor(index, "r-new")).toBe(true);
    expect(hasImagesFor(index, "r-old")).toBe(false);
    expect(hasImagesFor(index, "nope")).toBe(false);
  });

  it("builds the route from state", () => {
    expect(routeFromState({ runId: "r1", t: 12.7, selection: { type: "station", id: "review-desk" } }))
      .toEqual({ runId: "r1", t: 12, station: "review-desk" });
    expect(routeFromState({ runId: "r1", t: 0, selection: { type: "agent", id: "x" } }).station).toBeNull();
  });

  it("builds models for an empty state without throwing", () => {
    const s = initialState();
    expect(buildControlsModel(s).hasRun).toBe(false);
    expect(buildStationsModel(s)).toEqual({ selectedId: null, activeIds: [] });
    expect(buildRunPickerModel({ ...s, index }).runs.length).toBe(2);
  });
});
