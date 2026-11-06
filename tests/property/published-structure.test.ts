import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { buildRunFindings, type BuiltRun, type RawRunInputs } from "../../src/publish/run-findings.js";
import {
  buildDashboardAggregates,
  buildLatestPages,
  buildPageHistory,
  pageGroupOf,
} from "../../src/publish/pages.js";
import { arbRunInputs } from "./run-findings.test.js";

const RUNS = { numRuns: 150 };

const arbRunSet = fc
  .array(fc.tuple(arbRunInputs, fc.integer({ min: 0, max: 5 })), { minLength: 1, maxLength: 3 })
  .map((entries): BuiltRun[] =>
    entries.map(([inputs, day], i) =>
      buildRunFindings({ ...inputs, runId: `run_${i}`, finishedAt: `2025-01-0${day + 1}T00:00:00.000Z` } as RawRunInputs),
    ),
  );

/** Replace every axe node with arbitrary content and a different count. */
function withDifferentNodes(inputs: RawRunInputs, html: string, count: number): RawRunInputs {
  return {
    ...inputs,
    axe: inputs.axe.map((e) => {
      const raw = e.raw as { violations: Record<string, unknown>[] };
      return {
        ...e,
        raw: {
          ...raw,
          violations: raw.violations.map((v) => ({
            ...v,
            nodes: Array.from({ length: count }, (_, k) => ({
              html: `${html}${k}`,
              target: [`#t${k}`],
              failureSummary: `fix ${html}`,
            })),
          })),
        },
      };
    }),
  } as RawRunInputs;
}

function keysDeep(v: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => keysDeep(x, out));
  else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      out.add(k);
      keysDeep(x, out);
    }
  }
  return out;
}

describe("published structure properties", () => {
  // Feature: dashboard-usability-overhaul, Property 25: Page history agrees with run data
  // **Validates: Requirements 9.5**
  it("Property 25: page history entries match each run's findings for the slug", () => {
    fc.assert(
      fc.property(arbRunSet, (runs) => {
        const slugs = new Set(runs.flatMap((r) => r.runFindings.pages.map((p) => p.slug)));
        for (const slug of slugs) {
          const hist = buildPageHistory(slug, runs);
          for (const entry of hist.runs) {
            const run = runs.find((r) => r.runFindings.runId === entry.runId)!;
            const rf = run.runFindings;
            const findings = rf.findings.filter((f) => f.slug === slug);
            const page = rf.pages.find((p) => p.slug === slug)!;
            expect(entry.total).toBe(findings.length);
            expect(entry.total).toBe(page.counts.total);
            const sev = { critical: 0, serious: 0, moderate: 0, minor: 0, unrated: 0, notRecorded: 0 };
            for (const f of findings) sev[f.severity === "not-recorded" ? "notRecorded" : f.severity] += 1;
            expect(entry.bySeverity).toEqual(sev);
            expect(entry.findings.map((f) => [f.id, f.severity, f.lifecycle, f.viewport, f.ruleId])).toEqual(
              findings.map((f) => [f.id, f.severity, f.lifecycle, f.viewport, f.ruleId]),
            );
          }
        }
      }),
      RUNS,
    );
  });

  // Feature: dashboard-usability-overhaul, Property 26: The aggregate file does not depend on element detail
  // **Validates: Requirements 16.5**
  it("Property 26: aggregates are independent of element html/target/failureSummary and node count", () => {
    fc.assert(
      fc.property(arbRunInputs, fc.string({ maxLength: 20 }), fc.integer({ min: 0, max: 5 }), (inputs, html, count) => {
        const a = buildRunFindings(inputs);
        const b = buildRunFindings(withDifferentNodes(inputs, html, count));
        expect(buildDashboardAggregates([b])).toEqual(buildDashboardAggregates([a]));
        expect(buildLatestPages(b)).toEqual(buildLatestPages(a));
        const keys = keysDeep([buildDashboardAggregates([b]), buildLatestPages(b)]);
        for (const k of ["html", "target", "failureSummary"]) expect(keys.has(k)).toBe(false);
      }),
      RUNS,
    );
  });

  // Feature: dashboard-usability-overhaul, Property 27: Published data is genuine, valid, and stable JSON
  // **Validates: Requirements 17.5, 17.14**
  it("Property 27: published structures round-trip through JSON and are deterministic", () => {
    fc.assert(
      fc.property(arbRunSet, (runs) => {
        const slug = runs[0]!.runFindings.pages[0]?.slug ?? "none";
        const structures = (): unknown[] => [
          ...runs.map((r) => r.runFindings),
          ...runs.map((r) => r.evidence),
          buildPageHistory(slug, runs),
          buildDashboardAggregates(runs),
          ...runs.map((r) => buildLatestPages(r)),
        ];
        const first = structures();
        for (const s of first) {
          const text = JSON.stringify(s);
          expect(JSON.parse(text)).toStrictEqual(s);
          expect(JSON.stringify(JSON.parse(text))).toBe(text);
        }
        expect(JSON.stringify(structures())).toBe(JSON.stringify(first));
      }),
      RUNS,
    );
  });

  // Feature: dashboard-usability-overhaul, Property 15: Page groups partition the pages
  // **Validates: Requirements 8.1, 8.2**
  it("Property 15: published page group equals pageGroupOf(url) and groups partition pages", () => {
    fc.assert(
      fc.property(arbRunInputs, (inputs) => {
        const { runFindings: rf } = buildRunFindings(inputs);
        const groups = new Map<string, number>();
        for (const p of rf.pages) {
          expect(p.group).toBe(pageGroupOf(p.url));
          groups.set(p.group, (groups.get(p.group) ?? 0) + 1);
        }
        expect([...groups.values()].reduce((a, b) => a + b, 0)).toBe(rf.pages.length);
      }),
      RUNS,
    );
    fc.assert(
      fc.property(fc.webUrl(), (url) => {
        const g = pageGroupOf(url);
        expect(g).toBe(g.toLowerCase());
        expect(pageGroupOf(url)).toBe(g);
      }),
      RUNS,
    );
  });
});
