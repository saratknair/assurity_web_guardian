import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRunFindings, loadRawRunInputs, type RawRunInputs } from "../../src/publish/run-findings.js";
import { DEFAULT_CAPS } from "../../src/publish/evidence.js";
import { findingId, findingKey } from "../../src/core/finding-model.js";

const URL1 = "https://assurity.nz/";

function baseInputs(): RawRunInputs {
  return {
    runId: "run_test",
    results: {
      pages: [
        {
          page: URL1,
          slug: "assurity-nz",
          checks: [
            { name: "desktop:title", passed: true, detail: "Home" },
            { name: "desktop:a11y-critical-serious", passed: false, detail: "link-name, nested-interactive" },
            { name: "mobile:h1", passed: false, detail: "missing" },
          ],
        },
      ],
    },
    findings: {
      pages: [
        {
          page: URL1,
          slug: "assurity-nz",
          outcomes: [
            { findingId: "fnd_a", detail: "desktop:a11y-critical-serious: link-name, nested-interactive" },
            {
              findingId: "fnd_v",
              detail: "Screenshot difference with a violated deterministic rule (visual finding suppressed; evidence attached).",
            },
          ],
        },
      ],
    },
    axe: [
      {
        slug: "assurity-nz",
        viewport: "desktop",
        raw: {
          url: URL1,
          viewport: "desktop",
          violations: [
            { id: "link-name", impact: "serious", help: "Links must have discernible text", tags: ["wcag2a", "wcag244"], nodes: [{ html: "<a></a>", target: ["a"] }] },
            { id: "nested-interactive", impact: null, nodes: [] },
            { id: "region", impact: "moderate", nodes: [{ html: "<div></div>" }] },
          ],
        },
      },
    ],
    visualFiles: [{ slug: "assurity-nz", viewport: "desktop", hasDiff: true }],
    lifecycle: null,
  };
}

describe("buildRunFindings", () => {
  it("emits one a11y-rule finding per rule with axe impact, replacing the aggregate check", () => {
    const { runFindings: r, evidence } = buildRunFindings(baseInputs(), { caps: DEFAULT_CAPS });
    expect(r.detailLevel).toBe("rule");
    const rules = r.findings.filter((f) => f.kind === "a11y-rule");
    expect(rules.map((f) => [f.ruleId, f.severity])).toEqual([
      ["link-name", "serious"],
      ["nested-interactive", "unrated"],
      ["region", "moderate"],
    ]);
    expect(r.findings.some((f) => f.ruleId === "check:a11y-critical-serious")).toBe(false);
    const check = r.findings.find((f) => f.kind === "check")!;
    expect(check).toMatchObject({ ruleId: "check:h1", severity: "unrated", viewport: "mobile", detail: "missing" });
    const link = rules[0];
    expect(link.id).toBe(findingId("run_test", findingKey({ pageUrl: URL1, viewport: "desktop", ruleId: "link-name" }), "a11y-rule"));
    expect(link).toMatchObject({ legacyFindingId: "fnd_a", wcag: ["wcag244"], nodeCount: 1, ignoredNodeCount: 0, lifecycle: "not-recorded" });
    expect(Object.keys(evidence)).toEqual(["evidence/assurity-nz.desktop.json"]);
  });

  it("marks the visual finding suppressed by the page-viewport rules", () => {
    const { runFindings: r } = buildRunFindings(baseInputs(), { caps: DEFAULT_CAPS });
    const v = r.findings.find((f) => f.kind === "visual")!;
    expect(v).toMatchObject({
      severity: "unrated",
      suppressed: true,
      suppressedBy: ["link-name", "nested-interactive", "region"],
      legacyFindingId: "fnd_v",
    });
  });

  it("produces conserved totals and page counts", () => {
    const { runFindings: r } = buildRunFindings(baseInputs(), { caps: DEFAULT_CAPS });
    expect(r.totals.all).toBe(5);
    expect(r.totals.detected).toBe(5);
    expect(r.totals.ignored).toBe(0);
    expect(r.totals.bySeverity).toEqual({ critical: 0, serious: 1, moderate: 1, minor: 0, unrated: 3, notRecorded: 0 });
    expect(r.totals.byLifecycle.notRecorded).toBe(5);
    expect(r.ignored).toEqual([]);
    expect(r.decisions).toEqual({ status: "not-applicable" });
    expect(r.historyStatus).toBe("not-recorded");
    expect(r.pages).toEqual([
      {
        url: URL1,
        slug: "assurity-nz",
        group: "(home)",
        title: "Home",
        counts: { total: 5, critical: 0, serious: 1, moderate: 1, minor: 0, unrated: 3, notRecorded: 0 },
        highest: "serious",
      },
    ]);
  });

  it("joins lifecycle.json states", () => {
    const inputs = baseInputs();
    inputs.lifecycle = {
      historyStatus: "restored",
      states: { [`${URL1}|desktop|link-name`]: "recurring", [`${URL1}|mobile|check:h1`]: "new" },
      resolved: [{ key: "x" }],
    };
    const { runFindings: r } = buildRunFindings(inputs, { caps: DEFAULT_CAPS });
    expect(r.historyStatus).toBe("restored");
    expect(r.totals.byLifecycle).toEqual({ new: 1, recurring: 1, existingUnresolved: 0, regression: 0, notRecorded: 3 });
    expect(r.totals.resolved).toBe(1);
  });

  it("falls back to legacy mode when no raw axe is readable and records the omission", () => {
    const inputs = baseInputs();
    inputs.axe = [{ slug: "assurity-nz", viewport: "desktop", raw: null, parseError: "SyntaxError" }];
    const { runFindings: r } = buildRunFindings(inputs, { caps: DEFAULT_CAPS });
    expect(r.detailLevel).toBe("legacy");
    expect(r.omissions).toEqual([{ path: "accessibility/assurity-nz.desktop.json", role: "evidence", reason: "raw-axe-unreadable" }]);
    expect(r.findings.length).toBe(2);
    expect(r.findings.every((f) => f.severity === "not-recorded" && f.ruleId === "legacy-outcome")).toBe(true);
    expect(r.totals.bySeverity.notRecorded).toBe(2);
  });

  it("is total on garbage input", () => {
    const r = buildRunFindings(
      { runId: "r", findings: 42, results: "x", axe: [{ slug: "s", viewport: "tv", raw: [] }], visualFiles: [], lifecycle: [] },
      { caps: DEFAULT_CAPS },
    ).runFindings;
    expect(r.totals.all).toBe(0);
    expect(r.omissions.length).toBe(1);
  });
});

describe("loadRawRunInputs", () => {
  let dir = "";
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("tolerates missing and corrupt files", () => {
    dir = mkdtempSync(join(tmpdir(), "awg-rf-"));
    const runDir = join(dir, "run_x");
    mkdirSync(join(runDir, "accessibility"), { recursive: true });
    mkdirSync(join(runDir, "screenshots"), { recursive: true });
    writeFileSync(join(runDir, "accessibility", "p.desktop.json"), "{not json");
    writeFileSync(join(runDir, "accessibility", "p.mobile.json"), JSON.stringify({ url: URL1, violations: [] }));
    writeFileSync(join(runDir, "screenshots", "p.desktop.diff.png"), "");
    writeFileSync(join(runDir, "results.json"), "{bad");
    const i = loadRawRunInputs(runDir);
    expect(i.runId).toBe("run_x");
    expect(i.results).toBeNull();
    expect(i.findings).toBeNull();
    expect(i.lifecycle).toBeNull();
    expect(i.axe[0]).toMatchObject({ slug: "p", viewport: "desktop", raw: null });
    expect(typeof i.axe[0].parseError).toBe("string");
    expect(i.axe[1].raw).toEqual({ url: URL1, violations: [] });
    expect(i.visualFiles).toEqual([{ slug: "p", viewport: "desktop", hasDiff: true }]);
  });
});
