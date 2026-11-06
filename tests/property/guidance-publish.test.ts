import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { arbRunInputs } from "./run-findings.test.js";
import { buildRunFindings, type BuiltRun } from "../../src/publish/run-findings.js";
import { buildGuidance, isGenericGuidance } from "../../src/publish/guidance.js";
import { DEFAULT_CAPS, type PublishCaps } from "../../src/publish/evidence.js";
import type { VisualItem } from "../../src/publish/visual.js";

function withIgnored(run: BuiltRun): BuiltRun {
  // Add ignored copies with distinct ids; they must never surface in guidance.
  const ignored = run.runFindings.findings.map((f) => ({ ...f, id: "ignored_" + f.id }));
  return { ...run, runFindings: { ...run.runFindings, ignored: [...run.runFindings.ignored, ...ignored] } } as BuiltRun;
}

describe("Property 22 (publisher): guidance is specific, linked, and honest", () => {
  // Feature: dashboard-usability-overhaul, Property 22: Automated guidance is specific, linked, and honest
  // **Validates: Requirements 7.3, 7.4, 7.5, 7.7, 7.9**
  it("holds for any built run and cap", () => {
    fc.assert(
      fc.property(arbRunInputs, fc.integer({ min: 0, max: 12 }), fc.boolean(), (inputs, cap, useDefault) => {
        const run = withIgnored(buildRunFindings(inputs));
        const caps = (useDefault ? DEFAULT_CAPS : { ...DEFAULT_CAPS, maxGuidancePerRun: cap }) as PublishCaps;
        const visual: VisualItem[] = [];
        const result = buildGuidance(run, visual, caps);
        const active = run.runFindings.findings;
        const byId = new Map(active.map((f) => [f.id, f]));

        expect(result.items.length + result.omitted).toBe(active.length);
        expect(result.items.length).toBeLessThanOrEqual(caps.maxGuidancePerRun);
        expect(buildGuidance(run, visual, caps)).toEqual(result);

        for (const item of result.items) {
          const f = byId.get(item.findingId);
          expect(f).toBeDefined();
          expect(item.findingId.startsWith("ignored_")).toBe(false);
          expect(item.text).toContain(f!.pageUrl);
          const rule = f!.kind === "check" ? f!.ruleId.replace(/^check:/, "") : f!.ruleId;
          expect(item.text).toContain(rule);
          const sev = f!.severity === "not-recorded" ? "not recorded" : f!.severity;
          expect(item.text).toContain(sev);
          expect(isGenericGuidance(item.text)).toBe(false);
          expect(Object.keys(item).some((k) => /confidence/i.test(k))).toBe(false);
          expect(item.label).toBe("Automated guidance");
          expect(item.reviewerDecision.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 },
    );
  });
});
