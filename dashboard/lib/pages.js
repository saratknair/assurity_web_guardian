// Pure page-explorer helpers. No window/document access at import time.
// Requirements 8.1, 8.2, 8.4-8.7, 8.12, 8.13.
//
// Input page rows follow dashboard.json `latest.pages[]`:
//   { url, slug, group, title, counts: { total, critical, serious, moderate,
//     minor, unrated, notRecorded }, highest }
// Optional lifecycle data (needed only for the Lifecycle state filter), any of:
//   row.states: string[]            lifecycle states present on the page
//   row.byLifecycle: { new: n, ... } counts per state
//   row.findings: [{ lifecycle }]   per-finding lifecycle
// Lifecycle keys are accepted in camelCase or kebab-case
// ("existingUnresolved" == "existing-unresolved", "notRecorded" == "not-recorded").

import { SEVERITY_ORDER, rank } from "./severity.js";

/*
 * groupOfUrl algorithm (the TypeScript `pageGroupOf` in src/publish/pages.ts
 * MUST mirror this exactly; a cross-check test compares them):
 *   1. Parse the input with `new URL(url)`. If it throws (or input is not a
 *      string), the group is "(other)".
 *   2. Take url.pathname and split on "/"; the first NON-EMPTY segment is the
 *      candidate. Query string and fragment are never considered.
 *   3. If there is no non-empty segment (path is "" or "/" or only slashes),
 *      the group is "(home)".
 *   4. Otherwise apply decodeURIComponent to the segment inside try/catch (on
 *      failure keep the raw segment), then lowercase (toLowerCase) the result.
 *      That is the group name.
 */
export function groupOfUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch (e) {
    return "(other)";
  }
  const segment = parsed.pathname.split("/").find((s) => s.length > 0);
  if (segment === undefined) return "(home)";
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch (e) {
    decoded = segment;
  }
  return decoded.toLowerCase();
}

const COUNT_KEYS = Object.freeze({
  critical: "critical",
  serious: "serious",
  moderate: "moderate",
  minor: "minor",
  unrated: "unrated",
  "not-recorded": "notRecorded",
});

function normState(s) {
  if (typeof s !== "string") return "";
  return s.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
}

function num(v) {
  return typeof v === "number" && isFinite(v) && v > 0 ? v : 0;
}

/** Counts by severity (kebab keys) taken from row.counts or row.findings. */
function severityCounts(page) {
  const out = {};
  const counts = page && page.counts;
  for (const sev of SEVERITY_ORDER) out[sev] = counts ? num(counts[COUNT_KEYS[sev]]) : 0;
  if (!counts && page && Array.isArray(page.findings)) {
    for (const f of page.findings) {
      const sev = f && SEVERITY_ORDER.includes(f.severity) ? f.severity : "not-recorded";
      out[sev] += 1;
    }
  }
  return out;
}

/** Highest (most severe) severity present on a row, or "none". */
export function highestSeverity(counts) {
  let best = "none";
  let bestRank = Infinity;
  for (const sev of SEVERITY_ORDER) {
    if (counts[sev] > 0 && rank(sev) < bestRank) {
      best = sev;
      bestRank = rank(sev);
    }
  }
  return best;
}

function statesOf(page) {
  const set = new Set();
  if (Array.isArray(page.states)) for (const s of page.states) set.add(normState(s));
  if (page.byLifecycle && typeof page.byLifecycle === "object") {
    for (const k of Object.keys(page.byLifecycle)) if (num(page.byLifecycle[k]) > 0) set.add(normState(k));
  }
  if (Array.isArray(page.findings)) {
    for (const f of page.findings) if (f && f.lifecycle) set.add(normState(f.lifecycle));
  }
  return set;
}

/**
 * Build flat rows once. Each row gets a precomputed lowercase `searchKey`
 * (url + title), `total`, `sevCounts`, `highest` ("none" when no findings),
 * `highestRank` (lower = more severe; none sorts last), `states` (Set) and
 * `index` (original position, used to keep sorts stable).
 */
export function buildPageRows(pages) {
  const list = Array.isArray(pages) ? pages : [];
  return list.map((p, index) => {
    const url = p && typeof p.url === "string" ? p.url : "";
    const title = p && typeof p.title === "string" ? p.title : "";
    const sevCounts = severityCounts(p || {});
    let total = 0;
    for (const sev of SEVERITY_ORDER) total += sevCounts[sev];
    if (p && p.counts && num(p.counts.total) > total) total = num(p.counts.total);
    let highest = highestSeverity(sevCounts);
    if (highest === "none" && total > 0 && p && SEVERITY_ORDER.includes(p.highest)) highest = p.highest;
    return {
      url,
      slug: p && typeof p.slug === "string" ? p.slug : "",
      title: title || null,
      group: p && typeof p.group === "string" && p.group ? p.group : groupOfUrl(url),
      total,
      sevCounts,
      highest,
      highestRank: highest === "none" ? SEVERITY_ORDER.length + 1 : rank(highest),
      states: statesOf(p || {}),
      searchKey: (url + " " + title).toLowerCase(),
      index,
    };
  });
}

/**
 * filter = { q, sev, state, has }
 *   q: substring (case-insensitive) of url + title
 *   sev: string[] - page matches when ANY selected severity is present
 *   state: string[] - page matches when ANY finding is in a selected state
 *   has: "yes" | "no" | undefined (also true/false)
 */
export function filterPages(rows, filter) {
  const f = filter || {};
  const q = typeof f.q === "string" ? f.q.trim().toLowerCase() : "";
  const sev = Array.isArray(f.sev) ? f.sev.filter((s) => SEVERITY_ORDER.includes(s)) : [];
  const state = Array.isArray(f.state) ? f.state.map(normState).filter(Boolean) : [];
  let has = f.has;
  if (has === true) has = "yes";
  if (has === false) has = "no";
  return rows.filter((r) => {
    if (q && r.searchKey.indexOf(q) === -1) return false;
    if (sev.length && !sev.some((s) => r.sevCounts[s] > 0)) return false;
    if (state.length && !state.some((s) => r.states.has(s))) return false;
    if (has === "yes" && r.total === 0) return false;
    if (has === "no" && r.total !== 0) return false;
    return true;
  });
}

/**
 * sort = { sort: "url" | "count" | "severity", dir: "asc" | "desc" }
 * "severity" asc = most severe first. Stable: ties keep input order in both
 * directions. Returns a new array.
 */
export function sortPages(rows, sort) {
  const s = sort || {};
  const key = s.sort === "count" || s.sort === "severity" ? s.sort : "url";
  const sign = s.dir === "desc" ? -1 : 1;
  const cmp = (a, b) => {
    if (key === "count") return a.total - b.total;
    if (key === "severity") return a.highestRank - b.highestRank;
    return a.url < b.url ? -1 : a.url > b.url ? 1 : 0;
  };
  return rows
    .map((r, i) => ({ r, i }))
    .sort((x, y) => sign * cmp(x.r, y.r) || x.i - y.i)
    .map((e) => e.r);
}

/**
 * Group rows by `group`, preserving the order of first appearance of each
 * group and the order of rows within it. Each group:
 * { name, rows, pages, total, sevCounts, highest }
 */
export function groupPages(rows) {
  const map = new Map();
  for (const r of rows) {
    let g = map.get(r.group);
    if (!g) {
      g = { name: r.group, rows: [], pages: 0, total: 0, sevCounts: {}, highest: "none" };
      for (const sev of SEVERITY_ORDER) g.sevCounts[sev] = 0;
      map.set(r.group, g);
    }
    g.rows.push(r);
    g.pages += 1;
    g.total += r.total;
    for (const sev of SEVERITY_ORDER) g.sevCounts[sev] += r.sevCounts[sev];
  }
  const groups = Array.from(map.values());
  for (const g of groups) g.highest = highestSeverity(g.sevCounts);
  return groups;
}