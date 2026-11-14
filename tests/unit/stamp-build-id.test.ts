import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  toBuildId,
  stampHtml,
  stampSite,
  // @ts-expect-error plain .mjs module without type declarations
} from "../../scripts/stamp-build-id.mjs";

const html = [
  '<link rel="stylesheet" href="./style.css" />',
  '<script src="./vendor/chart.umd.min.js" defer></script>',
  '<script type="module" src="./app.js"></script>',
  '<script src="https://cdn.example.com/x.js"></script>',
  '<script src="/abs.js"></script>',
  '<link rel="icon" href="./favicon.ico" />',
].join("\n");

describe("stamp-build-id", () => {
  it("derives a 7-char build id and rejects invalid values", () => {
    expect(toBuildId("0123456789abcdef0123456789abcdef01234567")).toBe("0123456");
    expect(toBuildId("not-a-sha")).toBeNull();
    expect(toBuildId(undefined)).toBeNull();
  });

  it("stamps relative script and stylesheet URLs only", () => {
    const out = stampHtml(html, "abc1234");
    expect(out).toContain('href="./style.css?v=abc1234"');
    expect(out).toContain('src="./vendor/chart.umd.min.js?v=abc1234"');
    expect(out).toContain('src="./app.js?v=abc1234"');
    expect(out).toContain('src="https://cdn.example.com/x.js"');
    expect(out).toContain('src="/abs.js"');
    expect(out).toContain('href="./favicon.ico"');
  });

  it("does not double-stamp", () => {
    const once = stampHtml(html, "abc1234");
    expect(stampHtml(once, "abc1234")).toBe(once);
  });

  it("leaves HTML unchanged for an invalid build id", () => {
    expect(stampHtml(html, "nope")).toBe(html);
  });

  it("stamps both entry pages in a site folder and skips invalid ids", () => {
    const dir = mkdtempSync(join(tmpdir(), "awg-stamp-"));
    try {
      mkdirSync(join(dir, "office"));
      writeFileSync(join(dir, "index.html"), html);
      writeFileSync(join(dir, "office", "index.html"), html);
      expect(stampSite(dir, "zzz").stamped).toEqual([]);
      const res = stampSite(dir, "abcdef0123456789");
      expect(res.stamped).toEqual(["index.html", "office/index.html"]);
      expect(readFileSync(join(dir, "office", "index.html"), "utf8")).toContain("app.js?v=abcdef0");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
