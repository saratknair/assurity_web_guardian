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

  it("idle figures wait beside their own station, away from the scene centre and the working spot", () => {
    for (let i = 0; i < 6; i++) {
      const desk = L.stationPosition(i, 6);
      const work = L.anchorFor(i, 6, 0, true);
      const idle = L.anchorFor(i, 6, 0, false);
      expect(work).toEqual(L.stationAnchor(i, 6, 0));
      expect(idle).toEqual(L.homeAnchor(i, 6, 0));
      expect(Math.hypot(idle.x, idle.z)).toBeGreaterThan(4);
      expect(L.distance(idle, desk)).toBeLessThan(3);
      expect(L.distance(idle, work)).toBeGreaterThan(2);
      // closer to its own desk than to any other desk
      for (let j = 0; j < 6; j++) {
        if (j !== i) expect(L.distance(idle, L.stationPosition(j, 6))).toBeGreaterThan(L.distance(idle, desk));
      }
    }
  });
  it("figureVisual: highlighted (not working) drives the lit look, name and caption", () => {
    const held = L.figureVisual({ working: false, highlighted: true, caption: "Comparing (took 12 ms)" });
    expect(held).toEqual({ lit: true, showName: true, caption: "Comparing (took 12 ms)" });
    const idle = L.figureVisual({ working: false, highlighted: false, caption: "stale" });
    expect(idle).toEqual({ lit: false, showName: false, caption: "" });
    const workingOnly = L.figureVisual({ working: true, highlighted: false });
    expect(workingOnly.lit).toBe(false);
  });
  it("highlighted and idle figures at one station never overlap", () => {
    const figs = ["A", "B", "C", "D"].map((agent) => ({ agent, station: "review-desk" }));
    const slots = L.assignSlots(figs);
    const pts = figs.map((f, k) => L.anchorFor(4, 6, slots[f.agent], k % 2 === 0));
    const all = pts.concat(figs.map((f) => L.homeAnchor(4, 6, slots[f.agent])), figs.map((f) => L.stationAnchor(4, 6, slots[f.agent])));
    for (const working of [true, false]) {
      const set = figs.map((f) => L.anchorFor(4, 6, slots[f.agent], working));
      for (let a = 0; a < set.length; a++) for (let b = a + 1; b < set.length; b++) expect(L.distance(set[a], set[b])).toBeGreaterThan(0.8);
    }
    expect(all.length).toBe(12);
    for (let a = 0; a < pts.length; a++) for (let b = a + 1; b < pts.length; b++) expect(L.distance(pts[a], pts[b])).toBeGreaterThan(0.8);
  });
  it("spreads three figures at the review desk without overlap, working or idle", () => {
    const figs = [
      { agent: "Triage_Agent", station: "review-desk" },
      { agent: "Comparator", station: "review-desk" },
      { agent: "Quality_Analysis_Agent", station: "review-desk" },
    ];
    const slots = L.assignSlots(figs);
    for (const working of [true, false]) {
      const pts = figs.map((f) => L.anchorFor(4, 6, slots[f.agent], working));
      for (let a = 0; a < pts.length; a++) {
        for (let b = a + 1; b < pts.length; b++) expect(L.distance(pts[a], pts[b])).toBeGreaterThan(0.8);
      }
    }
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

  it("labels figures with the component name only and bobs only while working", () => {
    expect(L.figureLabel("Triage_Agent", true)).toBe("Triage_Agent");
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

describe("office diorama stacked labels (19.8)", () => {
  it("stackOffset spaces lines by a fixed pixel step", () => {
    expect(L.stackOffset(0)).toBe(0);
    expect(L.stackOffset(1)).toBe(L.STACK_LINE_PX);
    expect(L.stackOffset(3) - L.stackOffset(2)).toBe(L.STACK_LINE_PX);
  });
  it("stackLines groups lit figures by station in stable order and skips idle ones", () => {
    const figs = [
      { agent: "Triage_Agent", station: "review-desk", highlighted: true, caption: "Triaging /a/" },
      { agent: "Comparator", station: "review-desk", highlighted: true, caption: "Reviewing /a/" },
      { agent: "Lifecycle_Tracker", station: "records-room", highlighted: true, caption: "" },
      { agent: "Observation_Runner", station: "browser-bay", highlighted: false, caption: "stale" },
    ];
    const g = L.stackLines(figs);
    expect(g.map((x: { station: string }) => x.station)).toEqual(["records-room", "review-desk"]);
    expect(g[1].lines.map((l: { text: string }) => l.text)).toEqual([
      "Comparator - Reviewing /a/", "Triage_Agent - Triaging /a/",
    ]);
    expect(g[0].lines[0].text).toBe("Lifecycle_Tracker");
    expect(L.stackLines(figs.slice().reverse())).toEqual(g);
  });
});
