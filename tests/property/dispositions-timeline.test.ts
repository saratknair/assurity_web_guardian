import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fc from "fast-check";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyDispositions,
  canonicalMatcher,
  effectiveEntries,
  entryId,
  serializeLog,
  type DetectedFinding,
  type DispositionEntry,
  type ResolvedItem,
} from "../../src/core/dispositions.js";
import { logPath } from "../../src/core/disposition-store.js";
import { freezeDispositions } from "../../src/core/orchestrator.js";
import {
  buildRunFindings,
  finalizeDecisions,
  loadFrozenDispositions,
  type BuiltRun,
  type RawRunInputs,
} from "../../src/publish/run-findings.js";
// @ts-expect-error plain browser ES module without type declarations
import { decisionEffectText } from "../../dashboard/lib/findings.js";

const URL1 = "https://assurity.nz/";
const BASE = Date.parse("2026-01-01T00:00:00.000Z");
const RULES = ["link-name", "region", "image-alt"] as const;
const NODES: Record<string, { html: string; target: string[] }[]> = {
  "link-name": [
    { html: "<a id=1></a>", target: ["a.one"] },
    { html: "<a id=2></a>", target: ["a.two"] },
  ],
  region: [{ html: "<div></div>", target: ["div"] }],
  "image-alt": [{ html: "<img>", target: ["img"] }],
};
const SINGLE_TARGET: Record<string, string> = { region: "div", "image-alt": "img" };

const at = (min: number): string => new Date(BASE + min * 60000).toISOString();
const key = (rule: string): string => `${URL1}|desktop|${rule}`;
const keyOf = (f: { pageUrl: string; viewport: string; ruleId: string }): string =>
  `${f.pageUrl}|${f.viewport}|${f.ruleId}`;

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function mkEntry(p: {
  decision: DispositionEntry["decision"];
  scope: DispositionEntry["scope"];
  rule?: string;
  target?: string;
  min: number;
  reviewer: string;
  n: number;
  undoes?: string | null;
}): DispositionEntry {
  const matcher =
    p.decision === "unignore"
      ? canonicalMatcher("unignore", "undo", {})
      : canonicalMatcher(p.decision, p.scope, {
          pageUrl: URL1,
          viewport: "desktop",
          ruleId: p.rule ?? "",
          cssTarget: p.target ?? "",
        });
  const body = {
    decision: p.decision,
    scope: p.scope,
    matcher,
    reason: `reason ${p.n}`,
    reviewer: p.reviewer,
    at: at(p.min),
    undoes: p.undoes ?? null,
    source: "admin-gui" as const,
  };
  return { id: entryId(body), ...body };
}

function rawInputs(
  runId: string,
  fin: string,
  detected: ReadonlySet<string>,
  prev: ReadonlySet<string> | null,
  dispositions: RawRunInputs["dispositions"],
): RawRunInputs {
  const states: Record<string, string> = {};
  for (const r of detected) states[key(r)] = prev?.has(r) ? "recurring" : "new";
  const resolved = prev
    ? [...prev].filter((r) => !detected.has(r)).map((r) => ({ pageUrl: URL1, viewport: "desktop", ruleId: r }))
    : [];
  return {
    runId,
    finishedAt: fin,
    results: { pages: [{ page: URL1, slug: "assurity-nz", checks: [] }] },
    findings: { pages: [{ page: URL1, slug: "assurity-nz", outcomes: [] }] },
    axe: [
      {
        slug: "assurity-nz",
        viewport: "desktop",
        raw: {
          url: URL1,
          violations: RULES.filter((r) => detected.has(r)).map((r) => ({
            id: r,
            impact: "serious",
            help: `help ${r}`,
            nodes: NODES[r],
          })),
        },
      },
    ],
    visualFiles: [],
    lifecycle: { historyStatus: prev ? "restored" : "first-run", states, resolved },
    dispositions,
  };
}

function build(
  runId: string,
  fin: string,
  detected: ReadonlySet<string>,
  prev: ReadonlySet<string> | null,
  log: DispositionEntry[],
): BuiltRun {
  const entries = effectiveEntries({ schemaVersion: 1, entries: log }, fin);
  return buildRunFindings(rawInputs(runId, fin, detected, prev, { status: "applied", entries }));
}

const same = (a: BuiltRun, b: BuiltRun): boolean =>
  JSON.stringify(a.runFindings) === JSON.stringify(b.runFindings) &&
  JSON.stringify(a.evidence) === JSON.stringify(b.evidence);

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const arbRule = fc.constantFrom(...RULES);
const arbReviewer = fc.constantFrom("S. Nair", "A. Lee");
const arbSubset = fc.subarray([...RULES]).map((a) => new Set<string>(a));
const arbMin = fc.integer({ min: 0, max: 60 });

const arbIgnoreSpec = fc.record({
  scope: fc.constantFrom("site-rule", "page-rule", "element"),
  rule: arbRule,
  min: arbMin,
  reviewer: arbReviewer,
});
const arbResolveSpec = fc.record({ rule: arbRule, min: arbMin, reviewer: arbReviewer });
const arbUndoSpec = fc.record({ idx: fc.nat(), delta: fc.integer({ min: 1, max: 30 }), reviewer: arbReviewer });

/** A valid log: ignores, resolves, and un-ignores that name an earlier ignore (each at most once). */
function makeLog(
  ignores: { scope: string; rule: string; min: number; reviewer: string }[],
  resolves: { rule: string; min: number; reviewer: string }[],
  undos: { idx: number; delta: number; reviewer: string }[],
  withUndo: boolean,
): DispositionEntry[] {
  let n = 0;
  const out: DispositionEntry[] = [];
  const ign = ignores.map((s) => {
    const element = s.scope === "element";
    const rule = element && !(s.rule in SINGLE_TARGET) ? "region" : s.rule;
    return mkEntry({
      decision: "ignore",
      scope: s.scope as DispositionEntry["scope"],
      rule,
      target: element ? SINGLE_TARGET[rule] : "",
      min: s.min,
      reviewer: s.reviewer,
      n: n++,
    });
  });
  out.push(...ign);
  for (const s of resolves) {
    out.push(mkEntry({ decision: "resolve", scope: "finding", rule: s.rule, min: s.min, reviewer: s.reviewer, n: n++ }));
  }
  if (withUndo && ign.length > 0) {
    const used = new Set<number>();
    for (const u of undos) {
      const i = u.idx % ign.length;
      if (used.has(i)) continue;
      used.add(i);
      const target = ign[i];
      const min = Math.round((Date.parse(target.at) - BASE) / 60000) + u.delta;
      out.push(
        mkEntry({ decision: "unignore", scope: "undo", min, reviewer: u.reviewer, n: n++, undoes: target.id }),
      );
    }
  }
  return out;
}

const arbLog = fc
  .tuple(
    fc.array(arbIgnoreSpec, { maxLength: 4 }),
    fc.array(arbResolveSpec, { maxLength: 3 }),
    fc.array(arbUndoSpec, { maxLength: 3 }),
  )
  .map(([i, r, u]) => makeLog(i, r, u, true));

/** Whole-rule ignores and resolves only (no un-ignores). */
const arbSimpleLog = fc
  .tuple(
    fc.array(
      fc.record({
        scope: fc.constantFrom("site-rule", "page-rule"),
        rule: arbRule,
        min: arbMin,
        reviewer: arbReviewer,
      }),
      { maxLength: 3 },
    ),
    fc.array(arbResolveSpec, { maxLength: 3 }),
  )
  .map(([i, r]) => makeLog(i, r, [], false));

/** Strictly increasing run finish times (minutes) with the detected set of each run. */
const arbRuns = fc
  .array(fc.record({ step: fc.integer({ min: 1, max: 25 }), detected: arbSubset }), { minLength: 2, maxLength: 5 })
  .map((rs) => {
    let t = 5;
    return rs.map((r, i) => {
      t += r.step;
      return { runId: `run_${i}`, min: t, fin: at(t), detected: r.detected };
    });
  });

const later = (a: DispositionEntry, b: DispositionEntry): number =>
  a.at !== b.at ? (a.at < b.at ? -1 : 1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

let tmp = "";
beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "dsp-timeline-"));
});
afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("dispositions timeline properties", () => {
  // Feature: dashboard-usability-overhaul, Property 32: Decisions never change runs that finished before them
  it("Property 32: Decisions never change runs that finished before them (published output)", () => {
    // **Validates: Requirements 19.1, 19.2, 19.3, 18.12**
    fc.assert(
      fc.property(arbLog, arbRuns, (log, runs) => {
        let prev: ReadonlySet<string> | null = null;
        for (const r of runs) {
          const without = log.filter((e) => Date.parse(e.at) < Date.parse(r.fin));
          const a = build(r.runId, r.fin, r.detected, prev, log);
          const b = build(r.runId, r.fin, r.detected, prev, without);
          expect(same(a, b)).toBe(true);
          prev = r.detected;
        }
      }),
      { numRuns: 100 },
    );
  });

  // Feature: dashboard-usability-overhaul, Property 32: Decisions never change runs that finished before them
  it("Property 32: the frozen set ignores later entries and republishing after log changes is byte-identical", () => {
    // **Validates: Requirements 19.1, 19.2, 19.3, 18.12**
    // Filesystem-heavy (writes the log, freezes, reloads): 50 iterations by design.
    const art = join(tmp, "artifacts");
    const runDir = join(tmp, "run");
    mkdirSync(art, { recursive: true });
    mkdirSync(runDir, { recursive: true });
    const writeLog = (entries: DispositionEntry[]): void =>
      writeFileSync(logPath(art), serializeLog({ schemaVersion: 1, entries }), "utf8");
    const frozenEntries = (): unknown => JSON.parse(readFileSync(join(runDir, "dispositions-applied.json"), "utf8"));
    fc.assert(
      fc.property(arbLog, fc.integer({ min: 5, max: 90 }), arbSubset, fc.array(arbResolveSpec, { maxLength: 3 }), (log, finMin, det, extra) => {
        const fin = at(finMin);
        const before = log.filter((e) => Date.parse(e.at) < Date.parse(fin));
        writeLog(before);
        freezeDispositions(runDir, "run_x", fin, art);
        const frozenBefore = frozenEntries() as { status: string; entries: unknown };
        expect(frozenBefore.status).toBe("applied");
        writeLog(log);
        freezeDispositions(runDir, "run_x", fin, art);
        const frozenAll = frozenEntries() as { status: string; entries: unknown };
        expect(frozenAll.status).toBe("applied");
        expect(frozenAll.entries).toEqual(frozenBefore.entries);

        // Republish: the log changes afterwards (including entries dated before the run); the frozen file does not.
        const build1 = buildRunFindings(rawInputs("run_x", fin, det, null, loadFrozenDispositions(runDir)));
        const more = makeLog([], extra, [], false).map((e) => ({ ...e }));
        writeLog([...log, ...more]);
        const build2 = buildRunFindings(rawInputs("run_x", fin, det, null, loadFrozenDispositions(runDir)));
        expect(same(build1, build2)).toBe(true);
      }),
      { numRuns: 50 },
    );
  });

  // Feature: dashboard-usability-overhaul, Property 33: Resolved then reappears is a regression
  it("Property 33: Resolved then reappears is a regression", () => {
    // **Validates: Requirements 19.9, 19.10, 19.11, 19.19, 19.23**
    fc.assert(
      fc.property(arbSimpleLog, arbSubset, arbSubset, fc.integer({ min: 5, max: 90 }), (log, detected, prev, finMin) => {
        const fin = at(finMin);
        const eff = effectiveEntries({ schemaVersion: 1, entries: log }, fin);
        const rf = build("run_r", fin, detected, prev, log).runFindings;
        const resolvedItems = rf.resolved as { ruleId: string; humanResolved?: { reviewer: string; decisionId: string } }[];
        for (const rule of RULES) {
          const ignoredBy = eff.some(
            (e) => e.decision === "ignore" && (e.scope === "site-rule" || e.scope === "page-rule") && e.matcher.ruleId === rule,
          );
          const latest = eff
            .filter((e) => e.decision === "resolve" && e.matcher.ruleId === rule)
            .sort(later)
            .pop();
          const active = rf.findings.find((f) => f.ruleId === rule);
          const ign = rf.ignored.find((f) => f.ruleId === rule);
          const res = resolvedItems.find((x) => x.ruleId === rule);
          if (ignoredBy) {
            // An applicable ignore takes precedence over a resolve.
            expect(ign !== undefined).toBe(detected.has(rule));
            expect(active).toBeUndefined();
            expect(res).toBeUndefined();
          } else if (detected.has(rule)) {
            expect(active).toBeDefined();
            if (latest) {
              expect(active!.lifecycle).toBe("regression");
              expect(active!.regression).toMatchObject({ decisionId: latest.id, at: latest.at, reviewer: latest.reviewer });
            } else {
              expect(active!.lifecycle).toBe(prev.has(rule) ? "recurring" : "new");
              expect(active!.regression).toBeUndefined();
            }
          } else if (prev.has(rule)) {
            expect(res).toBeDefined();
            if (latest) expect(res!.humanResolved).toMatchObject({ decisionId: latest.id, reviewer: latest.reviewer });
            else expect(res!.humanResolved).toBeUndefined();
          } else {
            expect(res).toBeUndefined();
            expect(active).toBeUndefined();
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  // Feature: dashboard-usability-overhaul, Property 34: Un-ignore restores from its own time onward
  it("Property 34: Un-ignore restores from its own time onward", () => {
    // **Validates: Requirements 19.12, 19.13, 19.14, 18.11**
    fc.assert(
      fc.property(
        fc.record({
          scope: fc.constantFrom("site-rule", "page-rule", "element"),
          rule: arbRule,
          tIgnore: fc.integer({ min: 0, max: 40 }),
          delta: fc.integer({ min: 1, max: 40 }),
        }),
        arbRuns,
        (spec, runs) => {
          const rule = spec.scope === "element" && !(spec.rule in SINGLE_TARGET) ? "region" : spec.rule;
          const log = makeLog(
            [{ scope: spec.scope, rule, min: spec.tIgnore, reviewer: "S. Nair" }],
            [],
            [{ idx: 0, delta: spec.delta, reviewer: "A. Lee" }],
            true,
          );
          const tI = spec.tIgnore;
          const tU = spec.tIgnore + spec.delta;
          let prev: ReadonlySet<string> | null = null;
          let seenAfter = false;
          for (const r of runs) {
            const withLog = build(r.runId, r.fin, r.detected, prev, log).runFindings;
            const noLog = build(r.runId, r.fin, r.detected, prev, []).runFindings;
            const isIgnored = tI < r.min && !(tU < r.min);
            const inIgnored = withLog.ignored.some((f) => f.ruleId === rule);
            const inActive = withLog.findings.find((f) => f.ruleId === rule);
            if (r.detected.has(rule)) {
              expect(inIgnored).toBe(isIgnored);
              expect(inActive !== undefined).toBe(!isIgnored);
              if (inActive) {
                const expected = prev?.has(rule) ? "recurring" : "new";
                if (tU < r.min && !seenAfter) expect(inActive.lifecycle).toBe(expected);
                // History is identical whether or not the ignore existed.
                expect(inActive.lifecycle).toBe(noLog.findings.find((f) => f.ruleId === rule)!.lifecycle);
              }
            } else {
              expect(inIgnored).toBe(false);
              expect(inActive).toBeUndefined();
            }
            if (tU < r.min) seenAfter = true;
            expect(withLog.totals.detected).toBe(noLog.totals.detected);
            expect(withLog.totals.all + withLog.totals.ignored).toBe(withLog.totals.detected);
            prev = r.detected;
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: dashboard-usability-overhaul, Property 36: Application of dispositions is deterministic and order independent
  it("Property 36: Application of dispositions is deterministic and order independent", () => {
    // **Validates: Requirements 18.11, 19.1, 19.2**
    fc.assert(
      fc.property(
        arbLog.chain((log) =>
          fc.tuple(fc.constant(log), fc.shuffledSubarray(log, { minLength: log.length, maxLength: log.length })),
        ),
        arbSubset,
        arbSubset,
        fc.integer({ min: 5, max: 100 }),
        ([log, shuffled], detected, prev, finMin) => {
          const fin = at(finMin);
          const found: DetectedFinding[] = RULES.filter((r) => detected.has(r)).map((r) => ({
            id: `f_${r}`,
            kind: "a11y-rule",
            pageUrl: URL1,
            slug: "assurity-nz",
            viewport: "desktop",
            ruleId: r,
            severity: "serious",
            lifecycle: "new",
            nodeTargets: NODES[r].map((n) => n.target[0]),
            nodeCount: NODES[r].length,
          }));
          const items: ResolvedItem[] = RULES.filter((r) => prev.has(r) && !detected.has(r)).map((r) => ({
            pageUrl: URL1,
            viewport: "desktop",
            ruleId: r,
          }));
          const a = applyDispositions(found, effectiveEntries({ schemaVersion: 1, entries: log }, fin), items);
          const b = applyDispositions(found, effectiveEntries({ schemaVersion: 1, entries: shuffled }, fin), items);
          const c = applyDispositions(found, effectiveEntries({ schemaVersion: 1, entries: log }, fin), items);
          expect(b).toEqual(a);
          expect(c).toEqual(a);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: dashboard-usability-overhaul, Property 39: Decision effect counts are exact
  it("Property 39: Decision effect counts are exact", () => {
    // **Validates: Requirements 19.20, 19.21, 19.24, 10.12**
    fc.assert(
      fc.property(
        arbLog,
        arbSubset,
        arbSubset,
        fc.integer({ min: 1, max: 40 }),
        fc.integer({ min: 1, max: 40 }),
        (log, d1, d2, f1, gap) => {
          const fin1 = at(f1);
          const fin2 = at(f1 + gap);
          const set1 = effectiveEntries({ schemaVersion: 1, entries: log }, fin1);
          const set2 = effectiveEntries({ schemaVersion: 1, entries: log }, fin2);
          const prevRun = build("run_1", fin1, d1, null, log);
          const curRun = build("run_2", fin2, d2, d1, log);
          finalizeDecisions(curRun, prevRun);
          const dec = curRun.runFindings.decisions;

          const ids1 = new Set(set1.map((e) => e.id));
          const expectedNew = set2.filter((e) => !ids1.has(e.id)).map((e) => e.id).sort();
          expect((dec.newThisRun ?? []).map((n) => n.id).sort()).toEqual(expectedNew);
          expect(dec.appliedCount).toBe(set2.length);

          const prevIgnored = new Set(prevRun.runFindings.ignored.map(keyOf));
          const expectedIgnored = curRun.runFindings.ignored.filter((f) => !prevIgnored.has(keyOf(f))).length;
          expect(dec.ignoredNewThisRun).toBe(expectedIgnored);

          for (const n of dec.newThisRun ?? []) {
            const e = set2.find((x) => x.id === n.id)!;
            if (e.decision === "ignore" && (e.scope === "site-rule" || e.scope === "page-rule")) {
              expect(n.findingsAffected).toBe(d2.has(e.matcher.ruleId) ? 1 : 0);
            }
          }

          const text: string = decisionEffectText(dec);
          if ((dec.ignoredNewThisRun ?? 0) > 0) {
            expect(text).toContain(String(dec.ignoredNewThisRun));
            expect(text).toContain("ignored");
          }
          if (!dec.ignoredNewThisRun && !dec.unignoredNewThisRun && !dec.resolvedNewThisRun) {
            expect(text).toBe("");
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
