import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  STRICT_ENV,
  isStrict,
  inspectInstance,
  missingPublishedData,
  missingSite,
  decideSkip,
  // @ts-expect-error plain .mjs module without type declarations
} from "../../scripts/lib/instance-data.mjs";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "inst-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("isStrict", () => {
  it("is off when unset, empty, 0 or false", () => {
    expect(isStrict({})).toBe(false);
    expect(isStrict({ [STRICT_ENV]: "" })).toBe(false);
    expect(isStrict({ [STRICT_ENV]: "0" })).toBe(false);
    expect(isStrict({ [STRICT_ENV]: "false" })).toBe(false);
  });
  it("is on for 1", () => {
    expect(isStrict({ [STRICT_ENV]: "1" })).toBe(true);
  });
});

describe("inspectInstance", () => {
  it("reports nothing for an empty repo", () => {
    expect(inspectInstance(dir)).toEqual({ hasConfig: false, hasRuns: false, hasBaselines: false });
  });
  it("sees config, runs and baselines when present", () => {
    mkdirSync(join(dir, "config"));
    writeFileSync(join(dir, "config", "app.config.json"), "{}");
    mkdirSync(join(dir, "artifacts", "runs", "run_1"), { recursive: true });
    mkdirSync(join(dir, "baselines", "site"), { recursive: true });
    expect(inspectInstance(dir)).toEqual({ hasConfig: true, hasRuns: true, hasBaselines: true });
  });
  it("does not count empty runs or baselines directories", () => {
    mkdirSync(join(dir, "artifacts", "runs"), { recursive: true });
    mkdirSync(join(dir, "baselines"));
    const r = inspectInstance(dir);
    expect(r.hasRuns).toBe(false);
    expect(r.hasBaselines).toBe(false);
  });
});

describe("missingPublishedData and missingSite", () => {
  it("names a missing site directory", () => {
    const site = join(dir, "_site");
    expect(missingPublishedData(site)).toHaveLength(1);
    expect(missingSite(site)).toHaveLength(1);
  });
  it("names a site without data/index.json", () => {
    mkdirSync(join(dir, "_site"));
    expect(missingPublishedData(join(dir, "_site"))[0]).toContain("data/index.json");
    expect(missingSite(join(dir, "_site"))).toEqual([]);
  });
  it("is empty when published data exists", () => {
    mkdirSync(join(dir, "_site", "data"), { recursive: true });
    writeFileSync(join(dir, "_site", "data", "index.json"), "{}");
    expect(missingPublishedData(join(dir, "_site"))).toEqual([]);
  });
});

describe("decideSkip", () => {
  it("runs when nothing is missing", () => {
    expect(decideSkip([], {}).action).toBe("run");
  });
  it("skips with exit 0 and the standard message", () => {
    const d = decideSkip(["published data"], {});
    expect(d).toEqual({ action: "skip", exitCode: 0, message: "skipped: no instance data (published data)" });
  });
  it("fails with exit 1 in strict mode", () => {
    const d = decideSkip(["a", "b"], { [STRICT_ENV]: "1" });
    expect(d.action).toBe("fail");
    expect(d.exitCode).toBe(1);
    expect(d.message).toContain("a, b");
  });
});
