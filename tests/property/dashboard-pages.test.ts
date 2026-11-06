import { describe, it, expect } from "vitest";
import fc from "fast-check";
// @ts-expect-error plain browser ES module without type declarations
import { groupOfUrl, buildPageRows, filterPages, sortPages, groupPages, highestSeverity } from "../../dashboard/lib/pages.js";
import { pageGroupOf } from "../../src/publish/pages";

const SEVS = ["critical", "serious", "moderate", "minor", "unrated", "not-recorded"] as const;
const COUNT_KEY: Record<string, string> = {
  critical: "critical",
  serious: "serious",
  moderate: "moderate",
  minor: "minor",
  unrated: "unrated",
  "not-recorded": "notRecorded",
};
const STATES = ["new", "recurring", "existing-unresolved", "regression", "resolved"] as const;

const segChar = fc.constantFrom("a", "B", "c", "1", "-", "_", "%20", "%C3%A9", "%E6%97%A5", "%", "%zz", "\u00e9", "\u65e5");
const arbSegment = fc.stringOf(segChar, { maxLength: 8 });
const arbUrl = fc
  .tuple(
    fc.constantFrom("https://example.com", "http://Example.org:8080", "https://a.nz"),
    fc.array(arbSegment, { maxLength: 3 }),
    fc.constantFrom("", "/", "?q=1", "#frag", "/?x=/y"),
  )
  .map(([origin, segs, tail]) => origin + (segs.length ? "/" + segs.join("/") : "") + tail);

const arbCount = fc.oneof(fc.constant(0), fc.integer({ min: 0, max: 20 }));
const arbPage = fc
  .record({
    url: arbUrl,
    title: fc.option(fc.stringOf(fc.constantFrom("a", "B", "x", " ", "Home", "\u00e9"), { maxLength: 10 }), { nil: undefined }),
    counts: fc.record({
      critical: arbCount,
      serious: arbCount,
      moderate: arbCount,
      minor: arbCount,
      unrated: arbCount,
      notRecorded: arbCount,
    }),
    states: fc.array(fc.constantFrom(...STATES), { maxLength: 3 }),
  })
  .map((p, i) => ({ ...p, slug: "p" + i }));

const arbPageRows = (max = 500) =>
  fc.array(arbPage, { maxLength: max }).map((pages) => buildPageRows(pages));

const arbFilter = fc.record({
  q: fc.oneof(fc.constant(""), fc.stringOf(fc.constantFrom("a", "b", "x", "e", "/", "h", " ", "A"), { maxLength: 4 })),
  sev: fc.subarray([...SEVS]),
  state: fc.subarray([...STATES]),
  has: fc.constantFrom(undefined, "yes", "no"),
});

describe("page list properties", () => {
  // Feature: dashboard-usability-overhaul, Property 14: Search and filters only narrow the page list
  // **Validates: Requirements 8.5, 8.6, 8.12**
  it("Property 14: search and filters only narrow the page list", () => {
    fc.assert(
      fc.property(arbPageRows(60), arbFilter, fc.nat(), (rows, filter, pick) => {
        // Sometimes search for a real substring so the result is non-trivial.
        const f = { ...filter };
        if (rows.length && pick % 2 === 0) {
          const u: string = rows[pick % rows.length].url;
          f.q = u.slice(pick % 5, (pick % 5) + 4);
        }
        const out = filterPages(rows, f);
        const q = f.q.trim().toLowerCase();
        for (const r of out) {
          if (q) expect(r.searchKey.includes(q)).toBe(true);
          if (f.sev.length) expect(f.sev.some((s) => r.sevCounts[s] > 0)).toBe(true);
          if (f.state.length) expect(f.state.some((s) => r.states.has(s))).toBe(true);
          if (f.has === "yes") expect(r.total).toBeGreaterThan(0);
          if (f.has === "no") expect(r.total).toBe(0);
        }
        expect(out.length).toBeLessThanOrEqual(rows.length);
        // Subset of the empty-search result under the same filters.
        const noSearch = new Set(filterPages(rows, { ...f, q: "" }));
        for (const r of out) expect(noSearch.has(r)).toBe(true);
        // Adding a filter never increases the result.
        const base = { q: f.q, sev: [], state: [], has: undefined };
        const baseOut = new Set(filterPages(rows, base));
        const withSev = filterPages(rows, { ...base, sev: f.sev });
        const withSevState = filterPages(rows, { ...base, sev: f.sev, state: f.state });
        const withAll = filterPages(rows, { ...base, sev: f.sev, state: f.state, has: f.has });
        expect(withSev.length).toBeLessThanOrEqual(baseOut.size);
        expect(withSevState.length).toBeLessThanOrEqual(withSev.length);
        expect(withAll.length).toBeLessThanOrEqual(withSevState.length);
        for (const r of withAll) expect(baseOut.has(r)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: dashboard-usability-overhaul, Property 15: Page groups partition the pages
  // **Validates: Requirements 8.1, 8.2**
  it("Property 15: page groups partition the pages", () => {
    fc.assert(
      fc.property(arbPageRows(100), (rows) => {
        const groups = groupPages(rows);
        expect(groups.reduce((n: number, g: any) => n + g.pages, 0)).toBe(rows.length);
        const seen = new Set<any>();
        const names = new Set<string>();
        for (const g of groups) {
          expect(names.has(g.name)).toBe(false);
          names.add(g.name);
          expect(g.rows.length).toBe(g.pages);
          for (const r of g.rows) {
            expect(seen.has(r)).toBe(false);
            seen.add(r);
            expect(r.group).toBe(g.name);
            expect(g.name).toBe(groupOfUrl(r.url));
          }
          for (const s of SEVS) {
            expect(g.sevCounts[s]).toBe(g.rows.reduce((n: number, r: any) => n + r.sevCounts[s], 0));
          }
        }
        expect(seen.size).toBe(rows.length);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: dashboard-usability-overhaul, Property 15: Page groups partition the pages
  // **Validates: Requirements 8.1, 8.2**
  it("Property 15: group name is the lowercased first path segment or (home)", () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom("Services", "a", "", "B%20c", "caf\u00e9"), { maxLength: 3 }), (segs) => {
        const url = "https://example.com/" + segs.join("/");
        const first = segs.find((s) => s.length > 0);
        const expected = first === undefined ? "(home)" : decodeURIComponent(first).toLowerCase();
        expect(groupOfUrl(url)).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: dashboard-usability-overhaul, Property 15: Page groups partition the pages
  // **Validates: Requirements 8.1, 8.2**
  it("Property 15: TS pageGroupOf and JS groupOfUrl agree", () => {
    fc.assert(
      fc.property(fc.oneof(arbUrl, fc.string(), fc.fullUnicodeString(), fc.webUrl(), fc.constantFrom("", "/", "not a url", "https://x/%E0%A4%A", "https://x//a")), (url) => {
        expect(pageGroupOf(url)).toBe(groupOfUrl(url));
      }),
      { numRuns: 300 },
    );
  });

  // Feature: dashboard-usability-overhaul, Property 16: Row severity and sort order are correct
  // **Validates: Requirements 8.7, 8.13**
  it("Property 16: highest severity is the most severe present", () => {
    fc.assert(
      fc.property(arbPage, (page) => {
        const [row] = buildPageRows([page]);
        const present = SEVS.filter((s) => (page.counts as any)[COUNT_KEY[s]] > 0);
        expect(row.highest).toBe(present.length ? present[0] : "none");
        expect(highestSeverity(row.sevCounts)).toBe(row.highest);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: dashboard-usability-overhaul, Property 16: Row severity and sort order are correct
  // **Validates: Requirements 8.7, 8.13**
  it("Property 16: sortPages is a stable, ordered permutation", () => {
    fc.assert(
      fc.property(arbPageRows(100), fc.constantFrom("url", "count", "severity"), fc.constantFrom("asc", "desc"), (rows, key, dir) => {
        const out = sortPages(rows, { sort: key, dir });
        expect(out.length).toBe(rows.length);
        expect(new Set(out).size).toBe(rows.length);
        for (const r of out) expect(rows.includes(r)).toBe(true);
        const val = (r: any) => (key === "url" ? r.url : key === "count" ? r.total : r.highestRank);
        for (let i = 1; i < out.length; i++) {
          const a = val(out[i - 1]);
          const b = val(out[i]);
          if (dir === "asc") expect(a <= b).toBe(true);
          else expect(a >= b).toBe(true);
          if (a === b) expect(out[i - 1].index).toBeLessThan(out[i].index);
        }
      }),
      { numRuns: 100 },
    );
  });

  // Feature: dashboard-usability-overhaul, Property 28: Page filtering stays within the latency budget
  // **Validates: Requirements 16.3**
  it("Property 28: filter + sort over 500 pages stays under 200 ms", () => {
    fc.assert(
      fc.property(fc.array(arbPage, { minLength: 500, maxLength: 500 }), arbFilter, fc.constantFrom("url", "count", "severity"), fc.constantFrom("asc", "desc"), (pages, filter, key, dir) => {
        const rows = buildPageRows(pages);
        const start = performance.now();
        sortPages(filterPages(rows, filter), { sort: key, dir });
        const elapsed = performance.now() - start;
        expect(elapsed).toBeLessThan(200);
      }),
      { numRuns: 10 },
    );
  });
});
