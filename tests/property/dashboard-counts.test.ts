import { describe, it, expect } from "vitest";
import fc from "fast-check";
// @ts-expect-error plain browser ES module without type declarations
import { normalizeRun, countBySeverity, countByLifecycle, filterFindings, sameRuleOtherPages, LIFECYCLE_PRESENT } from "../../dashboard/lib/findings.js";
// @ts-expect-error plain browser ES module without type declarations
import { normalizeLegacyRun } from "../../dashboard/lib/legacy.js";

const SEVERITIES = ["critical", "serious", "moderate", "minor", "unrated", "not-recorded"];
const NUM_RUNS = 150;

const arbFinding = fc.record({
  id: fc.string({ maxLength: 8 }),
  kind: fc.constantFrom("a11y", "check"),
  pageUrl: fc.constantFrom("https://x.test/", "https://x.test/a", "https://x.test/b", "https://x.test/c/d"),
  slug: fc.constantFrom("home", "a", "b", "cd"),
  viewport: fc.constantFrom("desktop", "mobile"),
  ruleId: fc.constantFrom("r1", "r2", "r3", "r4"),
  severity: fc.constantFrom(...SEVERITIES),
  lifecycle: fc.constantFrom(...LIFECYCLE_PRESENT),
  title: fc.string({ maxLength: 10 }),
  nodeCount: fc.nat(20),
  hasElementDetail: fc.boolean(),
});

const arbRun = fc.record({
  runId: fc.string({ maxLength: 8 }),
  findings: fc.array(arbFinding, { maxLength: 40 }),
  resolved: fc.array(fc.record({ id: fc.string({ maxLength: 5 }) }), { maxLength: 5 }),
  ignored: fc.array(arbFinding, { maxLength: 5 }),
});

const sum = (o: Record<string, number>, keys: string[]) => keys.reduce((a, k) => a + o[k], 0);

describe("dashboard counts properties", () => {
  // Feature: dashboard-usability-overhaul, Property 4: Counts are conserved
  it("Property 4: Counts are conserved", () => {
    fc.assert(
      fc.property(arbRun, (raw) => {
        const run = normalizeRun(raw);
        expect(run.totals.all).toBe(run.findings.length);
        expect(sum(run.totals.bySeverity, SEVERITIES)).toBe(run.totals.all);
        expect(sum(run.totals.byLifecycle, [...LIFECYCLE_PRESENT])).toBe(run.totals.all);
        expect(run.totals.resolved).toBe(raw.resolved.length);
        expect(run.totals.ignored).toBe(raw.ignored.length);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: dashboard-usability-overhaul, Property 5: Every view of a run's counts agree
  // Dashboard-side views only (KPI, severity chart, segment filter, lifecycle chart,
  // run-view list length); the published trend aggregate is covered on the publish side.
  it("Property 5: Every view of a run's counts agrees", () => {
    fc.assert(
      fc.property(arbRun, (raw) => {
        const run = normalizeRun(raw);
        const kpi = run.totals.all;
        const bySev = countBySeverity(run.findings);
        const life = countByLifecycle(run.findings, run.resolved);
        expect(bySev.total).toBe(kpi);
        expect(life.total).toBe(kpi);
        expect(sum(life.series, [...LIFECYCLE_PRESENT])).toBe(kpi);
        expect(kpi).toBe(run.findings.length);
        for (const s of SEVERITIES) {
          expect(filterFindings(run.findings, { sev: [s] }).length).toBe(bySev[s]);
          expect(filterFindings(run, { sev: [s] }).length).toBe(run.totals.bySeverity[s]);
        }
        for (const st of LIFECYCLE_PRESENT) {
          expect(filterFindings(run.findings, { state: [st] }).length).toBe(life.series[st]);
          expect(run.totals.byLifecycle[st]).toBe(life.series[st]);
        }
        // trend point: total for the run equals the run view's list length
        expect(run.totals.all).toBe(filterFindings(run, {}).length);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: dashboard-usability-overhaul, Property 6: Legacy runs are never given inferred values
  it("Property 6: Legacy runs are never given inferred values", () => {
    const words = fc.constantFrom("critical", "serious", "moderate", "minor", "desktop:", "mobile:", "color-contrast", "new", "regression", "resolved");
    const arbDetail = fc.oneof(fc.string({ maxLength: 30 }), fc.array(words, { maxLength: 5 }).map((a) => a.join(" ")));
    const arbOutcome = fc.record({ findingId: fc.string({ maxLength: 6 }), kind: fc.string({ maxLength: 5 }), classification: fc.string({ maxLength: 5 }), detail: arbDetail });
    const arbLegacy = fc.record({
      runId: fc.string({ maxLength: 6 }),
      pages: fc.array(fc.record({ page: fc.constantFrom("https://x.test/", "https://x.test/a"), slug: fc.constantFrom("home", "a"), outcomes: fc.array(arbOutcome, { maxLength: 6 }) }), { maxLength: 5 }),
    });
    fc.assert(
      fc.property(arbLegacy, (raw) => {
        const run = normalizeLegacyRun(raw);
        const expected = raw.pages.flatMap((p: any) => p.outcomes.map((o: any) => o.detail));
        expect(run.findings.length).toBe(expected.length);
        run.findings.forEach((f: any, i: number) => {
          expect(f.severity).toBe("not-recorded");
          expect(f.lifecycle).toBe("not-recorded");
          expect(f.detail).toBe(expected[i]);
        });
        expect(run.totals.bySeverity["not-recorded"]).toBe(run.totals.all);
        expect(run.totals.byLifecycle["not-recorded"]).toBe(run.totals.all);
      }),
      { numRuns: NUM_RUNS },
    );
    expect(() => normalizeLegacyRun(null)).not.toThrow();
    expect(() => normalizeLegacyRun({ pages: [null, { outcomes: 5 }] })).not.toThrow();
  });

  // Feature: dashboard-usability-overhaul, Property 24: Same-rule-on-other-pages count is exact
  it("Property 24: Same-rule-on-other-pages count is exact", () => {
    fc.assert(
      fc.property(arbRun, arbFinding, (raw, target) => {
        const run = normalizeRun(raw);
        const res = sameRuleOtherPages(run.findings, target);
        const expected = new Set(
          run.findings.filter((f: any) => f.ruleId === target.ruleId && f.pageUrl !== target.pageUrl).map((f: any) => f.pageUrl),
        );
        expect(res.count).toBe(expected.size);
        expect(new Set(res.pageUrls)).toEqual(expected);
        expect(res.pageUrls).not.toContain(target.pageUrl);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
