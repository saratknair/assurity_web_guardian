import { describe, it, expect, afterEach, vi } from "vitest";
import fc from "fast-check";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  applyRun, nextState, emptyHistory, migrateV1,
  type HistoryV2, type RunObservation, type LifecycleState, type CurrentFinding,
} from "../../src/agents/a11y-lifecycle.js";
import { findingKey } from "../../src/core/finding-model.js";
import { loadA11yHistory, saveA11yHistory } from "../../src/agents/a11y-history-store.js";

const RUNS = { numRuns: 100 };

// ---- generators (small universes so keys collide across runs) ----
const arbPage = fc.constantFrom("https://a.test/", "https://a.test/x", "https://b.test/y");
const arbViewport = fc.constantFrom("desktop", "mobile");
const arbRule = fc.constantFrom("color-contrast", "image-alt", "label", "link-name");
const arbImpact = fc.constantFrom<string | null>("critical", "serious", "moderate", "minor", null);

const arbCurrent: fc.Arbitrary<CurrentFinding> = fc
  .record({ pageUrl: arbPage, viewport: arbViewport, ruleId: arbRule, impact: arbImpact })
  .map((f) => ({ ...f, key: findingKey(f) }));

const at = (i: number) => new Date(Date.UTC(2025, 0, 1, 0, 0, i)).toISOString();

/** Observation (without run id/time) as a function of the run index. */
const arbObsBody = fc.record({
  findings: fc.array(arbCurrent, { maxLength: 6 }),
  scanned: fc.array(fc.record({ pageUrl: arbPage, viewport: arbViewport }), { maxLength: 6 }),
});

function mkObs(body: { findings: CurrentFinding[]; scanned: { pageUrl: string; viewport: string }[] }, i: number): RunObservation {
  return { runId: `run-${i}`, at: at(i), findings: body.findings, scanned: body.scanned };
}

/** Observations applied in sequence from emptyHistory: every history is reachable. */
const arbObsSeq = fc.array(arbObsBody, { maxLength: 5 }).map((bodies) => bodies.map((b, i) => mkObs(b, i + 1)));

function build(seq: RunObservation[]): HistoryV2 {
  let h = emptyHistory();
  for (const o of seq) h = applyRun(h, o).history;
  return h;
}

const arbHistory = arbObsSeq.map(build);
/** A new observation whose run id is not in any generated history. */
const arbObservation = arbObsBody.map((b) => mkObs(b, 100));
const arbHistoryAndObs = fc.tuple(arbHistory, arbObservation);

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const UNRESOLVED: LifecycleState[] = ["new", "recurring", "existing-unresolved"];

describe("Feature: dashboard-usability-overhaul - lifecycle and history", () => {
  // Feature: dashboard-usability-overhaul, Property 7: Lifecycle transitions follow the table
  // **Validates: Requirements 12.10, 13.3, 13.4, 13.5, 13.6, 13.7**
  it("Property 7: Lifecycle transitions follow the table", () => {
    const prevs = fc.constantFrom<LifecycleState | undefined>(undefined, "new", "recurring", "existing-unresolved", "resolved");
    fc.assert(
      fc.property(prevs, fc.boolean(), (prev, present) => {
        const n = nextState(prev, present);
        if (present) {
          expect(n).toBe(prev === undefined || prev === "resolved" ? "new" : "recurring");
        } else if (prev === undefined) {
          expect(n).toBeUndefined();
        } else {
          expect(n).toBe("resolved");
        }
      }),
      RUNS,
    );
  });

  it("Property 7: applyRun applies the table, and leaves unscanned absent entries unchanged", () => {
    fc.assert(
      fc.property(arbHistoryAndObs, ([h, obs]) => {
        const { history: out } = applyRun(clone(h), obs);
        const present = new Set(obs.findings.map((f) => f.key));
        const scanned = new Set(obs.scanned.map((s) => `${s.pageUrl}|${s.viewport}`));
        for (const [key, prev] of Object.entries(h.findings)) {
          const now = out.findings[key];
          if (present.has(key)) {
            expect(now.state).toBe(prev.state === "resolved" ? "new" : "recurring");
          } else if (scanned.has(`${prev.pageUrl}|${prev.viewport}`)) {
            expect(now.state).toBe("resolved");
          } else {
            expect(now).toEqual(prev); // not scanned: unchanged
          }
        }
        for (const key of present) {
          if (!h.findings[key]) expect(out.findings[key].state).toBe("new");
        }
      }),
      RUNS,
    );
  });

  it("Property 7: findingKey equal iff (page, viewport, rule) triples equal", () => {
    const triple = fc.record({ pageUrl: arbPage, viewport: arbViewport, ruleId: arbRule });
    const wild = fc.record({
      pageUrl: fc.webUrl(), viewport: fc.constantFrom("desktop", "mobile", "tablet"), ruleId: fc.stringMatching(/^[a-z-]{1,12}$/),
    });
    fc.assert(
      fc.property(fc.oneof(triple, wild), fc.oneof(triple, wild), (a, b) => {
        const same = a.pageUrl === b.pageUrl && a.viewport === b.viewport && a.ruleId === b.ruleId;
        expect(findingKey(a) === findingKey(b)).toBe(same);
        expect(findingKey({ ...a })).toBe(findingKey(a));
      }),
      RUNS,
    );
  });

  // Feature: dashboard-usability-overhaul, Property 8: History application is idempotent
  // **Validates: Requirements 13.12**
  it("Property 8: History application is idempotent", () => {
    fc.assert(
      fc.property(arbHistoryAndObs, ([h, obs]) => {
        const once = applyRun(clone(h), obs);
        const twice = applyRun(clone(once.history), obs);
        expect(twice.history).toEqual(once.history);
        expect(twice.snapshot).toEqual(once.snapshot);
      }),
      RUNS,
    );
  });

  // Feature: dashboard-usability-overhaul, Property 9: History only grows
  // **Validates: Requirements 13.11**
  it("Property 9: History only grows", () => {
    fc.assert(
      fc.property(arbObsSeq, (seq) => {
        let h = emptyHistory();
        for (const o of seq) {
          const prev = clone(h);
          h = applyRun(h, o).history;
          expect(h.runs.slice(0, prev.runs.length)).toEqual(prev.runs);
          for (const [k, e] of Object.entries(prev.findings)) {
            expect(h.findings[k]).toBeDefined();
            expect(h.findings[k].firstSeen).toBe(e.firstSeen);
          }
        }
      }),
      RUNS,
    );
  });

  describe("write failure", () => {
    let dir: string | undefined;
    afterEach(() => {
      if (dir) rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    });

    it("Property 9: a simulated write failure leaves the previous history file bytes unchanged", () => {
      dir = mkdtempSync(join(tmpdir(), "awg-hist-"));
      const file = join(dir, "a11y-history.json");
      fc.assert(
        fc.property(arbHistory, arbHistory, (first, second) => {
          saveA11yHistory(first, file);
          const before = readFileSync(file);
          // Block the temp file path with a directory so the write fails.
          const tmp = `${file}.${process.pid}.tmp`;
          mkdirSync(tmp, { recursive: true });
          try {
            expect(() => saveA11yHistory(second, file)).toThrow();
          } finally {
            rmSync(tmp, { recursive: true, force: true });
          }
          expect(readFileSync(file).equals(before)).toBe(true);
        }),
        { numRuns: 100 },
      );
    });

    // Feature: dashboard-usability-overhaul, Property 11: Unavailable history never fabricates state
    // **Validates: Requirements 12.5, 13.8**
    it("Property 11: an unreadable history file loads as unavailable with empty state and is left untouched", () => {
      dir = mkdtempSync(join(tmpdir(), "awg-hist-"));
      const file = join(dir, "a11y-history.json");
      fc.assert(
        fc.property(fc.constantFrom("{not json", "[1,2", "", "[]", "\"x\"", "null"), (junk) => {
          writeFileSync(file, junk, "utf8");
          const before = readFileSync(file);
          const loaded = loadA11yHistory(file);
          expect(loaded.status).toBe("unavailable");
          expect(loaded.history).toEqual(emptyHistory());
          expect(readFileSync(file).equals(before)).toBe(true);
        }),
        RUNS,
      );
    });
  });

  // Feature: dashboard-usability-overhaul, Property 11: Unavailable history never fabricates state
  // **Validates: Requirements 12.5, 13.8**
  it("Property 11: the snapshot carries the unavailable status and an empty input history is not mutated", () => {
    // Module-level part only. The orchestrator (task 8.3) must not call applyRun when history is
    // unavailable, mark every Finding `not-recorded`, and the Dashboard must count unrecorded
    // Findings under "State not recorded"; those parts are verified at integration level.
    fc.assert(
      fc.property(arbObservation, (obs) => {
        const empty = emptyHistory();
        const before = clone(empty);
        const { snapshot } = applyRun(empty, obs, "unavailable");
        expect(snapshot.historyStatus).toBe("unavailable");
        expect(empty).toEqual(before); // input history never mutated
      }),
      RUNS,
    );
  });

  // Feature: dashboard-usability-overhaul, Property 10: Lifecycle is deterministic
  // **Validates: Requirements 13.13**
  it("Property 10: Lifecycle is deterministic and independent of the current time", () => {
    try {
      fc.assert(
        fc.property(arbHistoryAndObs, ([h, obs]) => {
          vi.useFakeTimers();
          vi.setSystemTime(new Date("2020-01-01T00:00:00Z"));
          const a = applyRun(clone(h), clone(obs));
          vi.setSystemTime(new Date("2031-07-07T07:07:07Z"));
          const b = applyRun(clone(h), clone(obs));
          expect(b.history).toEqual(a.history);
          expect(b.snapshot).toEqual(a.snapshot);
        }),
        RUNS,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  // Feature: dashboard-usability-overhaul, Property 12: Resolved items are complete and scoped
  // **Validates: Requirements 13.3, 13.5, 13.6, 13.7**
  it("Property 12: Resolved items are complete and scoped", () => {
    fc.assert(
      fc.property(arbHistoryAndObs, ([h, obs]) => {
        const { snapshot } = applyRun(clone(h), obs);
        const present = new Set(obs.findings.map((f) => f.key));
        const scanned = new Set(obs.scanned.map((s) => `${s.pageUrl}|${s.viewport}`));
        const expected = Object.entries(h.findings)
          .filter(([k, e]) => UNRESOLVED.includes(e.state) && !present.has(k) && scanned.has(`${e.pageUrl}|${e.viewport}`))
          .map(([k]) => k)
          .sort();
        expect(snapshot.resolved.map((r) => r.key).sort()).toEqual(expected);
        for (const r of snapshot.resolved) {
          const e = h.findings[r.key];
          expect(r.pageUrl).toBe(e.pageUrl);
          expect(r.viewport).toBe(e.viewport);
          expect(r.ruleId).toBe(e.ruleId);
          expect(typeof r.severity).toBe("string");
          expect(r.severity.length).toBeGreaterThan(0);
        }
        // every state in the snapshot is a lifecycle value for a present finding
        expect(Object.keys(snapshot.states).sort()).toEqual([...present].sort());
      }),
      RUNS,
    );
  });

  it("migrateV1 of an empty map yields an empty v2 history", () => {
    expect(migrateV1({})).toEqual(emptyHistory());
  });
});