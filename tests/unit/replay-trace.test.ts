import { describe, expect, it } from "vitest";
import { buildReplayPublication, toAsciiJson } from "../../src/publish/replay-trace.js";

const T0 = Date.parse("2026-01-01T00:00:00.000Z");
const iso = (ms: number): string => new Date(T0 + ms).toISOString();
const env = (kind: string, ms: number, data: Record<string, unknown>) => ({
  ts: iso(ms),
  correlationId: "cor_1",
  runId: "run_1",
  kind,
  data,
});

const URL1 = "https://example.test/a/";
const built = {
  runFindings: {
    findings: [{ id: "rf_000000000001", pageUrl: URL1, viewport: "desktop", ruleId: "color-contrast" }],
    ignored: [{ id: "vf_000000000002", pageUrl: URL1, viewport: "desktop", ruleId: "visual-diff" }],
  },
};

function enrichedEvents(extra: unknown[] = []): unknown[] {
  return [
    env("run.started", 0, { replaySchema: 1, pages: 1 }),
    env("step.completed", 1500, {
      seq: 1, step: "visual-compare", agent: "Observation_Runner", pageUrl: URL1, slug: "a", viewport: "desktop",
      startedAt: iso(1000), endedAt: iso(1500), durationMs: 500, template: false,
      result: { differs: true, baseline: true }, findings: ["visual-diff"],
    }),
    env("step.completed", 3000, {
      seq: 0, step: "accessibility-scan", agent: "Observation_Runner", pageUrl: URL1, slug: "a", viewport: "desktop",
      startedAt: iso(2000), endedAt: iso(3000), durationMs: 1000, template: false,
      result: { rules: 2 }, findings: ["color-contrast", "region"],
    }),
    ...extra,
    env("run.finished", 4000, { health: "ok" }),
  ];
}

describe("replay-trace", () => {
  it("enriched: adds ids by exact key, producedAt, replayT, meta", () => {
    const r = buildReplayPublication(enrichedEvents(), built, "run_1");
    expect(r.replay).toEqual({ enriched: true, durationMs: 4000 });
    const parsed = JSON.parse(r.eventsText) as { kind: string; data: Record<string, any> }[];
    const a11y = parsed.find((e) => e.data.step === "accessibility-scan")!;
    expect(a11y.data.findingIds).toEqual({ "color-contrast": "rf_000000000001" });
    expect(r.producedAtById.get("rf_000000000001")).toEqual({ entryId: "step-0", t: 2000, station: "accessibility-check" });
    expect(r.producedAtById.get("vf_000000000002")).toEqual({ entryId: "step-1", t: 1000, station: "visual-check" });
    expect(r.replayTBySlug.get("a")).toBe(1000);
    const last = parsed[parsed.length - 1];
    expect(last.kind).toBe("replay.meta");
    expect(last.data).toMatchObject({ enriched: true, stepCount: 2, truncated: null });
  });

  it("legacy: no ids, null producedAt, no meta, no replayT", () => {
    const legacy = [
      env("run.started", 0, {}),
      env("agent.working", 10, { agentName: "Comparator", agentRole: "analysis", status: "working" }),
      env("run.finished", 100, {}),
    ];
    const r = buildReplayPublication(legacy, built, "run_1");
    expect(r.replay.enriched).toBe(false);
    expect(r.producedAtById.get("rf_000000000001")).toBeNull();
    expect(r.replayTBySlug.size).toBe(0);
    expect(JSON.parse(r.eventsText)).toHaveLength(3);
  });

  it("over cap: drops tier 1 kinds first, keeps step identity, flags overCap when needed", () => {
    const filler = Array.from({ length: 40 }, (_, i) => env("audit", 500 + i, { note: "x".repeat(100) }));
    const r = buildReplayPublication(enrichedEvents(filler), built, "run_1", { capBytes: 2500 });
    const parsed = JSON.parse(r.eventsText) as { kind: string; data: Record<string, any> }[];
    expect(parsed.some((e) => e.kind === "audit")).toBe(false);
    expect(parsed.filter((e) => e.kind === "step.completed").map((e) => e.data.seq)).toEqual([1, 0]);
    const meta = parsed[parsed.length - 1].data;
    expect(meta.truncated).toMatchObject({ level: 1, droppedEvents: 40, overCap: false, droppedKinds: ["audit"] });

    const tiny = buildReplayPublication(enrichedEvents(), built, "run_1", { capBytes: 10 });
    const tinyMeta = (JSON.parse(tiny.eventsText) as { data: Record<string, any> }[]).pop()!.data;
    expect(tinyMeta.truncated.overCap).toBe(true);
    expect(tiny.eventsText).toContain("step.completed");
  });

  it("toAsciiJson escapes non-ASCII and round-trips", () => {
    const v = { s: "caf\u00e9 \ud83d\ude00 \u007f" };
    const t = toAsciiJson(v);
    expect(/^[\x20-\x7e]*$/.test(t)).toBe(true);
    expect(JSON.parse(t)).toEqual(v);
  });
});
