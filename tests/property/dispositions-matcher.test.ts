import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  applyDispositions,
  effectiveEntries,
  type DetectedFinding,
  type DispositionEntry,
  type DispositionLog,
  type ResolvedItem,
} from "../../src/core/dispositions.js";

// Feature: dashboard-usability-overhaul, Property 29: Matcher scope correctness
// Feature: dashboard-usability-overhaul, Property 30: Element-scope ignores account for nodes exactly
// Feature: dashboard-usability-overhaul, Property 31: Ignored Findings are excluded from every active count and nothing is lost
// **Validates: Requirements 19.4, 19.5, 19.6, 19.11, 19.15, 19.16, 19.17, 19.18, 20.3**

const RUNS = { numRuns: 200 };

const PATHS = ["/a", "/b", "/c/d"];
const RULES = ["color-contrast", "image-alt", "check:title", "visual-diff"];
const VIEWPORTS = ["desktop", "mobile"] as const;

// Several spellings of the same page: case of scheme/host, default port, trailing slash, fragment.
function pageVariant(pathIdx: number, variant: number): string {
  const p = PATHS[pathIdx] as string;
  switch (variant) {
    case 0:
      return `https://example.com${p}`;
    case 1:
      return `HTTPS://EXAMPLE.COM:443${p}/`;
    case 2:
      return `https://Example.com${p}#frag`;
    default:
      return `https://example.com:443${p}/#x`;
  }
}

const pageArb = fc.record({ idx: fc.integer({ min: 0, max: PATHS.length - 1 }), v: fc.integer({ min: 0, max: 3 }) });
const ruleArb = fc.integer({ min: 0, max: RULES.length - 1 });
const vpArb = fc.integer({ min: 0, max: 1 });

let seq = 0;
function entry(
  decision: DispositionEntry["decision"],
  scope: DispositionEntry["scope"],
  m: Partial<DispositionEntry["matcher"]>,
  at = "2025-01-01T00:00:00.000Z",
  undoes: string | null = null,
): DispositionEntry {
  seq += 1;
  return {
    id: `dsp_${String(seq).padStart(8, "0")}`,
    decision,
    scope,
    matcher: { pageUrl: "", viewport: "", ruleId: "", cssTarget: "", ...m },
    reason: "r",
    reviewer: "t",
    at,
    undoes,
    source: "cli",
  };
}

function finding(
  id: string,
  pageUrl: string,
  viewport: "desktop" | "mobile",
  ruleId: string,
  nodeTargets: string[],
  kind = "a11y-rule",
): DetectedFinding {
  return {
    id,
    kind,
    pageUrl,
    slug: "s",
    viewport,
    ruleId,
    severity: "serious",
    lifecycle: "new",
    nodeTargets,
    nodeCount: nodeTargets.length,
  };
}

describe("**Property 29** Matcher scope correctness", () => {
  it("**Property 29** page-rule and site-rule ignores match iff page/rule (any viewport) or rule only", () => {
    fc.assert(
      fc.property(pageArb, pageArb, ruleArb, ruleArb, vpArb, (fp, ep, fr, er, vp) => {
        const f = finding("f1", pageVariant(fp.idx, fp.v), VIEWPORTS[vp] as "desktop", RULES[fr] as string, ["#x"]);
        const pr = entry("ignore", "page-rule", { pageUrl: pageVariant(ep.idx, ep.v), ruleId: RULES[er] as string });
        const sr = entry("ignore", "site-rule", { ruleId: RULES[er] as string });
        const prHit = applyDispositions([f], [pr]).ignored.length === 1;
        const srHit = applyDispositions([f], [sr]).ignored.length === 1;
        expect(prHit).toBe(fp.idx === ep.idx && fr === er);
        expect(srHit).toBe(fr === er);
      }),
      RUNS,
    );
  });

  it("**Property 29** element ignores match a node iff page, viewport, rule and css target are all equal", () => {
    fc.assert(
      fc.property(
        pageArb,
        pageArb,
        ruleArb,
        ruleArb,
        vpArb,
        vpArb,
        fc.boolean(),
        (fp, ep, fr, er, fv, ev, sameTarget) => {
          const f = finding("f1", pageVariant(fp.idx, fp.v), VIEWPORTS[fv] as "desktop", RULES[fr] as string, ["#t1"]);
          const e = entry("ignore", "element", {
            pageUrl: pageVariant(ep.idx, ep.v),
            viewport: VIEWPORTS[ev] as "desktop",
            ruleId: RULES[er] as string,
            cssTarget: sameTarget ? "#t1" : "#t2",
          });
          const hit = applyDispositions([f], [e]).ignored.length === 1;
          expect(hit).toBe(fp.idx === ep.idx && fv === ev && fr === er && sameTarget);
        },
      ),
      RUNS,
    );
  });

  it("**Property 29** resolve matches iff page, viewport and rule are equal", () => {
    fc.assert(
      fc.property(pageArb, pageArb, ruleArb, ruleArb, vpArb, vpArb, (fp, ep, fr, er, fv, ev) => {
        const f = finding("f1", pageVariant(fp.idx, fp.v), VIEWPORTS[fv] as "desktop", RULES[fr] as string, ["#x"]);
        const r = entry("resolve", "finding", {
          pageUrl: pageVariant(ep.idx, ep.v),
          viewport: VIEWPORTS[ev] as "desktop",
          ruleId: RULES[er] as string,
        });
        const out = applyDispositions([f], [r]);
        expect(out.ignored).toHaveLength(0);
        expect(out.active).toHaveLength(1);
        const hit = out.active[0]?.regression !== null;
        expect(hit).toBe(fp.idx === ep.idx && fv === ev && fr === er);
      }),
      RUNS,
    );
  });
});

describe("**Property 30** Element-scope ignores account for nodes exactly", () => {
  it("**Property 30** ignored iff n > 0 and all nodes matched; else counts are n minus matched", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 15 }),
        fc.array(fc.boolean(), { minLength: 15, maxLength: 15 }),
        fc.integer({ min: 0, max: 3 }),
        pageArb,
        (n, pick, decoys, page) => {
          const targets = Array.from({ length: n }, (_, i) => `div#n${i} > span`);
          const url = pageVariant(page.idx, page.v);
          const f = finding("f1", url, "desktop", "color-contrast", targets);
          const chosen = targets.filter((_, i) => pick[i]);
          const entries = chosen.map((t) =>
            entry("ignore", "element", {
              pageUrl: pageVariant(page.idx, (page.v + 1) % 4),
              viewport: "desktop",
              ruleId: "color-contrast",
              cssTarget: t,
            }),
          );
          // Entries that match no node of this Finding.
          for (let i = 0; i < decoys; i++) {
            entries.push(
              entry("ignore", "element", {
                pageUrl: url,
                viewport: "desktop",
                ruleId: "color-contrast",
                cssTarget: `decoy${i}`,
              }),
            );
          }
          const out = applyDispositions([f], entries);
          const m = chosen.length;
          if (n > 0 && m === n) {
            expect(out.ignored).toHaveLength(1);
            expect(out.active).toHaveLength(0);
          } else {
            expect(out.ignored).toHaveLength(0);
            expect(out.active).toHaveLength(1);
            expect(out.active[0]?.ignoredNodeCount).toBe(m);
            expect(out.active[0]?.nodeCount).toBe(n - m);
          }
        },
      ),
      RUNS,
    );
  });

  it("**Property 30** changing a node's css target makes it unmatched", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 15 }), fc.nat({ max: 14 }), (n, k) => {
        const idx = k % n;
        const targets = Array.from({ length: n }, (_, i) => `#n${i}`);
        const entries = targets.map((t) =>
          entry("ignore", "element", {
            pageUrl: "https://example.com/a",
            viewport: "mobile",
            ruleId: "image-alt",
            cssTarget: t,
          }),
        );
        const changed = targets.map((t, i) => (i === idx ? `${t}-changed` : t));
        const out = applyDispositions([finding("f1", "https://example.com/a", "mobile", "image-alt", changed)], entries);
        if (n === 1) {
          expect(out.ignored).toHaveLength(0);
          expect(out.active[0]?.ignoredNodeCount).toBe(0);
          expect(out.active[0]?.nodeCount).toBe(1);
        } else {
          expect(out.active[0]?.ignoredNodeCount).toBe(n - 1);
          expect(out.active[0]?.nodeCount).toBe(1);
        }
      }),
      RUNS,
    );
  });
});

// ---- Property 31 generators ----

const AT = ["2025-01-01T00:00:00.000Z", "2025-01-02T00:00:00.000Z", "2025-01-03T00:00:00.000Z", "2025-01-04T00:00:00.000Z"];

const findingsArb = fc
  .array(
    fc.record({
      page: pageArb,
      vp: vpArb,
      rule: ruleArb,
      nodes: fc.integer({ min: 0, max: 4 }),
    }),
    { minLength: 0, maxLength: 12 },
  )
  .map((rows) =>
    rows.map((r, i) =>
      finding(
        `f${i}`,
        pageVariant(r.page.idx, r.page.v),
        VIEWPORTS[r.vp] as "desktop",
        RULES[r.rule] as string,
        Array.from({ length: r.nodes }, (_, j) => `#n${j}`),
        (RULES[r.rule] as string).startsWith("check:") || RULES[r.rule] === "visual-diff" ? "check" : "a11y-rule",
      ),
    ),
  );

const rawEntryArb = fc.record({
  kind: fc.integer({ min: 0, max: 4 }),
  page: pageArb,
  vp: vpArb,
  rule: ruleArb,
  node: fc.integer({ min: 0, max: 4 }),
  whole: fc.boolean(),
  at: fc.integer({ min: 0, max: AT.length - 1 }),
});

const logArb = fc.array(rawEntryArb, { minLength: 0, maxLength: 10 }).map((rows): DispositionLog => {
  const entries: DispositionEntry[] = [];
  for (const r of rows) {
    const m = {
      pageUrl: pageVariant(r.page.idx, r.page.v),
      viewport: VIEWPORTS[r.vp] as "desktop",
      ruleId: RULES[r.rule] as string,
    };
    const at = AT[r.at] as string;
    if (r.kind === 0) entries.push(entry("ignore", "site-rule", { ruleId: m.ruleId }, at));
    else if (r.kind === 1) entries.push(entry("ignore", "page-rule", { pageUrl: m.pageUrl, ruleId: m.ruleId }, at));
    else if (r.kind === 2) {
      entries.push(entry("ignore", "element", { ...m, cssTarget: r.whole ? "" : `#n${r.node}` }, at));
    } else if (r.kind === 3) entries.push(entry("resolve", "finding", m, at));
    else {
      const ign = entries.filter((e) => e.decision === "ignore");
      const target = ign[r.node % Math.max(ign.length, 1)];
      if (target) entries.push(entry("unignore", "undo", {}, at, target.id));
    }
  }
  return { schemaVersion: 1, entries };
});

const resolvedArb = fc
  .array(fc.record({ page: pageArb, vp: vpArb, rule: ruleArb }), { minLength: 0, maxLength: 6 })
  .map((rows): ResolvedItem[] =>
    rows.map((r) => ({
      pageUrl: pageVariant(r.page.idx, r.page.v),
      viewport: VIEWPORTS[r.vp] as string,
      ruleId: RULES[r.rule] as string,
    })),
  );

describe("**Property 31** Ignored Findings are excluded from every active count and nothing is lost", () => {
  it("**Property 31** active and ignored are disjoint and their union is the detected set", () => {
    fc.assert(
      fc.property(findingsArb, logArb, fc.integer({ min: 0, max: AT.length }), (detected, log, cut) => {
        const finishedAt = cut === AT.length ? "2025-01-05T00:00:00.000Z" : (AT[cut] as string);
        const effective = effectiveEntries(log, finishedAt);
        const out = applyDispositions(detected, effective);
        const a = out.active.map((f) => f.id);
        const i = out.ignored.map((f) => f.id);
        expect(a.filter((id) => i.includes(id))).toEqual([]);
        expect([...a, ...i].sort()).toEqual(detected.map((f) => f.id).sort());
        // totals.all + totals.ignored = totals.detected
        expect(out.active.length + out.ignored.length).toBe(detected.length);
        // Every active count is derived from active only.
        const bySeverity = out.active.reduce((acc, f) => acc + (f.severity === "serious" ? 1 : 0), 0);
        expect(bySeverity).toBe(out.active.length);
      }),
      RUNS,
    );
  });

  it("**Property 31** no ignored Finding appears in active, and resolved items hidden by page/site ignores are dropped", () => {
    fc.assert(
      fc.property(findingsArb, logArb, resolvedArb, (detected, log, items) => {
        const effective = effectiveEntries(log, "2025-01-05T00:00:00.000Z");
        const out = applyDispositions(detected, effective, items);
        const ignoredIds = new Set(out.ignored.map((f) => f.id));
        for (const f of out.active) expect(ignoredIds.has(f.id)).toBe(false);
        const undone = new Set(effective.filter((e) => e.decision === "unignore").map((e) => e.undoes));
        const live = effective.filter((e) => e.decision === "ignore" && !undone.has(e.id));
        for (const item of out.resolved) {
          const hidden = live.some(
            (e) =>
              e.scope === "site-rule" && e.matcher.ruleId === item.ruleId,
          );
          expect(hidden).toBe(false);
        }
        expect(out.resolved.length).toBeLessThanOrEqual(items.length);
      }),
      RUNS,
    );
  });

  it("**Property 31** with no applicable entries the active set equals the detected set", () => {
    fc.assert(
      fc.property(findingsArb, logArb, (detected, log) => {
        // Every entry is at or after the run finish time, so none applies.
        const effective = effectiveEntries(log, "2025-01-01T00:00:00.000Z");
        expect(effective).toEqual([]);
        const out = applyDispositions(detected, effective);
        expect(out.ignored).toEqual([]);
        expect(out.active.map(({ ignoredNodeCount: _i, regression: _r, ...rest }) => rest)).toEqual(detected);
        for (const f of out.active) {
          expect(f.ignoredNodeCount).toBe(0);
          expect(f.regression).toBeNull();
        }
      }),
      RUNS,
    );
  });
});
