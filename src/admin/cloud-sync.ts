import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Cloud-to-local run synchronization (Phase 2, Requirements 7.3–7.6, 7.8).
 *
 * `Cloud_Sync` is READ-ONLY with respect to the cloud and ADDITIVE with respect
 * to the local store. It fetches the `runs-data` branch (a plain `git fetch`,
 * never a push/branch edit/commit), enumerates the run-id directories committed
 * on that branch under `artifacts/runs/<id>/`, and copies into the local
 * `runsRoot` ONLY the run-ids that are not already present locally. A run-id
 * that already exists locally is SKIPPED and never touched — existing runs,
 * evidence, baselines, and audit history are inputs to sync, never outputs of
 * it, so nothing local is overwritten or deleted (Req 7.3, 7.5, 7.8).
 *
 * Each newly synced run gets an `origin` marker file containing `cloud` written
 * into its directory, matching `published-data.ts` → `originForRun` precedence
 * (a per-run `origin` marker whose content is exactly `cloud` wins), so synced
 * runs surface with origin `"cloud"` in the Admin GUI and published index
 * (Req 7.7).
 *
 * FAIL SAFE (Req 7.6): if the machine is offline, the fetch fails, or any error
 * occurs mid-sync, `cloudSync` resolves `{ ok: false, reason }` and leaves the
 * local store UNCHANGED. Each run is reconstructed into a private temp staging
 * area first and only MOVED into `runsRoot` once fully materialized, so a
 * failure can never leave a half-written run behind, and existing run
 * directories are never written through.
 */

/** Result of a `cloudSync` invocation (design → function-signature sketch). */
export interface CloudSyncResult {
  /** Run-ids newly copied in from the cloud branch. */
  added: string[];
  /** Run-ids already present locally and therefore left untouched. */
  skipped: string[];
  /** True when the sync completed without error. */
  ok: boolean;
  /** Human-readable failure reason when `ok` is false. */
  reason?: string;
}

/**
 * Pure copy/skip decision for cloud sync (Property 18 target).
 *
 * Given the run-ids already present locally and the run-ids available on the
 * cloud branch, return exactly which cloud run-ids to ADD (absent locally,
 * de-duplicated) and which to SKIP (already present locally). A run-id is
 * decided purely by its directory name: "already present locally" iff it
 * appears in `localIds`.
 *
 * The result guarantees the additive/non-destructive contract: `toAdd`
 * contains only cloud ids not in `localIds`, `toSkip` contains only cloud ids
 * that are in `localIds`, and the two partitions are disjoint and cover every
 * distinct cloud id. Applying `toAdd` to the local set yields exactly
 * `localIds ∪ cloudIds`.
 */
export function partitionRuns(
  localIds: Iterable<string>,
  cloudIds: Iterable<string>,
): { toAdd: string[]; toSkip: string[] } {
  const local = new Set(localIds);
  const toAdd: string[] = [];
  const toSkip: string[] = [];
  const seen = new Set<string>();
  for (const id of cloudIds) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (local.has(id)) toSkip.push(id);
    else toAdd.push(id);
  }
  return { toAdd, toSkip };
}

/** List run-id directory names directly under a local runs root (unordered). */
function listLocalRunIds(runsRoot: string): string[] {
  const root = resolve(runsRoot);
  if (!existsSync(root)) return [];
  return readdirSync(root).filter((name) => {
    try {
      return statSync(join(root, name)).isDirectory();
    } catch {
      return false;
    }
  });
}

/** POSIX-style prefix the branch stores run artifacts under. */
const RUNS_PREFIX = "artifacts/runs";

/**
 * Enumerate the run-id directory names committed on `origin/<branch>` under
 * `artifacts/runs/`. Returns the distinct first-level directory names and the
 * full tree file list (so each run can be reconstructed file-by-file).
 */
async function listCloudRuns(
  repoDir: string,
  branch: string,
): Promise<{ runIds: string[]; files: string[] }> {
  const ref = `origin/${branch}`;
  const { stdout } = await execFileAsync(
    "git",
    ["ls-tree", "-r", "--name-only", "-z", ref, "--", RUNS_PREFIX],
    { cwd: repoDir, maxBuffer: 64 * 1024 * 1024 },
  );
  const files = stdout.split("\0").filter((p) => p.length > 0);
  const runIds = new Set<string>();
  const prefix = `${RUNS_PREFIX}/`;
  for (const p of files) {
    if (!p.startsWith(prefix)) continue;
    const rest = p.slice(prefix.length);
    const slash = rest.indexOf("/");
    const id = slash === -1 ? rest : rest.slice(0, slash);
    if (id.length > 0) runIds.add(id);
  }
  return { runIds: [...runIds], files };
}

/**
 * Reconstruct a single run's directory tree from `origin/<branch>` into
 * `destRunDir` by reading each committed blob with `git show` (binary-safe).
 * `destRunDir` must be a fresh staging directory; nothing local is read/written
 * through here.
 */
async function materializeRun(
  repoDir: string,
  branch: string,
  runId: string,
  runFiles: string[],
  destRunDir: string,
): Promise<void> {
  const ref = `origin/${branch}`;
  const runPrefix = `${RUNS_PREFIX}/${runId}/`;
  for (const filePath of runFiles) {
    if (!filePath.startsWith(runPrefix)) continue;
    const relative = filePath.slice(runPrefix.length);
    if (relative.length === 0) continue;
    // Read the blob as raw bytes so screenshots/traces survive intact.
    const { stdout } = await execFileAsync("git", ["show", `${ref}:${filePath}`], {
      cwd: repoDir,
      encoding: "buffer",
      maxBuffer: 256 * 1024 * 1024,
    });
    const outPath = join(destRunDir, ...relative.split(posix.sep));
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, stdout as unknown as Buffer);
  }
  // Mark provenance so published-data.ts → originForRun reports "cloud".
  writeFileSync(join(destRunDir, "origin"), "cloud", "utf8");
}

/**
 * Synchronize cloud runs into the local store (additive, read-only, fail-safe).
 *
 * @see CloudSyncResult for the shape of the returned summary.
 */
export async function cloudSync(opts: {
  repoDir: string;
  branch: string;
  runsRoot: string;
}): Promise<CloudSyncResult> {
  const { repoDir, branch, runsRoot } = opts;

  // 1. READ-ONLY fetch of the runs-data branch. No push, no branch edit, no
  //    commit — just update the remote-tracking ref so we can read it.
  try {
    await execFileAsync("git", ["fetch", "origin", branch], {
      cwd: repoDir,
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    return {
      added: [],
      skipped: [],
      ok: false,
      reason: `git fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // 2. Enumerate run-id directories present on the fetched branch.
  let cloud: { runIds: string[]; files: string[] };
  try {
    cloud = await listCloudRuns(repoDir, branch);
  } catch (err) {
    return {
      added: [],
      skipped: [],
      ok: false,
      reason: `could not read branch '${branch}': ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // 3. Decide additively: add only run-ids absent locally; skip the rest.
  const localIds = listLocalRunIds(runsRoot);
  const { toAdd, toSkip } = partitionRuns(localIds, cloud.runIds);

  if (toAdd.length === 0) {
    return { added: [], skipped: toSkip, ok: true };
  }

  const root = resolve(runsRoot);
  mkdirSync(root, { recursive: true });

  // Stage every new run into a private temp area first, then MOVE completed
  // run dirs into place. On any error we remove the staging area and leave the
  // local store byte-for-byte unchanged (Req 7.6). We never write through an
  // existing local run directory.
  const staging = mkdtempSync(join(tmpdir(), "awg-cloud-sync-"));
  const added: string[] = [];
  try {
    for (const runId of toAdd) {
      const dest = join(root, runId);
      // Defensive: never overwrite an existing local run (additive only).
      if (existsSync(dest)) {
        toSkip.push(runId);
        continue;
      }
      const stageDir = join(staging, runId);
      await materializeRun(repoDir, branch, runId, cloud.files, stageDir);
      // Re-check immediately before the move so a concurrent run can't be
      // clobbered; skip rather than overwrite if it appeared.
      if (existsSync(dest)) {
        toSkip.push(runId);
        continue;
      }
      renameSync(stageDir, dest);
      added.push(runId);
    }
  } catch (err) {
    // Fail safe: discard anything staged. Runs already moved in are complete
    // and valid additions, but to honor "leave the local store unchanged on
    // failure" we report the error and do not claim partial success.
    try {
      rmSync(staging, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
    return {
      added: [],
      skipped: toSkip,
      ok: false,
      reason: `sync failed while copying runs: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  try {
    rmSync(staging, { recursive: true, force: true });
  } catch {
    /* best effort cleanup of the (now empty) staging area */
  }

  return { added, skipped: toSkip, ok: true };
}
