import type { Lifecycle, Severity } from "../core/finding-model.js";
import type {
  BuiltRun,
  LifecycleCounts,
  PagePublished,
  PublishedFinding,
  RunFindingsFile,
  SeverityCounts,
} from "./run-findings.js";

/**
 * Pure per-page history and dashboard aggregates (design section B).
 * Requirements 8.1, 8.2, 9.5, 10.1, 16.5.
 */

/**
 * Mirrors `groupOfUrl` in dashboard/lib/pages.js exactly: new URL (throw ->
 * "(other)"); first non-empty path segment; decodeURIComponent in try/catch
 * (keep raw on failure); lowercase; no segment -> "(home)".
 */
export function pageGroupOf(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "(other)";
  }
  const segment = parsed.pathname.split("/").find((s) => s.length > 0);
  if (segment === undefined) return "(home)";
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    decoded = segment;
  }
  return decoded.toLowerCase();
}

export interface PageHistoryFinding {
  id: string;
  viewport: string;
  ruleId: string;
  severity: Severity;
  lifecycle: Lifecycle;
}

export interface PageHistoryResolved {
  viewport: string | null;
  ruleId: string | null;
  severity: string | null;
}

export interface PageHistoryRun {
  runId: string;
  finishedAt: string | null;
  total: number;
  hasRunData: boolean;
  bySeverity: SeverityCounts;
  findings: PageHistoryFinding[];
  resolved: PageHistoryResolved[];
}

export interface PageHistory {
  schemaVersion: 2;
  slug: string;
  pageUrl: string | null;
  runs: PageHistoryRun[];
}

export interface DashboardRunAggregate {
  runId: string;
  finishedAt: string | null;
  origin: string | null;
  trigger: string | null;
  pages: number;
  total: number;
  hasRunData: boolean;
  detailLevel: "rule" | "legacy";
  historyStatus: RunFindingsFile["historyStatus"];
  bySeverity: SeverityCounts;
  ignored: number;
  detected: number;
  hasImages: boolean;
  decisions: {
    status: string;
    ignoredNewThisRun: number;
    newThisRun: unknown[];
    [extra: string]: unknown;
  };
  byLifecycle: LifecycleCounts;
  resolved: number;
}

export interface LatestPageRow extends Omit<PagePublished, "highest"> {
  /** published as "none" when the page has no findings */
  highest: Severity | "none" | null;
  byLifecycle: LifecycleCounts;
}

const LIFECYCLE_KEY: Record<Lifecycle, keyof LifecycleCounts> = {
  new: "new",
  recurring: "recurring",
  "existing-unresolved": "existingUnresolved",
  regression: "regression",
  "not-recorded": "notRecorded",
};

function zeroSeverity(): SeverityCounts {
  return { critical: 0, serious: 0, moderate: 0, minor: 0, unrated: 0, notRecorded: 0 };
}
function zeroLifecycle(): LifecycleCounts {
  return { new: 0, recurring: 0, existingUnresolved: 0, regression: 0, notRecorded: 0 };
}
function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}

function chronological(runs: BuiltRun[]): BuiltRun[] {
  return runs
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const fa = a.r.runFindings.finishedAt ?? "";
      const fb = b.r.runFindings.finishedAt ?? "";
      if (fa !== fb) return fa < fb ? -1 : 1;
      const ia = a.r.runFindings.runId;
      const ib = b.r.runFindings.runId;
      if (ia !== ib) return ia < ib ? -1 : 1;
      return a.i - b.i;
    })
    .map((e) => e.r);
}

function resolvedForPage(resolved: unknown[], slug: string, pageUrl: string | null): PageHistoryResolved[] {
  const out: PageHistoryResolved[] = [];
  for (const entry of resolved) {
    if (!isObj(entry)) continue;
    const entryUrl = strOrNull(entry.pageUrl) ?? strOrNull(entry.url);
    const entrySlug = strOrNull(entry.slug);
    const matches = (entrySlug !== null && entrySlug === slug) || (entryUrl !== null && entryUrl === pageUrl);
    if (!matches) continue;
    out.push({
      viewport: strOrNull(entry.viewport),
      ruleId: strOrNull(entry.ruleId) ?? strOrNull(entry.checkId),
      severity: strOrNull(entry.severity),
    });
  }
  return out;
}

/** Per-page history across runs, chronological ascending. Runs without the page are skipped. */
export function buildPageHistory(slug: string, runs: BuiltRun[]): PageHistory {
  let pageUrl: string | null = null;
  const out: PageHistoryRun[] = [];
  for (const run of chronological(runs)) {
    const rf = run.runFindings;
    const page = rf.pages.find((p) => p.slug === slug);
    const findings = rf.findings.filter((f) => f.slug === slug);
    const url = page?.url ?? findings[0]?.pageUrl ?? null;
    if (!page && findings.length === 0) continue;
    if (url !== null) pageUrl = url;
    const bySeverity = zeroSeverity();
    if (page) {
      for (const k of Object.keys(bySeverity) as (keyof SeverityCounts)[]) bySeverity[k] = num(page.counts[k]);
    } else {
      for (const f of findings) bySeverity[sevKey(f.severity)] += 1;
    }
    out.push({
      runId: rf.runId,
      finishedAt: rf.finishedAt,
      total: page ? num(page.counts.total) : findings.length,
      hasRunData: true,
      bySeverity,
      findings: findings.map((f) => ({
        id: f.id,
        viewport: f.viewport,
        ruleId: f.ruleId,
        severity: f.severity,
        lifecycle: f.lifecycle,
      })),
      resolved: resolvedForPage(rf.resolved, slug, url),
    });
  }
  return { schemaVersion: 2, slug, pageUrl, runs: out };
}

function sevKey(s: Severity): keyof SeverityCounts {
  return s === "not-recorded" ? "notRecorded" : s;
}

function decisionsOf(rf: RunFindingsFile): DashboardRunAggregate["decisions"] {
  const d: Record<string, unknown> = isObj(rf.decisions) ? { ...rf.decisions } : {};
  const status = typeof d.status === "string" ? d.status : "not-applicable";
  return {
    ...d,
    status,
    ignoredNewThisRun: num(d.ignoredNewThisRun),
    newThisRun: Array.isArray(d.newThisRun) ? d.newThisRun : [],
  };
}

/** One `runs[]` row per run (chronological ascending) for dashboard.json. */
export function buildDashboardAggregates(runs: BuiltRun[]): DashboardRunAggregate[] {
  return chronological(runs).map((run) => {
    const rf = run.runFindings;
    const t = rf.totals;
    const ignored = num(t.ignored);
    return {
      runId: rf.runId,
      finishedAt: rf.finishedAt,
      origin: null,
      trigger: null,
      pages: rf.pages.length,
      total: num(t.all),
      hasRunData: true,
      detailLevel: rf.detailLevel,
      historyStatus: rf.historyStatus,
      bySeverity: { ...zeroSeverity(), ...t.bySeverity },
      ignored,
      detected: t.detected === undefined ? num(t.all) + ignored : num(t.detected),
      hasImages: true,
      decisions: decisionsOf(rf),
      byLifecycle: { ...zeroLifecycle(), ...t.byLifecycle },
      resolved: num(t.resolved),
    };
  });
}

/** `latest.pages[]` rows for a run: page rows plus per-page lifecycle counts. */
export function buildLatestPages(run: BuiltRun): LatestPageRow[] {
  const rf = run.runFindings;
  const bySlug = new Map<string, LifecycleCounts>();
  for (const f of rf.findings as PublishedFinding[]) {
    let c = bySlug.get(f.slug);
    if (!c) {
      c = zeroLifecycle();
      bySlug.set(f.slug, c);
    }
    c[LIFECYCLE_KEY[f.lifecycle] ?? "notRecorded"] += 1;
  }
  return rf.pages.map((p) => ({
    ...p,
    highest: p.highest ?? "none",
    byLifecycle: bySlug.get(p.slug) ?? zeroLifecycle(),
  }));
}