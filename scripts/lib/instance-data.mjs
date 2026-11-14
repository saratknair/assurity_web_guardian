// Helpers for scripts that need instance data (config, baselines, runs,
// published site data). A fresh product copy has none of it, so those scripts
// report "skipped" and exit 0. Setting GUARDIAN_REQUIRE_INSTANCE_DATA=1 turns
// every skip into a failure, which CI uses so a missing input cannot hide a
// broken pipeline.

import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

export const STRICT_ENV = "GUARDIAN_REQUIRE_INSTANCE_DATA";

/** Pure. True when the strict-mode variable is set to a truthy value. */
export function isStrict(env = process.env) {
  const v = env && env[STRICT_ENV];
  return typeof v === "string" && v.trim() !== "" && v.trim() !== "0" && v.trim().toLowerCase() !== "false";
}

function hasSubdirectory(dir) {
  try {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) return false;
    return readdirSync(dir).some((n) => statSync(join(dir, n)).isDirectory());
  } catch {
    return false;
  }
}

/**
 * Inspects a repo root for the instance inputs verify.mjs depends on.
 * Returns { hasConfig, hasRuns, hasBaselines }.
 */
export function inspectInstance(root = ".") {
  const base = resolve(root);
  return {
    hasConfig: existsSync(join(base, "config", "app.config.json")),
    hasRuns: hasSubdirectory(join(base, "artifacts", "runs")),
    hasBaselines: hasSubdirectory(join(base, "baselines")),
  };
}

/** Lists what a site scan is missing: the published data index under siteDir. */
export function missingPublishedData(siteDir) {
  const dir = resolve(siteDir);
  if (!existsSync(dir)) return ["site directory " + siteDir];
  if (!existsSync(join(dir, "data", "index.json"))) return ["published data " + siteDir + "/data/index.json"];
  return [];
}

/** Lists what the size gate is missing: the built site directory. */
export function missingSite(siteDir) {
  const dir = resolve(siteDir);
  return existsSync(dir) && statSync(dir).isDirectory() ? [] : ["site directory " + siteDir];
}

/**
 * Pure. Decides what a script does given the missing inputs.
 * Returns { action: "run" | "skip" | "fail", exitCode, message }.
 */
export function decideSkip(missing, env = process.env) {
  if (!Array.isArray(missing) || missing.length === 0) return { action: "run", exitCode: 0, message: "" };
  const what = missing.join(", ");
  if (isStrict(env)) {
    return { action: "fail", exitCode: 1, message: "FAIL: instance data required but missing (" + what + ")" };
  }
  return { action: "skip", exitCode: 0, message: "skipped: no instance data (" + what + ")" };
}
