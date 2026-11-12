import { describe, it, expect } from "vitest";
// @ts-expect-error plain browser ES module without type declarations
import * as T from "../../office/lib/timeline.js";

const T0 = Date.parse("2026-01-01T00:00:00.000Z");
const iso = (ms: number) => new Date(T0 + ms).toISOString();
const ev = (kind: string, ms: number, data: unknown) => ({ ts: iso(ms), correlationId: "c", runId: "r1", kind, data });
const step = (seq: number, name: string, s: number, e: number, extra: Record<string, unknown> = {}) =>
  ev("step.completed", e, { seq, step: name, pageUrl: "https://x.test/", slug: "x", viewport: "desktop", startedAt: iso(s), endedAt: iso(e), ...extra });

const enriched = [
  ev("run.started", 0, { replaySchema: 1, pages: 1 }),
  ev("agent.working", 5, { agentName: "Specification_Agent", agentRole: "ai", status: "working" }),
  step(1, "accessibility-scan", 100, 400, { result: { violations: { critical: 0, serious: 1 } }, findings: ["color-contrast"] }),
  step(0, "load", 10, 90, { result: { httpStatus: 200 } }),
  ev("run.finished", 500, { health: "green" }),
];

describe("office timeline", () => {
  it("builds a sorted enriched timeline with findings keys and no placeholders", () => {
    const tl = T.buildTimeline(enriched);
    expect(tl.mode).toBe("enriched");
    expect(tl.entries.map((e: any) => e.id)).toEqual(["run-started", "step-0", "step-1", "run-finished"]);
    expect(tl.durationMs).toBe(500);
    expect(T.producingEntry(tl, T.officeFindingKey("https://x.test/", "desktop", "color-contrast")).id).toBe("step-1");
    expect(T.producingEntry(tl, "nope")).toBeNull();
    expect(JSON.stringify(T.buildTimeline(enriched))).toBe(JSON.stringify(tl));
  });

  it("navigates positions monotonically", () => {
    const tl = T.buildTimeline(enriched);
    expect(T.countAt(tl, 10)).toBe(2);
    expect(T.countAt(tl, 99)).toBe(2);
    expect(T.nextStart(tl, 10)).toBe(100);
    expect(T.prevStart(tl, 100)).toBe(10);
    expect(T.clampT(tl, 9999)).toBe(500);
    expect(T.firstEntryForPage(tl, "https://x.test/").id).toBe("step-0");
    const s = T.stateAt(tl, 450);
    expect(s.figures[0].agent).toBe("Observation_Runner");
    expect(s.screens["accessibility-check"].lines.join("|")).toContain("serious 1");
  });

  it("falls back to coarse mode for legacy runs without inference", () => {
    const tl = T.buildTimeline([
      ev("run.started", 0, {}),
      ev("agent.working", 1, { agentName: "Discovery crawler" }),
      ev("agent.working", 2, { agentName: "Observation_Runner" }),
      ev("agent.completed", 50, { agentName: "Observation_Runner" }),
    ]);
    expect(tl.mode).toBe("coarse");
    const agents = tl.entries.filter((e: any) => e.kind === "agent");
    expect(agents).toHaveLength(1);
    expect(agents[0].step).toBeNull();
    expect(agents[0].station).toBe("browser-bay");
    expect(tl.notices.notRecorded.length).toBeGreaterThan(0);
  });

  it("handles unsupported schema, empty and malformed input without throwing", () => {
    expect(T.buildTimeline(null).mode).toBe("empty");
    expect(T.buildTimeline([]).notices.empty).toBeTruthy();
    expect(T.buildTimeline([ev("run.finished", 1, {})]).mode).toBe("empty");
    const u = T.buildTimeline([ev("run.started", 0, { replaySchema: 2 }), step(0, "load", 1, 2)]);
    expect(u.mode).toBe("coarse");
    expect(u.notices.unsupported).toBeTruthy();
    const m = T.buildTimeline([ev("run.started", 0, {}), 5, { kind: "weird" }, ev("step.completed", 3, { step: "load" })]);
    expect(m.notices.skipped.length).toBe(3);
  });
});
