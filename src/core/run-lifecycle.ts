import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildRunFindingSet, findingKey } from "./finding-model.js";
import { applyRun, emptyHistory, type CurrentFinding, type HistoryStatus, type LifecycleSnapshot } from "../agents/a11y-lifecycle.js";
import { loadA11yHistory, saveA11yHistory } from "../agents/a11y-history-store.js";

export interface LifecycleTel {
  event(kind: string, extra?: { message?: string; data?: Record<string, unknown> }): void;
  audit(event: { type: string; reason: string; detail?: string }): void;
}

export interface LifecycleResult {
  snapshot: LifecycleSnapshot;
  historyStatus: HistoryStatus;
  summary: Record<string, number>;
  migrated: boolean;
}

function readJson(path: string): unknown | null {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/** CI-written status marker. undefined = no marker; "unavailable" if the marker is unreadable. */
function readStatusFile(statusPath: string): HistoryStatus | undefined {
  if (!existsSync(statusPath)) return undefined;
  const j = readJson(statusPath) as { status?: unknown } | null;
  const s = j && typeof j === "object" ? j.status : undefined;
  return s === "restored" || s === "first-run" || s === "unavailable" ? s : "unavailable";
}

/** key -> axe impact, from the raw accessibility files of the run. */
function readImpacts(runDir: string): Map<string, string | null> {
  const out = new Map<string, string | null>();
  const dir = join(runDir, "accessibility");
  if (!existsSync(dir)) return out;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    const m = /^(.*)\.(desktop|mobile)\.json$/.exec(file);
    const raw = readJson(join(dir, file)) as { url?: unknown; violations?: unknown } | null;
    if (!m || !raw || typeof raw.url !== "string" || !Array.isArray(raw.violations)) continue;
    for (const v of raw.violations as { id?: unknown; impact?: unknown }[]) {
      if (v && typeof v.id === "string") {
        out.set(findingKey({ pageUrl: raw.url, viewport: m[2] as "desktop" | "mobile", ruleId: v.id }), typeof v.impact === "string" ? v.impact : null);
      }
    }
  }
  return out;
}

/**
 * Build the run observation, apply it to the v2 history, write
 * `<runDir>/lifecycle.json`, and (unless unavailable) save the history atomically.
 */
export function computeLifecycleForRun(
  runDir: string,
  runId: string,
  at: string,
  scanned: { pageUrl: string; viewport: string }[],
  historyPath: string,
  statusPath: string,
  tel?: LifecycleTel,
): LifecycleResult {
  const loaded = loadA11yHistory(historyPath);
  const fileStatus = readStatusFile(statusPath);
  let status: HistoryStatus = fileStatus ?? loaded.status;
  if (loaded.status === "unavailable") status = "unavailable";

  if (status === "unavailable") {
    const snapshot: LifecycleSnapshot = { schemaVersion: 2, runId, historyStatus: "unavailable", states: {}, resolved: [] };
    writeFileSync(join(runDir, "lifecycle.json"), JSON.stringify(snapshot, null, 2), "utf8");
    tel?.event("a11y.history.unavailable", { message: "A11y history could not be restored; lifecycle not recorded for this run." });
    return { snapshot, historyStatus: status, summary: {}, migrated: false };
  }

  let migrated = false;
  if (existsSync(historyPath)) {
    const raw = readJson(historyPath) as { schemaVersion?: unknown } | null;
    migrated = !!raw && typeof raw === "object" && raw.schemaVersion !== 2;
  }

  const impacts = readImpacts(runDir);
  const findings: CurrentFinding[] = [];
  for (const [key, kind] of buildRunFindingSet(runDir)) {
    const [pageUrl, viewport, ruleId] = splitKey(key);
    findings.push({ key, ruleId, pageUrl, viewport, impact: kind === "a11y-rule" ? impacts.get(key) ?? null : null });
  }

  const base = loaded.history ?? emptyHistory();
  const { history, snapshot } = applyRun(base, { runId, at, findings, scanned }, status);
  writeFileSync(join(runDir, "lifecycle.json"), JSON.stringify(snapshot, null, 2), "utf8");
  saveA11yHistory(history, historyPath);

  if (migrated) {
    tel?.audit({
      type: "migration",
      reason: "a11y-history.json converted from v1 to v2 (dashboard-usability-overhaul, R13)",
      detail: "Per-fingerprint entries collapsed to per-key entries; no entries removed.",
    });
  }

  const summary: Record<string, number> = {};
  for (const e of Object.values(history.findings)) summary[e.state] = (summary[e.state] ?? 0) + 1;
  return { snapshot, historyStatus: status, summary, migrated };
}

/** Split `${pageUrl}|${viewport}|${ruleId}`; page URLs may contain `|` only via encoding, so take from the right. */
function splitKey(key: string): [string, string, string] {
  const last = key.lastIndexOf("|");
  const mid = key.lastIndexOf("|", last - 1);
  return [key.slice(0, mid), key.slice(mid + 1, last), key.slice(last + 1)];
}
