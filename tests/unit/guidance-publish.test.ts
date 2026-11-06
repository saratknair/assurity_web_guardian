import { describe, it, expect } from "vitest";
import { buildGuidance, isGenericGuidance } from "../../src/publish/guidance.js";
import { DEFAULT_CAPS } from "../../src/publish/evidence.js";
import type { BuiltRun } from "../../src/publish/run-findings.js";
import type { VisualItem } from "../../src/publish/visual.js";
import * as aiAgents from "../../src/agents/ai-agents.js";

const URL1 = "https://example.test/a";

function mk(findings: Record<string, unknown>[], ignored: Record<string, unknown>[] = []): BuiltRun {
  return { runFindings: { runId: "run_x", findings, ignored }, evidence: {} } as unknown as BuiltRun;
}

const a11y = {
  id: "rf_000000000001", kind: "a11y-rule", pageUrl: URL1, slug: "a", viewport: "desktop",
  ruleId: "link-name", severity: "serious", title: "Links must have discernible text",
  description: "Ensure links have discernible text", nodeCount: 7,
};
const check = {
  id: "cf_000000000002", kind: "check", pageUrl: URL1, slug: "a", viewport: "mobile",
  ruleId: "check:h1", severity: "unrated", title: "Check failed: h1", detail: "no h1 found",
};
const vis = {
  id: "vf_000000000003", kind: "visual", pageUrl: URL1, slug: "a", viewport: "desktop",
  ruleId: "visual-diff", severity: "unrated", title: "Screenshot differs", suppressed: true, suppressedBy: ["rf_000000000001"],
};

describe("buildGuidance", () => {
  it("names page, rule and severity, links to finding ids, and carries no confidence", () => {
    const visual = [
      { findingId: vis.id, measure: { diffPixels: 5, totalPixels: 100, diffRatio: 0.05, source: "recorded" } },
    ] as unknown as VisualItem[];
    const { items, omitted } = buildGuidance(mk([vis, check, a11y]), visual, DEFAULT_CAPS);
    expect(omitted).toBe(0);
    expect(items.map((i) => i.findingId)).toEqual([a11y.id, check.id, vis.id]);
    const ids = new Set([a11y.id, check.id, vis.id]);
    for (const i of items) {
      expect(ids.has(i.findingId)).toBe(true);
      expect(i.text).toContain(i.pageUrl);
      expect(isGenericGuidance(i.text)).toBe(false);
      expect(i.reviewerDecision.length).toBeGreaterThan(0);
      expect(Object.keys(i).some((k) => /confidence/i.test(k))).toBe(false);
      expect(i.label).toBe("Automated guidance");
    }
    const a = items.find((i) => i.findingId === a11y.id)!;
    expect(a.text).toContain("link-name");
    expect(a.text).toContain("serious");
    expect(a.checkId).toBe("link-name");
    expect(a.severity).toBe("serious");
    expect(items.find((i) => i.findingId === vis.id)!.text).toContain("5 of 100");
  });

  it("caps at maxGuidancePerRun and reports omitted, keeping most severe first", () => {
    const many = Array.from({ length: 5 }, (_, n) => ({ ...a11y, id: `rf_00000000000${n}`, ruleId: `r${n}`, severity: n === 4 ? "critical" : "minor" }));
    const { items, omitted } = buildGuidance(mk(many), [], { ...DEFAULT_CAPS, maxGuidancePerRun: 2 });
    expect(items.length).toBe(2);
    expect(omitted).toBe(3);
    expect(items[0].severity).toBe("critical");
  });

  it("ignores ignored findings and leaves ai-agents exported", () => {
    const { items } = buildGuidance(mk([a11y], [check]), [], DEFAULT_CAPS);
    expect(items.map((i) => i.findingId)).toEqual([a11y.id]);
    expect(typeof aiAgents.qualityAnalysis).toBe("function");
    expect(typeof aiAgents.visualExplanation).toBe("function");
  });
});
