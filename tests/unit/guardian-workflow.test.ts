import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// Smoke test: text assertions on the CI workflow (no YAML parser).
// Requirements: 13.1, 13.2, 13.14
const raw = readFileSync(".github/workflows/guardian.yml", "utf8");
// Non-comment lines only, so explanatory comments ("never -f") do not trip checks.
const code = raw
  .split(/\r?\n/)
  .filter((l) => !/^\s*#/.test(l))
  .join("\n");

describe("guardian.yml workflow smoke test", () => {
  it("restores a11y history before running Guardian", () => {
    const restore = code.indexOf("- name: Restore a11y history");
    const run = code.indexOf("- name: Run Guardian");
    expect(restore).toBeGreaterThan(-1);
    expect(run).toBeGreaterThan(-1);
    expect(restore).toBeLessThan(run);
  });

  it("uploads and downloads the a11y history between jobs", () => {
    expect(code).toContain("- name: Upload a11y history");
    expect(code).toContain("- name: Download a11y history");
  });

  it("commit job stages artifacts/a11y-history.json", () => {
    const commitJob = code.slice(code.indexOf("commit-runs-data:\n"));
    expect(commitJob).toMatch(/git add -- artifacts\/a11y-history\.json/);
  });

  it("writes the static-mode config into the published site", () => {
    expect(code).toContain('window.AWG_MODE = "static"');
    expect(code).toContain("./_site/config.js");
  });

  it("never force-pushes", () => {
    expect(code).not.toMatch(/push\s+(.*\s)?(-f|--force|--force-with-lease)\b/);
    expect(code).not.toContain("--force-with-lease");
    const pushLines = code.split("\n").filter((l) => /\bgit push\b/.test(l));
    expect(pushLines.length).toBeGreaterThan(0);
    for (const l of pushLines) expect(l).not.toMatch(/\s-f\b|--force/);
  });

  it("keeps every action pinned to a 40-hex SHA", () => {
    const uses = [...code.matchAll(/^\s*(?:-\s+)?uses:\s*(\S+)/gm)].map((m) => m[1]);
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(u).toMatch(/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/);
  });
});
