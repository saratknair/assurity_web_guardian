import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Validates: Requirements 15.2, 15.3, 15.4 (contrast of the console colour pairs)
const css = readFileSync(join(process.cwd(), "admin-ui", "console.css"), "utf8");

function rootTokens(): Record<string, string> {
  const m = /:root\s*\{([^}]*)\}/.exec(css);
  if (!m) throw new Error("no :root block in console.css");
  const out: Record<string, string> = {};
  for (const d of m[1].matchAll(/--([\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) out[d[1]] = d[2].toLowerCase();
  return out;
}

function luminance(hex: string): number {
  const ch = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const t = rootTokens();
const ALL = ["bg", "surface", "surface-2"];
const SURF = ["surface", "surface-2"];

const textPairs: Array<[string, string[]]> = [
  ["text", [...ALL, "selected", "code-bg"]],
  ["muted", ALL],
  ["link", [...ALL, "selected"]],
  ["ok", SURF],
  ["moderate", SURF],
  ["error", SURF],
  ["code-text", ["code-bg"]],
];

describe("console contrast tokens", () => {
  it("parses hex custom properties from :root", () => {
    for (const k of ["bg", "surface", "surface-2", "code-bg", "selected", "text", "focus", "border-strong", "on-accent"]) {
      expect(t[k], `--${k}`).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  for (const [fg, bgs] of textPairs) {
    for (const bg of bgs) {
      it(`--${fg} on --${bg} >= 4.5:1 (normal text)`, () => {
        expect(ratio(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it("--on-accent on --link fill >= 4.5:1 (primary button, skip link)", () => {
    expect(ratio(t["on-accent"], t["link"])).toBeGreaterThanOrEqual(4.5);
  });

  for (const fg of ["focus", "border-strong", "error"]) {
    for (const bg of ALL) {
      it(`--${fg} on --${bg} >= 3:1 (UI / large text)`, () => {
        expect(ratio(t[fg], t[bg])).toBeGreaterThanOrEqual(3);
      });
    }
  }

  it("keeps the 3px focus ring and has no external resources", () => {
    expect(css).toMatch(/outline:\s*3px solid var\(--focus\)/);
    expect(css).not.toMatch(/url\(|@import|https?:\/\//i);
    expect(/^[\x00-\x7F]*$/.test(css)).toBe(true);
  });
});
