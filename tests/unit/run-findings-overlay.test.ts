import { describe, it, expect } from "vitest";
import {
  buildRunFindings,
  finalizeDecisions,
  type RawRunInputs,
} from "../../src/publish/run-findings.js";
import type { DispositionEntry } from "../../src/core/dispositions.js";

const URL1 = "https://assurity.nz/";

function entry(p: Partial<DispositionEntry> & { id: string }): DispositionEntry {
  return {
    decision: "ignore",
    scope: "page-rule",
    matcher: { pageUrl: URL1, viewport: "", ruleId: "region", cssTarget: "" },
    reason: "accepted by design",
    reviewer: "S. Nair",
    at: "2026-01-01T00:00:00.000Z",
    undoes: null,
    source: "admin-gui",
    ...p,
  };
}

function inputs(entries: DispositionEntry[] | null): RawRunInputs {
  return {
    runId: "run_a",
    finishedAt: "2026-02-01T00:00:00.000Z",
    results: { pages: [{ page: URL1, slug: "assurity-nz", checks: [] }] },
    findings: { pages: [{ page: URL1, slug: "assurity-nz", outcomes: [] }] },
    axe: [
      {
        slug: "assurity-nz",
        viewport: "desktop",
        raw: {
          url: URL1,
          violations: [
            {
              id: "link-name",
              impact: "serious",
              help: "Links must have discernible text",
              nodes: [
                { html: "<a id=1></a>", target: ["a.one"] },
                { html: "<a id=2></a>", target: ["a.two"] },
              ],
            },
            { id: "region", impact: "moderate", nodes: [{ html: "<div></div>", target: ["div"] }] },
          ],
        },
      },
    ],
    visualFiles: [],
    lifecycle: null,
    dispositions: entries === null ? null : { status: "applied", entries },
  };
}

describe("disposition overlay in buildRunFindings", () => {
  it("keeps legacy runs without a frozen file as not-applicable", () => {
    const b = buildRunFindings(inputs(null));
    expect(b.runFindings.decisions).toEqual({ status: "not-applicable" });
    expect(b.runFindings.ignored).toEqual([]);
    expect(b.overlay).toBeUndefined();
    expect(b.runFindings.totals.ignored).toBe(0);
  });

  it("moves a page-rule ignored Finding to ignored[] and conserves totals", () => {
    const b = buildRunFindings(inputs([entry({ id: "dsp_1" })]));
    const rf = b.runFindings;
    expect(rf.findings.map((f) => f.ruleId)).toEqual(["link-name"]);
    expect(rf.ignored.map((f) => f.ruleId)).toEqual(["region"]);
    expect(rf.ignored[0].disposition).toMatchObject({ decisionId: "dsp_1", reviewer: "S. Nair", scope: "page-rule" });
    expect(rf.totals.all + rf.totals.ignored).toBe(rf.totals.detected);
    expect(rf.totals.bySeverity.moderate).toBe(0);
    expect(rf.pages[0].counts.total).toBe(1);
    expect(rf.decisions).toMatchObject({
      status: "applied",
      appliedCount: 1,
      ignoredNewThisRun: 1,
      newThisRun: [{ id: "dsp_1", decision: "ignore", scope: "page-rule", findingsAffected: 1 }],
    });
  });

  it("reduces node count and rebuilds evidence for a partly ignored Finding", () => {
    const e = entry({
      id: "dsp_2",
      scope: "element",
      matcher: { pageUrl: URL1, viewport: "desktop", ruleId: "link-name", cssTarget: "a.one" },
    });
    const b = buildRunFindings(inputs([e]));
    const f = b.runFindings.findings.find((x) => x.ruleId === "link-name")!;
    expect(f.ignoredNodeCount).toBe(1);
    expect(f.nodeCount).toBe(1);
    const ev = b.evidence["evidence/assurity-nz.desktop.json"].violations.find((v) => v.ruleId === "link-name")!;
    expect(ev.nodes.map((n) => n.target)).toEqual(["a.two"]);
  });

  it("marks a resolved Finding that is detected again as a regression", () => {
    const e = entry({
      id: "dsp_3",
      decision: "resolve",
      scope: "finding",
      matcher: { pageUrl: URL1, viewport: "desktop", ruleId: "region", cssTarget: "" },
    });
    const b = buildRunFindings(inputs([e]));
    const f = b.runFindings.findings.find((x) => x.ruleId === "region")!;
    expect(f.lifecycle).toBe("regression");
    expect(f.regression).toMatchObject({ decisionId: "dsp_3", reviewer: "S. Nair" });
    expect(b.runFindings.totals.byLifecycle.regression).toBe(1);
  });

  it("compares applied ids with the previous run", () => {
    const e = entry({ id: "dsp_1" });
    const prev = buildRunFindings(inputs([e]));
    const cur = buildRunFindings(inputs([e]));
    finalizeDecisions(cur, prev);
    expect(cur.runFindings.decisions).toMatchObject({ appliedCount: 1, newThisRun: [], ignoredNewThisRun: 0 });
  });

  it("withholds reviewer text that cannot be confirmed clean", () => {
    const b = buildRunFindings(inputs([entry({ id: "dsp_4", reviewer: "C:\\Users\\bob\\secret" })]));
    expect(b.runFindings.ignored[0].disposition).toBeDefined();
    expect(JSON.stringify(b.runFindings)).not.toContain("C:\\\\Users");
  });
});
