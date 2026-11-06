// Assurity Web Guardian - Run_View (one run: metadata, totals, findings).
// Plain browser ES module, ASCII-only.
//
// Contract: `export async function render(container, ctx)` (see the VIEW MODULE
// CONTRACT comment in app.js). Renders exactly one <h2>. All dynamic text goes
// through textContent. No <form> element is used.
//
// Shows (R10.3, R10.4, R10.10): Run_ID, date and time, trigger ("not
// recorded" when absent), origin, pages scanned, active Finding count by
// Severity, the change versus the previous run ("+3", "-2", "no change" or
// "no earlier run") and the shared findings list with no filters. A run whose
// per-run data is not published (hasRunData false) never opens an empty view:
// it shows "Run data not published". An unknown run id uses ctx.notFound.
//
// Pure helpers are exported for tests and never touch window/document at
// import time: runRows, findRunEntry, previousRun, changeText.

import { SEVERITY_ORDER } from "../lib/severity.js";
import { sortFindings } from "../lib/findings.js";
import {
  el, append, link, badge, errorBanner, sectionHeading, kvList, loading, plural, formatDateTime,
} from "./common.js";
import { renderSeverityChart, renderLifecycleChart, destroyCharts, RUN_DATA_MISSING_TEXT } from "./charts.js";
import { renderFindingsList } from "./findings-list.js";

function isObj(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function cnt(v) {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}
function text(v) {
  return typeof v === "string" && v.trim() ? v.trim() : "";
}

/**
 * Run rows, newest first (runs without a date last, stable). Sources, first
 * non-empty wins: dashboard.runs[], index.runs[]. Rows are the published
 * objects (not copies).
 */
export function runRows(dashboard, index) {
  const d = isObj(dashboard) ? dashboard : {};
  const idx = isObj(index) && Array.isArray(index.runs) ? index.runs : Array.isArray(index) ? index : [];
  const valid = (r) => isObj(r) && typeof r.runId === "string" && r.runId !== "";
  let src = Array.isArray(d.runs) ? d.runs.filter(valid) : [];
  if (!src.length) src = idx.filter(valid);
  const items = src.map((r, i) => ({ r, i }));
  const key = (r) => (typeof r.finishedAt === "string" ? r.finishedAt : "");
  items.sort((a, b) => {
    const x = key(a.r);
    const y = key(b.r);
    if (x !== y) {
      if (!x) return 1;
      if (!y) return -1;
      return x < y ? 1 : -1;
    }
    return a.i - b.i;
  });
  return items.map((x) => x.r);
}

/** The row for runId, or null when the run is not published anywhere. */
export function findRunEntry(rows, runId) {
  for (const r of rows) if (r.runId === runId) return r;
  return null;
}

/** The next older run row after runId in `rows` (newest first), or null. */
export function previousRun(rows, runId) {
  const i = rows.findIndex((r) => r.runId === runId);
  if (i === -1) return null;
  return i + 1 < rows.length ? rows[i + 1] : null;
}

/**
 * Change versus the previous run: "+3", "-2", "no change", "no earlier run",
 * or "not available" when the earlier run has no recorded total.
 */
export function changeText(total, prev) {
  if (!prev) return "no earlier run";
  if (typeof prev.total !== "number" || !Number.isFinite(prev.total)) return "not available";
  const delta = cnt(total) - cnt(prev.total);
  if (delta === 0) return "no change";
  return (delta > 0 ? "+" : "-") + Math.abs(delta);
}

function notPublished(container, runId, ctx) {
  const box = el("div", "empty-state");
  const card = el("div", "empty-state__card");
  card.appendChild(el("p", "empty-state__title", RUN_DATA_MISSING_TEXT));
  card.appendChild(el("p", "", "The per-run data for " + runId + " was not published, so there is no run view to open."));
  card.appendChild(link("Back to the overview", ctx.formatRoute({ view: "overview", params: {} }), "btn"));
  box.appendChild(card);
  container.appendChild(box);
}

function severityCounts(ctx, runId, bySeverity) {
  const row = el("div", "chip-row");
  for (const s of SEVERITY_ORDER) {
    const n = cnt(bySeverity && bySeverity[s]);
    const item = el("span", "chip");
    append(item, badge(s), " " + n);
    if (n > 0) {
      const a = link("", ctx.formatRoute({ view: "findings", params: { run: runId, sev: [s] } }), "", {
        "aria-label": "Show " + plural(n, "finding", "findings") + " of severity " + s,
      });
      a.appendChild(item);
      row.appendChild(a);
    } else {
      row.appendChild(item);
    }
  }
  return row;
}

export async function render(container, ctx) {
  destroyCharts();
  const state = ctx.state || {};
  const route = ctx.route || {};
  const runId = typeof route.runId === "string" ? route.runId : "";
  const rows = runRows(state.dashboard, state.index);
  let entry = findRunEntry(rows, runId);
  const latest = state.dashboard && isObj(state.dashboard.latest) ? state.dashboard.latest : null;
  const isLatestOnly = !entry && latest && latest.runId === runId;
  if (!runId || (!entry && !isLatestOnly)) {
    ctx.notFound(container);
    return;
  }
  if (!entry) entry = { runId, finishedAt: null };

  container.appendChild(el("h2", "", "Run " + runId));

  if (entry.hasRunData === false) {
    notPublished(container, runId, ctx);
    return;
  }

  const status = loading("Loading run data...");
  container.appendChild(status);
  let run;
  try {
    const out = await ctx.loadRun(runId);
    run = out && out.run;
  } catch (e) {
    if (!ctx.isCurrent()) return;
    container.removeChild(status);
    container.appendChild(
      errorBanner("runs/" + runId + "/run-findings.json", { detail: e && e.message ? e.message : "" }),
    );
    return;
  }
  if (!ctx.isCurrent()) return;
  container.removeChild(status);
  if (!isObj(run)) {
    container.appendChild(errorBanner("runs/" + runId + "/run-findings.json"));
    return;
  }

  const totals = isObj(run.totals) ? run.totals : { all: 0, bySeverity: {}, byLifecycle: {}, resolved: 0 };
  const total = cnt(totals.all);
  const prev = previousRun(rows, runId);
  const finished = typeof run.finishedAt === "string" ? run.finishedAt : entry.finishedAt;
  const pagesScanned = typeof entry.pages === "number" ? cnt(entry.pages) : Array.isArray(run.pages) ? run.pages.length : 0;

  const facts = kvList([
    ["Run ID", runId],
    ["Date and time", formatDateTime(finished)],
    ["Trigger", text(entry.trigger) || "not recorded"],
    ["Origin", text(entry.origin) || "not recorded"],
    ["Pages scanned", String(pagesScanned)],
    ["Active findings", String(total)],
    ["Change versus previous run", changeText(total, prev) + (prev ? " (previous run " + prev.runId + ")" : "")],
  ]);
  container.appendChild(facts);

  const sevSection = el("section", "stack");
  sevSection.appendChild(sectionHeading("Findings by severity", 3));
  sevSection.appendChild(severityCounts(ctx, runId, totals.bySeverity));
  container.appendChild(sevSection);

  const chartRow = el("div", "chart-grid");
  const sevHost = el("div");
  const lcHost = el("div");
  append(chartRow, sevHost, lcHost);
  container.appendChild(chartRow);
  try {
    renderSeverityChart(sevHost, totals.bySeverity, ctx, { runId });
    renderLifecycleChart(lcHost, { series: totals.byLifecycle, resolved: totals.resolved }, ctx, { runId });
  } catch (e) {
    chartRow.parentNode.removeChild(chartRow);
  }

  const list = el("section", "stack");
  list.appendChild(sectionHeading("Findings in this run", 3));
  list.appendChild(
    link("Filter these findings", ctx.formatRoute({ view: "findings", params: { run: runId } }), "btn", {
      "data-focus-key": "run-filter-link",
    }),
  );
  const findings = sortFindings(run.findings, { sort: "severity" });
  list.appendChild(el("p", "muted", plural(findings.length, "finding", "findings")));
  renderFindingsList(list, findings, ctx, { runId, emptyText: "No active findings in this run" });
  container.appendChild(list);
}
