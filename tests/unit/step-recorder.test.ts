import { describe, it, expect } from "vitest";
import { stepTimes, createStepSeq, recordStep, summariseStep } from "../../src/telemetry/step-recorder.js";
import type { StepEventData } from "../../src/telemetry/types.js";

describe("step-recorder", () => {
  it("stepTimes clamps negative durations", () => {
    const t = stepTimes(1000, -5);
    expect(t.durationMs).toBe(0);
    expect(t.startedAt).toBe(t.endedAt);
    expect(Date.parse(stepTimes(1000, 250.4).endedAt) - 1000).toBe(250);
  });

  it("createStepSeq increases", () => {
    const s = createStepSeq();
    expect([s(), s(), s()]).toEqual([1, 2, 3]);
  });

  it("summarises findings per the design tables", () => {
    const load = summariseStep("load", {
      status: 200,
      reached: true,
      checks: [
        { name: "desktop:http", passed: true },
        { name: "desktop:title", passed: false },
        { name: "desktop:a11y-critical-serious", passed: false },
      ],
    });
    expect(load.findings).toEqual(["check:title"]);
    expect(load.result).toEqual({ httpStatus: 200, reached: true, checksFailed: ["title"] });
    const ax = summariseStep("accessibility-scan", {
      violations: [{ id: "color-contrast", impact: "serious" }, { id: "region", impact: "moderate" }, { id: "x", impact: null }],
    });
    expect(ax.findings).toEqual(["color-contrast", "region", "x"]);
    expect(ax.result).toEqual({ violations: { critical: 0, serious: 1, moderate: 1, minor: 0, unrated: 1 }, rules: 3 });
    expect(summariseStep("visual-compare", { differs: true, dimensionsChanged: false, baselinePath: "p" }).findings).toEqual(["visual-diff"]);
  });

  it("recordStep emits on success and on throw without error text", async () => {
    const events: StepEventData[] = [];
    const tel = { step: (d: StepEventData) => void events.push(d) };
    const seq = createStepSeq();
    await recordStep(tel, { step: "notes", agent: "A", seq }, () => 3, (n) => summariseStep("notes", { items: n }));
    await expect(
      recordStep(tel, { step: "triage", agent: "B", seq }, () => { throw new Error("C:\\secret\\path"); }, () => ({ result: {} })),
    ).rejects.toThrow();
    expect(events.map((e) => e.seq)).toEqual([1, 2]);
    expect(events[0].result).toEqual({ items: 3 });
    expect(events[0].template).toBe(true);
    expect(events[1].result).toEqual({ failed: true });
    expect(JSON.stringify(events[1])).not.toContain("secret");
  });
});
