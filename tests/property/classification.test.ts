import { describe, it, expect } from "vitest";
import { compare } from "../../src/agents/comparator.js";
import { qualityText, triageText, visualText } from "../../src/agents/template-text.js";

describe("classification", () => {
  // Property 19: a difference without a violated expectation is never a Failed_Check.
  it("Property 19: observed changes are never failed-checks", () => {
    const r = compare({
      page: "https://assurity.nz/",
      deterministicChecks: [{ name: "title", passed: true, detail: "ok" }],
      observedDifferences: ["hero text changed", "new banner added"],
      screenshotDiffers: false,
    });
    expect(r.failedCheckCount).toBe(0);
    expect(r.outcomes.every((o) => o.kind !== "failed-check")).toBe(true);
    expect(r.outcomes.filter((o) => o.kind === "observed-website-change").length).toBe(2);
  });

  it("failed deterministic check produces a failed-check (deterministic-test-evidence)", () => {
    const r = compare({
      page: "https://assurity.nz/",
      deterministicChecks: [{ name: "h1", passed: false, detail: "no visible h1" }],
      observedDifferences: [],
      screenshotDiffers: false,
    });
    expect(r.failedCheckCount).toBe(1);
    expect(r.outcomes[0].classification).toBe("deterministic-test-evidence");
  });

  // Property 20: Visual_Finding suppressed when a deterministic rule is violated in the same comparison.
  it("Property 20: visual finding is suppressed when a deterministic rule is violated", () => {
    const suppressed = compare({
      page: "https://assurity.nz/",
      deterministicChecks: [],
      observedDifferences: [],
      screenshotDiffers: true,
      screenshotDeterministicRuleViolated: true,
    });
    expect(suppressed.outcomes.some((o) => o.kind === "visual-finding")).toBe(false);
    expect(suppressed.outcomes.some((o) => o.kind === "failed-check")).toBe(true);

    const notSuppressed = compare({
      page: "https://assurity.nz/",
      deterministicChecks: [],
      observedDifferences: [],
      screenshotDiffers: true,
      screenshotDeterministicRuleViolated: false,
    });
    expect(notSuppressed.outcomes.some((o) => o.kind === "visual-finding")).toBe(true);
    expect(notSuppressed.outcomes.some((o) => o.kind === "failed-check")).toBe(false);
  });

  // Property 13: AI analysis is linked, labeled, and never overwrites deterministic classification.
  it("Property 13: AI items are separate, linked, labeled, never deterministic", () => {
    const r = compare({
      page: "https://assurity.nz/",
      deterministicChecks: [{ name: "h1", passed: false, detail: "missing" }],
      observedDifferences: [],
      screenshotDiffers: true,
      screenshotDeterministicRuleViolated: false,
    });
    const detFinding = r.outcomes.find((o) => o.kind === "failed-check")!;
    const visualFinding = r.outcomes.find((o) => o.kind === "visual-finding")!;

    const qa = qualityText(detFinding);
    expect(qa.classification).toBe("ai-generated-analysis");
    expect(qa.relatedFindingId).toBe(detFinding.findingId);
    expect(qa.label.toLowerCase()).toContain("ai-generated");
    // Deterministic finding keeps its own classification (not overwritten).
    expect(detFinding.classification).toBe("deterministic-test-evidence");

    const ve = visualText(visualFinding);
    expect(ve?.classification).toBe("ai-generated-analysis");
    expect(ve?.relatedFindingId).toBe(visualFinding.findingId);

    const tri = triageText(r.outcomes);
    expect(tri.classification).toBe("agent-recommendation");
    expect(tri.label.toLowerCase()).toContain("recommendation");
  });
});
