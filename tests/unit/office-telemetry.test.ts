import { describe, it, expect } from "vitest";
// @ts-expect-error plain browser ES module without type declarations
import * as T from "../../office/lib/timeline.js";
// @ts-expect-error plain browser ES module without type declarations
import * as M from "../../office/lib/telemetry.js";

const T0 = Date.parse("2026-01-01T00:00:00.000Z");
const iso = (ms: number) => new Date(T0 + ms).toISOString();
const ev = (kind: string, ms: number, data: unknown) => ({ ts: iso(ms), correlationId: "c", runId: "r1", kind, data });
const step = (seq: number, name: string, s: number, e: number, extra: Record<string, unknown> = {}) =>
  ev("step.completed", e, { seq, step: name, pageUrl: "https://x.test/", slug: "x", viewport: "desktop", startedAt: iso(s), endedAt: iso(e), ...extra });

const events = [
  ev("run.started", 0, { replaySchema: 1, pages: 2 }),
  step(0, "load", 0, 100, { result: { httpStatus: 200, checksFailed: ["title"] }, findings: ["check:title"] }),
  step(1, "accessibility-scan", 100, 400, { result: { violations: { critical: 0, serious: 1 } }, findings: ["color-contrast"] }),
  step(2, "notes", 400, 500, { result: { items: 1 } }),
  ev("run.finished", 600, { health: "green" }),
];

describe("office telemetry", () => {
  it("accumulates running totals monotonically", () => {
    const tl = T.buildTimeline(events);
    const a = M.telemetryAt(tl, 100);
    const b = M.telemetryAt(tl, 600);
    expect(a.findings.total).toBe(1);
    expect(b.findings.total).toBe(2);
    expect(b.findings.serious).toBe(1);
    expect(a.pagesCompleted).toBe(0);
    expect(b.pagesCompleted).toBe(1);
    expect(b.pagesTotal).toBe(2);
    expect(b.unattributedMs).toBe(100);
  });

  it("station shares sum to exactly 100.0 and exclude unattributed time", () => {
    const tl = T.buildTimeline(events);
    const shares = M.stationShares(tl);
    const sum = shares.reduce((n: number, s: any) => n + Math.round(s.percent * 10), 0);
    expect(sum).toBe(1000);
    expect(M.timeBreakdown(tl).recordedStepMs).toBe(500);
    expect(M.stationShares(T.buildTimeline([]))).toEqual([]);
  });

  it("reconciles match, explained, differs and unavailable", () => {
    const tl = T.buildTimeline(events);
    const totals = M.eventTotals(tl);
    expect(totals.total).toBe(2);
    expect(M.reconcile(totals, { totals: { detected: 2, ignored: 0, all: 2 } }).status).toBe("match");
    const ex = M.reconcile(totals, { totals: { detected: 2, ignored: 1, all: 1 } });
    expect(ex.status).toBe("explained");
    expect(ex.message).toContain("ignored by a reviewer decision");
    const d = M.reconcile(totals, { totals: { detected: 5, ignored: 0, all: 5 } });
    expect(d.status).toBe("differs");
    expect(d.difference).toBe(-3);
    expect(d.reasons.length).toBeGreaterThan(0);
    expect(M.reconcile(totals, null).status).toBe("unavailable");
    expect(M.reconcile(null, { totals: { detected: 1 } }).status).toBe("unavailable");
  });

  it("shows not recorded (null) for a Legacy_Run", () => {
    const legacy = [
      ev("run.started", 0, {}),
      ev("agent.working", 10, { agentName: "Observation_Runner", status: "working" }),
      ev("agent.completed", 60, { agentName: "Observation_Runner", status: "completed" }),
      ev("run.finished", 100, { health: "green" }),
    ];
    const tl = T.buildTimeline(legacy);
    const t = M.telemetryAt(tl, 100);
    expect(t.findings).toBeNull();
    expect(t.pagesCompleted).toBeNull();
    expect(t.runDurationMs).toBe(100);
    expect(t.stationDurations.find((s: any) => s.station === "browser-bay").totalMs).toBe(50);
    expect(M.eventTotals(tl)).toBeNull();
  });
});
