/**
 * Synchronisation of decisions to the `runs-data` branch (design I.8).
 *
 * Push path: fetch, read the remote log, union with the local log (mergeLogs), build ONE
 * additive commit on the fetched tip, and push it without force. The commit is built with
 * git plumbing (a temporary index file in the OS temp directory, hash-object, write-tree,
 * commit-tree), so the Reviewer's branch, index, and working tree are never touched and no
 * worktree has to be created. The temporary directory is always removed. A push rejected
 * as non-fast-forward is retried from a fresh fetch (union again, no rebase), at most 3 attempts.
 * On any failure the local log is kept and the result is "Not yet synced" with a scrubbed reason.
 * No AI, no new dependencies.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { mergeLogs, parseLog, serializeLog } from "../core/dispositions.js";
import type { DispositionLog } from "../core/dispositions.js";
import { logPath, markSynced, mergeIntoLocal, readLog, syncPath } from "../core/disposition-store.js";
import type { GitPort, GitResult } from "./git-port.js";
import { scrubForDisplay } from "./scrub.js";

export const REMOTE_BRANCH = "runs-data";
export const REMOTE_LOG_PATH = "artifacts/dispositions.json";
export const MAX_PUSH_ATTEMPTS = 3;

export interface DispositionSyncDeps {
  git: GitPort;
  /** Project root (used only to scrub paths from reasons). */
  root: string;
  /** Directory holding dispositions.json and dispositions.sync.json. */
  artifactsDir: string;
  now?: () => Date;
  /** Parent directory for the temporary index (default: OS temp directory). */
  tmpRoot?: string;
}

export type PushResult =
  | { state: "synced"; pushed: number; attempts: number; commit: string | null }
  | { state: "not-yet-synced"; reason: string; pendingIds: string[] };

export type PullResult = { ok: true; added: number } | { ok: false; reason: string };

function scrub(text: string, root: string): string {
  const s = scrubForDisplay(text, { projectRoot: root, home: homedir() }).replace(/\s+/g, " ").trim();
  return s.length > 0 ? s.slice(0, 300) : "unknown error";
}

function failText(r: GitResult): string {
  return (r.stderr.trim() || r.stdout.trim() || `git exited with code ${r.code}`).split("\n")[0] as string;
}

type Step<T> = { ok: true; value: T } | { ok: false; reason: string };

/** Fetch the remote branch and return the 40-character tip. */
async function fetchTip(git: GitPort): Promise<Step<string>> {
  const f = await git.run(["fetch", "origin", REMOTE_BRANCH]);
  if (f.code !== 0) return { ok: false, reason: `fetch failed: ${failText(f)}` };
  const p = await git.run(["rev-parse", "--verify", "FETCH_HEAD^{commit}"]);
  const sha = p.stdout.trim();
  if (p.code !== 0 || !/^[0-9a-f]{40}$/.test(sha)) return { ok: false, reason: "cannot resolve the fetched runs-data tip" };
  return { ok: true, value: sha };
}

/** Read the remote log at `tip`. Absent file is an empty log (text null). An invalid remote log is a failure. */
async function readRemote(git: GitPort, tip: string): Promise<Step<{ log: DispositionLog; text: string | null }>> {
  const ls = await git.run(["ls-tree", "--name-only", tip, "--", REMOTE_LOG_PATH]);
  if (ls.code !== 0) return { ok: false, reason: `cannot list runs-data: ${failText(ls)}` };
  if (ls.stdout.trim() === "") return { ok: true, value: { log: { schemaVersion: 1, entries: [] }, text: null } };
  const cat = await git.run(["cat-file", "-p", `${tip}:${REMOTE_LOG_PATH}`]);
  if (cat.code !== 0) return { ok: false, reason: `cannot read remote decisions: ${failText(cat)}` };
  let text = cat.stdout;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const parsed = parseLog(text);
  if (parsed.rejected.length > 0) {
    return { ok: false, reason: `remote decisions file has ${parsed.rejected.length} invalid item(s); not overwritten` };
  }
  return { ok: true, value: { log: parsed.log, text } };
}

function isNonFastForward(r: GitResult): boolean {
  const t = `${r.stderr}\n${r.stdout}`.toLowerCase();
  return t.includes("non-fast-forward") || t.includes("fetch first") || t.includes("[rejected]") || t.includes("rejected");
}

/** Build one additive commit (tip + log file) using a temporary index. Returns the commit sha. */
async function buildCommit(
  git: GitPort,
  tip: string,
  text: string,
  count: number,
  tmpRoot: string,
): Promise<Step<string>> {
  let dir: string | null = null;
  try {
    dir = mkdtempSync(join(tmpRoot, "awg-dsp-"));
    const env = { GIT_INDEX_FILE: join(dir, "index") };
    const rt = await git.run(["read-tree", tip], { env });
    if (rt.code !== 0) return { ok: false, reason: `read-tree failed: ${failText(rt)}` };
    const ho = await git.run(["hash-object", "-w", "--no-filters", "--stdin"], { stdin: text, env });
    const blob = ho.stdout.trim();
    if (ho.code !== 0 || !/^[0-9a-f]{40}$/.test(blob)) return { ok: false, reason: `hash-object failed: ${failText(ho)}` };
    const ui = await git.run(["update-index", "--add", "--cacheinfo", `100644,${blob},${REMOTE_LOG_PATH}`], { env });
    if (ui.code !== 0) return { ok: false, reason: `update-index failed: ${failText(ui)}` };
    const wt = await git.run(["write-tree"], { env });
    const tree = wt.stdout.trim();
    if (wt.code !== 0 || !/^[0-9a-f]{40}$/.test(tree)) return { ok: false, reason: `write-tree failed: ${failText(wt)}` };
    const msg = `dispositions: add ${count} ${count === 1 ? "entry" : "entries"}`;
    const ct = await git.run(["commit-tree", tree, "-p", tip, "-m", msg], { env });
    const commit = ct.stdout.trim();
    if (ct.code !== 0 || !/^[0-9a-f]{40}$/.test(commit)) return { ok: false, reason: `commit failed: ${failText(ct)}` };
    return { ok: true, value: commit };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  } finally {
    if (dir !== null) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
  }
}

function pendingOf(deps: DispositionSyncDeps): string[] {
  const local = readLog(logPath(deps.artifactsDir));
  return local.log.entries.map((e) => e.id);
}

/** Push local decisions to runs-data (additive, never forced). Never throws. */
export async function pushDispositions(deps: DispositionSyncDeps): Promise<PushResult> {
  const now = deps.now ?? (() => new Date());
  const tmpRoot = deps.tmpRoot ?? tmpdir();
  const lp = logPath(deps.artifactsDir);
  const fail = (reason: string): PushResult => ({
    state: "not-yet-synced",
    reason: scrub(reason, deps.root),
    pendingIds: pendingOf(deps),
  });
  try {
    let lastReason = "push was rejected";
    for (let attempt = 1; attempt <= MAX_PUSH_ATTEMPTS; attempt++) {
      const local = readLog(lp);
      if (local.status === "unavailable") return fail(local.reason);

      const tip = await fetchTip(deps.git);
      if (!tip.ok) return fail(tip.reason);
      const remote = await readRemote(deps.git, tip.value);
      if (!remote.ok) return fail(remote.reason);

      const merged = mergeLogs(remote.value.log, local.log);
      const text = serializeLog(merged);
      const mergedIds = merged.entries.map((e) => e.id);
      const remoteIds = new Set(remote.value.log.entries.map((e) => e.id));
      const toAdd = mergedIds.filter((id) => !remoteIds.has(id)).length;

      if (remote.value.text !== null && remote.value.text === text) {
        const mi = mergeIntoLocal(lp, merged);
        if (!mi.ok) return fail(mi.reason);
        markSynced(syncPath(deps.artifactsDir), mergedIds, now());
        return { state: "synced", pushed: 0, attempts: attempt, commit: null };
      }

      const built = await buildCommit(deps.git, tip.value, text, toAdd, tmpRoot);
      if (!built.ok) return fail(built.reason);

      const push = await deps.git.run(["push", "--porcelain", "origin", `${built.value}:refs/heads/${REMOTE_BRANCH}`]);
      if (push.code === 0) {
        const mi = mergeIntoLocal(lp, merged);
        if (!mi.ok) return fail(mi.reason);
        markSynced(syncPath(deps.artifactsDir), mergedIds, now());
        return { state: "synced", pushed: toAdd, attempts: attempt, commit: built.value };
      }
      lastReason = `push failed: ${failText(push)}`;
      if (!isNonFastForward(push)) return fail(lastReason);
      // Non-fast-forward: loop again from a fresh fetch (union is recomputed, no rebase).
    }
    return fail(`${lastReason} (gave up after ${MAX_PUSH_ATTEMPTS} attempts)`);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

/** Merge the remote log into the local log as a union. Read-only toward the remote. Never throws. */
export async function pullDispositions(deps: DispositionSyncDeps): Promise<PullResult> {
  const now = deps.now ?? (() => new Date());
  try {
    const tip = await fetchTip(deps.git);
    if (!tip.ok) return { ok: false, reason: scrub(tip.reason, deps.root) };
    const remote = await readRemote(deps.git, tip.value);
    if (!remote.ok) return { ok: false, reason: scrub(remote.reason, deps.root) };
    if (remote.value.log.entries.length === 0) return { ok: true, added: 0 };
    const mi = mergeIntoLocal(logPath(deps.artifactsDir), remote.value.log);
    if (!mi.ok) return { ok: false, reason: scrub(mi.reason, deps.root) };
    // Entries that came from the remote are already there.
    markSynced(syncPath(deps.artifactsDir), remote.value.log.entries.map((e) => e.id), now());
    return { ok: true, added: mi.added.length };
  } catch (err) {
    return { ok: false, reason: scrub(err instanceof Error ? err.message : String(err), deps.root) };
  }
}
