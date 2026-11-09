import { createHash } from "node:crypto";

/**
 * Disposition log (design Section I.2 to I.4, part 1: entries and log).
 * Pure module: no I/O, no clock, no randomness. The caller supplies "now".
 * Human decisions (ignore / resolve / unignore) are stored in an append-only,
 * content-addressed log; ids are derived from content so tampering is detectable.
 */

export type DispositionDecision = "ignore" | "resolve" | "unignore";
export type DispositionScope = "element" | "page-rule" | "site-rule" | "finding" | "undo";
export type DispositionSource = "admin-gui" | "cli";

export interface Matcher {
  pageUrl: string;
  viewport: "desktop" | "mobile" | "";
  ruleId: string;
  cssTarget: string;
}

export interface DispositionEntry {
  id: string;
  decision: DispositionDecision;
  scope: DispositionScope;
  matcher: Matcher;
  reason: string;
  reviewer: string;
  at: string;
  undoes: string | null;
  source: DispositionSource;
}

export interface DispositionLog {
  schemaVersion: 1;
  entries: DispositionEntry[];
}

export interface EntryError {
  field: string;
  message: string;
}

export const REASON_MAX = 500;
export const REVIEWER_MAX = 80;

const DECISIONS: readonly string[] = ["ignore", "resolve", "unignore"];
const SOURCES: readonly string[] = ["admin-gui", "cli"];
const SCOPE_FOR_DECISION: Record<DispositionDecision, readonly DispositionScope[]> = {
  ignore: ["element", "page-rule", "site-rule"],
  resolve: ["finding"],
  unignore: ["undo"],
};

// ASCII and C1 control characters, plus DEL.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

function stripControl(s: string): string {
  return s.replace(CONTROL_CHARS, "");
}

function cleanText(v: unknown): string {
  return typeof v === "string" ? stripControl(v).trim() : "";
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Lowercase scheme/host, drop default port, fragment and non-root trailing slash; keep the query. */
export function normalizePageUrl(url: string): string {
  const trimmed = typeof url === "string" ? url.trim() : "";
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return trimmed;
  }
  if (u.host === "") return trimmed;
  let path = u.pathname;
  if (path.length > 1 && path.endsWith("/")) path = path.replace(/\/+$/, "");
  if (path === "") path = "/";
  return `${u.protocol}//${u.host}${path}${u.search}`;
}

/** Canonical matcher per scope (design I.4). Unused fields become empty strings. */
export function canonicalMatcher(
  decision: DispositionDecision,
  scope: DispositionScope,
  raw: Partial<Matcher>,
): Matcher {
  const r = isRecord(raw) ? raw : {};
  const pageUrl = typeof r.pageUrl === "string" ? normalizePageUrl(stripControl(r.pageUrl)) : "";
  const vp = typeof r.viewport === "string" ? r.viewport.trim().toLowerCase() : "";
  const viewport: Matcher["viewport"] = vp === "desktop" || vp === "mobile" ? vp : "";
  const ruleId = cleanText(r.ruleId);
  const cssTarget = typeof r.cssTarget === "string" ? stripControl(r.cssTarget).trim() : "";
  const empty: Matcher = { pageUrl: "", viewport: "", ruleId: "", cssTarget: "" };
  if (decision === "unignore" || scope === "undo") return empty;
  switch (scope) {
    case "element":
      return { pageUrl, viewport, ruleId, cssTarget };
    case "page-rule":
      return { pageUrl, viewport: "", ruleId, cssTarget: "" };
    case "site-rule":
      return { pageUrl: "", viewport: "", ruleId, cssTarget: "" };
    case "finding":
      return { pageUrl, viewport, ruleId, cssTarget: "" };
    default:
      return empty;
  }
}

/** Fixed key order so the canonical JSON (and therefore the id) is stable. */
function canonicalBody(e: Omit<DispositionEntry, "id">): string {
  return JSON.stringify({
    decision: e.decision,
    scope: e.scope,
    matcher: {
      pageUrl: e.matcher.pageUrl,
      viewport: e.matcher.viewport,
      ruleId: e.matcher.ruleId,
      cssTarget: e.matcher.cssTarget,
    },
    reason: e.reason,
    reviewer: e.reviewer,
    at: e.at,
    undoes: e.undoes,
    source: e.source,
  });
}

/** "dsp_" + first 16 hex of sha256 of the canonical JSON of all other fields. */
export function entryId(e: Omit<DispositionEntry, "id">): string {
  return "dsp_" + createHash("sha256").update(canonicalBody(e), "utf8").digest("hex").slice(0, 16);
}

function compareEntries(a: DispositionEntry, b: DispositionEntry): number {
  if (a.at !== b.at) return a.at < b.at ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

function sortedUnique(entries: DispositionEntry[]): DispositionEntry[] {
  const byId = new Map<string, DispositionEntry>();
  for (const e of entries) if (!byId.has(e.id)) byId.set(e.id, e);
  return [...byId.values()].sort(compareEntries);
}

/** Validate a new decision. `at` is always taken from `now`, never from the input. */
export function validateNewEntry(
  input: unknown,
  existing: DispositionEntry[],
  now: Date,
): { ok: true; entry: DispositionEntry } | { ok: false; errors: EntryError[] } {
  const errors: EntryError[] = [];
  if (!isRecord(input)) {
    return { ok: false, errors: [{ field: "input", message: "Decision must be an object." }] };
  }
  const nowMs = now.getTime();
  if (Number.isNaN(nowMs)) {
    return { ok: false, errors: [{ field: "at", message: "Invalid time." }] };
  }

  const decision = typeof input.decision === "string" ? input.decision : "";
  const scope = typeof input.scope === "string" ? input.scope : "";
  let pairingOk = false;
  if (!DECISIONS.includes(decision)) {
    errors.push({ field: "decision", message: "Decision must be ignore, resolve, or unignore." });
  } else if (!(SCOPE_FOR_DECISION[decision as DispositionDecision] as readonly string[]).includes(scope)) {
    errors.push({
      field: "scope",
      message: `Scope "${scope}" is not valid for decision "${decision}".`,
    });
  } else {
    pairingOk = true;
  }

  const reason = cleanText(input.reason);
  if (reason.length === 0) errors.push({ field: "reason", message: "Reason is required." });
  else if (reason.length > REASON_MAX) {
    errors.push({ field: "reason", message: `Reason must be at most ${REASON_MAX} characters.` });
  }
  const reviewer = cleanText(input.reviewer);
  if (reviewer.length === 0) errors.push({ field: "reviewer", message: "Reviewer is required." });
  else if (reviewer.length > REVIEWER_MAX) {
    errors.push({ field: "reviewer", message: `Reviewer must be at most ${REVIEWER_MAX} characters.` });
  }

  const source = typeof input.source === "string" ? input.source : "";
  if (!SOURCES.includes(source)) {
    errors.push({ field: "source", message: "Source must be admin-gui or cli." });
  }

  let matcher: Matcher = { pageUrl: "", viewport: "", ruleId: "", cssTarget: "" };
  let undoes: string | null = null;

  if (pairingOk) {
    const d = decision as DispositionDecision;
    const s = scope as DispositionScope;
    if (d === "unignore") {
      const target = typeof input.undoes === "string" ? input.undoes.trim() : "";
      const found = existing.find((e) => e.id === target);
      if (target === "" || !found) {
        errors.push({ field: "undoes", message: "Un-ignore must name an existing ignore entry." });
      } else if (found.decision !== "ignore") {
        errors.push({ field: "undoes", message: "Un-ignore can only undo an ignore entry." });
      } else if (existing.some((e) => e.decision === "unignore" && e.undoes === target)) {
        errors.push({ field: "undoes", message: "That ignore entry is already undone." });
      } else if (!(Date.parse(found.at) < nowMs)) {
        errors.push({ field: "undoes", message: "The ignore entry must be earlier than this decision." });
      } else {
        undoes = target;
      }
    } else {
      const rawM = isRecord(input.matcher) ? (input.matcher as Partial<Matcher>) : {};
      matcher = canonicalMatcher(d, s, rawM);
      if (s !== "site-rule" && matcher.pageUrl === "") {
        errors.push({ field: "matcher.pageUrl", message: "Page URL is required." });
      }
      if (matcher.ruleId === "") {
        errors.push({ field: "matcher.ruleId", message: "Rule id is required." });
      }
      if ((s === "element" || s === "finding") && matcher.viewport === "") {
        errors.push({ field: "matcher.viewport", message: "Viewport must be desktop or mobile." });
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  const body: Omit<DispositionEntry, "id"> = {
    decision: decision as DispositionDecision,
    scope: scope as DispositionScope,
    matcher,
    reason,
    reviewer,
    at: now.toISOString(),
    undoes,
    source: source as DispositionSource,
  };
  const id = entryId(body);
  if (existing.some((e) => e.id === id)) {
    return { ok: false, errors: [{ field: "id", message: "duplicate" }] };
  }
  return { ok: true, entry: { id, ...body } };
}

function shapeEntry(raw: unknown): { entry?: DispositionEntry; reason?: string } {
  if (!isRecord(raw)) return { reason: "entry is not an object" };
  const m = raw.matcher;
  if (!isRecord(m)) return { reason: "matcher missing" };
  for (const k of ["pageUrl", "ruleId", "cssTarget"] as const) {
    if (typeof m[k] !== "string") return { reason: `matcher.${k} is not a string` };
  }
  if (m.viewport !== "desktop" && m.viewport !== "mobile" && m.viewport !== "") {
    return { reason: "matcher.viewport invalid" };
  }
  if (typeof raw.id !== "string") return { reason: "id missing" };
  if (typeof raw.decision !== "string" || !DECISIONS.includes(raw.decision)) {
    return { reason: "decision invalid" };
  }
  const decision = raw.decision as DispositionDecision;
  if (
    typeof raw.scope !== "string" ||
    !(SCOPE_FOR_DECISION[decision] as readonly string[]).includes(raw.scope)
  ) {
    return { reason: "scope invalid for decision" };
  }
  if (typeof raw.reason !== "string" || typeof raw.reviewer !== "string") {
    return { reason: "reason or reviewer missing" };
  }
  if (typeof raw.at !== "string" || Number.isNaN(Date.parse(raw.at))) return { reason: "at invalid" };
  if (raw.undoes !== null && typeof raw.undoes !== "string") return { reason: "undoes invalid" };
  if (typeof raw.source !== "string" || !SOURCES.includes(raw.source)) return { reason: "source invalid" };
  const entry: DispositionEntry = {
    id: raw.id,
    decision,
    scope: raw.scope as DispositionScope,
    matcher: {
      pageUrl: m.pageUrl as string,
      viewport: m.viewport as Matcher["viewport"],
      ruleId: m.ruleId as string,
      cssTarget: m.cssTarget as string,
    },
    reason: raw.reason,
    reviewer: raw.reviewer,
    at: raw.at,
    undoes: (raw.undoes as string | null) ?? null,
    source: raw.source as DispositionSource,
  };
  return { entry };
}

/** Parse a log; every id is recomputed and mismatching entries are rejected, never applied. */
export function parseLog(text: string): {
  log: DispositionLog;
  rejected: { index: number; reason: string }[];
} {
  const empty: DispositionLog = { schemaVersion: 1, entries: [] };
  const rejected: { index: number; reason: string }[] = [];
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { log: empty, rejected: [{ index: -1, reason: "log is not valid JSON" }] };
  }
  if (!isRecord(data) || data.schemaVersion !== 1 || !Array.isArray(data.entries)) {
    return { log: empty, rejected: [{ index: -1, reason: "unsupported log format" }] };
  }
  const accepted: DispositionEntry[] = [];
  data.entries.forEach((raw, index) => {
    const shaped = shapeEntry(raw);
    if (!shaped.entry) {
      rejected.push({ index, reason: shaped.reason ?? "invalid entry" });
      return;
    }
    const { id, ...body } = shaped.entry;
    if (entryId(body) !== id) {
      rejected.push({ index, reason: "id does not match entry content" });
      return;
    }
    accepted.push(shaped.entry);
  });
  return { log: { schemaVersion: 1, entries: sortedUnique(accepted) }, rejected };
}

function escapeNonAscii(s: string): string {
  return s.replace(/[\u007f-\uffff]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
}

/** Stable order (at, id), fixed key order, non-ASCII escaped, trailing newline. */
export function serializeLog(log: DispositionLog): string {
  const entries = sortedUnique(log.entries).map((e) => ({
    id: e.id,
    decision: e.decision,
    scope: e.scope,
    matcher: {
      pageUrl: e.matcher.pageUrl,
      viewport: e.matcher.viewport,
      ruleId: e.matcher.ruleId,
      cssTarget: e.matcher.cssTarget,
    },
    reason: e.reason,
    reviewer: e.reviewer,
    at: e.at,
    undoes: e.undoes,
    source: e.source,
  }));
  return escapeNonAscii(JSON.stringify({ schemaVersion: 1, entries }, null, 2)) + "\n";
}

/** Union by id; commutative and idempotent, drops nothing. */
export function mergeLogs(a: DispositionLog, b: DispositionLog): DispositionLog {
  return { schemaVersion: 1, entries: sortedUnique([...a.entries, ...b.entries]) };
}

/** Effective_From: an entry applies to a run only if entry.at is strictly before the run finish time. */
export function effectiveEntries(log: DispositionLog, runFinishedAt: string): DispositionEntry[] {
  const finished = Date.parse(runFinishedAt);
  if (Number.isNaN(finished)) return [];
  return sortedUnique(log.entries.filter((e) => Date.parse(e.at) < finished));
}

// ---------------------------------------------------------------------------
// Part 2: overlay (design I.4 and I.5). Pure: takes detected Findings plus the
// frozen effective entries of the run and splits them. Nothing is mutated.
// ---------------------------------------------------------------------------

export interface DetectedFinding {
  id: string;
  kind: string;
  pageUrl: string;
  slug: string;
  viewport: "desktop" | "mobile";
  ruleId: string;
  severity: string;
  lifecycle: string;
  /** All raw axe node CSS targets; [] for kinds without elements. */
  nodeTargets: string[];
  /** Raw node count; reduced for partly ignored Findings. */
  nodeCount?: number;
  [extra: string]: unknown;
}

export interface RegressionInfo {
  decisionId: string;
  at: string;
  reviewer: string;
  reason: string;
}

export interface AppliedDisposition {
  decisionId: string;
  decision: DispositionDecision;
  scope: DispositionScope;
  reason: string;
  reviewer: string;
  at: string;
}

export interface HumanResolved {
  decisionId: string;
  at: string;
  reviewer: string;
}

/** A lifecycle `resolved` item of the run (key fields only are required). */
export interface ResolvedItem {
  pageUrl: string;
  viewport: string;
  ruleId: string;
  [extra: string]: unknown;
}

export type ActiveFinding<T extends DetectedFinding = DetectedFinding> = T & {
  ignoredNodeCount: number;
  regression: RegressionInfo | null;
};
export type IgnoredFinding<T extends DetectedFinding = DetectedFinding> = T & {
  disposition: AppliedDisposition;
};

export interface DispositionOutcome<T extends DetectedFinding = DetectedFinding, R extends ResolvedItem = ResolvedItem> {
  active: ActiveFinding<T>[];
  ignored: IgnoredFinding<T>[];
  resolved: (R & { humanResolved?: HumanResolved })[];
  /** Filled by the Publisher against the previous run. */
  newlyEffective: { id: string; decision: DispositionDecision; scope: DispositionScope; findingsAffected: number }[];
}

/** Later `at` wins; ties broken by the greater id. */
function latestOf(entries: DispositionEntry[]): DispositionEntry | null {
  let best: DispositionEntry | null = null;
  for (const e of entries) {
    if (best === null || compareEntries(best, e) < 0) best = e;
  }
  return best;
}

function applied(e: DispositionEntry): AppliedDisposition {
  return {
    decisionId: e.id,
    decision: e.decision,
    scope: e.scope,
    reason: e.reason,
    reviewer: e.reviewer,
    at: e.at,
  };
}

interface KeyLike {
  pageUrl: string;
  viewport: string;
  ruleId: string;
}

function sameRulePage(m: Matcher, f: KeyLike, viewportToo: boolean): boolean {
  return (
    m.ruleId === f.ruleId &&
    normalizePageUrl(m.pageUrl) === normalizePageUrl(f.pageUrl) &&
    (!viewportToo || m.viewport === f.viewport)
  );
}

/**
 * Split detected Findings into active / ignored and mark regressions.
 * `effective` must already be the run's frozen applicable set (see effectiveEntries).
 * An `unignore` removes exactly the entry it names; other matching ignores still apply.
 * Optional `resolvedItems` are the run's lifecycle `resolved` items to filter and annotate.
 */
export function applyDispositions<T extends DetectedFinding, R extends ResolvedItem = ResolvedItem>(
  detected: T[],
  effective: DispositionEntry[],
  resolvedItems: R[] = [],
): DispositionOutcome<T, R> {
  const undone = new Set<string>();
  for (const e of effective) if (e.decision === "unignore" && e.undoes) undone.add(e.undoes);
  const ignores = effective.filter((e) => e.decision === "ignore" && !undone.has(e.id));
  const resolves = effective.filter((e) => e.decision === "resolve" && e.scope === "finding");

  const siteOrPage = (f: KeyLike): DispositionEntry[] =>
    ignores.filter(
      (e) =>
        (e.scope === "site-rule" && e.matcher.ruleId === f.ruleId) ||
        (e.scope === "page-rule" && sameRulePage(e.matcher, f, false)),
    );
  const elementEntries = (f: KeyLike): DispositionEntry[] =>
    ignores.filter((e) => e.scope === "element" && sameRulePage(e.matcher, f, true));
  const matchingResolves = (f: KeyLike): DispositionEntry[] =>
    resolves.filter((e) => sameRulePage(e.matcher, f, true));

  const active: ActiveFinding<T>[] = [];
  const ignored: IgnoredFinding<T>[] = [];

  for (const f of detected) {
    // 1. Ignore test.
    const whole = latestOf(siteOrPage(f));
    if (whole) {
      ignored.push({ ...f, disposition: applied(whole) });
      continue;
    }
    const elems = elementEntries(f);
    const hasElements = f.kind === "a11y-rule";
    let ignoredNodeCount = 0;
    let nodeCount = f.nodeCount;
    if (!hasElements) {
      const whole2 = latestOf(elems.filter((e) => e.matcher.cssTarget === ""));
      if (whole2) {
        ignored.push({ ...f, disposition: applied(whole2) });
        continue;
      }
    } else if (elems.length > 0) {
      const targets = Array.isArray(f.nodeTargets) ? f.nodeTargets : [];
      const matchedBy: DispositionEntry[] = [];
      let matchedNodes = 0;
      for (const t of targets) {
        const hits = elems.filter((e) => e.matcher.cssTarget === t);
        if (hits.length > 0) {
          matchedNodes += 1;
          matchedBy.push(...hits);
        }
      }
      if (targets.length > 0 && matchedNodes === targets.length) {
        ignored.push({ ...f, disposition: applied(latestOf(matchedBy) as DispositionEntry) });
        continue;
      }
      ignoredNodeCount = matchedNodes;
      if (matchedNodes > 0) {
        nodeCount = (typeof f.nodeCount === "number" ? f.nodeCount : targets.length) - matchedNodes;
      }
    }

    // 2. Regression test (an active ignore has already won above).
    const res = latestOf(matchingResolves(f));
    const out = { ...f, ignoredNodeCount, regression: null as RegressionInfo | null } as ActiveFinding<T>;
    if (nodeCount !== undefined) (out as DetectedFinding).nodeCount = nodeCount;
    if (res) {
      (out as DetectedFinding).lifecycle = "regression";
      out.regression = { decisionId: res.id, at: res.at, reviewer: res.reviewer, reason: res.reason };
    }
    active.push(out);
  }

  // Resolved items: drop those hidden by an applicable ignore; annotate human-resolved.
  const resolved: (R & { humanResolved?: HumanResolved })[] = [];
  for (const item of resolvedItems) {
    const key: KeyLike = { pageUrl: item.pageUrl, viewport: item.viewport, ruleId: item.ruleId };
    const noElements = key.ruleId.startsWith("check:") || key.ruleId === "visual-diff";
    const hidden =
      siteOrPage(key).length > 0 ||
      (noElements && elementEntries(key).some((e) => e.matcher.cssTarget === ""));
    if (hidden) continue;
    const res = latestOf(matchingResolves(key));
    resolved.push(
      res ? { ...item, humanResolved: { decisionId: res.id, at: res.at, reviewer: res.reviewer } } : { ...item },
    );
  }

  return { active, ignored, resolved, newlyEffective: [] };
}
