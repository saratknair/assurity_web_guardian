import { describe, it, expect } from "vitest";
// @ts-expect-error plain browser ES module without type declarations
import { groupIgnoredByDecision, groupPagesText, ignoredCountBySlug, resolvedItemsForPage, resolvedItemName } from "../../dashboard/lib/ignored.js";
import {
  scopeInWords, ignoredBannerText, regressionLabelText, regressionBlockText, humanResolvedText,
  ignoredElementsText, pageIgnoredText, formatRunDate, IGNORED_FOOTER_TEXT, REGRESSION_SYMBOL,
  // @ts-expect-error plain browser ES module without type declarations
} from "../../dashboard/lib/captions.js";

const disp = (id: string, scope: string, at: string) => ({
  decisionId: id, decision: "ignore", scope, reason: "Third-party widget", reviewer: "Sam", at,
});

describe("dashboard ignored helpers (R19.4, 19.8, 19.10, 19.11, 19.23)", () => {
  it("groups ignored findings by decision, newest first, with scope words and page counts", () => {
    const ignored = [
      { id: "f1", slug: "a", pageUrl: "https://x.test/a", disposition: disp("d1", "site-rule", "2026-01-01T00:00:00Z") },
      { id: "f2", slug: "b", pageUrl: "https://x.test/b", disposition: disp("d1", "site-rule", "2026-01-01T00:00:00Z") },
      { id: "f3", slug: "a", pageUrl: "https://x.test/a", disposition: disp("d2", "element", "2026-02-01T00:00:00Z") },
      { id: "f4", slug: "c", pageUrl: "https://x.test/c" },
    ];
    const groups = groupIgnoredByDecision(ignored);
    expect(groups.map((g: any) => g.decisionId)).toEqual(["d2", "d1", ""]);
    expect(groups[0].scopeText).toBe("This element only");
    expect(groups[1].scopeText).toBe("This rule on every page");
    expect(groups[1].findings.map((f: any) => f.id)).toEqual(["f1", "f2"]);
    expect(groups[1].byText).toBe("Ignored by Sam on " + formatRunDate("2026-01-01T00:00:00Z"));
    expect(groupPagesText(groups[1])).toBe("Covers 2 pages in this run");
    expect(groupPagesText(groups[0])).toBe("");
    expect(groups.reduce((n: number, g: any) => n + g.findings.length, 0)).toBe(ignored.length);
    expect(ignoredCountBySlug(ignored)).toEqual({ a: 2, b: 1, c: 1 });
  });

  it("treats a legacy run without ignored[] as empty", () => {
    expect(groupIgnoredByDecision(undefined)).toEqual([]);
    expect(ignoredCountBySlug(null)).toEqual({});
  });

  it("returns exact plain-string wording", () => {
    expect(scopeInWords("page-rule")).toBe("This rule on this page, all viewports");
    expect(scopeInWords("bogus")).toBe("Scope not recorded");
    expect(ignoredBannerText(disp("d1", "element", "2026-01-01T00:00:00Z"))).toBe(
      "Ignored by Sam on " + formatRunDate("2026-01-01T00:00:00Z") + ". Reason: Third-party widget. Scope: This element only.",
    );
    const reg = { decisionId: "r1", at: "2026-03-04T05:06:00Z", reviewer: "Ana", reason: "Fixed in CMS" };
    expect(regressionLabelText(reg)).toBe("Reappeared after being marked resolved on " + formatRunDate("2026-03-04T05:06:00Z") + " by Ana");
    expect(regressionBlockText(reg)).toBe(
      REGRESSION_SYMBOL + " Regression: Reappeared after being marked resolved on " + formatRunDate("2026-03-04T05:06:00Z") + " by Ana. Original reason: Fixed in CMS.",
    );
    expect(humanResolvedText({ at: "2026-03-04T05:06:00Z", reviewer: "Ana" })).toBe("Marked resolved by Ana on " + formatRunDate("2026-03-04T05:06:00Z"));
    expect(ignoredElementsText(3)).toBe("3 elements ignored");
    expect(ignoredElementsText(1)).toBe("1 element ignored");
    expect(ignoredElementsText(0)).toBe("");
    expect(pageIgnoredText(2)).toBe("(+2 ignored)");
    expect(pageIgnoredText(undefined)).toBe("");
    expect(IGNORED_FOOTER_TEXT).toBe("Ignored issues are listed on the Ignored page. Reasons and reviewer names are published as entered.");
  });

  it("keeps reviewer and reason text as given (no markup interpretation)", () => {
    const text = ignoredBannerText({ reviewer: "<b>x</b>", reason: "<script>", scope: "element", at: "" });
    expect(text).toBe("Ignored by <b>x</b> on date not recorded. Reason: <script>. Scope: This element only.");
  });

  it("selects resolved items for a page and names them", () => {
    const resolved = [
      { slug: "a", ruleId: "image-alt", viewport: "desktop", humanResolved: { reviewer: "Ana", at: "2026-01-01T00:00:00Z" } },
      { pageUrl: "https://x.test/b", ruleId: "label" },
    ];
    expect(resolvedItemsForPage(resolved, "a", "").length).toBe(1);
    expect(resolvedItemsForPage(resolved, "z", "https://x.test/b").length).toBe(1);
    expect(resolvedItemName(resolved[0])).toBe("image-alt (desktop viewport)");
  });
});
