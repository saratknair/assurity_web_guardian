import { describe, it, expect } from "vitest";
// @ts-expect-error plain browser ES module without type declarations
import { appKeyAction, fallbackMessage, announceDecision } from "../../office/lib/app-model.js";
// @ts-expect-error plain browser ES module without type declarations
import { buildTimeline } from "../../office/lib/timeline.js";

describe("appKeyAction", () => {
  it("maps the app-level Diorama keys", () => {
    expect(appKeyAction(" ", {})).toEqual({ type: "toggle-play" });
    expect(appKeyAction(",", {})).toEqual({ type: "prev" });
    expect(appKeyAction(".", {})).toEqual({ type: "next" });
    expect(appKeyAction("Escape", {})).toEqual({ type: "escape" });
    expect(appKeyAction("1", {})).toEqual({ type: "station", index: 0 });
    expect(appKeyAction("6", {})).toEqual({ type: "station", index: 5 });
  });

  it("never maps Tab, out-of-range digits, shifted digits, or modified keys", () => {
    expect(appKeyAction("Tab", {})).toBeNull();
    expect(appKeyAction("7", {})).toBeNull();
    expect(appKeyAction("0", {})).toBeNull();
    expect(appKeyAction("1", { shiftKey: true })).toBeNull();
    expect(appKeyAction(" ", { ctrlKey: true })).toBeNull();
    expect(appKeyAction(".", { metaKey: true })).toBeNull();
    expect(appKeyAction(undefined, undefined)).toBeNull();
  });
});

describe("fallbackMessage", () => {
  it("names the reason and the text views", () => {
    const m = fallbackMessage("no-webgl");
    expect(m.headline).toContain("3D view is unavailable");
    expect(m.reason).toContain("WebGL");
    for (const w of ["Stations list", "Transcript", "Telemetry", "Swimlane", "Inspector"]) expect(m.detail).toContain(w);
    expect(fallbackMessage("import-failed").reason).toContain("office/diorama/diorama.js");
    expect(fallbackMessage("context-lost").reason).toContain("lost");
  });

  it("handles unknown reasons without throwing", () => {
    expect(fallbackMessage(undefined).reason.length).toBeGreaterThan(0);
    expect(fallbackMessage("__proto__").reason.length).toBeGreaterThan(0);
  });
});

describe("announceDecision", () => {
  const tl = buildTimeline([
    { type: "step.completed", step: "accessibility-scan", seq: 1, startMs: 0, durationMs: 1000, label: "Scan" },
  ]);
  const base = { timeline: tl, t: 500, announce: true };

  it("says nothing when announcements are off or there is no timeline", () => {
    expect(announceDecision({ ...base, announce: false }, -1, 0, 10000, 1500).text).toBeNull();
    expect(announceDecision({ announce: true, timeline: null, t: 0 }, -1, 0, 10000, 1500).text).toBeNull();
  });

  it("throttles and only speaks on a change", () => {
    const first = announceDecision(base, -1, 0, 10000, 1500);
    if (first.text !== null) {
      expect(announceDecision(base, first.count, first.at, 10100, 1500).text).toBeNull();
    }
    expect(announceDecision(base, 99, 9000, 9500, 1500).text).toBeNull(); // within 1.5 s
    expect(announceDecision(base, 99, 0, 10000, 1500).count).not.toBe(99); // after the window
  });
});
