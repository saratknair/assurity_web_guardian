import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { updateHistory, type TrackedFinding, type A11yViolationInput } from "./a11y-history.js";

/**
 * Persistent accessibility history across runs (Phase 3). Reads the prior
 * history file, merges the current run's violations, and writes it back WITHOUT
 * rewriting past run evidence. Human dispositions already recorded are kept.
 */
const HISTORY_PATH = "artifacts/a11y-history.json";

export function loadA11yHistory(path = HISTORY_PATH): Record<string, TrackedFinding> {
  const full = resolve(path);
  if (!existsSync(full)) return {};
  try {
    return JSON.parse(readFileSync(full, "utf8")) as Record<string, TrackedFinding>;
  } catch {
    return {};
  }
}

export function saveA11yHistory(history: Record<string, TrackedFinding>, path = HISTORY_PATH): void {
  const full = resolve(path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, JSON.stringify(history, null, 2), "utf8");
}

export function mergeRunIntoHistory(
  violations: A11yViolationInput[],
  runId: string,
  ts: string,
  path = HISTORY_PATH,
): { history: Record<string, TrackedFinding>; summary: Record<string, number> } {
  const prior = loadA11yHistory(path);
  const history = updateHistory(prior, violations, runId, ts);
  saveA11yHistory(history, path);
  const summary: Record<string, number> = {};
  for (const f of Object.values(history)) summary[f.state] = (summary[f.state] ?? 0) + 1;
  return { history, summary };
}
