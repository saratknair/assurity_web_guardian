import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  applyDispositions,
  normalizePageUrl,
  type DetectedFinding,
  type DispositionEntry,
  type ResolvedItem,
} from "../core/dispositions.js";
import {
  collectVisualViews,
  findingId,
  findingKey,
  type FindingKind,
  type Lifecycle,
  type Severity,
} from "../core/finding-model.js";
import {
  buildViolationEvidence,
  DEFAULT_CAPS,
  sanitizeEvidenceText,
  type PublishCaps,
  type ViolationEvidence,
} from "./evidence.js";

/**
 * Per-run Finding builder (design section B). `loadRawRunInputs` is a thin,
 * tolerant I/O shell; `buildRunFindings` is pure and total (never throws on
 * malformed input). Requirements 2.1, 2.3, 2.6, 2.8, 2.9, 1.9, 4.2, 4.5,
 * 12.4, 12.5, 13.9, 13.10, 17.9.
 */

export type Viewport = "desktop" | "mobile";

export interface RawRunInputs {
  runId: string;
  finishedAt?: string | null;
  findings: unknown | null; // findings.json
  results: unknown | null; // results.json
  axe: { slug: string; viewport: string; raw: unknown | null; parseError?: string }[];
  visualFiles: { slug: string; viewport: string; hasDiff: boolean; diffPixels?: number }[];
  lifecycle: unknown | null; // lifecycle.json
  /** Frozen dispositions-applied.json of the run; absent/null means `not-applicable`. */
  dispositions?: FrozenDispositions | null;
}

/** The run's frozen applied set (design I.6). Never the live log. */
export interface FrozenDispositions {
  status: "applied" | "unavailable";
  entries: DispositionEntry[];
}

export interface NewDecision {
  id: string;
  decision: string;
  scope: string;
  findingsAffected: number;
}

export interface DecisionsInfo {
  status: "applied" | "unavailable" | "not-applicable";
  appliedCount?: number;
  newThisRun?: NewDecision[];
  ignoredNewThisRun?: number;
  unignoredNewThisRun?: number;
  resolvedNewThisRun?: number;
}

/** Internal facts kept next to a built run so the Publisher can compare consecutive runs. */
export interface OverlayState {
  status: "applied" | "unavailable";
  entryIds: string[];
  meta: Record<string, { decision: string; scope: string }>;
  /** entry id -> number of this run's Findings (or resolved items) it affects */
  affected: Record<string, number>;
  /** keys (page|viewport|rule) of Ignored_Findings of this run */
  ignoredKeys: string[];
  /** keys of active Findings of this run */
  activeKeys: string[];
  /** decision ids of resolved items carrying humanResolved */
  humanResolvedIds: string[];
}

export interface Omission {
  path: string;
  role: string;
  reason: string;
}

export interface SeverityCounts {
  critical: number;
  serious: number;
  moderate: number;
  minor: number;
  unrated: number;
  notRecorded: number;
}

export interface LifecycleCounts {
  new: number;
  recurring: number;
  existingUnresolved: number;
  regression: number;
  notRecorded: number;
}

export interface PublishedFinding {
  id: string;
  kind: FindingKind;
  pageUrl: string;
  slug: string;
  viewport: Viewport;
  ruleId: string;
  severity: Severity;
  title: string;
  hasElementDetail: boolean;
  lifecycle: Lifecycle;
  ignoredNodeCount: number;
  legacyFindingId?: string;
  /** Replay link (virtual-office-replay): null when the run has no enriched trace. */
  producedAt?: { entryId: string; t: number; station: string } | null;
  [extra: string]: unknown;
}

export interface PagePublished {
  url: string;
  slug: string;
  group: string;
  title: string | null;
  counts: SeverityCounts & { total: number };
  highest: Severity | null;
  /** Relative ms of the first replay step for this page, or null. */
  replayT?: number | null;
}

export interface RunFindingsFile {
  schemaVersion: 2;
  runId: string;
  finishedAt: string | null;
  detailLevel: "rule" | "legacy";
  historyStatus: "restored" | "first-run" | "unavailable" | "not-recorded";
  totals: {
    all: number;
    detected: number;
    ignored: number;
    bySeverity: SeverityCounts;
    byLifecycle: LifecycleCounts;
    resolved: number;
  };
  decisions: DecisionsInfo;
  pages: PagePublished[];
  findings: PublishedFinding[];
  resolved: unknown[];
  ignored: PublishedFinding[];
  omissions: Omission[];
  /** Added by the Publisher (virtual-office-replay). */
  replay?: { enriched: boolean; durationMs: number };
}

export interface EvidenceFile {
  schemaVersion: 2;
  runId: string;
  pageUrl: string;
  viewport: Viewport;
  violations: {
    findingId: string;
    ruleId: string;
    severity: Severity;
    help: string;
    nodeCount: number;
    omittedNodeCount: number;
    nodes: ViolationEvidence["nodes"];
  }[];
  withheldCount: number;
}

export interface BuiltRun {
  runFindings: RunFindingsFile;
  /** keyed by path relative to the run dir, e.g. "evidence/<slug>.<viewport>.json" */
  evidence: Record<string, EvidenceFile>;
  /** Present only when the run has a frozen dispositions file; not published. */
  overlay?: OverlayState;
}

// ---------------------------------------------------------------------------
// I/O shell
// ---------------------------------------------------------------------------

function readJsonOrNull(path: string): unknown | null {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function listSafe(dir: string): string[] {
  try {
    return existsSync(dir) ? readdirSync(dir).sort() : [];
  } catch {
    return [];
  }
}

function isStr(v: unknown): v is string {
  return typeof v === "string";
}

function validEntry(e: unknown): e is DispositionEntry {
  if (typeof e !== "object" || e === null || Array.isArray(e)) return false;
  const r = e as Record<string, unknown>;
  const m = r.matcher as Record<string, unknown> | null;
  return (
    isStr(r.id) &&
    (r.decision === "ignore" || r.decision === "resolve" || r.decision === "unignore") &&
    isStr(r.scope) &&
    typeof m === "object" &&
    m !== null &&
    isStr(m.pageUrl) &&
    isStr(m.viewport) &&
    isStr(m.ruleId) &&
    isStr(m.cssTarget) &&
    isStr(r.reason) &&
    isStr(r.reviewer) &&
    isStr(r.at) &&
    (r.undoes === null || isStr(r.undoes))
  );
}

/**
 * Read a run's frozen dispositions-applied.json (never the live log).
 * Missing file -> null (`not-applicable`); present but unreadable -> `unavailable`.
 */
export function loadFrozenDispositions(runDir: string): FrozenDispositions | null {
  const p = join(runDir, "dispositions-applied.json");
  if (!existsSync(p)) return null;
  const j = readJsonOrNull(p);
  if (typeof j !== "object" || j === null || Array.isArray(j)) return { status: "unavailable", entries: [] };
  const r = j as Record<string, unknown>;
  if (r.status === "unavailable") return { status: "unavailable", entries: [] };
  if (r.status !== "applied" || !Array.isArray(r.entries)) return { status: "unavailable", entries: [] };
  return { status: "applied", entries: r.entries.filter(validEntry) };
}

/** Read raw artifacts of one run. Never throws; missing/corrupt files become null. */
export function loadRawRunInputs(runDir: string): RawRunInputs {
  const runId = runDir.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "";
  const axe: RawRunInputs["axe"] = [];
  const axeDir = join(runDir, "accessibility");
  for (const file of listSafe(axeDir)) {
    const m = /^(.*)\.(desktop|mobile)\.json$/.exec(file);
    if (!m) continue;
    try {
      axe.push({ slug: m[1], viewport: m[2], raw: JSON.parse(readFileSync(join(axeDir, file), "utf8")) });
    } catch (e) {
      axe.push({
        slug: m[1],
        viewport: m[2],
        raw: null,
        parseError: e instanceof Error ? e.name : "parse-error",
      });
    }
  }
  const visualFiles: RawRunInputs["visualFiles"] = [];
  for (const file of listSafe(join(runDir, "screenshots"))) {
    const m = /^(.*)\.(desktop|mobile)\.diff\.png$/.exec(file);
    if (m) visualFiles.push({ slug: m[1], viewport: m[2], hasDiff: true });
  }
  return {
    runId,
    finishedAt: null,
    findings: readJsonOrNull(join(runDir, "findings.json")),
    results: readJsonOrNull(join(runDir, "results.json")),
    axe,
    visualFiles,
    lifecycle: readJsonOrNull(join(runDir, "lifecycle.json")),
    // `dispositions` is set only by the Publisher (loadFrozenDispositions), so local
    // detection views (Admin GUI) keep seeing every detected Finding.
  };
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
function asViewport(v: unknown): Viewport | null {
  return v === "desktop" || v === "mobile" ? v : null;
}

const AXE_IMPACTS = ["critical", "serious", "moderate", "minor"] as const;
function severityOfImpact(impact: unknown): Severity {
  return (AXE_IMPACTS as readonly unknown[]).includes(impact) ? (impact as Severity) : "unrated";
}

const SEV_RANK: Record<Severity, number> = {
  critical: 5,
  serious: 4,
  moderate: 3,
  minor: 2,
  unrated: 1,
  "not-recorded": 0,
};
const SEV_KEY: Record<Severity, keyof SeverityCounts> = {
  critical: "critical",
  serious: "serious",
  moderate: "moderate",
  minor: "minor",
  unrated: "unrated",
  "not-recorded": "notRecorded",
};
const LC_KEY: Record<Lifecycle, keyof LifecycleCounts> = {
  new: "new",
  recurring: "recurring",
  "existing-unresolved": "existingUnresolved",
  regression: "regression",
  "not-recorded": "notRecorded",
};
const KIND_ORDER: Record<FindingKind, number> = { "a11y-rule": 0, check: 1, visual: 2 };

function zeroSeverity(): SeverityCounts {
  return { critical: 0, serious: 0, moderate: 0, minor: 0, unrated: 0, notRecorded: 0 };
}
function zeroLifecycle(): LifecycleCounts {
  return { new: 0, recurring: 0, existingUnresolved: 0, regression: 0, notRecorded: 0 };
}

function pageGroup(url: string): string {
  try {
    const seg = new URL(url).pathname.split("/").filter(Boolean)[0];
    return seg ? seg.toLowerCase() : "(home)";
  } catch {
    return "(home)";
  }
}

function clean(raw: unknown, max: number): string {
  const r = sanitizeEvidenceText(raw, max);
  return r.withheld ? "" : r.value;
}

const LIFECYCLE_VALUES: readonly Lifecycle[] = ["new", "recurring", "existing-unresolved", "regression"];
const HISTORY_STATUSES = ["restored", "first-run", "unavailable"] as const;

interface PageInfo {
  url: string;
  slug: string;
  title: string | null;
}

interface Draft {
  finding: PublishedFinding;
  key: string;
}

export function buildRunFindings(inputs: RawRunInputs, opts: { caps?: PublishCaps } = {}): BuiltRun {
  const caps = opts.caps ?? DEFAULT_CAPS;
  const runId = inputs.runId;
  const omissions: Omission[] = [];
  const pages = new Map<string, PageInfo>(); // slug -> info

  // ---- page registry (results.json first, then findings.json) ----
  const results = isObj(inputs.results) ? inputs.results : null;
  const resultPages = arr(results?.pages).filter(isObj);
  for (const p of resultPages) {
    const url = str(p.page);
    const slug = str(p.slug);
    if (!url || !slug) continue;
    let title: string | null = null;
    for (const c of arr(p.checks)) {
      if (isObj(c) && c.passed === true && typeof c.name === "string" && /^(desktop|mobile):title$/.test(c.name)) {
        const t = clean(c.detail, 300);
        if (t) {
          title = t;
          break;
        }
      }
    }
    pages.set(slug, { url, slug, title });
  }
  const findingsDoc = isObj(inputs.findings) ? inputs.findings : null;
  const findingPages = arr(findingsDoc?.pages).filter(isObj);
  for (const p of findingPages) {
    const url = str(p.page);
    const slug = str(p.slug);
    if (url && slug && !pages.has(slug)) pages.set(slug, { url, slug, title: null });
  }

  // ---- legacy outcomes index (for legacyFindingId joins and suppression) ----
  interface Outcome {
    slug: string;
    id: string | null;
    detail: string;
  }
  const outcomes: Outcome[] = [];
  for (const p of findingPages) {
    const slug = str(p.slug);
    if (!slug) continue;
    for (const o of arr(p.outcomes)) {
      if (isObj(o) && typeof o.detail === "string") {
        outcomes.push({ slug, id: str(o.findingId), detail: o.detail });
      }
    }
  }

  // ---- lifecycle ----
  const lc = isObj(inputs.lifecycle) ? inputs.lifecycle : null;
  let historyStatus: RunFindingsFile["historyStatus"] = "not-recorded";
  if (lc && (HISTORY_STATUSES as readonly unknown[]).includes(lc.historyStatus)) {
    historyStatus = lc.historyStatus as RunFindingsFile["historyStatus"];
  }
  const states = lc && isObj(lc.states) && historyStatus !== "unavailable" ? lc.states : {};
  const lifecycleOf = (key: string): Lifecycle => {
    const s = (states as Record<string, unknown>)[key];
    return (LIFECYCLE_VALUES as readonly unknown[]).includes(s) ? (s as Lifecycle) : "not-recorded";
  };
  const resolved: unknown[] =
    lc && Array.isArray(lc.resolved) && historyStatus !== "unavailable" ? lc.resolved.filter(isObj) : [];

  // ---- a11y rule findings from raw axe ----
  const drafts = new Map<string, Draft>();
  const rawById = new Map<string, { nodes: unknown[]; src: Record<string, unknown> }>();
  const evidence: Record<string, EvidenceFile> = {};
  const axeCovered = new Set<string>(); // `${slug}.${viewport}`
  const ruleIdsByView = new Map<string, string[]>(); // `${slug}.${viewport}` -> rule ids

  const sortedAxe = [...inputs.axe].sort((a, b) =>
    `${a.slug}.${a.viewport}`.localeCompare(`${b.slug}.${b.viewport}`),
  );
  for (const entry of sortedAxe) {
    const viewport = asViewport(entry.viewport);
    const path = `accessibility/${entry.slug}.${entry.viewport}.json`;
    const raw = entry.raw;
    if (!viewport || entry.parseError || !isObj(raw) || !Array.isArray(raw.violations)) {
      omissions.push({ path, role: "evidence", reason: "raw-axe-unreadable" });
      continue;
    }
    const pageUrl = str(raw.url) ?? pages.get(entry.slug)?.url ?? null;
    if (!pageUrl) {
      omissions.push({ path, role: "evidence", reason: "raw-axe-unreadable" });
      continue;
    }
    const viewKey = `${entry.slug}.${viewport}`;
    axeCovered.add(viewKey);
    if (!pages.has(entry.slug)) pages.set(entry.slug, { url: pageUrl, slug: entry.slug, title: null });

    // Group violations by rule id (merge duplicates).
    const byRule = new Map<string, { impact: unknown; nodes: unknown[]; src: Record<string, unknown> }>();
    for (const v of raw.violations) {
      if (!isObj(v) || typeof v.id !== "string" || !v.id) continue;
      const cur = byRule.get(v.id);
      if (cur) cur.nodes.push(...arr(v.nodes));
      else byRule.set(v.id, { impact: v.impact, nodes: [...arr(v.nodes)], src: v });
    }
    const evFile: EvidenceFile = {
      schemaVersion: 2,
      runId,
      pageUrl,
      viewport,
      violations: [],
      withheldCount: 0,
    };
    const ruleIds: string[] = [];
    for (const ruleId of [...byRule.keys()].sort()) {
      const g = byRule.get(ruleId)!;
      const ev = buildViolationEvidence({ ...g.src, id: ruleId, nodes: g.nodes }, caps);
      const key = findingKey({ pageUrl, viewport, ruleId });
      if (drafts.has(key)) continue;
      const severity = severityOfImpact(g.impact);
      const id = findingId(runId, key, "a11y-rule");
      const shown = ev.nodes.length;
      const prefix = `${viewport}:a11y-critical-serious:`;
      const legacy = outcomes.find(
        (o) =>
          o.slug === entry.slug &&
          o.id !== null &&
          o.detail.startsWith(prefix) &&
          o.detail
            .slice(prefix.length)
            .split(",")
            .map((s) => s.trim())
            .includes(ruleId),
      );
      const finding: PublishedFinding = {
        id,
        kind: "a11y-rule",
        pageUrl,
        slug: entry.slug,
        viewport,
        ruleId,
        severity,
        title: ev.help || ruleId,
        description: ev.description,
        helpUrl: ev.helpUrl,
        wcag: ev.wcag,
        nodeCount: ev.nodeCount,
        shownNodeCount: shown,
        omittedNodeCount: ev.omittedNodeCount,
        hasElementDetail: shown > 0,
        evidence: `evidence/${entry.slug}.${viewport}.json`,
        lifecycle: lifecycleOf(key),
        ignoredNodeCount: 0,
      };
      if (legacy?.id) finding.legacyFindingId = legacy.id;
      drafts.set(key, { finding, key });
      rawById.set(id, { nodes: g.nodes, src: g.src });
      ruleIds.push(ruleId);
      evFile.withheldCount += ev.nodes.reduce((n, node) => n + node.withheld.length, 0);
      evFile.violations.push({
        findingId: id,
        ruleId,
        severity,
        help: ev.help,
        nodeCount: ev.nodeCount,
        omittedNodeCount: ev.omittedNodeCount,
        nodes: ev.nodes,
      });
    }
    ruleIdsByView.set(viewKey, ruleIds);
    if (evFile.violations.length > 0) evidence[`evidence/${entry.slug}.${viewport}.json`] = evFile;
  }

  const detailLevel: "rule" | "legacy" = axeCovered.size > 0 ? "rule" : "legacy";

  // ---- check findings ----
  for (const p of resultPages) {
    const slug = str(p.slug);
    const pageUrl = str(p.page);
    if (!slug || !pageUrl) continue;
    for (const c of arr(p.checks)) {
      if (!isObj(c) || c.passed !== false || typeof c.name !== "string") continue;
      const m = /^(desktop|mobile):(.+)$/.exec(c.name);
      if (!m) continue;
      const viewport = m[1] as Viewport;
      const name = m[2];
      const detail = clean(c.detail, 300);
      if (detailLevel === "legacy") {
        const key = findingKey({ pageUrl, viewport, ruleId: "legacy-outcome" }) + `#${name}`;
        if (drafts.has(key)) continue;
        drafts.set(key, {
          key,
          finding: {
            id: findingId(runId, key, "check"),
            kind: "check",
            pageUrl,
            slug,
            viewport,
            ruleId: "legacy-outcome",
            severity: "not-recorded",
            title: `Check failed: ${name}`,
            detail: detail ? `${name}: ${detail}` : name,
            hasElementDetail: false,
            lifecycle: "not-recorded",
            ignoredNodeCount: 0,
          },
        });
        continue;
      }
      // Aggregate a11y check is replaced by its rule findings when raw axe is readable.
      if (name === "a11y-critical-serious" && axeCovered.has(`${slug}.${viewport}`)) continue;
      const key = findingKey({ pageUrl, viewport, ruleId: `check:${name}` });
      if (drafts.has(key)) continue;
      drafts.set(key, {
        key,
        finding: {
          id: findingId(runId, key, "check"),
          kind: "check",
          pageUrl,
          slug,
          viewport,
          ruleId: `check:${name}`,
          severity: "unrated",
          title: `Check failed: ${name}`,
          detail,
          hasElementDetail: false,
          lifecycle: lifecycleOf(key),
          ignoredNodeCount: 0,
        },
      });
    }
  }

  // ---- visual findings ----
  const visualViews = collectVisualViews(
    pages,
    inputs.visualFiles.filter((f) => f.hasDiff),
    findingPages,
  );
  if (detailLevel === "rule") {
    for (const [, { slug, viewport }] of [...visualViews].sort((a, b) => a[0].localeCompare(b[0]))) {
      const pageUrl = pages.get(slug)!.url;
      const key = findingKey({ pageUrl, viewport, ruleId: "visual-diff" });
      const id = findingId(runId, key, "visual");
      const mentionsSuppressed = outcomes.some(
        (o) => o.slug === slug && /visual finding suppressed/i.test(o.detail),
      );
      // Name every non-visual Finding (a11y rule or failed check) on this page and viewport.
      const suppressedBy = mentionsSuppressed
        ? [
            ...new Set(
              [...drafts.values()]
                .map((d) => d.finding)
                .filter((f) => f.kind !== "visual" && f.slug === slug && f.viewport === viewport)
                .map((f) => f.ruleId),
            ),
          ].sort()
        : [];
      const legacy = outcomes.find((o) => o.slug === slug && o.id !== null && /^Screenshot difference/i.test(o.detail));
      const finding: PublishedFinding = {
        id,
        kind: "visual",
        pageUrl,
        slug,
        viewport,
        ruleId: "visual-diff",
        severity: "unrated",
        title: "Screenshot differs from approved baseline",
        suppressed: suppressedBy.length > 0,
        suppressedBy,
        hasElementDetail: false,
        visual: `visual.json#vis_${id.slice(3)}`,
        lifecycle: lifecycleOf(key),
        ignoredNodeCount: 0,
      };
      if (legacy?.id) finding.legacyFindingId = legacy.id;
      drafts.set(key, { finding, key });
    }
  }

  // ---- ordering and totals ----
  const detectedAll = [...drafts.values()]
    .map((d) => d.finding)
    .sort(
      (a, b) =>
        a.pageUrl.localeCompare(b.pageUrl) ||
        a.viewport.localeCompare(b.viewport) ||
        KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
        a.ruleId.localeCompare(b.ruleId) ||
        a.id.localeCompare(b.id),
    );

  // ---- disposition overlay (design I.4 to I.6); frozen set only, never the live log ----
  let findings: PublishedFinding[] = detectedAll;
  let ignoredList: PublishedFinding[] = [];
  let resolvedOut: unknown[] = resolved;
  let overlay: OverlayState | undefined;
  const frozen = inputs.dispositions ?? null;
  if (frozen) {
    const entries = frozen.entries;
    overlay = {
      status: frozen.status,
      entryIds: entries.map((e) => e.id),
      meta: {},
      affected: {},
      ignoredKeys: [],
      activeKeys: [],
      humanResolvedIds: [],
    };
    for (const e of entries) overlay.meta[e.id] = { decision: e.decision, scope: e.scope };
    if (entries.length > 0) {
      const seenOmission = new Set<string>();
      const pub = (raw: string, max: number, ref: string): string => {
        const r = sanitizeEvidenceText(raw, max);
        if (!r.withheld) return r.value;
        const path = `dispositions/${ref.replace(/[^A-Za-z0-9_-]/g, "_")}`;
        if (!seenOmission.has(path)) {
          seenOmission.add(path);
          omissions.push({ path, role: "decision", reason: r.reason });
        }
        return "[withheld]";
      };
      const targetsOf = (f: PublishedFinding): string[] => {
        if (f.kind !== "a11y-rule") return [];
        const raw = rawById.get(f.id);
        return raw ? raw.nodes.map((n) => nodeTargetOf(n, caps)) : [];
      };
      const detected: DetectedFinding[] = detectedAll.map((f) => ({
        id: f.id,
        kind: f.kind,
        pageUrl: f.pageUrl,
        slug: f.slug,
        viewport: f.viewport,
        ruleId: f.ruleId,
        severity: f.severity,
        lifecycle: f.lifecycle,
        nodeTargets: targetsOf(f),
        nodeCount: typeof f.nodeCount === "number" ? f.nodeCount : undefined,
      }));
      const isKeyed = (r: unknown): r is Record<string, unknown> =>
        isObj(r) && typeof r.pageUrl === "string" && typeof r.viewport === "string" && typeof r.ruleId === "string";
      const validResolved = resolved.filter(isKeyed) as unknown as ResolvedItem[];
      const otherResolved = resolved.filter((r) => !isKeyed(r));
      const outcome = applyDispositions(detected, entries, validResolved);
      const byId = new Map(detectedAll.map((f) => [f.id, f]));

      const undone = new Set(entries.filter((e) => e.decision === "unignore" && e.undoes).map((e) => e.undoes as string));
      findings = outcome.active.map((a) => {
        const out: PublishedFinding = { ...(byId.get(a.id) as PublishedFinding) };
        if (a.regression) {
          out.lifecycle = "regression";
          out.regression = {
            decisionId: a.regression.decisionId,
            at: a.regression.at,
            reviewer: pub(a.regression.reviewer, 80, `${a.regression.decisionId}.reviewer`),
            reason: pub(a.regression.reason, 500, `${a.regression.decisionId}.reason`),
          };
        }
        if (a.ignoredNodeCount > 0) {
          const raw = rawById.get(out.id);
          const targets = targetsOf(out);
          const matched = new Set(
            entries
              .filter(
                (e) =>
                  e.decision === "ignore" &&
                  e.scope === "element" &&
                  !undone.has(e.id) &&
                  e.matcher.ruleId === out.ruleId &&
                  e.matcher.viewport === out.viewport &&
                  normalizePageUrl(e.matcher.pageUrl) === normalizePageUrl(out.pageUrl),
              )
              .map((e) => e.matcher.cssTarget),
          );
          if (raw) {
            const keep = raw.nodes.filter((_n, i) => !matched.has(targets[i]));
            const ev = buildViolationEvidence({ ...raw.src, id: out.ruleId, nodes: keep }, caps);
            out.nodeCount = ev.nodeCount;
            out.shownNodeCount = ev.nodes.length;
            out.omittedNodeCount = ev.omittedNodeCount;
            out.hasElementDetail = ev.nodes.length > 0;
            const evFile = typeof out.evidence === "string" ? evidence[out.evidence] : undefined;
            const viol = evFile?.violations.find((v) => v.findingId === out.id);
            if (evFile && viol) {
              const count = (ns: ViolationEvidence["nodes"]): number => ns.reduce((n, node) => n + node.withheld.length, 0);
              evFile.withheldCount += count(ev.nodes) - count(viol.nodes);
              viol.nodeCount = ev.nodeCount;
              viol.omittedNodeCount = ev.omittedNodeCount;
              viol.nodes = ev.nodes;
            }
          }
          out.ignoredNodeCount = a.ignoredNodeCount;
        }
        return out;
      });
      ignoredList = outcome.ignored.map((i) => ({
        ...(byId.get(i.id) as PublishedFinding),
        disposition: {
          decisionId: i.disposition.decisionId,
          decision: i.disposition.decision,
          scope: i.disposition.scope,
          reason: pub(i.disposition.reason, 500, `${i.disposition.decisionId}.reason`),
          reviewer: pub(i.disposition.reviewer, 80, `${i.disposition.decisionId}.reviewer`),
          at: i.disposition.at,
        },
      }));
      resolvedOut = [
        ...outcome.resolved.map((r) =>
          r.humanResolved
            ? {
                ...r,
                humanResolved: {
                  decisionId: r.humanResolved.decisionId,
                  at: r.humanResolved.at,
                  reviewer: pub(r.humanResolved.reviewer, 80, `${r.humanResolved.decisionId}.reviewer`),
                },
              }
            : r,
        ),
        ...otherResolved,
      ];

      overlay.ignoredKeys = outcome.ignored.map((f) => findingKey(f));
      overlay.activeKeys = outcome.active.map((f) => findingKey(f));
      overlay.humanResolvedIds = outcome.resolved.flatMap((r) => (r.humanResolved ? [r.humanResolved.decisionId] : []));
      const affectedBy = (e: DispositionEntry): number => {
        if (e.decision === "ignore") {
          const o = applyDispositions(detected, [e]);
          return o.ignored.length + o.active.filter((x) => x.ignoredNodeCount > 0).length;
        }
        if (e.decision === "resolve") {
          const o = applyDispositions(detected, [e], validResolved);
          return o.active.filter((x) => x.regression).length + o.resolved.filter((x) => x.humanResolved).length;
        }
        const target = entries.find((x) => x.id === e.undoes);
        return target && target.decision === "ignore" ? affectedBy(target) : 0;
      };
      for (const e of entries) overlay.affected[e.id] = affectedBy(e);
    }
  }

  const bySeverity = zeroSeverity();
  const byLifecycle = zeroLifecycle();
  const pageRows = new Map<string, PagePublished>();
  for (const info of [...pages.values()].sort((a, b) => a.slug.localeCompare(b.slug))) {
    pageRows.set(info.url, {
      url: info.url,
      slug: info.slug,
      group: pageGroup(info.url),
      title: info.title,
      counts: { total: 0, ...zeroSeverity() },
      highest: null,
    });
  }
  for (const f of findings) {
    bySeverity[SEV_KEY[f.severity]]++;
    byLifecycle[LC_KEY[f.lifecycle]]++;
    const row = pageRows.get(f.pageUrl);
    if (row) {
      row.counts.total++;
      row.counts[SEV_KEY[f.severity]]++;
      if (row.highest === null || SEV_RANK[f.severity] > SEV_RANK[row.highest]) row.highest = f.severity;
    }
  }

  const runFindings: RunFindingsFile = {
    schemaVersion: 2,
    runId,
    finishedAt: typeof inputs.finishedAt === "string" ? inputs.finishedAt : null,
    detailLevel,
    historyStatus,
    totals: {
      all: findings.length,
      detected: findings.length + ignoredList.length,
      ignored: ignoredList.length,
      bySeverity,
      byLifecycle,
      resolved: resolvedOut.length,
    },
    decisions: overlay ? decisionsFor(overlay, null) : { status: "not-applicable" },
    pages: [...pageRows.values()],
    findings,
    resolved: resolvedOut,
    ignored: ignoredList,
    omissions,
  };
  const built: BuiltRun = { runFindings, evidence };
  if (overlay) built.overlay = overlay;
  return built;
}

function decisionsFor(o: OverlayState, prev: OverlayState | null): DecisionsInfo {
  const prevIds = new Set(prev?.entryIds ?? []);
  const newIds = [...new Set(o.entryIds)].filter((id) => !prevIds.has(id));
  const newSet = new Set(newIds);
  const prevIgnored = new Set(prev?.ignoredKeys ?? []);
  return {
    status: o.status,
    appliedCount: new Set(o.entryIds).size,
    newThisRun: newIds.map((id) => ({
      id,
      decision: o.meta[id]?.decision ?? "",
      scope: o.meta[id]?.scope ?? "",
      findingsAffected: o.affected[id] ?? 0,
    })),
    ignoredNewThisRun: o.ignoredKeys.filter((k) => !prevIgnored.has(k)).length,
    unignoredNewThisRun: o.activeKeys.filter((k) => prevIgnored.has(k)).length,
    resolvedNewThisRun: o.humanResolvedIds.filter((id) => newSet.has(id)).length,
  };
}

/**
 * Recompute `decisions` for a run against the previous published run (by finishedAt).
 * A previous run with no frozen file counts as the empty set. No-op for `not-applicable` runs.
 */
export function finalizeDecisions(current: BuiltRun, previous: BuiltRun | null): void {
  if (!current.overlay) return;
  current.runFindings.decisions = decisionsFor(current.overlay, previous?.overlay ?? null);
}

function flattenTarget(t: unknown): string {
  const parts: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === "string") parts.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
  };
  walk(t);
  return parts.join(" >> ");
}

/** The CSS target string the evidence publishes for a raw axe node ("" when withheld or absent). */
function nodeTargetOf(n: unknown, caps: PublishCaps): string {
  const target = isObj(n) ? n.target : undefined;
  const r = sanitizeEvidenceText(flattenTarget(target), caps.maxTargetChars);
  return r.withheld ? "" : r.value;
}
