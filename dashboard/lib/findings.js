// Pure Finding helpers for run-findings.json. No window/document at import time.
//
// Conventions:
//  - Severity and lifecycle values are the kebab-case strings used in the
//    published data (e.g. "existing-unresolved", "not-recorded").
//  - Count objects are keyed by those same values, so they can be fed straight
//    to route filters (sev=..., state=...).
//  - Lifecycle present-state series (new, recurring, existing-unresolved,
//    regression, not-recorded) always sum to the number of Active_Findings.
//    "resolved" is reported separately and is NOT part of that sum.

import { SEVERITY_ORDER, rank } from "./severity.js";

export const LIFECYCLE_PRESENT = Object.freeze([
  "new",
  "recurring",
  "existing-unresolved",
  "regression",
  "not-recorded",
]);

export const LIFECYCLE_LABELS = Object.freeze({
  new: "New",
  recurring: "Recurring",
  "existing-unresolved": "Existing, unresolved",
  regression: "Regression",
  "not-recorded": "State not recorded",
  resolved: "Resolved in this run (not part of the total)",
});

export const DECISIONS_UNAVAILABLE_TEXT =
  "Decisions could not be loaded for this run; counts may include issues that were ignored";

const DEFAULT_DECISIONS = Object.freeze({
  status: "not-applicable",
  appliedCount: 0,
  newThisRun: Object.freeze([]),
  ignoredNewThisRun: 0,
  unignoredNewThisRun: 0,
  resolvedNewThisRun: 0,
});

function isObj(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function str(v, dflt) {
  return typeof v === "string" ? v : dflt;
}
function nonNegInt(v) {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}
function asArray(v) {
  return Array.isArray(v) ? v : [];
}

/** First path segment, lowercased; "(home)" for root; "(other)" if unparseable. */
function groupOfUrl(url) {
  try {
    const u = new URL(url);
    const seg = u.pathname.split("/").filter((s) => s !== "")[0];
    if (!seg) return "(home)";
    let d = seg;
    try {
      d = decodeURIComponent(seg);
    } catch (e) {
      d = seg;
    }
    return d.toLowerCase();
  } catch (e) {
    return "(other)";
  }
}

function normalizeSeverity(s) {
  return typeof s === "string" && SEVERITY_ORDER.includes(s) ? s : "not-recorded";
}
function normalizeLifecycle(s) {
  return typeof s === "string" && LIFECYCLE_PRESENT.includes(s) ? s : "not-recorded";
}

function normalizeFinding(f) {
  const src = isObj(f) ? f : {};
  const out = Object.assign({}, src);
  out.id = str(src.id, "");
  out.kind = str(src.kind, "check");
  out.pageUrl = str(src.pageUrl, "");
  out.slug = str(src.slug, "");
  out.viewport = str(src.viewport, "");
  out.ruleId = str(src.ruleId, "");
  out.severity = normalizeSeverity(src.severity);
  out.lifecycle = normalizeLifecycle(src.lifecycle);
  out.title = str(src.title, "");
  out.nodeCount = nonNegInt(src.nodeCount);
  out.ignoredNodeCount = nonNegInt(src.ignoredNodeCount);
  out.hasElementDetail = src.hasElementDetail === true;
  out.group = str(src.group, "") || groupOfUrl(out.pageUrl);
  if (src.detail !== undefined) out.detail = str(src.detail, "");
  return out;
}

function normalizeDecisions(d) {
  if (!isObj(d)) return Object.assign({}, DEFAULT_DECISIONS, { newThisRun: [] });
  const status = ["applied", "unavailable", "not-applicable"].includes(d.status)
    ? d.status
    : "not-applicable";
  return {
    status,
    appliedCount: nonNegInt(d.appliedCount),
    newThisRun: asArray(d.newThisRun),
    ignoredNewThisRun: nonNegInt(d.ignoredNewThisRun),
    unignoredNewThisRun: nonNegInt(d.unignoredNewThisRun),
    resolvedNewThisRun: nonNegInt(d.resolvedNewThisRun),
  };
}

/**
 * Normalize a parsed run-findings.json. Never throws. Missing `ignored[]`
 * is empty, missing `decisions` is status "not-applicable", missing
 * `hasImages` means images are published if their path exists (true),
 * missing `ignoredNodeCount` is 0. Totals are recomputed from findings[].
 */
export function normalizeRun(raw) {
  const r = isObj(raw) ? raw : {};
  const findings = asArray(r.findings).map(normalizeFinding);
  const ignored = asArray(r.ignored).map((f) => {
    const n = normalizeFinding(f);
    if (isObj(f) && isObj(f.disposition)) n.disposition = f.disposition;
    return n;
  });
  const out = {
    schemaVersion: typeof r.schemaVersion === "number" ? r.schemaVersion : 1,
    runId: str(r.runId, ""),
    finishedAt: typeof r.finishedAt === "string" ? r.finishedAt : null,
    detailLevel: r.detailLevel === "legacy" ? "legacy" : "rule",
    historyStatus: str(r.historyStatus, "not-recorded"),
    hasImages: typeof r.hasImages === "boolean" ? r.hasImages : true,
    ignoredNodeCount: nonNegInt(r.ignoredNodeCount),
    decisions: normalizeDecisions(r.decisions),
    pages: asArray(r.pages),
    findings,
    ignored,
    resolved: asArray(r.resolved),
    omissions: asArray(r.omissions),
  };
  const sev = countBySeverity(findings);
  const life = countByLifecycle(findings, out.resolved);
  out.totals = {
    all: findings.length,
    ignored: ignored.length,
    detected: findings.length + ignored.length,
    bySeverity: sev,
    byLifecycle: life.series,
    resolved: life.resolved,
  };
  return out;
}

/** Counts per severity value plus `total`. Unknown severities count as "not-recorded". */
export function countBySeverity(findings) {
  const out = {};
  for (const s of SEVERITY_ORDER) out[s] = 0;
  let total = 0;
  for (const f of asArray(findings)) {
    out[normalizeSeverity(isObj(f) ? f.severity : undefined)] += 1;
    total += 1;
  }
  out.total = total;
  return out;
}

/**
 * Lifecycle counts. `series` holds the five present-state values and sums to
 * `total` (the number of findings given). `resolved` is the length of the
 * separate resolved list and is excluded from `total`. `groups` is an ordered
 * display list; the not-recorded group is labelled "State not recorded".
 */
export function countByLifecycle(findings, resolved) {
  const series = {};
  for (const s of LIFECYCLE_PRESENT) series[s] = 0;
  let total = 0;
  for (const f of asArray(findings)) {
    series[normalizeLifecycle(isObj(f) ? f.lifecycle : undefined)] += 1;
    total += 1;
  }
  const resolvedCount = asArray(resolved).length;
  const groups = LIFECYCLE_PRESENT.map((key) => ({
    key,
    label: LIFECYCLE_LABELS[key],
    count: series[key],
    presentState: true,
  }));
  groups.push({
    key: "resolved",
    label: LIFECYCLE_LABELS.resolved,
    count: resolvedCount,
    presentState: false,
  });
  return { series, resolved: resolvedCount, total, groups };
}

function toList(v) {
  if (Array.isArray(v)) return v.filter((x) => typeof x === "string" && x);
  if (typeof v === "string" && v) return v.split(",").filter(Boolean);
  return [];
}

/**
 * Filter findings with the route-param vocabulary:
 *   q (text), sev[], state[], has (yes|no = element detail), group[], rule[],
 *   page (slug), scope (active|ignored; only when given a run object).
 * Accepts an array of findings, a run object, or a route params object as
 * the second argument ({params} is also accepted). Never throws.
 */
export function filterFindings(source, filter) {
  let list;
  const f0 = isObj(filter) && isObj(filter.params) ? filter.params : filter;
  const f = isObj(f0) ? f0 : {};
  if (Array.isArray(source)) list = source;
  else if (isObj(source)) list = f.scope === "ignored" ? asArray(source.ignored) : asArray(source.findings);
  else list = [];
  const q = typeof f.q === "string" ? f.q.trim().toLowerCase() : "";
  const sev = toList(f.sev);
  const state = toList(f.state);
  const group = toList(f.group);
  const rule = toList(f.rule);
  const page = typeof f.page === "string" ? f.page : "";
  const has = f.has === "yes" || f.has === "no" ? f.has : "";
  return list.filter((x) => {
    if (!isObj(x)) return false;
    if (sev.length && !sev.includes(normalizeSeverity(x.severity))) return false;
    if (state.length && !state.includes(normalizeLifecycle(x.lifecycle))) return false;
    if (rule.length && !rule.includes(x.ruleId)) return false;
    if (page && x.slug !== page) return false;
    if (group.length && !group.includes(x.group || groupOfUrl(x.pageUrl))) return false;
    if (has === "yes" && x.hasElementDetail !== true) return false;
    if (has === "no" && x.hasElementDetail === true) return false;
    if (q) {
      const hay = [x.pageUrl, x.ruleId, x.title, x.detail, x.viewport]
        .filter((s) => typeof s === "string")
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function cmpStr(a, b) {
  const x = typeof a === "string" ? a : "";
  const y = typeof b === "string" ? b : "";
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * Stable sort (returns a new array). sort: severity (default) | count | url;
 * dir: asc | desc. Severity "asc" puts the most severe first. Ties break on
 * page URL, viewport, rule id, id so the order is deterministic.
 */
export function sortFindings(findings, opts) {
  const o = isObj(opts) && isObj(opts.params) ? opts.params : isObj(opts) ? opts : {};
  const sort = ["url", "count", "severity"].includes(o.sort) ? o.sort : "severity";
  const sign = o.dir === "desc" ? -1 : 1;
  const items = asArray(findings).map((f, i) => ({ f, i }));
  items.sort((a, b) => {
    let c = 0;
    if (sort === "severity") c = rank(a.f && a.f.severity) - rank(b.f && b.f.severity);
    else if (sort === "count") c = nonNegInt(a.f && a.f.nodeCount) - nonNegInt(b.f && b.f.nodeCount);
    else c = cmpStr(a.f && a.f.pageUrl, b.f && b.f.pageUrl);
    if (c !== 0) return c * sign;
    c =
      cmpStr(a.f && a.f.pageUrl, b.f && b.f.pageUrl) ||
      cmpStr(a.f && a.f.viewport, b.f && b.f.viewport) ||
      cmpStr(a.f && a.f.ruleId, b.f && b.f.ruleId) ||
      cmpStr(a.f && a.f.id, b.f && b.f.id);
    return c !== 0 ? c : a.i - b.i;
  });
  return items.map((x) => x.f);
}

/**
 * Other pages in the same run with a Finding for the same rule.
 * Returns { count, pageUrls } (distinct pages, excluding the finding's own).
 */
export function sameRuleOtherPages(findings, finding) {
  const ruleId = isObj(finding) ? finding.ruleId : "";
  const own = isObj(finding) ? finding.pageUrl : "";
  const pages = new Set();
  if (ruleId) {
    for (const f of asArray(findings)) {
      if (isObj(f) && f.ruleId === ruleId && f.pageUrl && f.pageUrl !== own) pages.add(f.pageUrl);
    }
  }
  const pageUrls = Array.from(pages).sort();
  return { count: pageUrls.length, pageUrls };
}

function plural(n, one, many) {
  return n + " " + (n === 1 ? one : many);
}

/**
 * Plain text describing what Dispositions first took effect in a run, e.g.
 * "12 issues ignored from this run". Empty string when all counts are zero.
 * (The "unavailable" notice is DECISIONS_UNAVAILABLE_TEXT, shown separately.)
 */
export function decisionEffectText(decisions) {
  const d = isObj(decisions) ? decisions : {};
  const parts = [];
  const ig = nonNegInt(d.ignoredNewThisRun);
  const un = nonNegInt(d.unignoredNewThisRun);
  const rs = nonNegInt(d.resolvedNewThisRun);
  if (ig > 0) parts.push(plural(ig, "issue", "issues") + " ignored from this run");
  if (un > 0) parts.push(plural(un, "issue", "issues") + " no longer ignored from this run");
  if (rs > 0) parts.push(plural(rs, "issue", "issues") + " marked resolved from this run");
  return parts.join("; ");
}
