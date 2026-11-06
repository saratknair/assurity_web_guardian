import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { updateHistory, type TrackedFinding, type A11yViolationInput } from "./a11y-history.js";
import { emptyHistory, migrateV1, type HistoryV2, type HistoryStatus } from "./a11y-lifecycle.js";

/**
 * Persistent accessibility history across runs (Phase 3). Reads the prior
 * history file, merges the current run's violations, and writes it back WITHOUT
 * rewriting past run evidence. Human dispositions already recorded are kept.
 *
 * The file may be a legacy v1 map (fingerprint -> TrackedFinding) or a v2
 * document ({ schemaVersion: 2, runs, findings }).
 */
const HISTORY_PATH = "artifacts/a11y-history.json";

export interface LoadedHistory {
  status: HistoryStatus;
  history: HistoryV2;
}

function isV2(x: unknown): x is HistoryV2 {
  return !!x && typeof x === "object" && (x as { schemaVersion?: unknown }).schemaVersion === 2
    && typeof (x as { findings?: unknown }).findings === "object" && (x as { findings?: unknown }).findings !== null;
}

/** Read raw JSON: undefined = missing file, null = unreadable/unparseable. */
function readRaw(path: string): unknown | undefined | null {
  const full = resolve(path);
  if (!existsSync(full)) return undefined;
  try {
    return JSON.parse(readFileSync(full, "utf8")) as unknown;
  } catch {
    return null;
  }
}

/** Load history as v2 (v1 files are migrated in memory). Parse failure is `unavailable`. */
export function loadA11yHistory(path = HISTORY_PATH): LoadedHistory {
  const raw = readRaw(path);
  if (raw === undefined) return { status: "first-run", history: emptyHistory() };
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { status: "unavailable", history: emptyHistory() };
  }
  if (isV2(raw)) return { status: "restored", history: raw };
  return { status: "restored", history: migrateV1(raw as Record<string, TrackedFinding>) };
}

/** Atomic write: temp file in the same directory, then rename. */
export function saveA11yHistory(history: HistoryV2 | Record<string, TrackedFinding>, path = HISTORY_PATH): void {
  const full = resolve(path);
  mkdirSync(dirname(full), { recursive: true });
  const tmp = `${full}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(history, null, 2), "utf8");
    renameSync(tmp, full);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* ignore */ }
    throw e;
  }
}

/** v1-style `Record<string, TrackedFinding>` view of a v1 or v2 history file. */
export function readHistoryFindings(path = HISTORY_PATH): Record<string, TrackedFinding> {
  const raw = readRaw(path);
  if (raw === undefined || raw === null || typeof raw !== "object" || Array.isArray(raw)) return {};
  if (!isV2(raw)) return raw as Record<string, TrackedFinding>;
  const out: Record<string, TrackedFinding> = {};
  for (const [key, e] of Object.entries(raw.findings)) {
    const t: TrackedFinding = {
      fingerprint: e.fingerprint ?? key,
      ruleId: e.ruleId,
      pageUrl: e.pageUrl,
      viewport: e.viewport,
      impact: e.impact,
      firstSeen: e.firstSeen,
      lastSeen: e.lastSeen,
      occurrenceCount: e.occurrenceCount,
      runsSeen: [...(e.runsSeen ?? [])],
      state: e.state,
    };
    if (e.help !== undefined) t.help = e.help;
    if (e.helpUrl !== undefined) t.helpUrl = e.helpUrl;
    if (e.humanDisposition !== undefined) t.humanDisposition = e.humanDisposition;
    if (e.resolutionDate !== undefined) t.resolutionDate = e.resolutionDate;
    out[key] = t;
  }
  return out;
}

export function mergeRunIntoHistory(
  violations: A11yViolationInput[],
  runId: string,
  ts: string,
  path = HISTORY_PATH,
): { history: Record<string, TrackedFinding>; summary: Record<string, number> } {
  const prior = readHistoryFindings(path);
  const history = updateHistory(prior, violations, runId, ts);
  saveA11yHistory(history, path);
  const summary: Record<string, number> = {};
  for (const f of Object.values(history)) summary[f.state] = (summary[f.state] ?? 0) + 1;
  return { history, summary };
}