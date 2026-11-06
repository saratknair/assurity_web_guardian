import { describe, it, expect } from "vitest";
import fc from "fast-check";
// @ts-expect-error plain browser ES module without type declarations
import { evidenceCaption, imageAlt, formatRunDate, RUN_NOT_RECORDED, ROLE_LABELS, DIFF_LEGEND } from "../../dashboard/lib/captions.js";
// @ts-expect-error plain browser ES module without type declarations
import { plainEnglishSummary, shownElementsText, scopeSentence } from "../../dashboard/lib/summary.js";
// @ts-expect-error plain browser ES module without type declarations
import { isGenericGuidance, visibleGuidance, GENERIC_GUIDANCE_CORES } from "../../dashboard/lib/guidance.js";
// @ts-expect-error plain browser ES module without type declarations
import { RULE_CATALOGUE } from "../../dashboard/rule-catalogue.js";
import { qualityAnalysis, visualExplanation } from "../../src/agents/ai-agents.js";
import { isGenericGuidance as tsIsGeneric, GENERIC_GUIDANCE_CORES as tsCores } from "../../src/publish/guidance.js";

const RUNS = { numRuns: 100 };

const alnum = fc.stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789_-".split("")), { minLength: 1, maxLength: 16 });
const word = fc.stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz".split("")), { minLength: 2, maxLength: 10 });
const words = fc.array(word, { minLength: 1, maxLength: 6 }).map((w) => w.join(" "));
const isoDate = fc.integer({ min: Date.UTC(2000, 0, 1), max: Date.UTC(2090, 0, 1) }).map((t) => new Date(t).toISOString());

const arbCtx = fc.record({
  role: fc.constantFrom("baseline", "current", "diff"),
  pageUrl: fc.webUrl(),
  viewport: fc.constantFrom("desktop", "mobile", "tablet", "vp1280x720"),
  runId: fc.option(alnum, { nil: undefined }),
  runFinishedAt: fc.option(isoDate, { nil: undefined }),
});

// Feature: dashboard-usability-overhaul, Property 20: Captions and alt text always carry their facts
describe("Property 20: Captions and alt text always carry their facts", () => {
  it("evidenceCaption carries url, viewport, role, run id/date or Run not recorded, legend or full-page capture", () => {
    fc.assert(
      fc.property(arbCtx, (ctx) => {
        const cap: string = evidenceCaption(ctx);
        expect(cap).toContain(ctx.pageUrl);
        expect(cap).toContain(ctx.viewport);
        expect(cap).toContain(ROLE_LABELS[ctx.role]);
        if (ctx.runId !== undefined) expect(cap).toContain(ctx.runId);
        else expect(cap).toContain(RUN_NOT_RECORDED);
        if (ctx.runFinishedAt !== undefined) {
          expect(formatRunDate(ctx.runFinishedAt)).not.toBe(RUN_NOT_RECORDED);
          expect(cap).toContain(formatRunDate(ctx.runFinishedAt));
        } else {
          expect(cap).toContain(RUN_NOT_RECORDED);
        }
        if (ctx.runId === undefined && ctx.runFinishedAt === undefined) {
          expect(cap.split(RUN_NOT_RECORDED).length - 1).toBe(2);
        }
        if (ctx.role === "diff") expect(cap).toContain(DIFF_LEGEND);
        if (ctx.role === "current") expect(cap).toContain("full-page capture");
      }),
      RUNS,
    );
  });

  it("imageAlt carries url, viewport, role, run id and date (or not recorded)", () => {
    fc.assert(
      fc.property(arbCtx, (ctx) => {
        const alt: string = imageAlt(ctx);
        expect(alt).toContain(ctx.pageUrl);
        expect(alt).toContain(ctx.viewport);
        expect(alt).toContain(ROLE_LABELS[ctx.role]);
        if (ctx.runId !== undefined) expect(alt).toContain(ctx.runId);
        else expect(alt.toLowerCase()).toContain("run not recorded");
        if (ctx.runFinishedAt !== undefined) expect(alt).toContain(formatRunDate(ctx.runFinishedAt));
        else expect(alt.toLowerCase()).toContain("not recorded");
        if (ctx.role === "diff") expect(alt.toLowerCase()).toContain("red");
      }),
      RUNS,
    );
  });
});

const catalogueIds = Object.keys(RULE_CATALOGUE) as string[];
const PLACEHOLDER = /\{[^}]*\}|\$\{|%[sd]|\bundefined\b|\bnull\b|\bNaN\b|\[object/;

function sentence(s: string): string {
  const t = s.trim();
  return /[.!?]$/.test(t) ? t : t + ".";
}

// Feature: dashboard-usability-overhaul, Property 21: Plain-English summaries are complete and never invented
describe("Property 21: Plain-English summaries are complete and never invented", () => {
  it("catalogue rules: summary contains what, who, the scope statement, and no placeholder", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...catalogueIds),
        fc.integer({ min: 0, max: 60 }),
        fc.option(word, { nil: undefined }),
        (ruleId, nodeCount, firstTarget) => {
          const entry = RULE_CATALOGUE[ruleId];
          const s: string = plainEnglishSummary({ kind: "a11y-rule", ruleId, nodeCount, title: "t", description: "d" }, RULE_CATALOGUE, { firstTarget });
          expect(s.trim().length).toBeGreaterThan(0);
          expect(s).toContain(entry.what);
          expect(s).toContain(entry.who);
          expect(s).not.toMatch(PLACEHOLDER);
          if (entry.scope === "page" || nodeCount === 0) expect(s).toContain("whole page");
          else expect(s).toContain(nodeCount === 1 ? "1 element " : nodeCount + " elements");
        },
      ),
      RUNS,
    );
  });

  it("unknown rules: summary is only published description, help and the scope sentence", () => {
    fc.assert(
      fc.property(
        word.map((w) => "zz-unknown-" + w),
        words,
        words,
        fc.integer({ min: 0, max: 60 }),
        (ruleId, description, help, nodeCount) => {
          expect(catalogueIds).not.toContain(ruleId);
          const f = { kind: "a11y-rule", ruleId, description, help, title: "ignored title", nodeCount };
          const s: string = plainEnglishSummary(f, RULE_CATALOGUE);
          const d = sentence(description);
          const h = sentence(help);
          const parts = [d];
          if (h !== d) parts.push(h);
          parts.push(scopeSentence(null, nodeCount, null));
          expect(s).toBe(parts.join(" "));
          expect(s).not.toMatch(PLACEHOLDER);
          for (const id of catalogueIds) {
            expect(s).not.toContain(RULE_CATALOGUE[id].what);
            expect(s).not.toContain(RULE_CATALOGUE[id].who);
          }
        },
      ),
      RUNS,
    );
  });

  it("check and visual findings give non-empty text that states scope", () => {
    fc.assert(
      fc.property(fc.constantFrom("check", "visual"), words, alnum, (kind, detail, viewport) => {
        const s: string = plainEnglishSummary({ kind, ruleId: "check:" + viewport, viewport, detail, nodeCount: 0 }, RULE_CATALOGUE);
        expect(s.trim().length).toBeGreaterThan(0);
        expect(s).toContain("whole page");
        expect(s).not.toMatch(PLACEHOLDER);
      }),
      RUNS,
    );
  });

  it("showing X of Y text contains both the total and the omitted number", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5000 }), fc.integer({ min: 1, max: 5000 }), (total, omittedRaw) => {
        const omitted = Math.min(omittedRaw, total);
        const t: string = shownElementsText({ nodeCount: total, omittedNodeCount: omitted });
        expect(t).toContain(String(total));
        expect(t).toContain(String(omitted));
        expect(t).toContain(String(total - omitted));
      }),
      RUNS,
    );
  });
});

const arbSpecificText = words.map((w) => "Page " + w + " fails rule " + w + " at severity high");
const arbLegacyOutcome = fc.record({
  findingId: alnum,
  kind: fc.constantFrom("failed-check", "observed-website-change", "visual-finding"),
  classification: fc.constant("deterministic-test-evidence"),
  detail: fc.oneof(fc.string(), fc.fullUnicodeString(), words),
});

// Feature: dashboard-usability-overhaul, Property 22: Automated guidance is specific, linked, and honest
describe("Property 22: Automated guidance is specific, linked, and honest (visibleGuidance and isGenericGuidance)", () => {
  it("visibleGuidance drops unknown findingIds, generic texts and confidence fields", () => {
    const known = ["F1", "F2", "F3"];
    const arbItem = fc.record(
      {
        findingId: fc.constantFrom("F1", "F2", "F3", "X9", "nope", ""),
        text: fc.oneof(arbSpecificText, fc.constantFrom(...GENERIC_GUIDANCE_CORES), fc.constant("")),
        pageUrl: fc.constant("https://example.test/"),
        checkId: alnum,
        severity: fc.constantFrom("high", "low"),
        confidence: fc.double({ min: 0, max: 1, noNaN: true }),
      },
      { requiredKeys: ["findingId", "text"] },
    );
    fc.assert(
      fc.property(fc.array(arbItem, { maxLength: 12 }), (items) => {
        const out = visibleGuidance(items, new Set(known)) as Record<string, unknown>[];
        const expected = items.filter((i) => known.includes(i.findingId) && !isGenericGuidance(i.text));
        expect(out.length).toBe(expected.length);
        out.forEach((o, idx) => {
          expect(known).toContain(o.findingId);
          expect(isGenericGuidance(o.text)).toBe(false);
          expect(o.findingId).toBe(expected[idx].findingId);
          expect(o.text).toBe(expected[idx].text);
          expect(Object.keys(o).some((k) => /^confidence/i.test(k))).toBe(false);
        });
      }),
      RUNS,
    );
  });

  it("every legacy template text from src/agents/ai-agents.ts is generic", () => {
    fc.assert(
      fc.property(arbLegacyOutcome, (o) => {
        const outcome = o as never;
        expect(isGenericGuidance(qualityAnalysis(outcome).text)).toBe(true);
        const v = visualExplanation(outcome);
        if (o.kind === "visual-finding") {
          expect(v).not.toBeNull();
          expect(isGenericGuidance(v!.text)).toBe(true);
        } else {
          expect(v).toBeNull();
        }
      }),
      RUNS,
    );
  });

  it("specific texts and non-strings: specific is not generic, non-string is generic", () => {
    fc.assert(
      fc.property(arbSpecificText, fc.oneof(fc.constant(undefined), fc.constant(null), fc.integer()), (text, bad) => {
        expect(isGenericGuidance(text)).toBe(false);
        expect(isGenericGuidance(bad)).toBe(true);
      }),
      RUNS,
    );
  });

  it("TS isGenericGuidance (src/publish/guidance.ts) agrees with the JS implementation", () => {
    expect([...tsCores]).toEqual([...GENERIC_GUIDANCE_CORES]);
    const ws = fc.constantFrom(" ", "  ", "\t", "\n", " \r\n ");
    const mangle = (s: string) =>
      fc.tuple(ws, ws, fc.boolean(), fc.boolean()).map(([a, b, up, dots]) => {
        let t = s.replace(/ /g, a === "" ? " " : b);
        if (up) t = t.toUpperCase();
        return a + t + (dots ? "..." : "") + b;
      });
    const coreVariant = fc.constantFrom(...GENERIC_GUIDANCE_CORES).chain((c: string) =>
      fc.oneof(
        mangle(c),
        mangle("Likely impact: " + c.replace("may affect", 'may affect').replace("deterministic check", 'deterministic check ("x")')),
        fc.string().map((d) => c.replace(/^(a failing deterministic check|observed change)/, '$1 ("' + d + '")')),
        fc.string().map((d) => "Likely impact: " + c + " " + '("' + d + '")'),
      ),
    );
    const legacy = arbLegacyOutcome.map((o) => {
      const outcome = o as never;
      return qualityAnalysis(outcome).text as string;
    });
    const anyText = fc.oneof(
      coreVariant,
      legacy,
      arbSpecificText,
      fc.string(),
      fc.fullUnicodeString(),
      fc.constantFrom("", " ", "\n", ".", "likely impact:", '("")', "Likely impact: "),
      fc.constant(undefined),
      fc.constant(null),
      fc.integer(),
    );
    fc.assert(
      fc.property(anyText, (t) => {
        expect(tsIsGeneric(t as never)).toBe(isGenericGuidance(t));
      }),
      { numRuns: 300 },
    );
  });
});
