// Feature: dashboard-usability-overhaul, Property 35: Log merge is a lossless, commutative, idempotent union
// Feature: dashboard-usability-overhaul, Property 37: Decision input validation and entry integrity
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  entryId,
  mergeLogs,
  parseLog,
  serializeLog,
  validateNewEntry,
  REASON_MAX,
  REVIEWER_MAX,
  type DispositionEntry,
  type DispositionLog,
} from "../../src/core/dispositions.js";

const RUNS = { numRuns: 100 };

// Text pieces include non-ASCII (accents, CJK, astral emoji) and DEL.
const piece = fc.constantFrom("a", "Z", "7", " ", "-", "_", "\u00e9", "\u65e5", "\u00fc", "\ud83d\ude00", "\u007f", "\u2603");
const text = (min: number, max: number) =>
  fc.array(piece, { minLength: min, maxLength: max }).map((a) => a.join(""));

const isoAt = fc
  .integer({ min: Date.UTC(2024, 0, 1), max: Date.UTC(2026, 0, 1) })
  .map((ms) => new Date(ms).toISOString());

const matcherArb = fc.record({
  pageUrl: fc.constantFrom("https://assurity.nz/", "https://assurity.nz/a", "https://assurity.nz/b?x=1"),
  viewport: fc.constantFrom("desktop" as const, "mobile" as const, "" as const),
  ruleId: fc.constantFrom("color-contrast", "image-alt", "check:links"),
  cssTarget: fc.constantFrom("", "#a", ".b > p", "\u65e5"),
});

const entryArb: fc.Arbitrary<DispositionEntry> = fc
  .record({
    decision: fc.constantFrom("ignore" as const, "resolve" as const, "unignore" as const),
    matcher: matcherArb,
    reason: text(0, 20),
    reviewer: text(0, 10),
    at: isoAt,
    undoes: fc.option(fc.constantFrom("dsp_0123456789abcdef", "dsp_fedcba9876543210"), { nil: null }),
    source: fc.constantFrom("admin-gui" as const, "cli" as const),
    scopeIdx: fc.nat(2),
  })
  .map(({ decision, scopeIdx, ...rest }) => {
    const scopes = {
      ignore: ["element", "page-rule", "site-rule"],
      resolve: ["finding"],
      unignore: ["undo"],
    } as const;
    const list = scopes[decision];
    const scope = list[scopeIdx % list.length] as DispositionEntry["scope"];
    const body = { decision, scope, ...rest };
    return { id: entryId(body), ...body };
  });

const logArb: fc.Arbitrary<DispositionLog> = fc
  .array(entryArb, { maxLength: 8 })
  .map((entries) => ({ schemaVersion: 1 as const, entries }));

const ids = (l: DispositionLog) => l.entries.map((e) => e.id);

describe("Property 35: Log merge is a lossless, commutative, idempotent union", () => {
  it("**Property 35**: merge is commutative, associative and idempotent", () => {
    fc.assert(
      fc.property(logArb, logArb, logArb, (a, b, c) => {
        expect(mergeLogs(a, b)).toEqual(mergeLogs(b, a));
        expect(mergeLogs(a, mergeLogs(b, c))).toEqual(mergeLogs(mergeLogs(a, b), c));
        expect(mergeLogs(mergeLogs(a, a), a)).toEqual(mergeLogs(a, a));
        // a merged with itself equals a normalised a
        expect(mergeLogs(a, a)).toEqual(mergeLogs(a, { schemaVersion: 1, entries: [] }));
      }),
      RUNS,
    );
  });

  it("**Property 35**: merged ids equal the union of input ids and no entry is altered", () => {
    fc.assert(
      fc.property(logArb, logArb, (a, b) => {
        const m = mergeLogs(a, b);
        const union = new Set([...ids(a), ...ids(b)]);
        expect(new Set(ids(m))).toEqual(union);
        expect(ids(m).length).toBe(union.size);
        const source = new Map([...a.entries, ...b.entries].map((e) => [e.id, e]));
        for (const e of m.entries) expect(e).toEqual(source.get(e.id));
        // equal merged logs serialise to identical bytes
        expect(serializeLog(mergeLogs(a, b))).toBe(serializeLog(mergeLogs(b, a)));
      }),
      RUNS,
    );
  });

  it("**Property 35**: serialize/parse round-trip is stable, preserves non-ASCII and emits ASCII only", () => {
    fc.assert(
      fc.property(logArb, (log) => {
        const text1 = serializeLog(log);
        expect(/^[\x00-\x7f]*$/.test(text1)).toBe(true);
        const p1 = parseLog(text1);
        expect(p1.rejected).toEqual([]);
        expect(p1.log).toEqual(mergeLogs(log, { schemaVersion: 1, entries: [] }));
        const text2 = serializeLog(p1.log);
        expect(text2).toBe(text1);
        const p2 = parseLog(text2);
        expect(p2.log).toEqual(p1.log);
        for (const e of log.entries) {
          const back = p2.log.entries.find((x) => x.id === e.id);
          expect(back?.reason).toBe(e.reason);
          expect(back?.reviewer).toBe(e.reviewer);
        }
      }),
      RUNS,
    );
  });
});

const NOW = new Date("2025-06-01T00:00:00.000Z");

const goodInput = (over: Record<string, unknown> = {}) => ({
  decision: "ignore",
  scope: "page-rule",
  matcher: { pageUrl: "https://assurity.nz/a", ruleId: "color-contrast" },
  reason: "Known false positive",
  reviewer: "Sam",
  source: "cli",
  ...over,
});

const blank = fc.array(fc.constantFrom(" ", "\t", "\n", "\u0001"), { maxLength: 5 }).map((a) => a.join(""));
const nonBlank = text(1, 20).filter((s) => s.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim().length > 0);

describe("Property 37: Decision input validation and entry integrity", () => {
  it("**Property 37**: rejects empty/whitespace and over-long reason or reviewer, naming the field", () => {
    fc.assert(
      fc.property(blank, blank, fc.integer({ min: 1, max: 40 }), (r1, r2, extra) => {
        const emptyReason = validateNewEntry(goodInput({ reason: r1 }), [], NOW);
        expect(emptyReason.ok).toBe(false);
        if (!emptyReason.ok) expect(emptyReason.errors.map((e) => e.field)).toContain("reason");
        const emptyReviewer = validateNewEntry(goodInput({ reviewer: r2 }), [], NOW);
        expect(emptyReviewer.ok).toBe(false);
        if (!emptyReviewer.ok) expect(emptyReviewer.errors.map((e) => e.field)).toContain("reviewer");
        const longReason = validateNewEntry(goodInput({ reason: "x".repeat(REASON_MAX + extra) }), [], NOW);
        expect(longReason.ok).toBe(false);
        if (!longReason.ok) expect(longReason.errors.map((e) => e.field)).toContain("reason");
        const longReviewer = validateNewEntry(goodInput({ reviewer: "y".repeat(REVIEWER_MAX + extra) }), [], NOW);
        expect(longReviewer.ok).toBe(false);
        if (!longReviewer.ok) expect(longReviewer.errors.map((e) => e.field)).toContain("reviewer");
      }),
      RUNS,
    );
  });

  it("**Property 37**: rejects an ignore with a missing or disallowed scope", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(undefined),
          fc.constant(""),
          fc.constantFrom("finding", "undo", "page", "site", "ELEMENT"),
          text(0, 6).filter((s) => !["element", "page-rule", "site-rule"].includes(s)),
        ),
        (scope) => {
          const r = validateNewEntry(goodInput({ scope }), [], NOW);
          expect(r.ok).toBe(false);
          if (!r.ok) expect(r.errors.map((e) => e.field)).toContain("scope");
        },
      ),
      RUNS,
    );
  });

  it("**Property 37**: rejects unignore that names a missing, non-ignore, or already undone entry", () => {
    fc.assert(
      fc.property(isoAt, (at) => {
        const ign = validateNewEntry(goodInput(), [], new Date(at));
        expect(ign.ok).toBe(true);
        if (!ign.ok) return;
        const later = new Date(Date.parse(at) + 1000);
        const un = (undoes: unknown, existing: DispositionEntry[]) =>
          validateNewEntry(
            { decision: "unignore", scope: "undo", reason: "r", reviewer: "Sam", source: "cli", undoes },
            existing,
            later,
          );
        const fields = (r: ReturnType<typeof un>) => (r.ok ? [] : r.errors.map((e) => e.field));
        // missing
        expect(fields(un("dsp_0000000000000000", [ign.entry]))).toContain("undoes");
        expect(fields(un(undefined, [ign.entry]))).toContain("undoes");
        // valid, then already undone
        const ok = un(ign.entry.id, [ign.entry]);
        expect(ok.ok).toBe(true);
        if (ok.ok) expect(fields(un(ign.entry.id, [ign.entry, ok.entry]))).toContain("undoes");
        // non-ignore target
        const res = validateNewEntry(
          goodInput({ decision: "resolve", scope: "finding", matcher: { pageUrl: "https://assurity.nz/a", viewport: "desktop", ruleId: "image-alt" } }),
          [],
          new Date(at),
        );
        expect(res.ok).toBe(true);
        if (res.ok) expect(fields(un(res.entry.id, [res.entry]))).toContain("undoes");
      }),
      RUNS,
    );
  });

  it("**Property 37**: accepts well-formed input with id equal to entryId of its content and at taken from now", () => {
    fc.assert(
      fc.property(nonBlank, nonBlank, isoAt, (reason, reviewer, at) => {
        fc.pre(reason.length <= REASON_MAX && reviewer.length <= REVIEWER_MAX);
        const r = validateNewEntry(goodInput({ reason, reviewer, at: "1999-01-01T00:00:00.000Z" }), [], new Date(at));
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const { id, ...body } = r.entry;
        expect(id).toBe(entryId(body));
        expect(r.entry.at).toBe(at);
        // the produced entry survives a serialise/parse round trip
        const back = parseLog(serializeLog({ schemaVersion: 1, entries: [r.entry] }));
        expect(back.rejected).toEqual([]);
        expect(back.log.entries).toEqual([r.entry]);
        // resubmitting the same decision is a duplicate
        const dup = validateNewEntry(goodInput({ reason, reviewer }), [r.entry], new Date(at));
        expect(dup.ok).toBe(false);
      }),
      RUNS,
    );
  });

  it("**Property 37**: parseLog rejects entries whose stored id differs from the recomputed id", () => {
    fc.assert(
      fc.property(
        fc.array(entryArb, { minLength: 1, maxLength: 6 }),
        fc.nat(),
        fc.constantFrom("id", "reason", "reviewer", "at"),
        (entries, pick, tamper) => {
          const unique = [...new Map(entries.map((e) => [e.id, e])).values()];
          const i = pick % unique.length;
          const victim = unique[i]!;
          let mutated: DispositionEntry;
          if (tamper === "id") mutated = { ...victim, id: victim.id.slice(0, -1) + (victim.id.endsWith("0") ? "1" : "0") };
          else if (tamper === "at") mutated = { ...victim, at: new Date(Date.parse(victim.at) + 1).toISOString() };
          else mutated = { ...victim, [tamper]: victim[tamper] + "!" };
          const raw = JSON.stringify({
            schemaVersion: 1,
            entries: unique.map((e, k) => (k === i ? mutated : e)),
          });
          const { log, rejected } = parseLog(raw);
          expect(rejected.map((r) => r.index)).toEqual([i]);
          expect(log.entries.some((e) => e.id === mutated.id && e.id !== victim.id)).toBe(false);
          expect(log.entries.length).toBe(unique.length - 1);
          for (const e of unique) {
            if (e.id !== victim.id) expect(log.entries.some((x) => x.id === e.id)).toBe(true);
          }
        },
      ),
      RUNS,
    );
  });
});
