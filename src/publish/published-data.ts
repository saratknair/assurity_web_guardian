import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { buildDashboardData } from "../reporting/dashboard-data.js";
import {
  listRunScreenshots,
  sanitizeRun,
  sanitizeScreenshotName,
} from "./sanitizer.js";

/**
 * Published-data contract builder (Phase 2, Req 6.6, 6.7, 7.7, 11.8).
 *
 * Converts the local raw run store (`artifacts/runs/*`) into the static
 * `Published_Data` tree the GitHub Pages site serves, matching design.md →
 * Data Models (`RunsIndex`, `RunSummary` with `origin`, `Published_Data`
 * layout):
 *
 *   data/
 *     index.json                 # RunsIndex (runs newest-first, with origin)
 *     dashboard.json             # DashboardData contract (reused builder)
 *     runs/<id>/
 *       summary.json             # RunSummary (pages, failedChecks, health, origin)
 *       events.json              # sanitized event list (office replay)
 *       findings.json            # sanitized findings (pages[] shape, unchanged)
 *       screenshots/*.png        # sanitized screenshots
 *
 * Sanitization is delegated to `./sanitizer.ts` (fail-closed, Req 8): each run's
 * publishable JSON/JSONL is written through `sanitizeRun`, and screenshots are
 * copied only after that metadata pass. When a run withholds critical files the
 * builder still publishes whatever is clean (fail-closed semantics) and records
 * the withheld names so callers/`summary.json` can note them.
 *
 * The published tree carries NO absolute/internal paths: the sanitizer strips
 * them from the JSON it writes, and this builder only ever emits run-relative
 * references (run-id directory names, bare screenshot file names) into
 * `index.json`/`summary.json`.
 */

/** One run's health datapoint, mirrors dashboard-data's health vocabulary. */
export type RunHealth = "healthy" | "attention" | "failing";

/** Entry in the published runs index (design → RunsIndex.runs[]). */
export interface PublishedRunSummary {
  runId: string;
  finishedAt?: string;
  status: string;
  health: RunHealth;
  pages: number;
  failedChecks: number;
  pendingReview: boolean;
  /** Where the run executed (Req 7.7); defaults "local". */
  origin: "local" | "cloud";
}

/** RunsIndex, newest-first (design → Data Models → RunsIndex). */
export interface RunsIndex {
  generatedAt: string;
  domain: string;
  runs: PublishedRunSummary[];
}

/** Per-run summary.json (design → Data Models → RunSummary). */
export interface RunSummary extends PublishedRunSummary {
  /** Output-relative names of files the sanitizer withheld (fail-closed). */
  withheld: string[];
}

function readJson<T>(p: string): T | null {
  try {
    return JSON.parse(readFileSync(p, "utf8")) as T;
  } catch {
    return null;
  }
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** Normalize a free-form run result string into a stable `health` bucket. */
function healthFromFailedChecks(failedChecks: number): RunHealth {
  return failedChecks > 0 ? "attention" : "healthy";
}

/**
 * The publishable facts for a single run. This is the shared source of truth
 * for per-run origin/status/summary derivation: the published `RunsIndex` and
 * the loopback Admin API (`src/admin/admin-server.ts` → `GET /api/runs`) both
 * read run facts through `readRunFacts` so they never drift.
 */
export interface RunFacts {
  runId: string;
  finishedAt?: string;
  status: string;
  health: RunHealth;
  pages: number;
  failedChecks: number;
  pendingReview: boolean;
  origin: "local" | "cloud";
}

/**
 * Derive a run's origin. Precedence (kept simple and documented):
 *   1. A persisted marker file `artifacts/runs/<id>/origin` whose trimmed
 *      content is exactly "cloud" or "local" (how a synced/stored run records
 *      its provenance).
 *   2. The `AWG_RUN_ORIGIN` env marker ("cloud" set by the Cloud_Runner in CI).
 *   3. Default "local".
 * Only the exact token "cloud" yields "cloud"; anything else is "local".
 */
function originForRun(runDir: string, envOrigin?: string): "local" | "cloud" {
  const markerPath = join(runDir, "origin");
  if (existsSync(markerPath)) {
    const marker = (readJson<string>(markerPath) ?? "").toString().trim();
    const raw = marker.length > 0 ? marker : readFileSync(markerPath, "utf8").trim();
    return raw === "cloud" ? "cloud" : "local";
  }
  return (envOrigin ?? "").trim() === "cloud" ? "cloud" : "local";
}

/**
 * Collect the publishable facts for one run from its raw artifacts. Reads the
 * `run.finished` event (health/failedChecks/pages) and `run.record` event
 * (finishedAt/result) from `events.jsonl`, plus `findings.json` for the
 * `pendingReview` flag and the authoritative run id.
 */
export function readRunFacts(runDir: string, dirName: string, envOrigin?: string): RunFacts {
  const findings = readJson<{ runId?: string; awaitingReview?: boolean; pages?: unknown[] }>(
    join(runDir, "findings.json"),
  );
  const runId = findings?.runId ?? dirName;

  let finishedAt: string | undefined;
  let status = "unknown";
  let pages = Array.isArray(findings?.pages) ? findings!.pages!.length : 0;
  let failedChecks = 0;
  let health: RunHealth | undefined;

  const eventsPath = join(runDir, "events.jsonl");
  if (existsSync(eventsPath)) {
    const lines = readFileSync(eventsPath, "utf8")
      .split(/\r?\n/)
      .filter((l) => l.trim().length > 0);
    for (const line of lines) {
      let ev: { kind?: string; data?: Record<string, unknown> };
      try {
        ev = JSON.parse(line);
      } catch {
        continue; // skip malformed/partial lines
      }
      if (ev.kind === "run.record" && ev.data) {
        if (typeof ev.data.finishedAt === "string") finishedAt = ev.data.finishedAt;
        if (typeof ev.data.result === "string") status = ev.data.result;
      }
      if (ev.kind === "run.finished" && ev.data) {
        if (typeof ev.data.failedChecks === "number") failedChecks = ev.data.failedChecks;
        if (typeof ev.data.pages === "number") pages = ev.data.pages;
        if (typeof ev.data.health === "string") health = ev.data.health as RunHealth;
      }
    }
  }

  return {
    runId,
    finishedAt,
    status,
    health: health ?? healthFromFailedChecks(failedChecks),
    pages,
    failedChecks,
    pendingReview: findings?.awaitingReview === true,
    origin: originForRun(runDir, envOrigin),
  };
}

/** List run-id directories under a runs root (unordered). */
export function listRunDirs(runsRoot: string): string[] {
  const root = resolve(runsRoot);
  if (!existsSync(root)) return [];
  return readdirSync(root).filter((n) => {
    try {
      return statSync(join(root, n)).isDirectory();
    } catch {
      return false;
    }
  });
}

/**
 * Read every run's facts from a runs root and return them newest-first.
 *
 * Ordering matches the published `RunsIndex` exactly: by `finishedAt`
 * descending when present, otherwise by raw run-dir mtime descending. This is
 * the shared helper the Admin API (`GET /api/runs`) reuses so the admin view
 * and the published index agree on order and per-run facts (Req 4.3, 7.7).
 */
export function readRunsNewestFirst(runsRoot: string, envOrigin?: string): RunFacts[] {
  const root = resolve(runsRoot);
  const dirNames = listRunDirs(runsRoot);
  const facts = dirNames.map((dirName) => readRunFacts(join(root, dirName), dirName, envOrigin));

  const mtimeOf = (runId: string): number => {
    try {
      const dirName = dirNames.find(
        (n) => (readJson<{ runId?: string }>(join(root, n, "findings.json"))?.runId ?? n) === runId,
      );
      if (dirName) return statSync(join(root, dirName)).mtimeMs;
    } catch {
      /* ignore */
    }
    return 0;
  };

  return [...facts].sort((a, b) => {
    if (a.finishedAt && b.finishedAt) return b.finishedAt.localeCompare(a.finishedAt);
    if (a.finishedAt) return -1;
    if (b.finishedAt) return 1;
    return mtimeOf(b.runId) - mtimeOf(a.runId);
  });
}

/** Copy a run's sanitized screenshots into `<outRunDir>/screenshots/`. */
function copyScreenshots(runDir: string, outRunDir: string): void {
  const names = listRunScreenshots(runDir);
  if (names.length === 0) return;
  const srcDir = join(runDir, "screenshots");
  const destDir = join(outRunDir, "screenshots");
  ensureDir(destDir);
  for (const name of names) {
    const safeName = sanitizeScreenshotName(name);
    if (!safeName) continue;
    try {
      copyFileSync(join(srcDir, name), join(destDir, safeName));
    } catch {
      /* skip unreadable image; JSON sanitation already governs fail-closed */
    }
  }
}

/**
 * Build the static `Published_Data` tree from the raw run store.
 *
 * Writes `<outDir>/data/index.json`, `<outDir>/data/dashboard.json`, and per
 * run `<outDir>/data/runs/<id>/{summary.json, events.json, findings.json}` plus
 * sanitized screenshots. Returns the published run ids and a per-run map of any
 * withheld file names (fail-closed: a withheld file does not abort publishing).
 */
export async function buildPublishedData(opts: {
  runsRoot?: string;
  outDir: string;
  historyPath?: string;
  domain?: string;
}): Promise<{ runsPublished: string[]; withheld: Record<string, string[]> }> {
  const runsRoot = opts.runsRoot ?? "artifacts/runs";
  const historyPath = opts.historyPath ?? "artifacts/a11y-history.json";
  const domain = opts.domain ?? "assurity.nz";
  const envOrigin = process.env.AWG_RUN_ORIGIN;

  const dataDir = join(opts.outDir, "data");
  const runsOutDir = join(dataDir, "runs");
  ensureDir(runsOutDir);

  const root = resolve(runsRoot);
  const dirNames = listRunDirs(runsRoot);

  // Gather facts + sanitize each run.
  const summaries: RunSummary[] = [];
  const withheld: Record<string, string[]> = {};
  const runsPublished: string[] = [];

  for (const dirName of dirNames) {
    const runDir = join(root, dirName);
    const facts = readRunFacts(runDir, dirName, envOrigin);
    const outRunDir = join(runsOutDir, facts.runId);
    ensureDir(outRunDir);

    // Sanitize publishable JSON/JSONL (writes findings.json, events.json, ...).
    const report = sanitizeRun(runDir, outRunDir);
    if (!report.ok && report.withheld.length > 0) {
      withheld[facts.runId] = report.withheld;
    }

    // Copy sanitized screenshots after the metadata/JSON pass.
    copyScreenshots(runDir, outRunDir);

    const summary: RunSummary = {
      runId: facts.runId,
      finishedAt: facts.finishedAt,
      status: facts.status,
      health: facts.health,
      pages: facts.pages,
      failedChecks: facts.failedChecks,
      pendingReview: facts.pendingReview,
      origin: facts.origin,
      withheld: report.withheld,
    };
    writeFileSync(join(outRunDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");

    summaries.push(summary);
    runsPublished.push(facts.runId);
  }

  // RunsIndex, newest-first: by finishedAt desc when present, else dir mtime desc.
  const mtimeOf = (runId: string): number => {
    try {
      // Prefer the raw run dir mtime; fall back to the published run dir.
      const dirName = dirNames.find(
        (n) => (readJson<{ runId?: string }>(join(root, n, "findings.json"))?.runId ?? n) === runId,
      );
      if (dirName) return statSync(join(root, dirName)).mtimeMs;
    } catch {
      /* ignore */
    }
    return 0;
  };
  const indexRuns = [...summaries].sort((a, b) => {
    if (a.finishedAt && b.finishedAt) return b.finishedAt.localeCompare(a.finishedAt);
    if (a.finishedAt) return -1;
    if (b.finishedAt) return 1;
    return mtimeOf(b.runId) - mtimeOf(a.runId);
  });

  const index: RunsIndex = {
    generatedAt: new Date().toISOString(),
    domain,
    runs: indexRuns.map((r) => ({
      runId: r.runId,
      finishedAt: r.finishedAt,
      status: r.status,
      health: r.health,
      pages: r.pages,
      failedChecks: r.failedChecks,
      pendingReview: r.pendingReview,
      origin: r.origin,
    })),
  };
  writeFileSync(join(dataDir, "index.json"), JSON.stringify(index, null, 2), "utf8");

  // Dashboard contract (reuse the existing deterministic builder).
  const dashboard = buildDashboardData(runsRoot, historyPath, domain);
  writeFileSync(join(dataDir, "dashboard.json"), JSON.stringify(dashboard, null, 2), "utf8");

  return { runsPublished, withheld };
}
