import { describe, it, expect } from "vitest";
// @ts-expect-error plain browser ES module without type declarations
import * as L from "../../office/diorama/layout.js";
// @ts-expect-error plain browser ES module without type declarations
import { STATIONS } from "../../office/lib/stations.js";

describe("office diorama layout", () => {
  it("places six stations on the ring of radius 7, 60 degrees apart", () => {
    expect(STATIONS.length).toBe(6);
    for (let i = 0; i < 6; i++) {
      const p = L.stationPosition(i, 6);
      expect(Math.hypot(p.x, p.z)).toBeCloseTo(7, 6);
    }
    const a = L.stationPosition(0, 6);
    const b = L.stationPosition(1, 6);
    const dot = (a.x * b.x + a.z * b.z) / 49;
    expect(Math.acos(dot)).toBeCloseTo(Math.PI / 3, 6);
  });

  it("anchors figures inside the ring and separates slots", () => {
    const a0 = L.stationAnchor(2, 6, 0);
    const a1 = L.stationAnchor(2, 6, 1);
    expect(Math.hypot(a0.x, a0.z)).toBeCloseTo(L.ANCHOR_RADIUS, 6);
    expect(L.distance(a0, a1)).toBeGreaterThan(0.5);
  });

  it("bezier path starts and ends at the endpoints and bows toward the centre", () => {
    const from = L.stationAnchor(0, 6, 0);
    const to = L.stationAnchor(3, 6, 0);
    const path = L.bezierPath(from, to, 8);
    expect(path[0]).toEqual({ x: from.x, y: 0, z: from.z });
    expect(path[8].x).toBeCloseTo(to.x, 9);
    expect(path[8].z).toBeCloseTo(to.z, 9);
    const adjacent = L.bezierPath(L.stationAnchor(0, 6, 0), L.stationAnchor(1, 6, 0), 8);
    const mid = adjacent[4];
    expect(Math.hypot(mid.x, mid.z)).toBeLessThan(L.ANCHOR_RADIUS);
  });

  it("caps move duration at 0.6 s and is zero for no move", () => {
    const a = { x: 0, y: 0, z: 0 };
    expect(L.moveDuration(a, a)).toBe(0);
    expect(L.moveDuration(a, { x: 7, y: 0, z: 0 })).toBeCloseTo(0.5, 6);
    expect(L.moveDuration(a, { x: 40, y: 0, z: 0 })).toBe(0.6);
  });

  it("snaps on reduced motion, scrub, or no previous place", () => {
    expect(L.shouldSnap({ reducedMotion: true, scrubbed: false, hasPrevious: true })).toBe(true);
    expect(L.shouldSnap({ reducedMotion: false, scrubbed: true, hasPrevious: true })).toBe(true);
    expect(L.shouldSnap({ reducedMotion: false, scrubbed: false, hasPrevious: false })).toBe(true);
    expect(L.shouldSnap({ reducedMotion: false, scrubbed: false, hasPrevious: true })).toBe(false);
  });

  it("labels template figures and bobs only while working", () => {
    expect(L.figureLabel("Triage_Agent", true)).toBe("Triage_Agent (template)");
    expect(L.figureLabel("Comparator", false)).toBe("Comparator");
    expect(L.bobOffset(false, 1.3)).toBe(0);
    expect(Math.abs(L.bobOffset(true, 0.3))).toBeLessThanOrEqual(0.08);
  });

  it("assigns stable distinct slots per station", () => {
    const slots = L.assignSlots([
      { agent: "B", station: "review-desk" },
      { agent: "A", station: "review-desk" },
      { agent: "C", station: "browser-bay" },
    ]);
    expect(slots).toEqual({ A: 0, B: 1, C: 0 });
  });

  it("gives every known agent a distinct colour", () => {
    const names = Object.keys(L.AGENT_COLOURS);
    const set = new Set(names.map((n) => L.agentColour(n)));
    expect(set.size).toBe(names.length);
  });
});
