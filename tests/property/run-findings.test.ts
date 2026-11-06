import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { buildRunFindings, type RawRunInputs } from "../../src/publish/run-findings.js";
import { findingKey } from "../../src/core/finding-model.js";

const RULE_POOL = ["link-name", "color-contrast", "region", "image-alt", "label", "nested-interactive"];
const IMPACTS = ["critical", "serious", "moderate", "minor", null, "weird"] as const;
const SEGMENTS = ["", "services", "services/testing", "about/team/leads", "careers", "contact/us"];
const CHECK_NAMES = ["title", "h1", "links", "a11y-critical-serious"];
const LC_STATES = ["new", "recurring", "existing-unresolved", "regression", "bogus", undefined] as const;
const VIEWPORTS = ["desktop", "mobile"] as const;

const arbViolation = fc.record({
  id: fc.constantFrom(...RULE_POOL),
  impact: fc.constantFrom(...IMPACTS),
  nodes: fc.array(fc.record({ html: fc.string({ maxLength: 30 }), target: fc.constant(["a"]) }), { maxLength: 4 }),
});

const arbPage = fc.record({
  segments: fc.constantFrom(...SEGMENTS),
  title: fc.constantFrom("Home", "About us"),
  axe: fc.record({
    desktop: fc.option(fc.array(arbViolation, { maxLength: 6 }), { nil: null }),
    mobile: fc.option(fc.array(arbViolation, { maxLength: 6 }), { nil: null }),
  }),
  checks: fc.array(
    fc.record({
      viewport: fc.constantFrom(...VIEWPORTS),
      name: fc.constantFrom(...CHECK_NAMES),
      passed: fc.boolean(),
    }),
    { maxLength: 6 },
  ),
  visual: fc.record({ desktop: fc.boolean(), mobile: fc.boolean() }),
  suppressedNote: fc.boolean(),
});

export const arbRunInputs: fc.Arbitrary<RawRunInputs> = fc
  .tuple(
    fc.array(arbPage, { maxLength: 8 }),
    fc.array(fc.constantFrom(...LC_STATES), { minLength: 80, maxLength: 80 }),
    fc.constantFrom("restored", "first-run", "unavailable", "weird", null),
  )
  .map(([pages, lcPool, historyStatus]) => {
    let li = 0;
    const states: Record<string, string> = {};
    const resultPages: unknown[] = [];
    const findingPages: unknown[] = [];
    const axe: RawRunInputs["axe"] = [];
    const visualFiles: RawRunInputs["visualFiles"] = [];
    pages.forEach((p, i) => {
      const slug = `page-${i}`;
      const url = `https://assurity.nz/${p.segments}${p.segments ? "/" : ""}p${i}`;
      resultPages.push({
        page: url,
        slug,
        checks: [
          { name: "desktop:title", passed: true, detail: p.title },
          ...p.checks.map((c) => ({ name: `${c.viewport}:${c.name}`, passed: c.passed, detail: "d" })),
        ],
      });
      findingPages.push({
        page: url,
        slug,
        outcomes: p.suppressedNote
          ? [{ findingId: `fnd_${i}`, detail: "Screenshot difference with a violated rule (visual finding suppressed; evidence attached)." }]
          : [],
        visual: { desktop: { differs: false }, mobile: { differs: false } },
      });
      for (const vp of VIEWPORTS) {
        const vs = p.axe[vp];
        if (vs !== null) {
          axe.push({ slug, viewport: vp, raw: { url, viewport: vp, violations: vs } });
          for (const r of RULE_POOL) {
            const s = lcPool[li++ % lcPool.length];
            if (s !== undefined) states[findingKey({ pageUrl: url, viewport: vp, ruleId: r })] = s;
          }
        }
        if (p.visual[vp]) visualFiles.push({ slug, viewport: vp, hasDiff: true });
      }
    });
    return {
      runId: "run_prop",
      finishedAt: null,
      findings: { pages: findingPages },
      results: { pages: resultPages },
      axe,
      visualFiles,
      lifecycle: historyStatus === null ? null : { historyStatus, states, resolved: [] },
    } as RawRunInputs;
  });

const RUNS = { numRuns: 150 };
const firstImpact = (raw: unknown, ruleId: string): unknown => {
  const v = (raw as { violations: { id: string; impact: unknown }[] }).violations.find((x) => x.id === ruleId);
  return v?.impact;
};
const sevOf = (impact: unknown): string =>
  impact === "critical" || impact === "serious" || impact === "moderate" || impact === "minor" ? impact : "unrated";

describe("run findings properties", () => {
  // Feature: dashboard-usability-overhaul, Property 3: One Finding per rule violation with its real Impact
  // **Validates: Requirements 2.1, 2.3, 2.6, 12.6**
  it("Property 3: one a11y-rule Finding per (page, viewport, rule) with its real impact", () => {
    fc.assert(
      fc.property(arbRunInputs, (inputs) => {
        const { runFindings } = buildRunFindings(inputs);
        const expected = new Map<string, string>();
        for (const e of inputs.axe) {
          const url = (e.raw as { url: string }).url;
          for (const v of (e.raw as { violations: { id: string }[] }).violations) {
            const k = `${url}|${e.viewport}|${v.id}`;
            if (!expected.has(k)) expected.set(k, sevOf(firstImpact(e.raw, v.id)));
          }
        }
        const actual = runFindings.findings.filter((f) => f.kind === "a11y-rule");
        expect(actual.length).toBe(expected.size);
        const seen = new Set<string>();
        for (const f of actual) {
          const k = `${f.pageUrl}|${f.viewport}|${f.ruleId}`;
          expect(seen.has(k)).toBe(false);
          seen.add(k);
          expect(expected.get(k)).toBe(f.severity);
        }
        const ruleMode = runFindings.detailLevel === "rule";
        for (const f of runFindings.findings) {
          if (f.kind === "a11y-rule") continue;
          // In legacy mode (no readable axe at all) severity is honestly not-recorded.
          expect(f.severity).toBe(ruleMode ? "unrated" : "not-recorded");
        }
      }),
      RUNS,
    );
  });

  // Feature: dashboard-usability-overhaul, Property 4: Counts are conserved
  // **Validates: Requirements 2.4, 2.9, 4.2, 4.5, 12.9, 14.7**
  it("Property 4: totals, severity, lifecycle and page counts are conserved", () => {
    fc.assert(
      fc.property(arbRunInputs, (inputs) => {
        const { runFindings: rf } = buildRunFindings(inputs);
        const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
        expect(rf.totals.all).toBe(rf.findings.length);
        expect(rf.totals.ignored).toBe(0);
        expect(rf.totals.all + rf.totals.ignored).toBe(rf.totals.detected);
        expect(new Set(rf.findings.map((f) => f.id)).size).toBe(rf.findings.length);
        expect(sum(rf.totals.bySeverity)).toBe(rf.totals.all);
        expect(sum(rf.totals.byLifecycle)).toBe(rf.totals.all);
        expect(rf.pages.reduce((n, p) => n + p.counts.total, 0)).toBe(rf.totals.all);
        for (const p of rf.pages) {
          const { total, ...sev } = p.counts;
          expect(sum(sev)).toBe(total);
        }
      }),
      RUNS,
    );
  });

  // Feature: dashboard-usability-overhaul, Property 23: Suppressed visual Findings name the failing rules
  // **Validates: Requirements 2.1, 2.3, 2.6**
  it("Property 23: suppressedBy equals the ids of the page's non-visual Findings", () => {
    fc.assert(
      fc.property(arbRunInputs, (inputs) => {
        const { runFindings: rf } = buildRunFindings(inputs);
        for (const v of rf.findings.filter((f) => f.kind === "visual")) {
          const noted = (inputs.findings as { pages: { slug: string; outcomes: unknown[] }[] }).pages.some(
            (p) => p.slug === v.slug && p.outcomes.length > 0,
          );
          const expected = noted
            ? [
                ...new Set(
                  rf.findings
                    .filter((f) => f.kind !== "visual" && f.slug === v.slug && f.viewport === v.viewport)
                    .map((f) => f.ruleId),
                ),
              ].sort()
            : [];
          expect([...(v.suppressedBy as string[])].sort()).toEqual(expected);
          expect(v.suppressed).toBe(expected.length > 0);
          expect(v.severity).toBe("unrated");
        }
      }),
      RUNS,
    );
  });
});