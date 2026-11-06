import { describe, it, expect } from "vitest";
import fc from "fast-check";
// @ts-expect-error plain browser ES module without type declarations
import { parseRoute, formatRoute, normalizeRoute, VIEWS } from "../../dashboard/lib/route.js";

// Strings mixing unicode (never lone surrogates), whitespace and reserved characters.
const reservedChar = fc.constantFrom("&", "#", "%", " ", "/", "?", "=", ",", "+", ";", "\u00e9", "\u2603", "\u65e5\u672c");
const textChar = fc.oneof(reservedChar, fc.fullUnicode(), fc.char());
const arbText = fc.stringOf(textChar, { maxLength: 24 });

const arbEnumParams = fc.record(
  {
    has: fc.constantFrom("yes", "no", "bogus"),
    sort: fc.constantFrom("url", "count", "severity", "bogus"),
    dir: fc.constantFrom("asc", "desc", "bogus"),
    scope: fc.constantFrom("active", "ignored", "bogus"),
  },
  { requiredKeys: [] },
);

const arbParams = fc
  .tuple(
    fc.record(
      {
        run: arbText,
        q: arbText,
        page: arbText,
        sev: fc.array(fc.oneof(fc.constantFrom("critical", "high", "medium", "low", "info", "bogus"), arbText), { maxLength: 4 }),
        state: fc.array(
          fc.oneof(fc.constantFrom("new", "recurring", "existing-unresolved", "regression", "resolved", "not-recorded"), arbText),
          { maxLength: 4 },
        ),
        group: fc.array(arbText, { maxLength: 4 }),
        rule: fc.array(arbText, { maxLength: 4 }),
      },
      { requiredKeys: [] },
    ),
    arbEnumParams,
  )
  .map(([a, b]) => ({ ...a, ...b }));

const arbRoute = fc.record(
  {
    view: fc.constantFrom(...(VIEWS as string[]), "bogus"),
    runId: arbText,
    slug: arbText,
    findingId: arbText,
    viewport: fc.constantFrom("desktop", "mobile", "tablet"),
    params: arbParams,
  },
  { requiredKeys: [] },
);

describe("Feature: dashboard-usability-overhaul - route", () => {
  // Feature: dashboard-usability-overhaul, Property 13: Deep links round-trip
  // **Validates: Requirements 3.13, 8.9, 9.7, 9.12, 11.8**
  it("Property 13: parseRoute(formatRoute(r)) equals normalizeRoute(r)", () => {
    fc.assert(
      fc.property(arbRoute, (r) => {
        expect(parseRoute(formatRoute(r))).toEqual(normalizeRoute(r));
      }),
      { numRuns: 300 },
    );
  });

  // Feature: dashboard-usability-overhaul, Property 13: Deep links round-trip
  it("Property 13: formatRoute is stable on parsed canonical hashes", () => {
    fc.assert(
      fc.property(arbRoute, (r) => {
        const h = formatRoute(r);
        expect(formatRoute(parseRoute(h))).toBe(h);
        expect(formatRoute(parseRoute(formatRoute(parseRoute(h))))).toBe(h);
      }),
      { numRuns: 300 },
    );
  });

  // Feature: dashboard-usability-overhaul, Property 13: Deep links round-trip
  it("Property 13: arbitrary hash strings format to a stable canonical hash", () => {
    fc.assert(
      fc.property(fc.stringOf(fc.oneof(reservedChar, fc.char()), { maxLength: 60 }), (raw) => {
        const once = formatRoute(parseRoute(raw));
        expect(formatRoute(parseRoute(once))).toBe(once);
      }),
      { numRuns: 300 },
    );
  });

  // Feature: dashboard-usability-overhaul, Property 13: Deep links round-trip
  it("Property 13: unicode and reserved characters in q and slug survive", () => {
    const sample = "caf\u00e9 & #1 100% \u65e5\u672c";
    const r = { view: "page", slug: sample, params: { q: sample, rule: [sample, "a,b"] } };
    const back = parseRoute(formatRoute(r));
    expect(back.slug).toBe(sample);
    expect(back.params.q).toBe(sample);
    expect(back.params.rule).toEqual(["a,b", sample].sort());
  });
});
