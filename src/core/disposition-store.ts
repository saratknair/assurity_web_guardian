/**
 * Disposition store (design Section I.8, local part). File I/O around the pure
 * log in dispositions.ts: safe read, atomic write, a locked read-merge-write step
 * so concurrent CLI and GUI writers lose nothing, and sync bookkeeping.
 * No clock except the caller-supplied "now"; no randomness; no dependencies.
 */
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { mergeLogs, parseLog, serializeLog } from "./dispositions.js";
import type { DispositionEntry, DispositionLog } from "./dispositions.js";

export const LOG_FILE = "dispositions.json";
export const SYNC_FILE = "dispositions.sync.json";

export function logPath(artifactsDir: string): string {
  return join(artifactsDir, LOG_FILE);
}

export function syncPath(artifactsDir: string): string {
  return join(artifactsDir, SYNC_FILE);
}

export type ReadLogResult =
  | { status: "ok"; log: DispositionLog }
  | { status: "missing"; log: DispositionLog }
  | { status: "unavailable"; log: DispositionLog; reason: string };

function emptyLog(): DispositionLog {
  return { schemaVersion: 1, entries: [] };
}

/**
 * Read the log. A missing file is an empty log. A file that cannot be read, is not
 * valid, or contains any rejected entry is `unavailable`: callers must not write over it.
 */
export function readLog(path: string): ReadLogResult {
  if (!existsSync(path)) return { status: "missing", log: emptyLog() };
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    return { status: "unavailable", log: emptyLog(), reason: `cannot read log: ${errMessage(err)}` };
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const parsed = parseLog(text);
  if (parsed.rejected.length > 0) {
    const first = parsed.rejected[0];
    return {
      status: "unavailable",
      log: emptyLog(),
      reason: `log has ${parsed.rejected.length} invalid item(s): ${first.reason}`,
    };
  }
  return { status: "ok", log: parsed.log };
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

let tmpCounter = 0;

/** Write the serialized log to a temp file in the same directory, then rename over the target. */
export function writeLogAtomic(path: string, log: DispositionLog): void {
  writeTextAtomic(path, serializeLog(log));
}

function writeTextAtomic(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  tmpCounter += 1;
  const tmp = `${path}.tmp-${process.pid}-${tmpCounter}`;
  try {
    writeFileSync(tmp, text, "utf8");
    renameSync(tmp, path);
  } catch (err) {
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      /* ignore cleanup failure */
    }
    throw err;
  }
}

const LOCK_WAIT_MS = 10_000;
const LOCK_STALE_MS = 30_000;

function sleepMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Run `fn` while holding an exclusive lock file next to `path`. Throws if the lock cannot be taken. */
export function withFileLock<T>(path: string, fn: () => T): T {
  const lock = `${path}.lock`;
  mkdirSync(dirname(path), { recursive: true });
  const started = Date.now();
  let fd = -1;
  for (;;) {
    try {
      fd = openSync(lock, "wx");
      break;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST" && code !== "EPERM" && code !== "EACCES") throw err;
      try {
        if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) {
          unlinkSync(lock);
          continue;
        }
      } catch {
        /* lock vanished or is busy; retry */
      }
      if (Date.now() - started > LOCK_WAIT_MS) throw new Error("Timed out waiting for the decisions file lock");
      sleepMs(15);
    }
  }
  try {
    return fn();
  } finally {
    try {
      closeSync(fd);
    } catch {
      /* ignore */
    }
    try {
      unlinkSync(lock);
    } catch {
      /* ignore */
    }
  }
}

export type UpdateLogResult =
  | { ok: true; log: DispositionLog; added: DispositionEntry[] }
  | { ok: false; reason: string };

/**
 * Read-merge-write under a lock. `build` receives the current log (empty if the file is
 * missing) and returns the entries to add, or null to abort. An unavailable log is never
 * overwritten. Entries already present (same id) are not added twice.
 */
export function updateLog(
  path: string,
  build: (current: DispositionLog) => DispositionEntry[] | null,
): UpdateLogResult {
  try {
    return withFileLock(path, () => {
      const current = readLog(path);
      if (current.status === "unavailable") return { ok: false as const, reason: current.reason };
      const toAdd = build(current.log);
      if (toAdd === null) return { ok: false as const, reason: "aborted" };
      const have = new Set(current.log.entries.map((e) => e.id));
      const added = toAdd.filter((e) => !have.has(e.id));
      const merged = mergeLogs(current.log, { schemaVersion: 1, entries: toAdd });
      if (added.length > 0 || current.status === "missing") writeLogAtomic(path, merged);
      return { ok: true as const, log: merged, added };
    });
  } catch (err) {
    return { ok: false, reason: errMessage(err) };
  }
}

/** Append entries to the log (union by id) inside the locked read-merge-write step. */
export function appendEntries(path: string, entries: DispositionEntry[]): UpdateLogResult {
  return updateLog(path, () => entries);
}

/** Merge a log from elsewhere (for example the remote copy) into the local file as a union. */
export function mergeIntoLocal(path: string, other: DispositionLog): UpdateLogResult {
  return updateLog(path, () => other.entries);
}

// ---------------------------------------------------------------------------
// Sync bookkeeping: artifacts/dispositions.sync.json
// ---------------------------------------------------------------------------

export interface SyncState {
  schemaVersion: 1;
  syncedIds: string[];
  lastSyncedAt: string | null;
}

export function readSyncState(path: string): SyncState {
  const empty: SyncState = { schemaVersion: 1, syncedIds: [], lastSyncedAt: null };
  try {
    const data: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (typeof data !== "object" || data === null || Array.isArray(data)) return empty;
    const r = data as Record<string, unknown>;
    const ids = Array.isArray(r.syncedIds)
      ? [...new Set(r.syncedIds.filter((x): x is string => typeof x === "string"))].sort()
      : [];
    const last = typeof r.lastSyncedAt === "string" ? r.lastSyncedAt : null;
    return { schemaVersion: 1, syncedIds: ids, lastSyncedAt: last };
  } catch {
    return empty;
  }
}

export function writeSyncState(path: string, state: SyncState): void {
  const out = {
    schemaVersion: 1,
    syncedIds: [...new Set(state.syncedIds)].sort(),
    lastSyncedAt: state.lastSyncedAt,
  };
  writeTextAtomic(path, JSON.stringify(out, null, 2) + "\n");
}

/** Record ids as synced (union with what is already recorded) and set lastSyncedAt to `now`. */
export function markSynced(path: string, ids: string[], now: Date): SyncState {
  return withFileLock(path, () => {
    const prev = readSyncState(path);
    const next: SyncState = {
      schemaVersion: 1,
      syncedIds: [...new Set([...prev.syncedIds, ...ids])].sort(),
      lastSyncedAt: now.toISOString(),
    };
    writeSyncState(path, next);
    return next;
  });
}

/** "Not yet synced" is every local id not in syncedIds. */
export function unsyncedIds(log: DispositionLog, state: SyncState): string[] {
  const synced = new Set(state.syncedIds);
  return log.entries.map((e) => e.id).filter((id) => !synced.has(id));
}
