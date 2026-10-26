import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { computeAnalytics, type Analytics } from "../core/analytics.js";
import type { TrackedFinding } from "../agents/a11y-history.js";

/**
 * Dashboard data contract (Phase 2, Req 1.2, 1.3, 1.7, 1.8, 11.8).
 *
 * This module produces the machine-readable `DashboardData` JSON that the new
 * static dashboard renders from, replacing the approach where the dashboard
 * embedded HTML tables directly. It is DETERMINISTIC and READ-ONLY over
 * completed run records: it reuses `computeAnalytics()` for severity/lifecycle
 * and reads per-run `findings.json` / `events.jsonl` for the breakdowns.
 *
 * The pure assembly helpers (`buildFindingsByPage`, `buildFindingsBySeverity`,
 * `buildRunHealthTrend`, `collectAiItems`) are exported so property tests can
 * target them directly (Property 1 breakdown-conservation, Property 2
 * trend-selection). None of these helpers touch the filesystem or embed
 * absolute paths — the contract carries only run-relative references.
 */

/** A single run's health point, used for the chronological trend view (1.3). */
export interface RunHealthPoint {
  runId: string;
  finishedAt?: string;
  failedChecks: number;
  health: "healthy" | "attention" | "failing";
}

/** One AI-assisted analysis item, always rendered with a "not a fact" label (1.8). */
export interface DashboardAiItem {
  agent: string;
  label: string;
  text: string;
  relatedFindingId: string;
  classification: string;
}

/**
 * The data contract read by the dashboard in both static (Pages) and live
 * (Event_Server) modes. Shape matches design.md → Data Models → DashboardData.
 */
export interface DashboardData {
  generatedAt: string;
  domain: string;
  /** Chronological (non-decreasing finish time); >=10 most recent or all (1.3). */
  runHealthTrend: RunHealthPoint[];
  /** Per-page total finding counts; sum == total findings (1.2). */
  findingsByPage: { page: string; count: number }[];
  /** Severity buckets partitioning the accessibility findings (1.2). */
  findingsBySeverity: Record<string, number>;
  /** New vs recurring accessibility findings from the lifecycle (1.2). */
  a11yNewVsRecurring: { new: number; recurring: number };
  /** AI-assisted items; every one carries `.ai-assisted` treatment (1.8). */
  aiItems: DashboardAiItem[];
  /** True when there are no runs — drives the empty state (1.7). */
  empty: boolean;
}

/** Minimal per-page findings shape shared by the legacy and `pages[]` layouts. */
export interface RunFindingPage {
  page?: string;
  slug?: string;
  outcomes?: { kind: string; classification?: string; detail: string }[];
  aiItems?: { agent: string; label: string; text: string; relatedFindingId?: string; classification?: string }[];
}

/** A run point before trend selection: everything needed to order and plot it. */
export interface RunPoint extends RunHealthPoint {}

// ---------------------------------------------------------------------------
// Pure assembly helpers (property-test targets). No filesystem, no abs paths.
// ---------------------------------------------------------------------------

/** Minimum number of trend points to show when enough runs exist (Req 1.3). */
export const TREND_MIN = 10;

/**
 * Property 2 — trend selection is the most-recent chronological suffix.
 * Given runs in chronological order (oldest→newest), return the most-recent
 * suffix of length `max(min(TREND_MIN, n), ...)`: at least the 10 newest when
 * >=10 exist, otherwise all. The result stays chronological and is exactly the
 * most-recent subset (no older run included while a newer one is dropped).
 */
export function buildRunHealthTrend(runsChrono: RunPoint[], minPoints = TREND_MIN): RunHealthPoint[] {
  const n = runsChrono.length;
  if (n === 0) return [];
  const take = n >= minPoints ? n : n; // keep all; selection only matters when capping
  // We never cap below the full set here (showing all is permitted when <10, and
  // showing all is also valid when >=10). The "most-recent suffix" guarantee is
  // trivially satisfied by returning the chronological list as-is. The helper is
  // kept explicit so a future cap (e.g. last N) remains a pure suffix slice.
  return runsChrono.slice(n - take).map((r) => ({
    runId: r.runId,
    finishedAt: r.finishedAt,
    failedChecks: r.failedChecks,
    health: r.health,
  }));
}

/**
 * Property 1 (part) — per-page finding counts conserve the total.
 * Counts every outcome across the provided pages; the sum of the returned
 * counts equals the total number of outcomes.
 */
export function buildFindingsByPage(pages: RunFindingPage[]): { page: string; count: number }[] {
  return pages.map((p) => ({
    page: p.page ?? p.slug ?? "(unknown)",
    count: (p.outcomes ?? []).length,
  }));
}

/** Canonical a11y severity buckets, in presentation order. */
export const SEVERITY_BUCKETS = ["critical", "serious", "moderate", "minor"] as const;
export type SeverityBucket = (typeof SEVERITY_BUCKETS)[number];

/**
 * Map an axe impact string to one of the canonical buckets. Unknown / missing
 * impacts fall into "minor" so every a11y finding lands in exactly one bucket
 * (keeps the partition total equal to the a11y finding total — Property 1).
 */
export function severityBucketOf(impact: string | null | undefined): SeverityBucket {
  switch ((impact ?? "").toLowerCase()) {
    case "critical":
      return "critical";
    case "serious":
      return "serious";
    case "moderate":
      return "moderate";
    default:
      return "minor";
  }
}

/**
 * Property 1 (part) — severity buckets partition the accessibility findings.
 * Each tracked a11y finding is placed in exactly one bucket by its impact, so
 * the bucket counts sum to the number of a11y findings provided.
 */
export function buildFindingsBySeverity(a11yFindings: { impact: string | null }[]): Record<string, number> {
  const out: Record<string, number> = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  for (const f of a11yFindings) out[severityBucketOf(f.impact)]++;
  return out;
}

/** Collect AI-assisted items from a run's pages (or legacy top-level aiItems). */
export function collectAiItems(pages: RunFindingPage[]): DashboardAiItem[] {
  const items: DashboardAiItem[] = [];
  for (const p of pages) {
    for (const a of p.aiItems ?? []) {
      items.push({
        agent: a.agent,
        label: a.label,
        text: a.text,
        relatedFindingId: a.relatedFindingId ?? "",
        classification: a.classification ?? "ai-generated-analysis",
      });
    }
  }
  return items;
}

// ---------------------------------------------------------------------------
// Filesystem assembly (impure shell around the pure helpers above).
// ---------------------------------------------------------------------------

function readJson<T>(p: string): T | null {
  try {
    return JSON.parse(readFileSync(p, "utf8")) as T;
  } catch {
    return null;
  }
}

/** Normalize a run's findings.json into the shared `pages[]` shape. */
function pagesFromFindings(raw: unknown): RunFindingPage[] {
  const d = raw as { pages?: RunFindingPage[]; page?: string; outcomes?: RunFindingPage["outcomes"]; aiItems?: RunFindingPage["aiItems"] } | null;
  if (!d) return [];
  if (Array.isArray(d.pages)) return d.pages;
  // Legacy single-page layout: top-level outcomes/aiItems.
  if (d.outcomes || d.aiItems) return [{ page: d.page, outcomes: d.outcomes, aiItems: d.aiItems }];
  return [];
}

/**
 * Read a run's `run.record` / `run.finished` events to recover finish time and
 * health. Falls back to directory mtime ordering via the caller when absent.
 */
function runPointFromEvents(runDir: string, runId: string, failedChecks: number): RunHealthPoint {
  const p = join(runDir, "events.jsonl");
  let finishedAt: string | undefined;
  let health: RunHealthPoint["health"] = failedChecks > 0 ? "attention" : "healthy";
  if (existsSync(p)) {
    try {
      const lines = readFileSync(p, "utf8").split(/\r?\n/).filter((l) => l.trim().length > 0);
      for (const line of lines) {
        const ev = JSON.parse(line) as { kind?: string; data?: Record<string, unknown> };
        if (ev.kind === "run.record" && ev.data && typeof ev.data.finishedAt === "string") {
          finishedAt = ev.data.finishedAt;
        }
        if (ev.kind === "run.finished" && ev.data && typeof ev.data.health === "string") {
          health = ev.data.health as RunHealthPoint["health"];
        }
      }
    } catch {
      /* ignore malformed event stream; keep derived defaults */
    }
  }
  return { runId, finishedAt, failedChecks, health };
}

/**
 * Assemble the `DashboardData` contract from the local artifacts store.
 * Deterministic and read-only. Reuses `computeAnalytics()` for severity (via
 * the a11y history) and lifecycle, and reads per-run artifacts for the trend
 * and the latest-run page/AI breakdowns.
 */
export function buildDashboardData(
  runsRoot = "artifacts/runs",
  historyPath = "artifacts/a11y-history.json",
  domain = "assurity.nz",
): DashboardData {
  const analytics: Analytics = computeAnalytics(runsRoot, historyPath);
  const root = resolve(runsRoot);
  const runDirs = existsSync(root)
    ? readdirSync(root)
        .filter((n) => statSync(join(root, n)).isDirectory())
        .sort((a, b) => statSync(join(root, a)).mtimeMs - statSync(join(root, b)).mtimeMs)
    : [];

  // Chronological run points (oldest→newest) for the trend. Pair each run dir
  // with the analytics failedChecks (matched by runId) and its event health.
  const byId = new Map(analytics.runs.map((r) => [r.runId, r]));
  const runPoints: RunPoint[] = runDirs.map((id) => {
    const dir = join(root, id);
    const findings = readJson<{ runId?: string }>(join(dir, "findings.json"));
    const runId = findings?.runId ?? id;
    const failedChecks = byId.get(runId)?.failedChecks ?? 0;
    return runPointFromEvents(dir, runId, failedChecks);
  });
  // Order chronologically by finishedAt when present, else keep mtime order.
  runPoints.sort((a, b) => {
    if (a.finishedAt && b.finishedAt) return a.finishedAt.localeCompare(b.finishedAt);
    return 0;
  });

  const runHealthTrend = buildRunHealthTrend(runPoints);

  // Latest run (newest by chronological order) drives page/AI breakdowns.
  const latestRunId = runPoints[runPoints.length - 1]?.runId;
  let latestPages: RunFindingPage[] = [];
  if (latestRunId) {
    const latestDir = join(root, runDirs.find((id) => (readJson<{ runId?: string }>(join(root, id, "findings.json"))?.runId ?? id) === latestRunId) ?? latestRunId);
    latestPages = pagesFromFindings(readJson(join(latestDir, "findings.json")));
  }

  const findingsByPage = buildFindingsByPage(latestPages);

  // Severity buckets come from the tracked a11y history (impact), consistent
  // with computeAnalytics().a11yBySeverity and partitioning every a11y finding.
  const history = readJson<Record<string, TrackedFinding>>(resolve(historyPath)) ?? {};
  const findingsBySeverity = buildFindingsBySeverity(Object.values(history).map((f) => ({ impact: f.impact })));

  const a11yNewVsRecurring = {
    new: analytics.findingLifecycle.new,
    recurring: analytics.findingLifecycle.recurring,
  };

  const aiItems = collectAiItems(latestPages);

  return {
    generatedAt: new Date().toISOString(),
    domain,
    runHealthTrend,
    findingsByPage,
    findingsBySeverity,
    a11yNewVsRecurring,
    aiItems,
    empty: runPoints.length === 0,
  };
}
