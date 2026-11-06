import type { TrackedFinding } from "./a11y-history.js";

/**
 * Pure accessibility/finding lifecycle (dashboard-usability-overhaul, design section C).
 * No I/O. Identity key is `${pageUrl}|${viewport}|${ruleId}`.
 */
export type LifecycleState = "new" | "recurring" | "existing-unresolved" | "resolved";

export interface HistoryEntry {
  fingerprint: string; // equals the finding key
  ruleId: string;
  pageUrl: string;
  viewport: string;
  impact: string | null;
  help?: string;
  helpUrl?: string;
  firstSeen: string;
  lastSeen: string;
  occurrenceCount: number;
  runsSeen: string[];
  state: LifecycleState;
  lastSeenRun: string;
  resolvedRun?: string | null;
  resolutionDate?: string | null;
  humanDisposition?: "accepted" | "rejected" | "dismissed" | null;
}

export interface HistoryV2 {
  schemaVersion: 2;
  runs: string[];
  findings: Record<string, HistoryEntry>;
}

export interface CurrentFinding {
  key: string;
  ruleId: string;
  pageUrl: string;
  viewport: string;
  impact: string | null;
}

export interface RunObservation {
  runId: string;
  at: string;
  findings: CurrentFinding[];
  scanned: { pageUrl: string; viewport: string }[];
}

export type HistoryStatus = "restored" | "first-run" | "unavailable" | "not-recorded";

export interface LifecycleSnapshot {
  schemaVersion: 2;
  runId: string;
  historyStatus: HistoryStatus;
  states: Record<string, LifecycleState>;
  resolved: { key: string; pageUrl: string; viewport: string; ruleId: string; severity: string }[];
}

export function emptyHistory(): HistoryV2 {
  return { schemaVersion: 2, runs: [], findings: {} };
}

/** Transition table (R13.4-R13.7). `undefined` result means "no state". */
export function nextState(prev: LifecycleState | undefined, present: boolean): LifecycleState | undefined {
  if (present) {
    if (prev === undefined || prev === "resolved") return "new";
    return "recurring";
  }
  if (prev === undefined) return undefined;
  return "resolved";
}

function severityOf(impact: string | null): string {
  return impact === "critical" || impact === "serious" || impact === "moderate" || impact === "minor"
    ? impact
    : "unrated";
}

function cloneEntry(e: HistoryEntry): HistoryEntry {
  return { ...e, runsSeen: [...e.runsSeen] };
}

function cloneHistory(h: HistoryV2): HistoryV2 {
  const findings: Record<string, HistoryEntry> = {};
  for (const [k, v] of Object.entries(h.findings)) findings[k] = cloneEntry(v);
  return { schemaVersion: 2, runs: [...h.runs], findings };
}

function snapshotFor(history: HistoryV2, runId: string, historyStatus: HistoryStatus): LifecycleSnapshot {
  const states: Record<string, LifecycleState> = {};
  const resolved: LifecycleSnapshot["resolved"] = [];
  for (const key of Object.keys(history.findings).sort()) {
    const e = history.findings[key];
    if (e.resolvedRun === runId && e.state === "resolved") {
      resolved.push({ key, pageUrl: e.pageUrl, viewport: e.viewport, ruleId: e.ruleId, severity: severityOf(e.impact) });
    } else if (e.lastSeenRun === runId && e.runsSeen.includes(runId) && e.state !== "resolved") {
      states[key] = e.state;
    }
  }
  return { schemaVersion: 2, runId, historyStatus, states, resolved };
}

/**
 * Apply one run. Idempotent by run id (re-applying returns an equal history and
 * the same snapshot). Append-only: entries are never removed.
 */
export function applyRun(
  history: HistoryV2,
  obs: RunObservation,
  historyStatus: HistoryStatus = "restored",
): { history: HistoryV2; snapshot: LifecycleSnapshot } {
  if (history.runs.includes(obs.runId)) {
    const same = cloneHistory(history);
    return { history: same, snapshot: snapshotFor(same, obs.runId, historyStatus) };
  }
  const next = cloneHistory(history);
  next.runs.push(obs.runId);

  const scanned = new Set(obs.scanned.map((s) => `${s.pageUrl}|${s.viewport}`));
  const presentKeys = new Set<string>();

  for (const f of obs.findings) {
    if (presentKeys.has(f.key)) continue;
    presentKeys.add(f.key);
    const prev = next.findings[f.key];
    const state = nextState(prev?.state, true) as LifecycleState;
    if (!prev) {
      next.findings[f.key] = {
        fingerprint: f.key, ruleId: f.ruleId, pageUrl: f.pageUrl, viewport: f.viewport, impact: f.impact,
        firstSeen: obs.at, lastSeen: obs.at, occurrenceCount: 1, runsSeen: [obs.runId],
        state, lastSeenRun: obs.runId, resolvedRun: null, resolutionDate: null,
      };
    } else {
      prev.impact = f.impact;
      prev.lastSeen = obs.at;
      prev.lastSeenRun = obs.runId;
      prev.occurrenceCount += 1;
      if (!prev.runsSeen.includes(obs.runId)) prev.runsSeen.push(obs.runId);
      prev.state = state;
      prev.resolvedRun = null;
      prev.resolutionDate = null;
    }
  }

  for (const [key, e] of Object.entries(next.findings)) {
    if (presentKeys.has(key)) continue;
    if (!scanned.has(`${e.pageUrl}|${e.viewport}`)) continue; // not scanned: unchanged
    if (e.state === "resolved") continue; // stays resolved, not re-reported
    e.state = nextState(e.state, false) as LifecycleState;
    e.resolvedRun = obs.runId;
    e.resolutionDate = obs.at;
  }

  return { history: next, snapshot: snapshotFor(next, obs.runId, historyStatus) };
}

const V1_MAP: Record<string, LifecycleState> = {
  new: "new",
  recurring: "recurring",
  "existing-unresolved": "existing-unresolved",
  resolved: "resolved",
  reopened: "new",
  "dismissed-reappeared": "recurring",
};

/** Convert the legacy per-fingerprint map into a v2 history keyed by page|viewport|rule. */
export function migrateV1(v1: Record<string, TrackedFinding>): HistoryV2 {
  const groups = new Map<string, TrackedFinding[]>();
  for (const f of Object.values(v1 ?? {})) {
    const key = `${f.pageUrl}|${f.viewport}|${f.ruleId}`;
    const g = groups.get(key);
    if (g) g.push(f);
    else groups.set(key, [f]);
  }
  const findings: Record<string, HistoryEntry> = {};
  const runs: string[] = [];
  const seenRuns = new Set<string>();
  for (const key of [...groups.keys()].sort()) {
    const g = groups.get(key)!.slice().sort((a, b) => (a.lastSeen < b.lastSeen ? -1 : a.lastSeen > b.lastSeen ? 1 : 0));
    const latest = g[g.length - 1];
    const runsSeen: string[] = [];
    for (const f of g) for (const r of f.runsSeen ?? []) if (!runsSeen.includes(r)) runsSeen.push(r);
    for (const r of runsSeen) if (!seenRuns.has(r)) { seenRuns.add(r); runs.push(r); }
    const entry: HistoryEntry = {
      fingerprint: key,
      ruleId: latest.ruleId,
      pageUrl: latest.pageUrl,
      viewport: latest.viewport,
      impact: latest.impact ?? null,
      firstSeen: g.map((f) => f.firstSeen).sort()[0],
      lastSeen: latest.lastSeen,
      occurrenceCount: g.reduce((n, f) => n + (f.occurrenceCount ?? 0), 0),
      runsSeen,
      state: V1_MAP[latest.state] ?? "recurring",
      lastSeenRun: runsSeen.length ? runsSeen[runsSeen.length - 1] : "",
      resolvedRun: null,
      resolutionDate: latest.resolutionDate ?? null,
    };
    if (latest.help !== undefined) entry.help = latest.help;
    if (latest.helpUrl !== undefined) entry.helpUrl = latest.helpUrl;
    if (latest.humanDisposition !== undefined) entry.humanDisposition = latest.humanDisposition;
    findings[key] = entry;
  }
  return { schemaVersion: 2, runs, findings };
}