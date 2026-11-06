// Pure size budgeting and image-retention helpers for the Publisher.

export type CandidateRole = "json" | "diff" | "baseline" | "current" | "evidence";

export interface Candidate {
  path: string;
  bytes: number;
  role: CandidateRole;
  /** Lower value = more important within the same role tier. */
  priority: number;
  /** Set to false when the owning run is outside the image-retention window. */
  retained?: boolean;
}

export type DropReason = "run-cap" | "image-cap" | "image-retention";

export interface Dropped {
  path: string;
  role: string;
  reason: DropReason;
}

/** Minimal structural subset of PublishCaps needed here. */
export interface BudgetCaps {
  maxRunBytes: number;
  maxImageBytes: number;
}

export const DEFAULT_IMAGE_RETENTION_RUNS = 10;

const ROLE_RANK: Record<CandidateRole, number> = {
  json: 0,
  evidence: 1,
  diff: 2,
  baseline: 3,
  current: 4,
};

function isImage(role: CandidateRole): boolean {
  return role === "diff" || role === "baseline" || role === "current";
}

function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Keeps candidates in priority order (JSON, evidence, then images by priority and
 * diff/baseline/current) until the run cap is reached. Images outside the retention
 * window or over maxImageBytes are dropped first. Every non-kept candidate is recorded.
 */
export function selectWithinBudget(
  cands: Candidate[],
  caps: BudgetCaps,
): { keep: Candidate[]; dropped: Dropped[] } {
  const keep: Candidate[] = [];
  const dropped: Dropped[] = [];
  const eligible: Candidate[] = [];

  for (const c of cands) {
    if (isImage(c.role) && c.retained === false) {
      dropped.push({ path: c.path, role: c.role, reason: "image-retention" });
    } else if (isImage(c.role) && c.bytes > caps.maxImageBytes) {
      dropped.push({ path: c.path, role: c.role, reason: "image-cap" });
    } else {
      eligible.push(c);
    }
  }

  eligible.sort((a, b) => {
    const ja = a.role === "json" ? 0 : 1;
    const jb = b.role === "json" ? 0 : 1;
    if (ja !== jb) return ja - jb;
    const ea = a.role === "evidence" ? 0 : 1;
    const eb = b.role === "evidence" ? 0 : 1;
    if (ea !== eb) return ea - eb;
    if (a.priority !== b.priority) return a.priority - b.priority;
    if (ROLE_RANK[a.role] !== ROLE_RANK[b.role]) return ROLE_RANK[a.role] - ROLE_RANK[b.role];
    return cmpStr(a.path, b.path);
  });

  let used = 0;
  let full = false;
  for (const c of eligible) {
    if (!full && used + c.bytes <= caps.maxRunBytes) {
      keep.push(c);
      used += c.bytes;
    } else {
      full = true;
      dropped.push({ path: c.path, role: c.role, reason: "run-cap" });
    }
  }
  return { keep, dropped };
}

/** Image retention window size from AWG_IMAGE_RETENTION_RUNS (default 10). */
export function imageRetentionRuns(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.AWG_IMAGE_RETENTION_RUNS;
  if (raw === undefined || raw.trim() === "") return DEFAULT_IMAGE_RETENTION_RUNS;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : DEFAULT_IMAGE_RETENTION_RUNS;
}

function timeOf(s: string | null | undefined): number {
  if (!s) return Number.NEGATIVE_INFINITY;
  const t = Date.parse(s);
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

/**
 * The N most recent runs by finishedAt descending, then runId descending.
 * Missing or unparseable dates sort as oldest. Returns all runs when fewer than N.
 */
export function runsWithImages(
  runsNewestFirst: { runId: string; finishedAt: string | null }[],
  n: number = imageRetentionRuns(),
): Set<string> {
  const limit = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : DEFAULT_IMAGE_RETENTION_RUNS;
  const sorted = [...runsNewestFirst].sort((a, b) => {
    const ta = timeOf(a.finishedAt);
    const tb = timeOf(b.finishedAt);
    if (ta !== tb) return ta < tb ? 1 : -1;
    return cmpStr(b.runId, a.runId);
  });
  return new Set(sorted.slice(0, limit).map((r) => r.runId));
}