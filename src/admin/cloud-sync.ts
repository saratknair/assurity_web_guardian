import { execFile, spawn } from "node:child_process";
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
 * Cloud-to-local run synchronization.
 *
 * `Cloud_Sync` is READ-ONLY with respect to the cloud and ADDITIVE with respect
 * to the local store. It fetches the `runs-data` branch (a plain `git fetch`,
 * never a push/branch edit/commit), enumerates the run-id directories committed
 * on that branch under `artifacts/runs/<id>/`, and copies into the local
 * `runsRoot` ONLY the run-ids that are not already present locally. A run-id
 * that already exists locally is SKIPPED and never touched - existing runs,
 * evidence, baselines, and audit history are inputs to sync, never outputs of
 * it, so nothing local is overwritten or deleted.
 *
 * Each newly synced run gets an `origin` marker file containing `cloud` written
 * into its directory, matching `published-data.ts` -> `originForRun` precedence
 * (a per-run `origin` marker whose content is exactly `cloud` wins), so synced
 * runs surface with origin `"cloud"` in the Admin GUI and published index.
 *
 * FAIL SAFE: if the machine is offline, the fetch fails, or any error
 * occurs mid-sync, `cloudSync` resolves `{ ok: false, reason }` and leaves the
 * local store UNCHANGED. Each run is reconstructed into a private temp staging
 * area first and only MOVED into `runsRoot` once fully materialized, so a
 * failure can never leave a half-written run behind, and existing run
 * directories are never written through.
 */

/** Result of a `cloudSync` invocation (run-ids added and skipped). */
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
 * the union of `localIds` and `cloudIds`.
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

/** A branch name that cannot be read by git as an option or revision expression. */
export function isSafeBranchName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(name) && !name.includes("..") && !name.endsWith("/") && !name.endsWith(".lock");
}

/** A run id that is one plain path segment (no separators, no dot segments). */
export function isSafeRunId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) && !id.includes("..");
}

/** True when every segment of a remote-supplied relative path is a plain name. */
export function isSafeRelativePath(rel: string): boolean {
  return rel.length > 0 && rel.split("/").every((s) => s !== "" && s !== "." && s !== ".." && !/[\\:\0]/.test(s));
}

/** POSIX-style prefix the branch stores run artifacts under. */
const RUNS_PREFIX = "artifacts/runs";

/** Time limits so a stalled git process can never leave a pull running forever. */
export const FETCH_TIMEOUT_MS = 120_000;
export const READ_TIMEOUT_MS = 60_000;

/** Environment for git children: never wait for a credential prompt. */
export function gitChildEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...base, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" };
}

/** One blob of the cloud branch tree. */
interface CloudFile {
  path: string;
  oid: string;
}

/**
 * Reads many blobs with ONE `git cat-file --batch` process (a process per file took minutes
 * for a few thousand files on Windows). Returns the contents in the order of `oids`.
 */
export function readBlobs(repoDir: string, oids: string[], timeoutMs = READ_TIMEOUT_MS): Promise<Buffer[]> {
  return new Promise<Buffer[]>((resolveAll, reject) => {
    if (oids.length === 0) {
      resolveAll([]);
      return;
    }
    const child = spawn("git", ["cat-file", "--batch"], {
      cwd: repoDir,
      windowsHide: true,
      shell: false,
      env: gitChildEnv(),
    });
    const chunks: Buffer[] = [];
    let settled = false;
    const finish = (err: Error | null, value?: Buffer[]): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) {
        child.kill();
        reject(err);
      } else resolveAll(value ?? []);
    };
    const timer = setTimeout(() => finish(new Error("git cat-file timed out")), timeoutMs);
    child.on("error", (e) => finish(e));
    child.stdin.on("error", () => {
      /* the close handler reports the failure */
    });
    child.stdout.on("data", (c: Buffer) => chunks.push(c));
    child.on("close", () => {
      const all = Buffer.concat(chunks);
      const out: Buffer[] = [];
      let pos = 0;
      for (const oid of oids) {
        const nl = all.indexOf(0x0a, pos);
        if (nl === -1) return finish(new Error("unexpected git cat-file output"));
        const header = all.subarray(pos, nl).toString("utf8").split(" ");
        const size = Number(header[2]);
        if (header[0] !== oid || header[1] !== "blob" || !Number.isInteger(size) || size < 0) {
          return finish(new Error("could not read " + oid));
        }
        const start = nl + 1;
        if (start + size > all.length) return finish(new Error("truncated git cat-file output"));
        out.push(all.subarray(start, start + size));
        pos = start + size + 1;
      }
      finish(null, out);
    });
    child.stdin.end(oids.join("\n") + "\n");
  });
}

/**
 * Enumerate the run-id directory names committed on `origin/<branch>` under
 * `artifacts/runs/`. Returns the distinct first-level directory names and the
 * full tree file list (so each run can be reconstructed file-by-file).
 */
async function listCloudRuns(
  repoDir: string,
  branch: string,
): Promise<{ runIds: string[]; files: CloudFile[] }> {
  const ref = `origin/${branch}`;
  const { stdout } = await execFileAsync(
    "git",
    ["ls-tree", "-r", "-z", ref, "--", RUNS_PREFIX],
    { cwd: repoDir, maxBuffer: 64 * 1024 * 1024, env: gitChildEnv(), timeout: READ_TIMEOUT_MS },
  );
  const files: CloudFile[] = [];
  for (const rec of stdout.split("\0")) {
    // "<mode> blob <oid>\t<path>"
    const m = /^\d+ blob ([0-9a-f]{40,64})\t(.+)$/s.exec(rec);
    if (m) files.push({ oid: m[1] as string, path: m[2] as string });
  }
  const runIds = new Set<string>();
  const prefix = `${RUNS_PREFIX}/`;
  for (const { path: p } of files) {
    if (!p.startsWith(prefix)) continue;
    const rest = p.slice(prefix.length);
    const slash = rest.indexOf("/");
    const id = slash === -1 ? rest : rest.slice(0, slash);
    // Remote tree names are untrusted: only plain directory names become run ids.
    if (isSafeRunId(id)) runIds.add(id);
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
  runFiles: CloudFile[],
  destRunDir: string,
): Promise<void> {
  const runPrefix = `${RUNS_PREFIX}/${runId}/`;
  const mine: { relative: string; oid: string }[] = [];
  for (const f of runFiles) {
    if (!f.path.startsWith(runPrefix)) continue;
    const relative = f.path.slice(runPrefix.length);
    if (relative.length === 0) continue;
    // A remote tree is untrusted data: refuse any path that could leave destRunDir.
    if (!isSafeRelativePath(relative)) throw new Error("unsafe path in remote run");
    mine.push({ relative, oid: f.oid });
  }
  // Read the blobs as raw bytes so screenshots/traces survive intact.
  const blobs = await readBlobs(repoDir, mine.map((m) => m.oid));
  mine.forEach((m, i) => {
    const outPath = join(destRunDir, ...m.relative.split(posix.sep));
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, blobs[i] as Buffer);
  });
  // Mark provenance so published-data.ts -> originForRun reports "cloud".
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
  /** Called as runs are copied in, so a caller can show progress. */
  onProgress?: (done: number, total: number) => void;
}): Promise<CloudSyncResult> {
  const { repoDir, branch, runsRoot, onProgress } = opts;
  // The branch goes to git as an argument; refuse anything that could parse as an option.
  if (!isSafeBranchName(branch)) return { added: [], skipped: [], ok: false, reason: "invalid branch name" };

  // 1. READ-ONLY fetch of the runs-data branch. No push, no branch edit, no
  //    commit - just update the remote-tracking ref so we can read it.
  try {
    await execFileAsync("git", ["fetch", "origin", branch], {
      cwd: repoDir,
      maxBuffer: 64 * 1024 * 1024,
      env: gitChildEnv(),
      timeout: FETCH_TIMEOUT_MS,
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
  let cloud: { runIds: string[]; files: CloudFile[] };
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
  // local store byte-for-byte unchanged. We never write through an
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
      onProgress?.(added.length, toAdd.length);
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
