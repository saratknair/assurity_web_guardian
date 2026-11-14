import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
// @ts-expect-error plain .mjs script without type declarations
import { checkVendored, hashFile, parseVendoredTable } from "../../scripts/dev/hash-vendored.mjs";

const root = resolve(__dirname, "..", "..");

describe("hash-vendored", () => {
  it("matches every vendored file against docs/VENDORED.md", () => {
    const md = readFileSync(join(root, "docs", "VENDORED.md"), "utf8");
    expect(checkVendored(root, md)).toEqual([]);
  });

  it("parses path and hash from table rows only", () => {
    const hash = "a".repeat(64);
    const md = `| Name | File | SHA-256 |\n|---|---|---|\n| x | \`v/x.js\` | ${hash} |\nplain text`;
    expect([...parseVendoredTable(md)]).toEqual([["v/x.js", hash]]);
  });

  it("detects a tampered, unrecorded and missing file", () => {
    const dir = mkdtempSync(join(tmpdir(), "vendored-"));
    try {
      mkdirSync(join(dir, "v"));
      writeFileSync(join(dir, "v", "a.js"), "one");
      writeFileSync(join(dir, "v", "b.js"), "two");
      const row = (f: string, h: string) => `| n | \`${f}\` | ${h} |`;
      const good = [row("v/a.js", hashFile(join(dir, "v", "a.js"))), row("v/b.js", hashFile(join(dir, "v", "b.js")))].join("\n");
      expect(checkVendored(dir, good, ["v"])).toEqual([]);

      writeFileSync(join(dir, "v", "a.js"), "tampered");
      expect(checkVendored(dir, good, ["v"]).join("\n")).toContain("v/a.js: hash mismatch");

      writeFileSync(join(dir, "v", "c.js"), "three");
      expect(checkVendored(dir, good, ["v"]).join("\n")).toContain("v/c.js: not recorded");

      const withGhost = good + "\n" + row("v/gone.js", "b".repeat(64));
      expect(checkVendored(dir, withGhost, ["v"]).join("\n")).toContain("v/gone.js: recorded but file is missing");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
