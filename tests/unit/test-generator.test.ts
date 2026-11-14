import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateTestFromBaseline, writeTestManifest } from "../../src/agents/test-generator.js";

let root: string;
let baselinesRoot: string;
let outDir: string;
let prevCwd: string;

// Relative output paths resolve against the working directory, so each test runs
// inside its temp root and never writes into the repository's tests/generated.
beforeEach(() => {
  prevCwd = process.cwd();
  root = mkdtempSync(join(tmpdir(), "awg-tg-"));
  baselinesRoot = join(root, "baselines");
  outDir = join(root, "tests", "generated");
  mkdirSync(join(baselinesRoot, "example-com"), { recursive: true });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(baselinesRoot, "example-com", "baseline.v2.md"),
    "# Baseline\nExpect all 12 images to load.\n",
    "utf8",
  );
  process.chdir(root);
});

afterEach(() => {
  process.chdir(prevCwd);
  rmSync(root, { recursive: true, force: true });
});

describe("test-manifest path migration", () => {
  it("stores a repo-relative specPath with forward slashes and no absolute prefix", () => {
    const outRel = "tests/generated";
    const gen = generateTestFromBaseline("example-com", "https://example.com/", baselinesRoot, outRel);

    expect(gen.specPath).toBe("tests/generated/example-com.baseline-v2.spec.ts");
    // No Windows drive letter, no UNC, no POSIX absolute, no backslashes.
    expect(gen.specPath).not.toMatch(/^[A-Za-z]:[\\/]/);
    expect(gen.specPath).not.toMatch(/^\\\\/);
    expect(gen.specPath.startsWith("/")).toBe(false);
    expect(gen.specPath).not.toContain("\\");
  });

  it("still writes the actual spec file to disk (behavior unchanged)", () => {
    const gen = generateTestFromBaseline("example-com", "https://example.com/", baselinesRoot, outDir);
    const expectedAbs = join(outDir, "example-com.baseline-v2.spec.ts");
    expect(existsSync(expectedAbs)).toBe(true);
    // Even when outDir is absolute, the stored path is normalized to forward slashes.
    expect(gen.specPath).not.toContain("\\");
  });

  it("writes a manifest whose specPath entries contain no absolute paths", () => {
    const runDir = join(root, "run");
    mkdirSync(runDir, { recursive: true });
    const gen = generateTestFromBaseline("example-com", "https://example.com/", baselinesRoot, "tests/generated");
    const manifestPath = writeTestManifest(runDir, [gen]);

    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      tests: { slug: string; specPath: string }[];
    };
    for (const t of manifest.tests) {
      expect(t.specPath).toMatch(/^tests\/generated\//);
      expect(t.specPath).not.toMatch(/^[A-Za-z]:[\\/]/);
      expect(t.specPath).not.toContain("\\");
    }
  });
});
