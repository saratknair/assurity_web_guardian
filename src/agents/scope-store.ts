import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { AppendOnlyLog } from "../telemetry/audit-log.js";
import { newReviewId } from "../core/ids.js";

/**
 * Scope_Store (Req 5.4-5.6). Manages the two-tier scope model used by the
 * discovery + approval flow:
 *
 *  - PROPOSED scope: written by the crawler to
 *    `artifacts/pending-review/scope/<domain>.proposed.json`. Not authoritative.
 *  - APPROVED scope: `config/scope/<domain>.approved.json`. Authoritative,
 *    human-approved, version-controlled. The crawler NEVER writes it (5.4).
 *
 * `diffScope` and `groupByPathSegment` are pure, total functions validated by
 * Property 12 (exact set partition) and Property 13 (lossless grouping).
 */

/** A scope file. `pages` is always deduped, normalized, and sorted. */
export interface ScopeFile {
  domain: string;
  generatedAt: string;
  pages: string[];
}

/** An exact set partition of proposed vs approved pages (Req 5.5). */
export interface ScopeDifference {
  added: string[];
  removed: string[];
  unchanged: string[];
}

/** A group of pages sharing the same first URL path segment (Req 5.6). */
export interface ScopeGroup {
  segment: string;
  pages: string[];
}

/** Sentinel segment for pages whose path has no first segment (root "/"). */
const ROOT_SEGMENT = "(root)";

/** Deduplicate and sort a page list deterministically. */
function normalizePages(pages: string[]): string[] {
  return Array.from(new Set(pages)).sort();
}

/**
 * Build a normalized `ScopeFile`. `pages` are deduped + sorted so a scope file
 * is a canonical representation regardless of input order.
 */
function makeScopeFile(domain: string, pages: string[], generatedAt: string): ScopeFile {
  return { domain, generatedAt, pages: normalizePages(pages) };
}

/**
 * Write the PROPOSED scope for a domain to
 * `artifacts/pending-review/scope/<domain>.proposed.json`, creating the
 * directory if missing. Returns the written path. This never touches the
 * authoritative approved file (Req 5.4).
 */
export function writeProposedScope(domain: string, pages: string[]): string {
  const dir = resolve("artifacts/pending-review/scope");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const scope = makeScopeFile(domain, pages, new Date().toISOString());
  const p = join(dir, `${domain}.proposed.json`);
  writeFileSync(p, JSON.stringify(scope, null, 2), "utf8");
  return p;
}

/**
 * Read the APPROVED scope for a domain from
 * `config/scope/<domain>.approved.json`. Returns `null` when the file does not
 * exist. Pages are re-normalized on read so the in-memory shape is canonical.
 */
export function readApprovedScope(domain: string): ScopeFile | null {
  const p = resolve("config/scope", `${domain}.approved.json`);
  if (!existsSync(p)) return null;
  const parsed = JSON.parse(readFileSync(p, "utf8")) as ScopeFile;
  return makeScopeFile(parsed.domain ?? domain, parsed.pages ?? [], parsed.generatedAt ?? "");
}

/**
 * Read the PROPOSED scope for a domain from
 * `artifacts/pending-review/scope/<domain>.proposed.json`. Returns `null` when
 * the file does not exist. Pages are re-normalized on read so the in-memory
 * shape is canonical. This is the sibling read for the file `writeProposedScope`
 * emits, used by the approval CLI to present a proposed scope for review.
 */
export function readProposedScope(domain: string): ScopeFile | null {
  const p = resolve("artifacts/pending-review/scope", `${domain}.proposed.json`);
  if (!existsSync(p)) return null;
  const parsed = JSON.parse(readFileSync(p, "utf8")) as ScopeFile;
  return makeScopeFile(parsed.domain ?? domain, parsed.pages ?? [], parsed.generatedAt ?? "");
}

/** Raised when a scope approval is not attributed to a human reviewer (Req 12.2, 12.7). */
export class ScopeApprovalError extends Error {}

/**
 * Agent/process identities that may NEVER approve a scope. Mirrors the
 * no-self-approval semantics of `ApprovalGate` (Req 12.2, 12.7): a scope must be
 * approved by a human, not by the crawler or any other agent.
 */
const AGENT_IDENTITIES = new Set([
  "Specification_Agent",
  "Spec_Generator",
  "Discovery crawler",
  "Quality_Analysis_Agent",
  "Visual_Explanation_Agent",
  "Triage_Agent",
  "Orchestrator",
]);

/**
 * Promote a set of pages to the AUTHORITATIVE human-approved scope for a domain
 * (Req 5.4, 12.2, 12.7). Writes `config/scope/<domain>.approved.json` (creating
 * `config/scope/` if missing) and appends an append-only audit record of the
 * approval to `artifacts/audit.jsonl`, reusing the same `AppendOnlyLog`
 * mechanism as `ApprovalGate`. Returns the written path.
 *
 * Human-in-control: this is the ONLY writer of the approved file. It requires a
 * non-empty human `reviewer` and rejects known agent identities, so the crawler
 * (which only ever writes the proposed file) can never self-approve a scope.
 */
export function approveScope(domain: string, pages: string[], reviewer: string): string {
  const who = (reviewer ?? "").trim();
  if (who.length === 0) {
    throw new ScopeApprovalError("A human reviewer identity is required to approve a scope.");
  }

  const auditLog = new AppendOnlyLog(resolve("artifacts/audit.jsonl"));
  if (AGENT_IDENTITIES.has(who)) {
    auditLog.append({ type: "scope-self-approval-rejected", reviewer: who, domain });
    throw new ScopeApprovalError(
      `Agent "${who}" may not approve a scope. A human reviewer is required.`,
    );
  }

  const dir = resolve("config/scope");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const scope = makeScopeFile(domain, pages, new Date().toISOString());
  const p = join(dir, `${domain}.approved.json`);
  writeFileSync(p, JSON.stringify(scope, null, 2), "utf8");

  auditLog.append({
    type: "scope-approved",
    reviewId: newReviewId(),
    reviewer: who,
    domain,
    pageCount: scope.pages.length,
    approvedPath: p,
  });
  return p;
}

/**
 * Compute the exact set partition between a previously approved scope and a
 * proposed scope (Req 5.5). Pure and total; a `null` approved scope is treated
 * as the empty set.
 *
 *   added     = proposed \ approved
 *   removed   = approved \ proposed
 *   unchanged = approved ∩ proposed
 *
 * Guarantees validated by Property 12: `added ∪ unchanged = proposed`,
 * `removed ∪ unchanged = approved`, and the three result sets are pairwise
 * disjoint. Each result list is sorted for determinism.
 */
export function diffScope(approved: ScopeFile | null, proposed: ScopeFile): ScopeDifference {
  const approvedSet = new Set(approved ? approved.pages : []);
  const proposedSet = new Set(proposed.pages);

  const added: string[] = [];
  const removed: string[] = [];
  const unchanged: string[] = [];

  for (const page of proposedSet) {
    if (approvedSet.has(page)) unchanged.push(page);
    else added.push(page);
  }
  for (const page of approvedSet) {
    if (!proposedSet.has(page)) removed.push(page);
  }

  return {
    added: added.sort(),
    removed: removed.sort(),
    unchanged: unchanged.sort(),
  };
}

/**
 * Derive the first URL path segment for grouping. Falls back to `ROOT_SEGMENT`
 * for the site root ("/") or any URL that cannot be parsed, so the function is
 * total and never throws.
 */
function firstPathSegment(page: string): string {
  let pathname: string;
  try {
    pathname = new URL(page).pathname;
  } catch {
    // Not an absolute URL — treat the raw string as a path.
    pathname = page.startsWith("/") ? page : `/${page}`;
  }
  const first = pathname.split("/").filter((s) => s.length > 0)[0];
  return first ?? ROOT_SEGMENT;
}

/**
 * Group pages by their first URL path segment (Req 5.6), used when the proposed
 * scope exceeds `largeScopeThreshold`. Pure, total, and lossless: the union of
 * all group pages equals the deduped input set (Property 13), every page shares
 * its group's segment, and groups + their pages are sorted for determinism.
 */
export function groupByPathSegment(pages: string[]): ScopeGroup[] {
  const bySegment = new Map<string, Set<string>>();
  for (const page of pages) {
    const segment = firstPathSegment(page);
    let bucket = bySegment.get(segment);
    if (!bucket) {
      bucket = new Set<string>();
      bySegment.set(segment, bucket);
    }
    bucket.add(page);
  }
  return Array.from(bySegment.entries())
    .map(([segment, set]) => ({ segment, pages: Array.from(set).sort() }))
    .sort((a, b) => (a.segment < b.segment ? -1 : a.segment > b.segment ? 1 : 0));
}
