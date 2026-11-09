/**
 * Config_Publish delta computation (design J.8.2). Pure: no I/O.
 * Maps are repo-relative path -> blob id.
 */
import { isConfigPath } from "./publish-paths.js";

export interface PublishDelta {
  added: string[];
  modified: string[];
  deleted: string[];
}

export type PublishBlockReason =
  | "nothing-to-publish"
  | "no-origin"
  | "publish-running"
  | "staged-changes";

export interface CanPublishInput {
  delta: PublishDelta;
  originExists: boolean;
  publishRunning: boolean;
  stagedOperations: number;
}

export interface CanPublishResult {
  canPublish: boolean;
  reason?: PublishBlockReason;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Compares local and remote blob maps; only configuration paths are considered. */
export function computeDelta(
  local: ReadonlyMap<string, string> | Record<string, string>,
  remote: ReadonlyMap<string, string> | Record<string, string>,
): PublishDelta {
  const l = local instanceof Map ? local : new Map(Object.entries(local));
  const r = remote instanceof Map ? remote : new Map(Object.entries(remote));
  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];
  for (const [p, id] of l) {
    if (!isConfigPath(p)) continue;
    const rid = r.get(p);
    if (rid === undefined) added.push(p);
    else if (rid !== id) modified.push(p);
  }
  for (const p of r.keys()) {
    if (isConfigPath(p) && !l.has(p)) deleted.push(p);
  }
  return { added: added.sort(cmp), modified: modified.sort(cmp), deleted: deleted.sort(cmp) };
}

export function isDeltaEmpty(d: PublishDelta): boolean {
  return d.added.length === 0 && d.modified.length === 0 && d.deleted.length === 0;
}

/** Publishing is allowed only for a non-empty delta with an origin, no running publish, and nothing staged. */
export function canPublish(input: CanPublishInput): CanPublishResult {
  if (isDeltaEmpty(input.delta)) return { canPublish: false, reason: "nothing-to-publish" };
  if (!input.originExists) return { canPublish: false, reason: "no-origin" };
  if (input.publishRunning) return { canPublish: false, reason: "publish-running" };
  if (input.stagedOperations > 0) return { canPublish: false, reason: "staged-changes" };
  return { canPublish: true };
}
