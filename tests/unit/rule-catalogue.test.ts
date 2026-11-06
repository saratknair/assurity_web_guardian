import { describe, it, expect } from "vitest";
// @ts-expect-error plain browser ES module without type declarations
import { RULE_CATALOGUE, FALLBACK_NOTE } from "../../dashboard/rule-catalogue.js";

const entries = Object.entries(RULE_CATALOGUE) as [string, { scope: string; what: string; who: string; fix: string; wcag?: string[] }][];
const PRONOUNS = ["it", "its", "they", "their", "them", "this", "that", "these", "those", "he", "she", "we", "you"];
const PLACEHOLDER = /\{[^}]*\}|\$\{|%[sd]|\bundefined\b|\bnull\b|\bNaN\b|\[object|\bTODO\b|\bTBD\b|<[a-z]+>/i;

describe("Rule_Catalogue", () => {
  it("is non-empty", () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it("uses ASCII only (including the fallback note)", () => {
    expect(JSON.stringify(RULE_CATALOGUE)).toMatch(/^[\x20-\x7e]*$/);
    expect(FALLBACK_NOTE).toMatch(/^[\x20-\x7e]+$/);
  });

  for (const [id, e] of entries) {
    describe(id, () => {
      it("has non-empty what, who and fix", () => {
        for (const k of ["what", "who", "fix"] as const) {
          expect(typeof e[k]).toBe("string");
          expect(e[k].trim().length).toBeGreaterThan(0);
        }
      });

      it("starts with a named subject, not a bare pronoun", () => {
        for (const k of ["what", "who", "fix"] as const) {
          const first = e[k].trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, "");
          expect(PRONOUNS).not.toContain(first);
        }
      });

      it("has no unresolved placeholders", () => {
        for (const k of ["what", "who", "fix"] as const) {
          expect(e[k]).not.toMatch(PLACEHOLDER);
        }
      });

      it("has scope page or elements", () => {
        expect(["page", "elements"]).toContain(e.scope);
      });
    });
  }
});
