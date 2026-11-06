import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { selectWithinBudget, type Candidate } from "../../src/publish/size-budget.js";

const IMAGE_ROLES = new Set(["diff", "baseline", "current"]);
const REASONS = new Set(["run-cap", "image-cap", "image-retention"]);

const candidateListArb = fc
  .array(
    fc.record({
      bytes: fc.integer({ min: 0, max: 5000 }),
      role: fc.constantFrom("json", "diff", "baseline", "current", "evidence"),
      priority: fc.integer({ min: 0, max: 5 }),
      retained: fc.constantFrom(true, false, undefined),
    }),
    { maxLength: 40 },
  )
  .map((rows): Candidate[] =>
    rows.map((r, i) => {
      const c: Candidate = { path: `f${i}`, bytes: r.bytes, role: r.role, priority: r.priority };
      if (r.retained !== undefined) c.retained = r.retained;
      return c;
    }),
  );

const capsArb = fc.record({
  maxRunBytes: fc.integer({ min: 0, max: 20000 }),
  maxImageBytes: fc.integer({ min: 0, max: 5000 }),
});

describe("Feature: dashboard-usability-overhaul — size budget", () => {
  // Feature: dashboard-usability-overhaul, Property 17: Published size never exceeds the cap and every drop is recorded
  // **Validates: Requirements 1.11, 5.8**
  it("Property 17: Published size never exceeds the cap and every drop is recorded", () => {
    fc.assert(
      fc.property(candidateListArb, capsArb, (cands, caps) => {
        const { keep, dropped } = selectWithinBudget(cands, caps);

        // Kept total within the run cap.
        expect(keep.reduce((s, c) => s + c.bytes, 0)).toBeLessThanOrEqual(caps.maxRunBytes);

        // Every candidate is in exactly one of keep / dropped.
        const keptPaths = keep.map((c) => c.path);
        const droppedPaths = dropped.map((d) => d.path);
        expect(new Set(keptPaths).size).toBe(keptPaths.length);
        expect(new Set(droppedPaths).size).toBe(droppedPaths.length);
        const all = [...keptPaths, ...droppedPaths].sort();
        expect(all).toEqual(cands.map((c) => c.path).sort());
        expect(keptPaths.filter((p) => droppedPaths.includes(p))).toEqual([]);

        // Every drop has a valid reason.
        for (const d of dropped) expect(REASONS.has(d.reason)).toBe(true);

        // Oversized images are never kept; unretained images are dropped as image-retention.
        for (const c of keep) {
          if (IMAGE_ROLES.has(c.role)) {
            expect(c.bytes).toBeLessThanOrEqual(caps.maxImageBytes);
            expect(c.retained).not.toBe(false);
          }
        }
        for (const c of cands) {
          if (IMAGE_ROLES.has(c.role) && c.retained === false) {
            const d = dropped.find((x) => x.path === c.path);
            expect(d?.reason).toBe("image-retention");
          }
        }
      }),
      { numRuns: 200 },
    );
  });
});
