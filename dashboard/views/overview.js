// Assurity Web Guardian - Overview view (run selector, KPI cards, charts and
// the page explorer). Plain browser ES module, ASCII-only.
//
// Contract: `export async function render(container, ctx)` (see the VIEW MODULE
// CONTRACT comment in app.js). Renders exactly one <h2>. All dynamic text goes
// through textContent (never markup strings). No <form> element is used.
//
// Data sources (R16.1): the latest run renders from dashboard.json `latest`
// with no fetch; any other run is fetched with ctx.loadRun(runId). Old
// dashboards without `runs[]` / `latest` fall back to the legacy fields
// (runHealthTrend, findingsByPage, findingsBySeverity) and show figures that
// are not available as "Not recorded".
//
// Pure helpers are exported for tests and never touch window/document at
// import time: normalizeSevCounts, normalizeLifecycleCounts, buildRunList,
// pickLatestId, summaryFromPages, summaryFromDashboard, summaryFromRun,
// legacySummary, healthLabel, pageRowName, groupHeaderText, isGroupExpanded,
// sortValue, parseSortValue, activeFilterTexts, runOptionText.

import { SEVERITY_ORDER, label as sevLabel, symbol as sevSymbol } from "../lib/severity.js";
import { LIFECYCLE_PRESENT, LIFECYCLE_LABELS } from "../lib/findings.js";
import { runDomain, differentSiteLabel } from "../lib/domain.js";
import { pageIgnoredText } from "../lib/captions.js";
import { ignoredCountBySlug } from "../lib/ignored.js";
import { buildPageRows, filterPages, sortPages, groupPages } from "../lib/pages.js";
import {
  el, append, clear, button, badge, errorBanner, sectionHeading, plural, formatDateTime,
  shortSeverityLabel, uniqueId,
} from "./common.js";
import { renderTrendChart, renderSeverityChart, renderLifecycleChart, destroyCharts } from "./charts.js";

export const LARGE_SITE_PAGES = 100;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function isObj(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function cnt(v) {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}
function camelKey(k) {
  return k.replace(/-([a-z])/g, (m, c) => c.toUpperCase());
}
function readCount(obj, key) {
  if (!isObj(obj)) return 0;
  return cnt(obj[key] !== undefined ? obj[key] : obj[camelKey(key)]);
}

/** Severity counts keyed by kebab-case severity; accepts camelCase input. */
export function normalizeSevCounts(obj) {
  const out = {};
  for (const s of SEVERITY_ORDER) out[s] = readCount(obj, s);
  return out;
}

/** Present-state lifecycle counts keyed by kebab-case; accepts camelCase input. */
export function normalizeLifecycleCounts(obj) {
  const out = {};
  for (const s of LIFECYCLE_PRESENT) out[s] = readCount(obj, s);
  return out;
}

function sumCounts(counts) {
  let n = 0;
  for (const s of SEVERITY_ORDER) n += counts[s] || 0;
  return n;
}

function finishedKey(r) {
  return typeof r.finishedAt === "string" ? r.finishedAt : "";
}

/**
 * Runs, newest first (runs without a date last, stable). Each entry:
 * { runId, finishedAt, total (number|null), hasRunData, health }.
 * Sources, first non-empty wins: dashboard.runs[], index.runs[], runHealthTrend.
 * Health is taken from index.json or runHealthTrend when the entry lacks it.
 */
export function buildRunList(dashboard, index) {
  const d = isObj(dashboard) ? dashboard : {};
  const idxRaw = isObj(index) && Array.isArray(index.runs) ? index.runs : Array.isArray(index) ? index : [];
  const trend = Array.isArray(d.runHealthTrend) ? d.runHealthTrend : [];
  const healthById = new Map();
  for (const r of idxRaw.concat(trend)) {
    if (isObj(r) && typeof r.runId === "string" && typeof r.health === "string" && !healthById.has(r.runId)) {
      healthById.set(r.runId, r.health);
    }
  }
  const domainById = new Map();
  for (const r of idxRaw.concat(trend)) {
    if (isObj(r) && typeof r.runId === "string" && runDomain(r) && !domainById.has(r.runId)) {
      domainById.set(r.runId, runDomain(r));
    }
  }
  let src = Array.isArray(d.runs) ? d.runs.filter((r) => isObj(r) && typeof r.runId === "string" && r.runId) : [];
  const fromDashboard = src.length > 0;
  if (!src.length) src = idxRaw.filter((r) => isObj(r) && typeof r.runId === "string" && r.runId);
  if (!src.length) src = trend.filter((r) => isObj(r) && typeof r.runId === "string" && r.runId);
  const items = src.map((r, i) => ({
    i,
    entry: {
      runId: r.runId,
      finishedAt: typeof r.finishedAt === "string" ? r.finishedAt : null,
      total: fromDashboard && typeof r.total === "number" ? cnt(r.total) : null,
      hasRunData: r.hasRunData !== false,
      health: typeof r.health === "string" ? r.health : healthById.get(r.runId) || "",
      domain: runDomain(r) || domainById.get(r.runId) || "",
    },
  }));
  items.sort((a, b) => {
    const x = finishedKey(a.entry);
    const y = finishedKey(b.entry);
    if (x !== y) {
      if (!x) return 1;
      if (!y) return -1;
      return x < y ? 1 : -1;
    }
    return a.i - b.i;
  });
  return items.map((x) => x.entry);
}

/** Latest run id: dashboard.latest.runId, else the newest run in the list. */
export function pickLatestId(dashboard, runList) {
  const d = isObj(dashboard) ? dashboard : {};
  if (isObj(d.latest) && typeof d.latest.runId === "string" && d.latest.runId) return d.latest.runId;
  return runList && runList.length ? runList[0].runId : "";
}

/** Option text: "date - run id - N findings[ - Different site: host]". latest is optional. */
export function runOptionText(r, latest) {
  const parts = [formatDateTime(r.finishedAt), r.runId];
  if (typeof r.total === "number") parts.push(plural(r.total, "finding", "findings"));
  if (r.hasRunData === false) parts.push("run data not published");
  const diff = differentSiteLabel(r, latest);
  if (diff) parts.push(diff);
  return parts.join(" - ");
}

const COUNT_FIELDS = {
  critical: "critical", serious: "serious", moderate: "moderate", minor: "minor",
  unrated: "unrated", "not-recorded": "notRecorded",
};

function emptyPageCounts() {
  return { total: 0, critical: 0, serious: 0, moderate: 0, minor: 0, unrated: 0, notRecorded: 0 };
}

/** Totals from page rows ({counts}): { total, bySeverity }. */
export function summaryFromPages(pages) {
  const bySeverity = normalizeSevCounts({});
  let total = 0;
  for (const p of Array.isArray(pages) ? pages : []) {
    const c = isObj(p) && isObj(p.counts) ? p.counts : {};
    let rowSum = 0;
    for (const s of SEVERITY_ORDER) {
      const n = cnt(c[COUNT_FIELDS[s]]);
      bySeverity[s] += n;
      rowSum += n;
    }
    total += Math.max(rowSum, cnt(c.total));
  }
  return { total, bySeverity };
}

/** Page rows derived from Findings (used when a run has no pages[]). */
function pagesFromFindings(findings) {
  const map = new Map();
  for (const f of Array.isArray(findings) ? findings : []) {
    if (!isObj(f)) continue;
    const key = f.slug || f.pageUrl || "";
    let p = map.get(key);
    if (!p) {
      p = { url: f.pageUrl || "", slug: f.slug || "", group: f.group, title: null, counts: emptyPageCounts(), highest: "none" };
      map.set(key, p);
    }
    const sev = SEVERITY_ORDER.includes(f.severity) ? f.severity : "not-recorded";
    p.counts[COUNT_FIELDS[sev]] += 1;
    p.counts.total += 1;
  }
  return Array.from(map.values());
}

/** Page rows with ignoredCount set from a { slug: n } map (published values win). */
export function withIgnored(pages, bySlug) {
  const list = Array.isArray(pages) ? pages : [];
  if (!isObj(bySlug)) return list;
  return list.map((p) =>
    isObj(p) && typeof p.ignoredCount !== "number" && typeof bySlug[p.slug] === "number"
      ? Object.assign({}, p, { ignoredCount: bySlug[p.slug] })
      : p,
  );
}

function statesBySlugFrom(findings) {
  const out = {};
  for (const f of Array.isArray(findings) ? findings : []) {
    if (!isObj(f) || !f.slug) continue;
    const list = out[f.slug] || (out[f.slug] = []);
    if (f.lifecycle && list.indexOf(f.lifecycle) === -1) list.push(f.lifecycle);
  }
  return out;
}

/**
 * Summary for the latest run straight from dashboard.json (no fetch).
 * Returns null unless dashboard.latest matches runId and carries pages[].
 */
export function summaryFromDashboard(dashboard, runId) {
  const d = isObj(dashboard) ? dashboard : {};
  if (!isObj(d.latest) || d.latest.runId !== runId || !Array.isArray(d.latest.pages)) return null;
  const entry = (Array.isArray(d.runs) ? d.runs : []).find((r) => isObj(r) && r.runId === runId) || null;
  const pages = d.latest.pages;
  const fromPages = summaryFromPages(pages);
  const bySeverity = entry && isObj(entry.bySeverity) ? normalizeSevCounts(entry.bySeverity) : fromPages.bySeverity;
  return {
    source: "dashboard",
    runId,
    finishedAt: entry && typeof entry.finishedAt === "string" ? entry.finishedAt : null,
    total: entry && typeof entry.total === "number" ? cnt(entry.total) : fromPages.total,
    bySeverity,
    lifecycle: entry && isObj(entry.byLifecycle) ? normalizeLifecycleCounts(entry.byLifecycle) : null,
    resolved: entry ? cnt(entry.resolved) : 0,
    ignored: entry && typeof entry.ignored === "number" ? cnt(entry.ignored) : null,
    pagesScanned: entry && typeof entry.pages === "number" ? cnt(entry.pages) : pages.length,
    pages,
    statesBySlug: null,
    hasRunData: entry ? entry.hasRunData !== false : true,
    health: entry && typeof entry.health === "string" ? entry.health : "",
  };
}

/** Summary from a normalized run (ctx.loadRun result). entry = runs[] row or null. */
export function summaryFromRun(run, entry) {
  const r = isObj(run) ? run : {};
  const t = isObj(r.totals) ? r.totals : {};
  const pages = Array.isArray(r.pages) && r.pages.length ? r.pages : pagesFromFindings(r.findings);
  return {
    source: "run",
    runId: typeof r.runId === "string" ? r.runId : "",
    finishedAt: typeof r.finishedAt === "string" ? r.finishedAt : entry && entry.finishedAt ? entry.finishedAt : null,
    total: cnt(t.all),
    bySeverity: normalizeSevCounts(t.bySeverity),
    lifecycle: normalizeLifecycleCounts(t.byLifecycle),
    resolved: cnt(t.resolved),
    ignored: typeof t.ignored === "number" ? cnt(t.ignored) : null,
    pagesScanned: entry && typeof entry.pages === "number" ? cnt(entry.pages) : pages.length,
    pages,
    statesBySlug: statesBySlugFrom(r.findings),
    ignoredBySlug: ignoredCountBySlug(r.ignored),
    hasRunData: true,
    health: entry && typeof entry.health === "string" ? entry.health : "",
  };
}

/** Summary from the pre-overhaul dashboard.json fields. Never throws. */
export function legacySummary(dashboard) {
  const d = isObj(dashboard) ? dashboard : {};
  const trend = Array.isArray(d.runHealthTrend) ? d.runHealthTrend.filter(isObj) : [];
  const last = trend.length ? trend[trend.length - 1] : null;
  const byPage = Array.isArray(d.findingsByPage) ? d.findingsByPage.filter(isObj) : [];
  const pages = byPage.map((p) => {
    const n = cnt(p.count);
    const counts = emptyPageCounts();
    counts.total = n;
    counts.notRecorded = n;
    return { url: typeof p.page === "string" ? p.page : "", slug: "", title: null, counts, highest: n > 0 ? "not-recorded" : "none" };
  });
  const bySeverity = normalizeSevCounts(d.findingsBySeverity);
  const sevTotal = sumCounts(bySeverity);
  return {
    source: "legacy",
    runId: last && typeof last.runId === "string" ? last.runId : "",
    finishedAt: last && typeof last.finishedAt === "string" ? last.finishedAt : null,
    total: sevTotal > 0 ? sevTotal : pages.reduce((a, p) => a + p.counts.total, 0),
    bySeverity,
    lifecycle: null,
    resolved: 0,
    ignored: null,
    pagesScanned: pages.length,
    pages,
    statesBySlug: null,
    hasRunData: true,
    health: last && typeof last.health === "string" ? last.health : "",
  };
}

/** Text for the Health card. Derived only from the findings total when no health was published. */
export function healthLabel(summary, runEntry) {
  const h = (summary && summary.health) || (runEntry && runEntry.health) || "";
  if (h === "healthy") return "Healthy";
  if (h === "attention") return "Needs attention";
  if (h === "failing") return "Failing";
  if (summary && typeof summary.total === "number") return summary.total > 0 ? "Needs attention" : "Healthy";
  return "Not recorded";
}

/** Accessible name of a page row: "url, N findings, highest severity X". */
export function pageRowName(row) {
  const n = row.total;
  let s = row.url + ", " + plural(n, "finding", "findings");
  if (n > 0 && row.highest !== "none") s += ", highest severity " + sevLabel(row.highest);
  if (row.ignoredCount > 0) s += ", plus " + row.ignoredCount + " ignored, not counted";
  return s;
}

/** Group header sentence (also its aria-label). */
export function groupHeaderText(g) {
  const parts = [g.name, plural(g.pages, "page", "pages"), plural(g.total, "finding", "findings")];
  for (const s of SEVERITY_ORDER) {
    if (g.sevCounts[s] > 0) parts.push(g.sevCounts[s] + " " + shortSeverityLabel(s));
  }
  return parts.join(", ");
}

/**
 * Is a group expanded? An explicit choice wins; otherwise groups with matches
 * are open while a search is active; otherwise collapsed at 100+ pages.
 * o = { expanded: Set, collapsed: Set, totalPages, searching }
 */
export function isGroupExpanded(name, o) {
  if (o.expanded && o.expanded.has(name)) return true;
  if (o.collapsed && o.collapsed.has(name)) return false;
  if (o.searching) return true;
  return o.totalPages < LARGE_SITE_PAGES;
}

export const SORT_OPTIONS = Object.freeze([
  { value: "url:asc", label: "URL (A to Z)" },
  { value: "url:desc", label: "URL (Z to A)" },
  { value: "count:desc", label: "Most findings first" },
  { value: "count:asc", label: "Fewest findings first" },
  { value: "severity:asc", label: "Highest severity first" },
  { value: "severity:desc", label: "Lowest severity first" },
]);

/** "sort:dir" value for the sort select from route params. */
export function sortValue(params) {
  const p = params || {};
  const sort = p.sort === "count" || p.sort === "severity" ? p.sort : "url";
  return sort + ":" + (p.dir === "desc" ? "desc" : "asc");
}

/** Inverse of sortValue: { sort, dir } route param patch (defaults are omitted). */
export function parseSortValue(value) {
  const [sort, dir] = String(value || "").split(":");
  if (sort === "url" && dir === "asc") return { sort: undefined, dir: undefined };
  return { sort, dir };
}

const CHIP_LABELS = {
  critical: "Critical", serious: "Serious", moderate: "Moderate", minor: "Minor",
  unrated: "Not rated", "not-recorded": "Not recorded",
};

/** Plain-text list of the active page filters (shown in the empty state). */
export function activeFilterTexts(params) {
  const p = params || {};
  const out = [];
  if (p.q) out.push('Search: "' + p.q + '"');
  if (Array.isArray(p.sev) && p.sev.length) out.push("Severity: " + p.sev.map((s) => CHIP_LABELS[s] || s).join(", "));
  if (Array.isArray(p.state) && p.state.length) out.push("Lifecycle state: " + p.state.map((s) => LIFECYCLE_LABELS[s] || s).join(", "));
  if (p.has === "yes") out.push("Has findings: yes");
  if (p.has === "no") out.push("Has findings: no");
  return out;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

// Set by handlers that re-render the whole view so the run selector can take
// focus back (the shell only moves focus on a change of view).
let refocusRunSelect = false;

const KPI_DEFS = {
  health: "Health of the selected run as recorded by the Guardian: healthy, needs attention, or failing.",
  runs: "Number of runs published in the dashboard data.",
  total: "Active findings in the selected run, not counting ignored findings. Select to list them.",
  severity: "Active findings in the selected run split by severity. Select a severity to list those findings.",
  pages: "Number of pages scanned in the selected run. Select to open the run.",
  ignored: "Findings in the selected run that a reviewer chose to ignore. They are not part of the total.",
};

function styleButtonCard(b) {
  b.className = (b.className ? b.className + " " : "") + "kpi--button";
}

function kpiParts(card, labelText, valueText, valueCls, defKey) {
  const labelId = uniqueId("kpi-label");
  const defId = uniqueId("kpi-def");
  const lab = el("div", "kpi__label", labelText, { id: labelId });
  const val = el("div", "kpi__value" + (valueCls ? " " + valueCls : ""), valueText);
  const def = el("span", "sr-only", KPI_DEFS[defKey], { id: defId });
  card.setAttribute("aria-describedby", defId);
  append(card, lab, val, def);
  return { labelId, defId, val };
}

function kpiStatic(labelText, valueText, valueCls, defKey) {
  const card = el("div", "kpi", null, { role: "group" });
  const p = kpiParts(card, labelText, valueText, valueCls, defKey);
  card.setAttribute("aria-labelledby", p.labelId);
  return card;
}

function kpiButton(ctx, labelText, valueText, valueCls, defKey, route, focusKey) {
  const card = button("", "kpi", { "data-focus-key": focusKey });
  styleButtonCard(card);
  kpiParts(card, labelText, valueText, valueCls, defKey);
  card.addEventListener("click", () => ctx.navigate(route, { focusKey }));
  return card;
}

function buildKpis(ctx, summary, runList, runEntry, runId) {
  const grid = el("div", "kpi-grid");
  const health = healthLabel(summary, runEntry);
  const hCls = health === "Healthy" ? "good" : health === "Needs attention" ? "warn" : health === "Failing" ? "bad" : "";
  grid.appendChild(kpiStatic("Health", health, hCls, "health"));
  grid.appendChild(kpiStatic("Runs tracked", String(runList.length), "", "runs"));

  const total = summary.total;
  grid.appendChild(
    kpiButton(ctx, "Total findings", String(total), total > 0 ? "warn" : "good", "total",
      { view: "findings", params: { run: runId } }, "kpi-total"),
  );

  // Findings by severity: one button per severity that has findings.
  const sevCard = el("div", "kpi", null, { role: "group" });
  const sp = kpiParts(sevCard, "Findings by severity", "", "", "severity");
  sevCard.setAttribute("aria-labelledby", sp.labelId);
  sp.val.className = "";
  sp.val.style.marginTop = "8px";
  let any = false;
  const chips = el("div", "chip-row");
  for (const s of SEVERITY_ORDER) {
    const n = summary.bySeverity[s] || 0;
    if (n <= 0) continue;
    any = true;
    const key = "kpi-sev-" + s;
    const b = button("", "chip", { "data-focus-key": key });
    append(b, el("span", "", sevSymbol(s), { "aria-hidden": "true" }), " " + CHIP_LABELS[s] + " " + n);
    b.setAttribute("aria-label", n + " " + shortSeverityLabel(s) + " findings");
    b.addEventListener("click", () => ctx.navigate({ view: "findings", params: { run: runId, sev: [s] } }, { focusKey: key }));
    chips.appendChild(b);
  }
  if (any) sp.val.appendChild(chips);
  else sp.val.appendChild(el("span", "muted", "No active findings"));
  grid.appendChild(sevCard);

  const pagesText = String(summary.pagesScanned);
  if (summary.hasRunData !== false && summary.source !== "legacy") {
    grid.appendChild(kpiButton(ctx, "Pages scanned", pagesText, "", "pages", { view: "run", runId }, "kpi-pages"));
  } else {
    grid.appendChild(kpiStatic("Pages scanned", pagesText, "", "pages"));
  }

  if (typeof summary.ignored === "number") {
    if (summary.ignored > 0) {
      grid.appendChild(
        kpiButton(ctx, "Ignored", String(summary.ignored), "", "ignored",
          { view: "findings", params: { run: runId, scope: "ignored" } }, "kpi-ignored"),
      );
    } else {
      grid.appendChild(kpiStatic("Ignored", "0", "", "ignored"));
    }
  }
  return grid;
}

function chartHost() {
  const h = el("div");
  h.style.display = "contents";
  return h;
}

function note(text) {
  return el("p", "notice", text);
}

function chipLabelFor(kind, key) {
  return kind === "sev" ? CHIP_LABELS[key] : LIFECYCLE_LABELS[key];
}

/** Page explorer: search, filters, sort, result count and grouped page list. */
function buildExplorer(ctx, summary, runId, startParams) {
  const section = el("section", "stack");
  section.appendChild(sectionHeading("Pages", 3));
  const params = Object.assign({}, startParams);
  const ui = ctx.state.ui;
  if (!(ui.expandedGroups instanceof Set)) ui.expandedGroups = new Set();
  if (!(ui.collapsedGroups instanceof Set)) ui.collapsedGroups = new Set();

  let statesBySlug = summary.statesBySlug;
  let statesFailed = false;
  let ignoredBySlug = summary.ignoredBySlug || null;
  let rows = buildPageRows(withIgnored(summary.pages, ignoredBySlug));
  const totalPages = rows.length;

  function rebuildRows() {
    const pages = withIgnored(summary.pages, ignoredBySlug).map((p) =>
      Object.assign({}, p, { states: statesBySlug && p && statesBySlug[p.slug] ? statesBySlug[p.slug] : [] }),
    );
    rows = buildPageRows(pages);
  }
  if (statesBySlug) rebuildRows();

  // "(+N ignored)" needs the run's ignored[] list; fetch it quietly when the
  // summary came from dashboard.json and the run has ignored findings.
  if (!ignoredBySlug && typeof summary.ignored === "number" && summary.ignored > 0 && summary.runId) {
    ctx.loadRun(runId).then(
      (out) => {
        if (!ctx.isCurrent()) return;
        ignoredBySlug = ignoredCountBySlug(out.run.ignored);
        rebuildRows();
        update(false);
      },
      () => { /* the "(+N ignored)" text is simply not shown */ },
    );
  }

  async function ensureStates() {
    if (statesBySlug || statesFailed) return;
    try {
      const out = await ctx.loadRun(runId);
      statesBySlug = statesBySlugFrom(out.run.findings);
      rebuildRows();
    } catch (e) {
      statesFailed = true;
    }
  }

  // --- controls -----------------------------------------------------------
  const searchId = uniqueId("page-search");
  const hasId = uniqueId("page-has");
  const sortId = uniqueId("page-sort");
  const countId = uniqueId("page-count");

  const searchWrap = el("div", "stack");
  const searchLabel = el("label", "", "Search pages by URL or title", { for: searchId });
  const search = el("input", "field search-box", null, { id: searchId, type: "search", autocomplete: "off", spellcheck: "false" });
  search.value = params.q || "";
  append(searchWrap, searchLabel, search);

  const filters = el("fieldset", "stack");
  filters.appendChild(el("legend", "", "Filter pages"));

  function chipGroup(kind, legend, keys) {
    const fs = el("fieldset");
    fs.appendChild(el("legend", "", legend));
    const rowEl = el("div", "chip-row");
    const btns = [];
    for (const key of keys) {
      const b = button(chipLabelFor(kind, key), "chip", { "aria-pressed": "false", "data-focus-key": "pf-" + kind + "-" + key });
      b.addEventListener("click", () => {
        const cur = new Set(Array.isArray(params[kind]) ? params[kind] : []);
        if (cur.has(key)) cur.delete(key); else cur.add(key);
        commit({ [kind]: Array.from(cur).sort() }, false);
      });
      btns.push([key, b]);
      rowEl.appendChild(b);
    }
    fs.appendChild(rowEl);
    return { fs, btns };
  }
  const sevGroup = chipGroup("sev", "Severity", SEVERITY_ORDER);
  const stateGroup = chipGroup("state", "Lifecycle state", LIFECYCLE_PRESENT);

  const hasWrap = el("div", "stack");
  hasWrap.appendChild(el("label", "", "Has findings", { for: hasId }));
  const hasSel = el("select", "select", null, { id: hasId });
  for (const [v, t] of [["", "Any"], ["yes", "Yes"], ["no", "No"]]) {
    const o = el("option", "", t, { value: v });
    hasSel.appendChild(o);
  }
  hasSel.addEventListener("change", () => commit({ has: hasSel.value }, false));
  hasWrap.appendChild(hasSel);

  append(filters, sevGroup.fs, stateGroup.fs, hasWrap);

  const sortWrap = el("div", "stack");
  sortWrap.appendChild(el("label", "", "Sort pages by", { for: sortId }));
  const sortSel = el("select", "select", null, { id: sortId });
  for (const o of SORT_OPTIONS) sortSel.appendChild(el("option", "", o.label, { value: o.value }));
  sortSel.addEventListener("change", () => commit(parseSortValue(sortSel.value), false));
  sortWrap.appendChild(sortSel);

  const toolbar = el("div", "toolbar");
  append(toolbar, searchWrap, sortWrap);
  const countEl = el("p", "muted", "", { id: countId });
  const statesNote = el("div");
  const listHost = el("div");
  append(section, toolbar, filters, statesNote, countEl, listHost);

  function syncControls() {
    if (search.value !== (params.q || "")) search.value = params.q || "";
    for (const [key, b] of sevGroup.btns) b.setAttribute("aria-pressed", (params.sev || []).indexOf(key) !== -1 ? "true" : "false");
    for (const [key, b] of stateGroup.btns) b.setAttribute("aria-pressed", (params.state || []).indexOf(key) !== -1 ? "true" : "false");
    hasSel.value = params.has || "";
    sortSel.value = sortValue(params);
  }

  function writeUrl(replace) {
    ctx.navigate({ view: "overview", params: Object.assign({}, params) }, { replace: !!replace, rerender: false });
  }

  function commit(patch, replace) {
    for (const k of Object.keys(patch)) {
      const v = patch[k];
      if (v === undefined || v === "" || (Array.isArray(v) && !v.length)) delete params[k];
      else params[k] = v;
    }
    writeUrl(replace);
    syncControls();
    update(true);
  }

  function clearFilters() {
    for (const k of ["q", "sev", "state", "has"]) delete params[k];
    writeUrl(false);
    syncControls();
    update(true);
  }

  // --- search: coalesced with requestAnimationFrame, URL via replaceState ---
  let frame = 0;
  function onSearchFrame() {
    frame = 0;
    const q = search.value.trim();
    if (q) params.q = q; else delete params.q;
    writeUrl(true);
    update(true);
  }
  search.addEventListener("input", () => {
    if (frame) return;
    if (typeof requestAnimationFrame === "function") frame = requestAnimationFrame(onSearchFrame);
    else onSearchFrame();
  });

  // --- list ---------------------------------------------------------------
  function clearButton() {
    const b = button("Clear filters", "btn", { "data-focus-key": "pf-clear" });
    b.addEventListener("click", clearFilters);
    return b;
  }

  function buildGroup(g, expanded) {
    const wrap = el("div");
    const listId = uniqueId("group-list");
    const head = button("", "group-header", {
      "aria-expanded": expanded ? "true" : "false",
      "aria-controls": listId,
      "aria-label": groupHeaderText(g),
      "data-focus-key": "group:" + g.name,
    });
    head.appendChild(el("span", "", g.name));
    const sevText = SEVERITY_ORDER.filter((s) => g.sevCounts[s] > 0).map((s) => g.sevCounts[s] + " " + shortSeverityLabel(s));
    head.appendChild(
      el("span", "group-header__count", [plural(g.pages, "page", "pages"), plural(g.total, "finding", "findings")].concat(sevText).join(", ")),
    );
    wrap.appendChild(head);
    let listEl = null;
    function fill() {
      listEl = el("ul", "page-list", null, { id: listId });
      for (const r of g.rows) listEl.appendChild(buildRow(r));
      wrap.appendChild(listEl);
    }
    if (expanded) fill();
    head.addEventListener("click", () => {
      const open = head.getAttribute("aria-expanded") !== "true";
      if (open) { ui.expandedGroups.add(g.name); ui.collapsedGroups.delete(g.name); }
      else { ui.collapsedGroups.add(g.name); ui.expandedGroups.delete(g.name); }
      head.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) { if (!listEl) fill(); }
      else if (listEl) { wrap.removeChild(listEl); listEl = null; }
    });
    return wrap;
  }

  function buildRow(r) {
    const li = el("li");
    const inner = r.slug
      ? el("a", "page-row", null, {
          href: ctx.formatRoute({ view: "page", slug: r.slug, params: { run: runId } }),
          "data-focus-key": "page:" + r.slug,
        })
      : el("div", "page-row");
    inner.setAttribute("aria-label", pageRowName(r));
    const urlSpan = el("span", "page-row__url");
    urlSpan.appendChild(el("span", "", r.url));
    if (r.title) urlSpan.appendChild(el("span", "muted", r.title, { style: "display:block" }));
    inner.appendChild(urlSpan);
    inner.appendChild(el("span", "page-row__count", plural(r.total, "finding", "findings")));
    const ignText = pageIgnoredText(r.ignoredCount);
    if (ignText) inner.appendChild(el("span", "page-row__count muted", ignText));
    if (r.total > 0 && r.highest !== "none") inner.appendChild(badge(r.highest));
    else inner.appendChild(el("span", "page-row__count", "No findings"));
    li.appendChild(inner);
    return li;
  }

  let lastAnnounced = "";
  async function update(announce) {
    const wantStates = Array.isArray(params.state) && params.state.length > 0;
    if (wantStates) await ensureStates();
    if (!ctx.isCurrent()) return;
    clear(statesNote);
    if (wantStates && statesFailed) {
      statesNote.appendChild(
        errorBanner("runs/" + runId + "/run-findings.json", { note: "The lifecycle state filter could not be applied." }),
      );
    }
    const filter = { q: params.q, sev: params.sev, state: statesFailed ? [] : params.state, has: params.has };
    const matched = filterPages(rows, filter);
    const sorted = sortPages(matched, { sort: params.sort, dir: params.dir });
    const groups = groupPages(sorted);
    const active = activeFilterTexts(params);
    const text = active.length ? plural(matched.length, "page", "pages") + " match" : plural(totalPages, "page", "pages");
    countEl.textContent = text;
    if (announce && text !== lastAnnounced && typeof ctx.announce === "function") ctx.announce(text);
    lastAnnounced = text;

    clear(listHost);
    if (!matched.length) {
      const box = el("div", "empty-state");
      const card = el("div", "empty-state__card");
      if (totalPages === 0) {
        card.appendChild(el("p", "empty-state__title", "No pages were recorded for this run"));
      } else {
        card.appendChild(el("p", "empty-state__title", "No pages match"));
        if (active.length) {
          const ul = el("ul");
          for (const t of active) ul.appendChild(el("li", "", t));
          card.appendChild(ul);
        }
        card.appendChild(clearButton());
      }
      box.appendChild(card);
      listHost.appendChild(box);
      return;
    }
    const searching = !!params.q;
    for (const g of groups) {
      const open = isGroupExpanded(g.name, { expanded: ui.expandedGroups, collapsed: ui.collapsedGroups, totalPages, searching });
      listHost.appendChild(buildGroup(g, open));
    }
  }

  syncControls();
  update(false);
  return section;
}

export async function render(container, ctx) {
  destroyCharts();
  const state = ctx.state || {};
  const dashboard = state.dashboard || {};
  const route = ctx.route || { params: {} };
  const params = route.params || {};

  const runList = buildRunList(dashboard, state.index);
  const latestId = pickLatestId(dashboard, runList);
  const legacy = !Array.isArray(dashboard.runs) && !isObj(dashboard.latest);
  const wantedId = params.run || latestId;

  const known = new Set(runList.map((r) => r.runId));
  if (params.run && params.run !== latestId && !known.has(params.run)) {
    ctx.notFound(container);
    return;
  }

  container.appendChild(el("h2", "", "Overview"));

  const hasAnything = runList.length > 0 || (isObj(dashboard.latest) && Array.isArray(dashboard.latest.pages)) ||
    (Array.isArray(dashboard.findingsByPage) && dashboard.findingsByPage.length > 0);
  if (dashboard.empty === true || !hasAnything || !wantedId) {
    const box = el("div", "empty-state");
    const card = el("div", "empty-state__card");
    card.appendChild(el("p", "empty-state__title", "No run data yet"));
    card.appendChild(el("p", "empty-state__body", "Once a Guardian run completes and publishes, its results will appear here."));
    box.appendChild(card);
    container.appendChild(box);
    return;
  }

  const entryOf = (id) => runList.find((r) => r.runId === id) || null;

  async function getSummary(id) {
    const fromDash = summaryFromDashboard(dashboard, id);
    if (fromDash) {
      if (!fromDash.health) fromDash.health = (entryOf(id) || {}).health || "";
      return fromDash;
    }
    if (legacy && id === legacySummary(dashboard).runId) return legacySummary(dashboard);
    const entry = entryOf(id);
    if (entry && entry.hasRunData === false) throw new Error("Run data not published for " + id);
    const out = await ctx.loadRun(id);
    return summaryFromRun(out.run, entry);
  }

  // Selected run first, then the latest, then older runs (newest first).
  const order = [wantedId];
  if (latestId && order.indexOf(latestId) === -1) order.push(latestId);
  for (const r of runList) if (order.indexOf(r.runId) === -1) order.push(r.runId);
  const failures = [];
  let summary = null;
  for (const id of order.slice(0, 6)) {
    try {
      summary = await getSummary(id);
      if (!ctx.isCurrent()) return;
      if (!summary.runId) summary.runId = id;
      break;
    } catch (err) {
      if (!ctx.isCurrent()) return;
      failures.push({ id, message: err && err.message ? String(err.message) : String(err) });
    }
  }

  if (failures.length) {
    const first = failures[0];
    container.appendChild(
      errorBanner("runs/" + first.id + "/run-findings.json", {
        detail: first.message,
        note: summary
          ? "Showing run " + summary.runId + " instead, the most recent run that loaded."
          : "No run could be loaded, so no figures are shown.",
      }),
    );
  }

  // Run selector
  const effectiveId = summary ? summary.runId : wantedId;
  const toolbar = el("div", "toolbar");
  const selWrap = el("div", "stack");
  const selId = uniqueId("run-select");
  selWrap.appendChild(el("label", "", "Run", { for: selId }));
  const sel = el("select", "select", null, { id: selId, "data-focus-key": "run-select" });
  const options = runList.length ? runList : [{ runId: effectiveId, finishedAt: null, total: null, hasRunData: true }];
  const latestEntry = entryOf(latestId);
  for (const r of options) sel.appendChild(el("option", "", runOptionText(r, latestEntry), { value: r.runId }));
  sel.value = effectiveId;
  function selectRun(id) {
    const next = Object.assign({}, params);
    if (id && id !== latestId) next.run = id; else delete next.run;
    refocusRunSelect = true;
    ctx.navigate({ view: "overview", params: next }, { focusKey: "run-select" });
  }
  sel.addEventListener("change", () => selectRun(sel.value));
  selWrap.appendChild(sel);
  toolbar.appendChild(selWrap);
  container.appendChild(toolbar);

  if (!summary) return;

  const entry = entryOf(effectiveId);
  container.appendChild(
    el("p", "muted", "Showing run " + effectiveId + " (" + formatDateTime(summary.finishedAt) + ")"),
  );

  const siteLabel = differentSiteLabel(entry, latestEntry);
  if (siteLabel) {
    const sn = el("div", "notice notice--warn", null, { role: "status" });
    sn.appendChild(
      el("span", "", siteLabel + ". This run describes a different site from the latest run (" + runDomain(latestEntry) + ")."),
    );
    container.appendChild(sn);
  }

  if (effectiveId !== latestId) {
    const n = el("div", "notice notice--warn", null, { role: "status" });
    n.appendChild(el("span", "", "You are viewing run " + effectiveId + " (" + formatDateTime(summary.finishedAt) + "), not the latest run. "));
    const back = button("Back to latest run", "btn", { "data-focus-key": "back-to-latest" });
    back.addEventListener("click", () => selectRun(latestId));
    n.appendChild(back);
    container.appendChild(n);
  }

  container.appendChild(buildKpis(ctx, summary, runList, entry, effectiveId));

  // Charts
  const grid = el("div", "chart-grid");
  const trendHost = chartHost();
  const sevHost = chartHost();
  const lcHost = chartHost();
  append(grid, trendHost, sevHost, lcHost);
  container.appendChild(grid);

  const trendRuns = Array.isArray(dashboard.runs) ? dashboard.runs : [];
  if (trendRuns.length) {
    renderTrendChart(trendHost, trendRuns, ctx);
  } else {
    trendHost.appendChild(note("Totals per run are not recorded in this data, so the trend chart is not shown."));
  }
  renderSeverityChart(sevHost, summary.bySeverity, ctx, { runId: effectiveId });
  if (summary.lifecycle) {
    renderLifecycleChart(lcHost, { series: summary.lifecycle, resolved: summary.resolved }, ctx, { runId: effectiveId });
  } else {
    lcHost.appendChild(note("New versus recurring is not recorded for this run."));
  }

  container.appendChild(buildExplorer(ctx, summary, effectiveId, params));

  if (refocusRunSelect) {
    refocusRunSelect = false;
    try { sel.focus({ preventScroll: true }); } catch (e) { /* not focusable yet */ }
  }
}
