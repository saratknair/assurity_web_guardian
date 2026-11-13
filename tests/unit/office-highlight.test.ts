import { describe, it, expect } from "vitest";
// @ts-expect-error plain browser ES module without type declarations
import * as T from "../../office/lib/timeline.js";
// @ts-expect-error plain browser ES module without type declarations
import * as Tel from "../../office/lib/telemetry.js";

const base = Date.parse("2026-01-01T00:00:00.000Z");
const iso = (ms: number) => new Date(base + ms).toISOString();
const URL1 = "https://x.test/careers/";

function step(seq: number, name: string, s: number, e: number, extra: Record<string, unknown> = {}) {
  return { ts: iso(e), correlationId: "c", runId: "r", kind: "step.completed", data: {
    seq, step: name, pageUrl: URL1, slug: "careers", startedAt: iso(s), endedAt: iso(e), ...extra } };
}
function fixture(steps: unknown[]) {
  return T.buildTimeline([
    { ts: iso(0), correlationId: "c", runId: "r", kind: "run.started", data: { replaySchema: 1, pages: 1 } },
    ...steps,
  ]);
}

describe("highlightAt", () => {
  const tl = fixture([step(0, "compare", 1000, 1001), step(1, "notes", 5000, 5001)]);

  it("exports the default hold", () => {
    expect(T.HIGHLIGHT_HOLD_MS).toBe(1500);
  });

  it("is working inside the recorded span, then held until start + hold", () => {
    expect(T.highlightAt(tl, 999).Comparator).toBeUndefined();
    const w = T.highlightAt(tl, 1000).Comparator;
    expect(w.working).toBe(true);
    expect(w.held).toBe(false);
    const h = T.highlightAt(tl, 1001).Comparator;
    expect(h.working).toBe(false);
    expect(h.held).toBe(true);
    expect(T.highlightAt(tl, 2499).Comparator.held).toBe(true);
    expect(T.highlightAt(tl, 2500).Comparator).toBeUndefined();
  });

  it("is cut off by the next entry of the same agent", () => {
    const two = fixture([step(0, "compare", 1000, 1001), step(1, "compare", 1200, 1201)]);
    const at = T.highlightAt(two, 1201).Comparator;
    expect(at.entry.id).toBe("step-1");
    const first = T.highlightAt(two, 1100).Comparator;
    expect(first.entry.id).toBe("step-0");
    expect(first.held).toBe(true);
    expect(T.highlightAt(two, 1200).Comparator.entry.id).toBe("step-1");
  });

  it("appends the real duration to the caption", () => {
    const h = T.highlightAt(tl, 1500).Comparator;
    expect(h.caption).toBe("Reviewing results for /careers/ (took 1 ms)");
    expect(T.highlightAt(tl, 1000).Comparator.caption).toBe("Reviewing results for /careers/ (took 1 ms)");
  });

  it("leaves long entries plain while working", () => {
    const long = fixture([step(0, "accessibility-scan", 100, 4100, { viewport: "mobile" })]);
    const w = T.highlightAt(long, 2000)["Observation_Runner"] || Object.values(T.highlightAt(long, 2000))[0];
    expect((w as { caption: string }).caption).toBe("Scanning /careers/ (mobile)");
  });

  it("stateAt exposes highlighted figures and screens", () => {
    const s = T.stateAt(tl, 1200);
    const f = s.figures.find((x: { agent: string }) => x.agent === "Comparator");
    expect(f.working).toBe(false);
    expect(f.highlighted).toBe(true);
    expect(f.caption).toContain("(took 1 ms)");
    expect(s.screens[f.station].highlighted).toBe(true);
    const later = T.stateAt(tl, 3000);
    const g = later.figures.find((x: { agent: string }) => x.agent === "Comparator");
    expect(g.highlighted).toBe(false);
    expect(g.caption).toBe("");
    expect(later.screens[g.station].highlighted).toBe(false);
  });

  it("is deterministic whether scrubbed or stepped", () => {
    const direct = JSON.stringify(T.stateAt(tl, 1700));
    for (let t = 0; t <= 1700; t += 100) T.stateAt(tl, t);
    expect(JSON.stringify(T.stateAt(tl, 1700))).toBe(direct);
    expect(JSON.stringify(T.highlightAt(tl, 1700))).toBe(JSON.stringify(T.highlightAt(tl, 1700)));
  });

  it("does not change recorded entries, telemetry or shares", () => {
    const before = JSON.stringify([tl.entries, Tel.telemetryAt(tl, 1200), Tel.stationShares(tl)]);
    T.highlightAt(tl, 1200);
    T.stateAt(tl, 1200);
    expect(JSON.stringify([tl.entries, Tel.telemetryAt(tl, 1200), Tel.stationShares(tl)])).toBe(before);
    expect(tl.entries.find((e: { id: string }) => e.id === "step-0").endMs).toBe(1001);
  });
});
