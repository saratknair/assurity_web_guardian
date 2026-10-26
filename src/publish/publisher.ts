import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { buildPublishedData, type RunsIndex } from "./published-data.js";

/**
 * Publisher orchestrator (Phase 2, Req 6.6, 6.7, 6.8, 6.9).
 *
 * `build-published-data.ts` (the CLI) produces the sanitized `data/` tree via
 * `buildPublishedData`. This module is the higher-level step that assembles the
 * *complete* GitHub Pages bundle and swaps it into place atomically-ish:
 *
 *   1. Build `Published_Data` into a STAGING directory (never directly onto the
 *      live `outDir`), so a failed/partial build cannot corrupt the previously
 *      published site.
 *   2. Copy the static dashboard app (`dashboard/index.html`, `style.css`,
 *      `app.js`, `data-source.js`, `vendor/`) into the staging bundle so the
 *      Pages site is self-contained.
 *   3. Only once staging is fully built, swap it into `outDir` (move the old
 *      bundle aside, move staging into place, then drop the old bundle). If the
 *      swap fails midway, the old bundle is restored so previously published
 *      data is left unchanged.
 *
 * The replay-only office build (Vite with `VITE_AWG_MODE=replay`) is NOT
 * produced here — that build wiring is task 13.1 (and the CI publish step). The
 * publish/CI step injects the office bundle into the Pages output alongside the
 * assets this orchestrator copies. This keeps `publisher.ts` focused on the
 * staging build of `Published_Data` plus the static dashboard assets and the
 * atomic-ish swap.
 *
 * Failure-preservation contract (Req 6.8, 6.9): if `buildPublishedData` throws
 * (run unusable / publish build failure), the existing `outDir` is left
 * completely untouched and `publish` returns `{ ok: false, reason }`. The old
 * `outDir` is only ever replaced after the staging bundle is confirmed built.
 */

/** Result of a publish attempt. */
export interface PublishResult {
  /** True iff the staging bundle built and swapped into `outDir` successfully. */
  ok: boolean;
  /** The latest (most-recent) run id that was published, when known. */
  publishedRunId?: string;
  /** Flat list of `run/file` names the sanitizer withheld (fail-closed, Req 8.5). */
  withheld: string[];
  /** Human-readable reason when `ok` is false. */
  reason?: string;
}

/** Static dashboard asset file names copied into the Pages bundle. */
const DASHBOARD_FILES = ["index.html", "style.css", "app.js", "data-source.js"] as const;
/** Static dashboard asset directory names copied recursively. */
const DASHBOARD_DIRS = ["vendor"] as const;

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** Resolve the repo's static `dashboard/` directory from this module. */
function dashboardSourceDir(): string {
  // This file lives at <root>/src/publish/publisher.ts (compiled to
  // <root>/dist/publish/publisher.js). Walk up to the dir containing
  // `dashboard/`. Try CWD first (most common for the CLI), then the module
  // location so it also works when invoked from elsewhere.
  const cwdCandidate = resolve(process.cwd(), "dashboard");
  if (existsSync(cwdCandidate)) return cwdCandidate;
  // Fall back to walking up from the module file location.
  let dir = dirname(new URL(import.meta.url).pathname);
  // On Windows the pathname starts with a leading "/"; strip it so `resolve`
  // produces a usable path.
  if (/^\/[A-Za-z]:\//.test(dir)) dir = dir.slice(1);
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, "dashboard");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return cwdCandidate; // best-effort; copyStaticDashboard tolerates absence
}

/**
 * Copy the static dashboard app into the staging bundle root. Files that do not
 * exist yet (e.g. `data-source.js` lands in task 4.5) are skipped silently so
 * the publisher stays forward-compatible as the static app is filled in.
 */
function copyStaticDashboard(stagingDir: string): void {
  const srcDir = dashboardSourceDir();
  if (!existsSync(srcDir)) return;
  ensureDir(stagingDir);
  for (const name of DASHBOARD_FILES) {
    const src = join(srcDir, name);
    if (existsSync(src)) cpSync(src, join(stagingDir, name));
  }
  for (const name of DASHBOARD_DIRS) {
    const src = join(srcDir, name);
    if (existsSync(src)) cpSync(src, join(stagingDir, name), { recursive: true });
  }
}

/** Read the newest-first index written by `buildPublishedData` from staging. */
function readStagedIndex(stagingDir: string): RunsIndex | null {
  const indexPath = join(stagingDir, "data", "index.json");
  if (!existsSync(indexPath)) return null;
  try {
    return JSON.parse(readFileSync(indexPath, "utf8")) as RunsIndex;
  } catch {
    return null;
  }
}

/**
 * When `latestOnly` is set, prune every per-run directory from the staged
 * bundle except the most-recent run (the first entry of the newest-first
 * index). `index.json` and `dashboard.json` are always retained.
 */
function pruneToLatest(stagingDir: string, latestRunId: string | undefined): void {
  const runsDir = join(stagingDir, "data", "runs");
  if (!existsSync(runsDir)) return;
  let entries: string[];
  try {
    entries = readdirSync(runsDir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name === latestRunId) continue;
    try {
      if (statSync(join(runsDir, name)).isDirectory()) {
        rmSync(join(runsDir, name), { recursive: true, force: true });
      }
    } catch {
      /* ignore individual prune failures; swap still proceeds */
    }
  }
}

/** Flatten the per-run withheld map into `run/file` tokens for PublishResult. */
function flattenWithheld(withheld: Record<string, string[]>): string[] {
  const out: string[] = [];
  for (const runId of Object.keys(withheld)) {
    for (const file of withheld[runId]) out.push(`${runId}/${file}`);
  }
  return out;
}

/**
 * Swap the freshly built `stagingDir` into `outDir` with best-effort atomicity.
 *
 * Strategy that never destroys the live bundle until the new one is ready:
 *   - If `outDir` does not exist yet, just move staging into place.
 *   - Otherwise move the live `outDir` to a sibling backup, move staging into
 *     `outDir`, then delete the backup. If moving staging in fails, the backup
 *     is restored so the previously published data survives intact.
 */
function swapIntoPlace(stagingDir: string, outDir: string): void {
  const out = resolve(outDir);
  ensureDir(dirname(out));

  if (!existsSync(out)) {
    renameSync(stagingDir, out);
    return;
  }

  const backup = `${out}.prev-${Date.now()}`;
  renameSync(out, backup);
  try {
    renameSync(stagingDir, out);
  } catch (err) {
    // Restore the previous bundle so published data is left unchanged.
    if (!existsSync(out)) {
      renameSync(backup, out);
    }
    throw err;
  }
  // New bundle is in place; drop the old one.
  rmSync(backup, { recursive: true, force: true });
}

/**
 * Build and publish the static Pages bundle.
 *
 * @param opts.runsRoot  raw run store (default "artifacts/runs")
 * @param opts.outDir    final Pages output directory to swap the bundle into
 * @param opts.latestOnly publish only the most-recent run's per-run data
 *                        (index.json + dashboard.json are always written);
 *                        default false publishes all runs.
 */
export async function publish(opts: {
  runsRoot?: string;
  outDir: string;
  latestOnly?: boolean;
}): Promise<PublishResult> {
  const runsRoot = opts.runsRoot ?? "artifacts/runs";
  const out = resolve(opts.outDir);
  const stagingDir = `${out}.staging`;

  // Fresh staging dir; never touch `out` yet.
  try {
    if (existsSync(stagingDir)) rmSync(stagingDir, { recursive: true, force: true });
    ensureDir(stagingDir);
  } catch (err) {
    return {
      ok: false,
      withheld: [],
      reason: `failed to prepare staging dir: ${(err as Error).message}`,
    };
  }

  // 1. Build Published_Data + copy static assets into STAGING. Any throw here
  //    must leave `out` untouched (Req 6.8, 6.9).
  let withheldMap: Record<string, string[]> = {};
  let publishedRunId: string | undefined;
  try {
    const built = await buildPublishedData({ runsRoot, outDir: stagingDir });
    withheldMap = built.withheld;

    const index = readStagedIndex(stagingDir);
    publishedRunId = index?.runs[0]?.runId;

    if (opts.latestOnly) {
      pruneToLatest(stagingDir, publishedRunId);
    }

    copyStaticDashboard(stagingDir);
  } catch (err) {
    // Build failed: discard staging, leave the previously published bundle as-is.
    try {
      rmSync(stagingDir, { recursive: true, force: true });
    } catch {
      /* ignore cleanup failure */
    }
    return {
      ok: false,
      withheld: flattenWithheld(withheldMap),
      reason: `publish build failed: ${(err as Error).message}`,
    };
  }

  // 2. Staging built successfully — swap it into place. A swap failure also
  //    leaves the previous bundle intact (restored from backup).
  try {
    swapIntoPlace(stagingDir, out);
  } catch (err) {
    try {
      if (existsSync(stagingDir)) rmSync(stagingDir, { recursive: true, force: true });
    } catch {
      /* ignore cleanup failure */
    }
    return {
      ok: false,
      withheld: flattenWithheld(withheldMap),
      reason: `publish swap failed: ${(err as Error).message}`,
    };
  }

  return {
    ok: true,
    publishedRunId,
    withheld: flattenWithheld(withheldMap),
  };
}
