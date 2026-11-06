import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  buildViolationEvidence,
  sanitizeEvidenceText,
  DEFAULT_CAPS,
} from "../../src/publish/evidence.js";
import { hasResidualPath } from "../../src/publish/sanitizer.js";

// The Sanitizer's secret patterns (src/safety/redactor.ts SENSITIVE_VALUE).
const SECRET_PATTERNS: RegExp[] = [
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
  /\bBearer\s+[A-Za-z0-9._-]+\b/i,
  /\b[A-Za-z0-9_]{32,}\b/,
  /\b\d{13,19}\b/,
];
// Any control char except \n and \t.
const BAD_CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u2028\u2029]/;

const alnum = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_";
const word = fc.stringOf(fc.constantFrom(...alnum.split("")), { minLength: 1, maxLength: 12 });
const arbEmail = fc.tuple(word, word).map(([a, b]) => `${a}@${b}.com`);
const arbBearer = word.map((w) => `Bearer ${w}abc`);
const arbOpaque = fc.stringOf(fc.constantFrom(...alnum.split("")), { minLength: 32, maxLength: 60 });
const arbDigits = fc
  .integer({ min: 13, max: 19 })
  .chain((n) => fc.stringOf(fc.constantFrom(..."0123456789".split("")), { minLength: n, maxLength: n }));
const arbWinPath = fc.tuple(fc.constantFrom("C", "D", "e"), word, word).map(([d, a, b]) => `${d}:\\${a}\\${b}.txt`);
const arbWinFwd = fc.tuple(fc.constantFrom("C", "d"), word, word).map(([d, a, b]) => `${d}:/${a}/${b}.txt`);
const arbUnc = fc.tuple(word, word).map(([h, s]) => `\\\\${h}\\${s}\\file.txt`);
const arbPosix = fc.tuple(fc.constantFrom("Users", "home"), word, word).map(([r, u, f]) => `/${r}/${u}/${f}`);
const arbControl = fc.constantFrom(
  "\u0000", "\u0001", "\u0007", "\u0008", "\u000B", "\u000C", "\r", "\u001B", "\u007F", "\u0085", "\u009F", "\u2028", "\u2029", "\n", "\t",
);
const arbNonAscii = fc.constantFrom("\u00E9", "\u00FC", "\u4E2D\u6587", "\u{1F600}", "\u0416", "\u200B");
const arbPlain = fc.stringOf(fc.constantFrom(..."ab <>=\"/-.:#".split("")), { maxLength: 20 });

const arbFragment = fc.oneof(
  arbEmail, arbBearer, arbOpaque, arbDigits, arbWinPath, arbWinFwd, arbUnc, arbPosix, arbControl, arbNonAscii, arbPlain,
);
const arbText = fc.array(arbFragment, { maxLength: 12 }).map((a) => a.join(" "));
// Also variants with no separators so control chars can glue fragments together.
const arbTextGlued = fc.array(arbFragment, { maxLength: 12 }).map((a) => a.join(""));
const arbEvidenceString = fc.oneof(arbText, arbTextGlued);

const arbTarget = fc.oneof(
  arbEvidenceString,
  fc.array(fc.oneof(arbEvidenceString, fc.array(arbEvidenceString, { maxLength: 3 })), { maxLength: 4 }),
);

const arbAxeNode = fc.record({
  html: arbEvidenceString,
  target: arbTarget,
  failureSummary: arbEvidenceString,
});

function assertClean(value: string): void {
  for (const re of SECRET_PATTERNS) expect(re.test(value), `secret ${re} in ${JSON.stringify(value)}`).toBe(false);
  expect(hasResidualPath(value), `path in ${JSON.stringify(value)}`).toBe(false);
  expect(BAD_CONTROL.test(value), `control in ${JSON.stringify(value)}`).toBe(false);
}

describe("Feature: dashboard-usability-overhaul — evidence sanitization", () => {
  // Feature: dashboard-usability-overhaul, Property 1: Published element evidence is clean
  // **Validates: Requirements 1.4, 1.8, 1.10, 17.6**
  it("Property 1: Published element evidence is clean", () => {
    fc.assert(
      fc.property(fc.array(arbAxeNode, { minLength: 1, maxLength: 4 }), (nodes) => {
        const ev = buildViolationEvidence({ id: "rule", nodes });
        for (const n of ev.nodes) {
          for (const f of ["html", "target", "failureSummary"] as const) {
            if (n.withheld.includes(f)) {
              expect(n[f]).toBe("[withheld]");
            } else {
              assertClean(n[f]);
              expect(n[f]).not.toBe("[withheld]");
            }
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  // Feature: dashboard-usability-overhaul, Property 1: Published element evidence is clean
  it("Property 1 (direct): sanitizeEvidenceText output is clean or withheld", () => {
    fc.assert(
      fc.property(arbEvidenceString, fc.integer({ min: 0, max: 700 }), (raw, max) => {
        const r = sanitizeEvidenceText(raw, max);
        if (r.withheld) expect(r.value).toBe("[withheld]");
        else assertClean(r.value);
      }),
      { numRuns: 200 },
    );
  });

  // Feature: dashboard-usability-overhaul, Property 2: Evidence caps and counts are exact
  // **Validates: Requirements 1.1, 1.2, 1.3, 1.5, 1.6**
  it("Property 2: Evidence caps and counts are exact", () => {
    const safeChar = fc.constantFrom(..."abcdefghij klmnop<>=/-.#".split(""));
    // Single-space-separated words so collapseSpaces never changes length; no secrets/paths.
    const word = fc.stringOf(fc.constantFrom(..."abcdefghijklmnop<>=-.#".split("")), { minLength: 1, maxLength: 20 });
    const text = (maxWords: number) =>
      fc.array(word, { maxLength: maxWords }).map((a) => a.join(" "));
    void safeChar;
    const arbNode = fc.record({
      html: text(200), // up to ~4000 chars
      target: text(60),
      failureSummary: text(120),
    });
    const tagArb = fc.oneof(
      fc.integer({ min: 1, max: 999 }).map((n) => `wcag${n}`),
      fc.constantFrom("wcag2a", "wcag21aa", "best-practice", "cat.color", "wcag2aa", "section508"),
    );
    fc.assert(
      fc.property(
        fc.array(arbNode, { maxLength: 60 }),
        fc.array(tagArb, { maxLength: 8 }),
        fc.constantFrom("minor", "moderate", "serious", "critical"),
        (nodes, tags, impact) => {
          const v = {
            id: "color-contrast",
            impact,
            description: "desc here",
            help: "help text",
            helpUrl: "https://dequeuniversity.com/rules/axe/4.9/color-contrast",
            tags,
            nodes,
          };
          const ev = buildViolationEvidence(v);
          const caps = { html: 500, target: 300, failureSummary: 600 } as const;
          expect(ev.nodeCount).toBe(nodes.length);
          expect(ev.nodes.length).toBe(Math.min(nodes.length, 10));
          expect(ev.omittedNodeCount).toBe(ev.nodeCount - ev.nodes.length);
          ev.nodes.forEach((n, i) => {
            const src = nodes[i]!;
            const raw = {
              html: src.html,
              target: src.target,
              failureSummary: src.failureSummary,
            };
            for (const f of ["html", "target", "failureSummary"] as const) {
              expect(n.withheld).not.toContain(f);
              expect(Array.from(n[f]).length).toBeLessThanOrEqual(caps[f] + 3);
              const cut = Array.from(raw[f]).length > caps[f];
              expect(n.truncated.includes(f)).toBe(cut);
              if (cut) expect(n[f].endsWith("...")).toBe(true);
              else expect(n[f]).toBe(raw[f]);
            }
          });
          expect(ev.ruleId).toBe("color-contrast");
          expect(ev.impact).toBe(impact);
          expect(ev.description).toBe("desc here");
          expect(ev.help).toBe("help text");
          expect(ev.helpUrl).toBe(v.helpUrl);
          expect(ev.wcag).toEqual(tags.filter((t) => /^wcag\d+$/.test(t)).sort());
        },
      ),
      { numRuns: 150 },
    );
  });

  it("example: known secrets and paths are removed", () => {
    const r = sanitizeEvidenceText(
      "mail a@b.com Bearer abc.def C:\\Users\\x\\f.txt /home/u/p \\\\h\\s\\f 1234567890123456",
      DEFAULT_CAPS.maxFailureSummaryChars,
    );
    expect(r.withheld).toBe(false);
    assertClean(r.value);
  });
});