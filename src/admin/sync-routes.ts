/**
 * Decision sync routes (design I.8, J; Requirements 18.13, 20.5, 20.6).
 *
 * POST /api/dispositions/sync starts one push of the local decisions to `runs-data` and answers
 * 202 at once; 409 when a sync is already running (single-flight per project root).
 * GET /api/dispositions/sync/status reports "running", "synced", or "not-yet-synced" with a
 * scrubbed reason. Only the GitPort from the console deps is used. No AI.
 */
import { join } from "node:path";
import { pushDispositions } from "./disposition-sync.js";
import type { PushResult } from "./disposition-sync.js";
import { readLog, logPath, readSyncState, syncPath, unsyncedIds } from "../core/disposition-store.js";
import type { ConsoleResponse, HandlerContext, RouteDef } from "./console-routes.js";

export type SyncPhase = "idle" | "running" | "synced" | "not-yet-synced";

interface SyncRecord {
  running: boolean;
  last: PushResult | null;
  startedAt: string | null;
  finishedAt: string | null;
  done: Promise<void> | null;
}

const records = new Map<string, SyncRecord>();

function recordFor(root: string): SyncRecord {
  let r = records.get(root);
  if (!r) {
    r = { running: false, last: null, startedAt: null, finishedAt: null, done: null };
    records.set(root, r);
  }
  return r;
}

/** Resolves when the sync for this root (if any) has finished. For tests. */
export function waitForSync(root: string): Promise<void> {
  return recordFor(root).done ?? Promise.resolve();
}

/** Forget remembered sync results (tests). */
export function resetSyncState(): void {
  records.clear();
}

async function postSync(ctx: HandlerContext): Promise<ConsoleResponse> {
  const { deps } = ctx;
  const rec = recordFor(deps.fs.root);
  if (rec.running) {
    return { status: 409, json: { error: "A sync is already running.", state: "running" } };
  }
  rec.running = true;
  rec.startedAt = deps.clock.now().toISOString();
  rec.finishedAt = null;
  const artifactsDir = join(deps.fs.root, "artifacts");
  rec.done = (async () => {
    try {
      rec.last = await pushDispositions({
        git: deps.git,
        root: deps.fs.root,
        artifactsDir,
        now: () => deps.clock.now(),
      });
    } catch {
      rec.last = { state: "not-yet-synced", reason: "sync failed", pendingIds: [] };
    } finally {
      rec.running = false;
      rec.finishedAt = deps.clock.now().toISOString();
    }
  })();
  return { status: 202, json: { state: "running", startedAt: rec.startedAt } };
}

async function getSyncStatus(ctx: HandlerContext): Promise<ConsoleResponse> {
  const { deps } = ctx;
  const rec = recordFor(deps.fs.root);
  const artifactsDir = join(deps.fs.root, "artifacts");
  const local = readLog(logPath(artifactsDir));
  const sync = readSyncState(syncPath(artifactsDir));
  const pending = local.status === "unavailable" ? 0 : unsyncedIds(local.log, sync).length;
  let state: SyncPhase;
  let reason: string | null = null;
  if (rec.running) state = "running";
  else if (rec.last) {
    state = rec.last.state;
    if (rec.last.state === "not-yet-synced") reason = rec.last.reason;
  } else state = pending === 0 ? "synced" : "not-yet-synced";
  if (state === "synced" && pending > 0) state = "not-yet-synced";
  return {
    status: 200,
    json: {
      state,
      reason,
      notYetSynced: pending,
      lastSyncedAt: sync.lastSyncedAt,
      startedAt: rec.startedAt,
      finishedAt: rec.finishedAt,
    },
  };
}

export const SYNC_BODY_LIMIT = 1024;

export const SYNC_GROUP: RouteDef[] = [
  { method: "POST", pattern: "/api/dispositions/sync", mutating: true, maxBodyBytes: SYNC_BODY_LIMIT, handler: postSync },
  { method: "GET", pattern: "/api/dispositions/sync/status", mutating: false, maxBodyBytes: 0, handler: getSyncStatus },
];
