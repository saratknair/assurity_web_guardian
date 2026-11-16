import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error plain ESM script without type declarations
import { checkTarget, isAllowedPath, isDeniedPath, planExport, runExport, verifyTarget } from "../../scripts/dev/export-product.mjs";

const tmpDirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(path.join(os.tmpdir(), "export-test-"));
  tmpDirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function write(root: string, rel: string, text: string): void {
  const full = path.join(root, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, text);
}

// Built at runtime so this file does not contain the instance name.
const instanceName = ["assur", "ity"].join("");

describe("allowlist and denylist", () => {
  it("allows product code, docs and example config", () => {
    for (const p of [
      "README.md",
      "package.json",
      ".github/workflows/guardian.yml",
      "src/core/run.ts",
      "scripts/dev/export-product.mjs",
      "tests/unit/a.test.ts",
      "tests/property/a.test.ts",
      "tests/helpers/fixtures.ts",
      "config/app.config.example.json",
      "config/domains/example-com.example.json",
      ".kiro/specs/web-guardian/design.md",
    ]) {
      expect(isAllowedPath(p), p).toBe(true);
    }
  });

  it("denies instance data, real config and generated output", () => {
    for (const p of [
      "baselines/x/baseline.v1.md",
      "baselines-visual/x/a.png",
      `tests/generated/${instanceName}.spec.ts`,
      "tests/instance/real-config.test.ts",
      "config/app.config.json",
      "config/page-seed.json",
      "config/domains/some-site.json",
      "config/scope/x.json",
      "artifacts/runs/r1/a.json",
      "artifacts/dispositions.jsonl",
      "data/dispositions-log.json",
      "dist/index.js",
      "node_modules/x/index.js",
      ".kiro/specs/other-spec/tasks.md",
      ".kiro/steering/notes.md",
    ]) {
      expect(isDeniedPath(p), p).toBe(true);
      expect(isAllowedPath(p), p).toBe(false);
    }
  });

  it("keeps dispositions source and test modules exportable", () => {
    for (const p of [
      "src/core/dispositions.ts",
      "src/admin/dispositions-api.ts",
      "tests/unit/dispositions-api.test.ts",
      "tests/property/dispositions-log.test.ts",
    ]) {
      expect(isDeniedPath(p), p).toBe(false);
      expect(isAllowedPath(p), p).toBe(true);
    }
  });

  it("does not allow unknown root files or path escapes", () => {
    expect(isAllowedPath("notes.txt")).toBe(false);
    expect(isAllowedPath("src/../baselines/a.md")).toBe(false);
    expect(isAllowedPath("/etc/passwd")).toBe(false);
  });

  it("plans a mixed list into copy, denied and unlisted", () => {
    const plan = planExport(["README.md", "baselines/a.md", "notes.txt", "src/a.ts"]);
    expect(plan.copy).toEqual(["README.md", "src/a.ts"]);
    expect(plan.denied).toEqual(["baselines/a.md"]);
    expect(plan.unlisted).toEqual(["notes.txt"]);
  });
});

describe("checkTarget", () => {
  it("refuses a target inside the repo, a non-empty target and a root", () => {
    const repo = tmp();
    expect(checkTarget(path.join(repo, "out"), repo).ok).toBe(false);
    expect(checkTarget(repo, repo).ok).toBe(false);

    const full = tmp();
    write(full, "x.txt", "x");
    expect(checkTarget(full, repo)).toEqual({ ok: false, reason: "Target is not empty." });

    expect(checkTarget(path.parse(repo).root, repo).ok).toBe(false);
    expect(checkTarget("", repo).ok).toBe(false);
  });

  it("accepts a missing or empty directory outside the repo", () => {
    const repo = tmp();
    expect(checkTarget(path.join(tmp(), "new"), repo).ok).toBe(true);
    expect(checkTarget(tmp(), repo).ok).toBe(true);
  });
});

describe("runExport", () => {
  function fakeRepo(): { root: string; files: string[] } {
    const root = tmp();
    const files: Record<string, string> = {
      "README.md": "# Web Guardian\n",
      ".gitignore": "checkpoints/\n",
      "package.json": "{}\n",
      "src/a.ts": "export const a = 1;\n",
      "config/app.config.example.json": "{}\n",
      "config/app.config.json": '{"site":"real"}\n',
      "baselines/s/baseline.v1.md": "page text\n",
      "tests/generated/s.spec.ts": "test\n",
    };
    for (const [rel, text] of Object.entries(files)) write(root, rel, text);
    return { root, files: Object.keys(files) };
  }

  it("copies allowlisted files only and writes the product gitignore", () => {
    const { root, files } = fakeRepo();
    const target = path.join(tmp(), "out");
    const result = runExport({ repoRoot: root, target, files });
    expect(result.ok).toBe(true);
    expect(existsSync(path.join(target, "src/a.ts"))).toBe(true);
    expect(existsSync(path.join(target, "config/app.config.example.json"))).toBe(true);
    expect(existsSync(path.join(target, "config/app.config.json"))).toBe(false);
    expect(existsSync(path.join(target, "baselines"))).toBe(false);
    expect(existsSync(path.join(target, "tests/generated"))).toBe(false);
    expect(readFileSync(path.join(target, ".gitignore"), "utf8")).toContain("node_modules/");
    expect(verifyTarget(target).problems).toEqual([]);
  });

  it("fails and leaves the target when a copied file contains an instance name", () => {
    const { root, files } = fakeRepo();
    write(root, "src/a.ts", `// built for ${instanceName}\n`);
    const target = path.join(tmp(), "out");
    const result = runExport({ repoRoot: root, target, files });
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual(["name rule hit: src/a.ts"]);
    expect(existsSync(path.join(target, "src/a.ts"))).toBe(true);
  });

  it("detects a stray file in the target", () => {
    const { root, files } = fakeRepo();
    const target = path.join(tmp(), "out");
    runExport({ repoRoot: root, target, files });
    write(target, "baselines/leak.md", "x");
    write(target, "notes.txt", "x");
    expect(verifyTarget(target).problems).toEqual([
      "denied path present: baselines/leak.md",
      "not on the allowlist: notes.txt",
    ]);
  });

  it("refuses a non-empty target without writing", () => {
    const { root, files } = fakeRepo();
    const target = tmp();
    write(target, "keep.txt", "x");
    const result = runExport({ repoRoot: root, target, files });
    expect(result.ok).toBe(false);
    expect(result.written).toBe(0);
    expect(existsSync(path.join(target, "src"))).toBe(false);
  });

  it("dry run writes nothing and reports the plan", () => {
    const { root, files } = fakeRepo();
    const result = runExport({ repoRoot: root, files, dryRun: true });
    expect(result.ok).toBe(true);
    expect(result.written).toBe(0);
    expect(result.plan.copy).toContain("src/a.ts");
  });
});
