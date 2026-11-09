import { describe, expect, it } from "vitest";
import {
  applyDispositions,
  entryId,
  type DetectedFinding,
  type DispositionEntry,
} from "../../src/core/dispositions.js";

const PAGE = "https://example.com/a";

function entry(p: Partial<DispositionEntry> & Pick<DispositionEntry, "decision" | "scope">): DispositionEntry {
  const body: Omit<DispositionEntry, "id"> = {
    matcher: { pageUrl: PAGE, viewport: "desktop", ruleId: "color-contrast", cssTarget: "" },
    reason: "r",
    reviewer: "rev",
    at: "2024-01-01T00:00:00.000Z",
    undoes: null,
    source: "cli",
    ...p,
  };
  return { id: entryId(body), ...body };
}

function finding(targets: string[]): DetectedFinding {
  return {
    id: "rf_1",
    kind: "a11y-rule",
    pageUrl: PAGE,
    slug: "a",
    viewport: "desktop",
    ruleId: "color-contrast",
    severity: "serious",
    lifecycle: "new",
    nodeTargets: targets,
    nodeCount: targets.length,
  };
}

describe("applyDispositions", () => {
  it("ignores the whole finding for a site-rule entry", () => {
    const e = entry({
      decision: "ignore",
      scope: "site-rule",
      matcher: { pageUrl: "", viewport: "", ruleId: "color-contrast", cssTarget: "" },
    });
    const out = applyDispositions([finding(["a", "b"])], [e]);
    expect(out.active).toHaveLength(0);
    expect(out.ignored[0].disposition.decisionId).toBe(e.id);
  });

  it("accounts for partly ignored nodes and ignores when all nodes match", () => {
    const e1 = entry({
      decision: "ignore",
      scope: "element",
      matcher: { pageUrl: PAGE, viewport: "desktop", ruleId: "color-contrast", cssTarget: "a" },
    });
    const part = applyDispositions([finding(["a", "b"])], [e1]);
    expect(part.active[0].ignoredNodeCount).toBe(1);
    expect(part.active[0].nodeCount).toBe(1);
    const all = applyDispositions([finding(["a"])], [e1]);
    expect(all.ignored).toHaveLength(1);
    expect(all.active).toHaveLength(0);
  });

  it("marks regression on resolve, and ignore beats resolve", () => {
    const r = entry({ decision: "resolve", scope: "finding" });
    const out = applyDispositions([finding(["a"])], [r]);
    expect(out.active[0].lifecycle).toBe("regression");
    expect(out.active[0].regression?.decisionId).toBe(r.id);
    const ig = entry({
      decision: "ignore",
      scope: "page-rule",
      at: "2024-01-02T00:00:00.000Z",
      matcher: { pageUrl: PAGE, viewport: "", ruleId: "color-contrast", cssTarget: "" },
    });
    const both = applyDispositions([finding(["a"])], [r, ig]);
    expect(both.active).toHaveLength(0);
    expect(both.ignored).toHaveLength(1);
  });

  it("restores a finding once the ignore is undone and filters resolved items", () => {
    const ig = entry({
      decision: "ignore",
      scope: "page-rule",
      matcher: { pageUrl: PAGE, viewport: "", ruleId: "color-contrast", cssTarget: "" },
    });
    const un = entry({ decision: "unignore", scope: "undo", undoes: ig.id, at: "2024-02-01T00:00:00.000Z" });
    expect(applyDispositions([finding(["a"])], [ig, un]).active).toHaveLength(1);
    const item = { pageUrl: PAGE, viewport: "desktop", ruleId: "color-contrast" };
    expect(applyDispositions([], [ig], [item]).resolved).toHaveLength(0);
    const r = entry({ decision: "resolve", scope: "finding" });
    expect(applyDispositions([], [r], [item]).resolved[0].humanResolved?.decisionId).toBe(r.id);
  });
});
