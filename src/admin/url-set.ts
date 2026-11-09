/**
 * Approved_URL set rules (design J.4.1, J.4.2; Requirements 22.2 to 22.6, 22.10, 22.11,
 * 22.17, 22.19). PURE and total: no I/O, never throws.
 *
 * - Normalisation: approved scheme, in-domain, no fragment, no default port, max 2048 chars,
 *   trailing "/" when the last path segment has no dot.
 * - The set is ordered; add is idempotent; new URLs append; existing entries keep their text.
 * - Baselines are keyed by slug, so a different URL with the same slug is rejected.
 * - The maximum is fixed: Math.min(seed.maxUrls, cfg.limits.pages).
 * - edit(from, to) = remove + add as one unit; if the add is invalid nothing changes.
 */

import { isApprovedDomain } from "../safety/domain-guard.js";

export const MAX_URL_LENGTH = 2048;

/** Same keying as spec-generator `slugify` (kept local so this module stays dependency-free). */
export function urlSlug(url: string): string {
  const u = url
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "");
  return u.toLowerCase() || "home";
}

export type NormaliseResult = { ok: true; url: string } | { ok: false; reason: string };

export function normaliseApprovedUrl(
  input: string,
  approvedDomain: string,
  approvedSchemes: string[] = ["https"],
): NormaliseResult {
  try {
    const raw = (typeof input === "string" ? input : "").trim();
    if (raw.length === 0) return { ok: false, reason: "Enter a web address" };
    if (raw.length > MAX_URL_LENGTH) return { ok: false, reason: "That address is too long" };
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      return { ok: false, reason: "That is not a valid web address" };
    }
    const schemes = (approvedSchemes.length ? approvedSchemes : ["https"]).map((s) =>
      s.toLowerCase().replace(/:$/, ""),
    );
    const scheme = u.protocol.replace(/:$/, "");
    if (!schemes.includes(scheme)) {
      return { ok: false, reason: `Only ${schemes.join(" or ")} addresses are allowed` };
    }
    if (u.username || u.password) {
      return { ok: false, reason: "Do not include a user name or password" };
    }
    if (!isApprovedDomain(u.href, approvedDomain)) {
      return { ok: false, reason: `That address is outside ${approvedDomain}` };
    }
    u.hash = "";
    // URL already drops default ports (443 for https, 80 for http).
    let path = u.pathname;
    const last = path.split("/").pop() ?? "";
    if (!path.endsWith("/") && !last.includes(".")) path += "/";
    u.pathname = path;
    const out = u.href;
    if (out.length > MAX_URL_LENGTH) return { ok: false, reason: "That address is too long" };
    return { ok: true, url: out };
  } catch {
    return { ok: false, reason: "That is not a valid web address" };
  }
}

/** Fixed maximum number of Approved_URLs. */
export function urlLimit(seedMaxUrls: number, cfgLimitsPages: number): number {
  return Math.min(seedMaxUrls, cfgLimitsPages);
}

/** Display text such as "3 of 10 used". */
export function usedText(count: number, max: number): string {
  return `${count} of ${max} used`;
}

export function limitReachedText(max: number): string {
  return `The limit of ${max} approved pages is reached. Remove one to free a slot.`;
}

export interface PendingOp {
  opId?: string;
  editId?: string | null;
  op: "add" | "remove";
  url: string;
}

export interface ProjectedEntry {
  url: string;
  /** "add" or "remove" when a staged operation affects this URL, otherwise null. */
  pending: "add" | "remove" | null;
  requiresReapproval: boolean;
}

export interface ProjectedUrls {
  /** Every URL to show, in order; removed URLs stay listed with pending "remove". */
  entries: ProjectedEntry[];
  /** The projected set (removals applied). */
  urls: string[];
  used: number;
  max: number;
  usedText: string;
}

/** Project the seed plus staged operations. Staged ops are assumed already validated. */
export function projectUrls(seed: string[], pending: PendingOp[], max: number): ProjectedUrls {
  const entries: ProjectedEntry[] = seed.map((url) => ({
    url,
    pending: null,
    requiresReapproval: false,
  }));
  // URLs added by an edit unit need re-approval.
  const editsWithAdd = new Set<string>();
  for (const p of pending) if (p.op === "add" && p.editId) editsWithAdd.add(p.editId);

  for (const p of pending) {
    const idx = entries.findIndex((e) => e.url === p.url);
    if (p.op === "remove") {
      if (idx >= 0) entries[idx].pending = "remove";
    } else if (idx >= 0) {
      if (entries[idx].pending === "remove") {
        entries[idx].pending = null; // re-added after a staged removal
      }
    } else {
      entries.push({
        url: p.url,
        pending: "add",
        requiresReapproval: !!p.editId && editsWithAdd.has(p.editId),
      });
    }
  }
  const urls = entries.filter((e) => e.pending !== "remove").map((e) => e.url);
  return { entries, urls, used: urls.length, max, usedText: usedText(urls.length, max) };
}

export type UrlOp =
  | { op: "add"; url: string }
  | { op: "remove"; url: string }
  | { op: "edit"; from: string; to: string };

export interface UrlOpOutcome {
  op: UrlOp;
  status: "added" | "removed" | "edited" | "already-approved" | "not-found" | "rejected";
  reason?: string;
  /** Normalised URL that was added (add or edit). */
  added?: string;
  /** URL that was removed (remove or edit). */
  removed?: string;
}

export interface ApplyUrlOpsResult {
  urls: string[];
  outcomes: UrlOpOutcome[];
  /** URLs added by an edit; they need their baselines approved again. */
  requiresReapproval: string[];
  max: number;
  usedText: string;
}

export interface ApplyContext {
  approvedDomain: string;
  approvedSchemes?: string[];
  max: number;
}

/** Find a set member equal to `input` as typed or after normalisation. */
function findMember(
  urls: string[],
  input: string,
  ctx: ApplyContext,
): { index: number; normalised: string | null } {
  const exact = urls.indexOf(input);
  if (exact >= 0) return { index: exact, normalised: input };
  const n = normaliseApprovedUrl(input, ctx.approvedDomain, ctx.approvedSchemes);
  if (!n.ok) return { index: -1, normalised: null };
  return { index: urls.indexOf(n.url), normalised: n.url };
}

/** Validate an add against `urls`; returns the normalised URL or a rejection/no-op. */
function checkAdd(
  urls: string[],
  input: string,
  ctx: ApplyContext,
): { kind: "ok"; url: string } | { kind: "already"; url: string } | { kind: "rejected"; reason: string } {
  const n = normaliseApprovedUrl(input, ctx.approvedDomain, ctx.approvedSchemes);
  if (!n.ok) return { kind: "rejected", reason: n.reason };
  if (urls.includes(n.url)) return { kind: "already", url: n.url };
  const slug = urlSlug(n.url);
  const clash = urls.find((u) => urlSlug(u) === slug);
  if (clash !== undefined) {
    return {
      kind: "rejected",
      reason: `That address would share baselines with ${clash}`,
    };
  }
  if (urls.length >= ctx.max) return { kind: "rejected", reason: limitReachedText(ctx.max) };
  return { kind: "ok", url: n.url };
}

/**
 * Apply operations in order to `seed`. Each operation is independent: an invalid one is
 * reported and leaves the set unchanged. An edit is atomic (remove + add as one unit).
 */
export function applyUrlOps(seed: string[], ops: UrlOp[], ctx: ApplyContext): ApplyUrlOpsResult {
  let urls = seed.slice();
  const outcomes: UrlOpOutcome[] = [];
  const requiresReapproval: string[] = [];

  for (const op of ops) {
    try {
      if (op.op === "add") {
        const c = checkAdd(urls, op.url, ctx);
        if (c.kind === "ok") {
          urls = [...urls, c.url];
          outcomes.push({ op, status: "added", added: c.url });
        } else if (c.kind === "already") {
          outcomes.push({ op, status: "already-approved", reason: "already approved", added: c.url });
        } else {
          outcomes.push({ op, status: "rejected", reason: c.reason });
        }
      } else if (op.op === "remove") {
        const m = findMember(urls, op.url, ctx);
        if (m.index < 0) {
          outcomes.push({ op, status: "not-found", reason: "That address is not in the list" });
        } else {
          const removed = urls[m.index];
          urls = urls.filter((_, i) => i !== m.index);
          outcomes.push({ op, status: "removed", removed });
        }
      } else if (op.op === "edit") {
        const m = findMember(urls, op.from, ctx);
        if (m.index < 0) {
          outcomes.push({ op, status: "not-found", reason: "That address is not in the list" });
          continue;
        }
        const removed = urls[m.index];
        const without = urls.filter((_, i) => i !== m.index);
        const c = checkAdd(without, op.to, ctx);
        if (c.kind === "rejected") {
          outcomes.push({ op, status: "rejected", reason: c.reason });
        } else if (c.kind === "already") {
          // The target is already approved elsewhere in the list: nothing is staged.
          outcomes.push({ op, status: "rejected", reason: "already approved" });
        } else {
          urls = [...without, c.url];
          requiresReapproval.push(c.url);
          outcomes.push({ op, status: "edited", removed, added: c.url });
        }
      } else {
        outcomes.push({ op, status: "rejected", reason: "Unknown operation" });
      }
    } catch {
      outcomes.push({ op, status: "rejected", reason: "That change could not be applied" });
    }
  }

  return {
    urls,
    outcomes,
    requiresReapproval,
    max: ctx.max,
    usedText: usedText(urls.length, ctx.max),
  };
}
