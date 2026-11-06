// Assurity Web Guardian - Page_Detail_View (#/page/<slug>?run=<runId>).
// Plain browser ES module, ASCII-only. Requirements 9.1 to 9.5, 9.9, 9.11.
//
// Full-width layout (.detail-layout, no side panel). Sections: heading with
// the page URL (the single h2), summary (highest severity and counts), Findings
// grouped by viewport, Evidence (screenshots with Evidence_Captions and a
// Visual_Comparison link), and History across runs (pages/<slug>.json, loaded
// lazily after the rest of the view is shown).
//
// DOM is built with createElement / textContent only. No forms. Nothing here
// touches window/document at import time; the pure helpers exported below run
// under Node: highestSeverityOf, countBySeverityList, groupByViewport,
// lifecycleSummaryText, runAssetUrl, historyRows.

import { el, append, link, button, badge, lifecycleBadge, errorBanner, sectionHeading, kvList, loading, plural, formatDateTime } from "./common.js";
import { rank, label as sevLabel, SEVERITY_ORDER } from "../lib/severity.js";
import { plainEnglishSummary } from "../lib/summary.js";
import { evidenceCaption, imageAlt, imageUnavailableText } from "../lib/captions.js";
import { LIFECYCLE_LABELS, LIFECYCLE_PRESENT } from "../lib/findings.js";

const VIEWPORT_ORDER = ["desktop", "mobile"];
const NO_VIEWPORT = "Viewport not recorded";

function isObj(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function arr(v) {
  return Array.isArray(v) ? v : [];
}
function str(v) {
  return typeof v === "string" ? v : "";
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Most severe severity among findings, or "none" when there are none. */
export function highestSeverityOf(findings) {
  let best = "none";
  let bestRank = Infinity;
  for (const f of arr(findings)) {
    const sev = isObj(f) ? f.severity : undefined;
    const r = rank(sev);
    if (r < bestRank) {
      bestRank = r;
      best = SEVERITY_ORDER.indexOf(sev) === -1 ? "not-recorded" : sev;
    }
  }
  return best;
}

/** [{ severity, count }] for non-zero severities, most severe first. */
export function countBySeverityList(findings) {
  const counts = {};
  for (const f of arr(findings)) {
    const sev = isObj(f) && SEVERITY_ORDER.indexOf(f.severity) !== -1 ? f.severity : "not-recorded";
    counts[sev] = (counts[sev] || 0) + 1;
  }
  return SEVERITY_ORDER.filter((s) => counts[s] > 0).map((s) => ({ severity: s, count: counts[s] }));
}

/**
 * Group findings by viewport: desktop, mobile, other named viewports (sorted),
 * then findings without a viewport. Findings inside a group keep severity order
 * (most severe first), then input order. Returns [{ viewport, name, findings }].
 */
export function groupByViewport(findings) {
  const map = new Map();
  arr(findings).forEach((f, i) => {
    if (!isObj(f)) return;
    const vp = str(f.viewport);
    if (!map.has(vp)) map.set(vp, []);
    map.get(vp).push({ f, i });
  });
  const keys = Array.from(map.keys());
  const idx = (k) => (k === "" ? 1000 : VIEWPORT_ORDER.indexOf(k) === -1 ? 500 : VIEWPORT_ORDER.indexOf(k));
  keys.sort((a, b) => idx(a) - idx(b) || (a < b ? -1 : a > b ? 1 : 0));
  return keys.map((k) => ({
    viewport: k,
    name: k || NO_VIEWPORT,
    findings: map
      .get(k)
      .sort((x, y) => rank(x.f.severity) - rank(y.f.severity) || x.i - y.i)
      .map((e) => e.f),
  }));
}

/** "New 2, Recurring 3" from a findings list; "No findings" when empty. */
export function lifecycleSummaryText(findings, resolvedCount) {
  const counts = {};
  for (const f of arr(findings)) {
    const raw = isObj(f) ? str(f.lifecycle).replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase() : "";
    const key = LIFECYCLE_PRESENT.indexOf(raw) === -1 ? "not-recorded" : raw;
    counts[key] = (counts[key] || 0) + 1;
  }
  const parts = LIFECYCLE_PRESENT.filter((k) => counts[k] > 0).map((k) => LIFECYCLE_LABELS[k] + " " + counts[k]);
  const resolved = typeof resolvedCount === "number" && resolvedCount > 0 ? Math.floor(resolvedCount) : 0;
  if (resolved > 0) parts.push("Resolved " + resolved);
  return parts.length ? parts.join(", ") : "No findings";
}

/**
 * Relative URL of a published run asset. relPath is a path inside the run
 * folder such as "screenshots/<slug>.<viewport>.png". Segments are encoded.
 */
export function runAssetUrl(runId, relPath) {
  const segs = String(relPath || "").split("/").filter((s) => s !== "" && s !== "." && s !== "..");
  return "./data/runs/" + encodeURIComponent(String(runId || "")) + "/" + segs.map(encodeURIComponent).join("/");
}

/** History rows, newest first (undated runs last, stable). */
export function historyRows(pageFile) {
  const runs = isObj(pageFile) ? arr(pageFile.runs) : [];
  const rows = runs.filter(isObj).map((r, i) => ({ r, i }));
  rows.sort((a, b) => {
    const ta = Date.parse(str(a.r.finishedAt));
    const tb = Date.parse(str(b.r.finishedAt));
    const ha = Number.isFinite(ta);
    const hb = Number.isFinite(tb);
    if (ha && hb && ta !== tb) return tb - ta;
    if (ha !== hb) return ha ? -1 : 1;
    return b.i - a.i;
  });
  return rows.map((e) => e.r);
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

function runIdsOf(state) {
  const ids = new Set();
  const d = isObj(state.dashboard) ? state.dashboard : {};
  for (const r of arr(d.runs)) if (isObj(r) && r.runId) ids.add(r.runId);
  const idx = isObj(state.index) ? state.index : {};
  for (const r of Array.isArray(state.index) ? state.index : arr(idx.runs)) if (isObj(r) && r.runId) ids.add(r.runId);
  for (const r of arr(d.runHealthTrend)) if (isObj(r) && r.runId) ids.add(r.runId);
  if (isObj(d.latest) && d.latest.runId) ids.add(d.latest.runId);
  return ids;
}

function latestRunId(state) {
  const d = isObj(state.dashboard) ? state.dashboard : {};
  if (isObj(d.latest) && str(d.latest.runId)) return d.latest.runId;
  const idx = isObj(state.index) ? state.index : {};
  const list = (Array.isArray(state.index) ? state.index : arr(idx.runs)).filter((r) => isObj(r) && r.runId);
  if (list.length) {
    const sorted = list.slice().sort((a, b) => (Date.parse(str(b.finishedAt)) || 0) - (Date.parse(str(a.finishedAt)) || 0));
    return sorted[0].runId;
  }
  const trend = arr(d.runHealthTrend).filter((r) => isObj(r) && r.runId);
  return trend.length ? trend[trend.length - 1].runId : "";
}

function retentionRuns(state) {
  const idx = isObj(state.index) ? state.index : {};
  return typeof idx.imageRetentionRuns === "number" ? idx.imageRetentionRuns : 0;
}

function pageUrlFrom(slug, run, pageFile, dashboard) {
  const fromRun = arr(run && run.pages).find((p) => isObj(p) && p.slug === slug && str(p.url || p.pageUrl));
  if (fromRun) return str(fromRun.url || fromRun.pageUrl);
  const f = arr(run && run.findings).find((x) => x.slug === slug && x.pageUrl);
  if (f) return f.pageUrl;
  if (isObj(pageFile) && str(pageFile.pageUrl)) return pageFile.pageUrl;
  const latest = isObj(dashboard) && isObj(dashboard.latest) ? arr(dashboard.latest.pages) : [];
  const row = latest.find((p) => isObj(p) && p.slug === slug && str(p.url));
  return row ? row.url : "";
}

function runHasPage(run, slug) {
  if (!run) return false;
  return arr(run.pages).some((p) => isObj(p) && p.slug === slug) || arr(run.findings).some((f) => f.slug === slug) ||
    arr(run.ignored).some((f) => f.slug === slug);
}

function openImage(spec, opener) {
  import("./lightbox.js").then(
    (m) => {
      if (m && typeof m.openLightbox === "function") m.openLightbox(spec, opener);
    },
    () => {
      /* lightbox unavailable: the image stays visible in the page */
    },
  );
}

function evidenceFigure(ctx, o) {
  // o: { runId, viewport, src, pageUrl, finishedAt, unavailableText }
  const fig = el("figure", "figure");
  const ctxFacts = { role: "current", pageUrl: o.pageUrl, viewport: o.viewport, runId: o.runId, runFinishedAt: o.finishedAt };
  const caption = evidenceCaption(ctxFacts);
  const note = el("p", "detail-empty", "", { role: "status" });
  note.hidden = true;
  if (!o.src) {
    note.hidden = false;
    note.textContent = o.unavailableText || "This image was not published for this run.";
    append(fig, note, el("figcaption", "caption", caption));
    return fig;
  }
  const alt = imageAlt(ctxFacts);
  const key = "ev:" + o.viewport;
  const opener = button("", "figure__open", { "data-focus-key": key, "aria-label": "Open full size image: " + (o.viewport || "page") + " screenshot" });
  const img = el("img", "", null, { src: o.src, alt, loading: "lazy", decoding: "async" });
  img.addEventListener("error", () => {
    opener.hidden = true;
    note.hidden = false;
    note.textContent = "Image could not be loaded";
  });
  opener.appendChild(img);
  opener.addEventListener("click", () => openImage({ src: o.src, alt, caption }, opener));
  append(fig, opener, note, el("figcaption", "caption", caption));
  return fig;
}

function renderFindings(ctx, container, groups, runId, dashboardCatalogueOpts) {
  const sec = el("section", "detail-section");
  sec.appendChild(sectionHeading("Findings by viewport", 3));
  if (!groups.length) {
    sec.appendChild(el("p", "empty-state__body", "No findings were recorded for this page in this run."));
    container.appendChild(sec);
    return;
  }
  for (const g of groups) {
    const gh = sectionHeading(g.name + " (" + plural(g.findings.length, "finding", "findings") + ")", 4, "section-title");
    sec.appendChild(gh);
    const ul = el("ul", "chip-row");
    for (const f of g.findings) {
      const li = el("li", "finding-item");
      const title = f.title || f.ruleId || "Finding";
      const a = link(title, ctx.formatRoute({ view: "finding", runId, findingId: f.id }), "target", {
        "data-focus-key": "finding:" + f.id,
      });
      append(li, badge(f.severity), " ", a, " ", lifecycleBadge(f.lifecycle));
      li.appendChild(el("p", "empty-state__body", plainEnglishSummary(f, undefined, dashboardCatalogueOpts)));
      ul.appendChild(li);
    }
    sec.appendChild(ul);
  }
  container.appendChild(sec);
}

function renderEvidence(ctx, container, o) {
  const sec = el("section", "detail-section");
  sec.appendChild(sectionHeading("Evidence", 3));
  const { run, runId, slug, pageUrl, visualItems, visualMissing, viewports, retention } = o;
  if (run.hasImages === false) {
    sec.appendChild(el("p", "detail-empty", imageUnavailableText("image-retention", retention, "current")));
    container.appendChild(sec);
    return;
  }
  if (visualMissing) {
    sec.appendChild(el("p", "detail-empty", "Visual comparison data is not available for this run."));
  }
  if (!viewports.length) {
    sec.appendChild(el("p", "detail-empty", "No screenshots were recorded for this page in this run."));
    container.appendChild(sec);
    return;
  }
  for (const vp of viewports) {
    const item = visualItems.find((it) => it.viewport === vp);
    const wrap = el("div", "detail-section");
    wrap.appendChild(sectionHeading(vp || NO_VIEWPORT, 4));
    let src = "";
    let unavailable = "";
    if (item && isObj(item.images)) {
      if (item.images.current) src = runAssetUrl(runId, item.images.current);
      else unavailable = imageUnavailableText(item.baseline && item.baseline.reason, retention, "current");
    } else if (vp) {
      src = runAssetUrl(runId, "screenshots/" + slug + "." + vp + ".png");
    } else {
      unavailable = "This screenshot was not published for this run.";
    }
    const grid = el("div", "figure-grid");
    grid.appendChild(evidenceFigure(ctx, { runId, viewport: vp, src, pageUrl, finishedAt: run.finishedAt, unavailableText: unavailable }));
    wrap.appendChild(grid);
    if (item && item.differs !== false) {
      wrap.appendChild(
        link("Open Visual comparison (" + vp + ")", ctx.formatRoute({ view: "visual", runId, slug, viewport: vp }), "target", {
          "data-focus-key": "visual:" + vp,
        }),
      );
    }
    sec.appendChild(wrap);
  }
  container.appendChild(sec);
}

function fillHistory(ctx, host, pageFile, slug, currentRunId) {
  host.textContent = "";
  host.appendChild(sectionHeading("History across runs", 3));
  const rows = historyRows(pageFile);
  if (!rows.length) {
    host.appendChild(el("p", "detail-empty", "No history is recorded for this page."));
    return;
  }
  const scroll = el("div", "table-scroll");
  const table = el("table", "data-table");
  table.appendChild(el("caption", "sr-only", "History of this page across runs, newest first"));
  const thead = el("thead");
  const hr = el("tr");
  for (const h of ["Run", "Date", "Findings", "Lifecycle states"]) hr.appendChild(el("th", "", h, { scope: "col" }));
  thead.appendChild(hr);
  table.appendChild(thead);
  const tbody = el("tbody");
  for (const r of rows) {
    const tr = el("tr");
    const th = el("th", "", null, { scope: "row" });
    const runId = str(r.runId);
    if (runId && runId !== currentRunId) {
      th.appendChild(link(runId, ctx.formatRoute({ view: "page", slug, params: { run: runId } }), "target"));
    } else {
      th.appendChild(el("span", "", (runId || "Run not recorded") + (runId ? " (shown)" : "")));
    }
    tr.appendChild(th);
    tr.appendChild(el("td", "", formatDateTime(r.finishedAt)));
    const hasData = r.hasRunData !== false;
    tr.appendChild(el("td", "", hasData && typeof r.total === "number" ? String(r.total) : "Not recorded"));
    tr.appendChild(el("td", "", hasData ? lifecycleSummaryText(r.findings, arr(r.resolved).length) : "Not recorded"));
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  scroll.appendChild(table);
  host.appendChild(scroll);
}

function backControl(ctx) {
  const b = button("Back to list", "btn", { "data-focus-key": "back-to-list" });
  b.addEventListener("click", () => {
    const ui = ctx.state.ui || {};
    const hash = str(ui.lastListHash) || "#/";
    const y = typeof ui.listScroll === "number" ? ui.listScroll : 0;
    Promise.resolve(ctx.navigate(hash, { focusKey: "back-to-list" })).then(() => {
      if (y > 0 && typeof window !== "undefined" && typeof window.scrollTo === "function") window.scrollTo(0, y);
    });
  });
  return b;
}

export async function render(container, ctx) {
  const state = ctx.state;
  const slug = str(ctx.route.slug);
  const params = ctx.route.params || {};
  const known = runIdsOf(state);
  const latestId = latestRunId(state);
  const runId = str(params.run) || latestId;

  if (params.run && !known.has(params.run) && params.run !== latestId) {
    ctx.notFound(container);
    return;
  }

  // Start the history fetch now (cached by the shell); it is awaited lazily.
  const pageProm = Promise.resolve()
    .then(() => ctx.loadPage(slug))
    .then((p) => ({ ok: true, page: p }), (e) => ({ ok: false, error: e }));

  let run = null;
  let visual = null;
  let visualMissing = false;
  let runError = null;
  if (runId) {
    try {
      const bundle = await ctx.loadRun(runId, ["visual"]);
      run = bundle.run;
      visual = bundle.visual || null;
    } catch (e) {
      try {
        const bundle = await ctx.loadRun(runId);
        run = bundle.run;
        visualMissing = true;
      } catch (e2) {
        runError = e2;
      }
    }
  }
  if (!ctx.isCurrent()) return;

  if (run && !runHasPage(run, slug)) {
    // The run does not list this page; accept it only when it has page history.
    const r = await pageProm;
    if (!ctx.isCurrent()) return;
    if (!r.ok) {
      ctx.notFound(container);
      return;
    }
  }
  if (!run && !runError) {
    const r = await pageProm;
    if (!ctx.isCurrent()) return;
    if (!r.ok) {
      ctx.notFound(container);
      return;
    }
  }

  const findings = run ? arr(run.findings).filter((f) => f.slug === slug) : [];
  const knownPage = await Promise.race([pageProm, Promise.resolve(null)]);
  const pageUrl = pageUrlFrom(slug, run, knownPage && knownPage.ok ? knownPage.page : null, state.dashboard) || slug;

  const items = visual && Array.isArray(visual.items) ? visual.items.filter((it) => isObj(it) && it.slug === slug) : [];
  const groups = groupByViewport(findings);

  // --- header ---------------------------------------------------------------
  const layout = el("div", "detail-layout");
  const header = el("header", "detail-header");
  header.appendChild(el("h2", "", pageUrl));
  const top = el("div", "toolbar");
  top.appendChild(backControl(ctx));
  header.appendChild(top);

  const highest = highestSeverityOf(findings);
  const sevList = countBySeverityList(findings);
  const summary = el("div", "detail-section");
  const highestNode = highest === "none" ? el("span", "", "No findings") : badge(highest);
  const countsNode = el("span");
  if (!sevList.length) countsNode.textContent = "0 findings";
  else {
    countsNode.appendChild(document.createTextNode(plural(findings.length, "finding", "findings") + ": "));
    sevList.forEach((s, i) => {
      if (i > 0) countsNode.appendChild(document.createTextNode(", "));
      countsNode.appendChild(document.createTextNode(s.count + " " + sevLabel(s.severity).toLowerCase()));
    });
  }
  summary.appendChild(
    kvList([
      ["Highest severity", highestNode],
      ["Findings", countsNode],
      ["Run", run ? run.runId + " (" + formatDateTime(run.finishedAt) + ")" : runId || "Run not recorded"],
    ]),
  );
  header.appendChild(summary);
  layout.appendChild(header);

  const main = el("div", "detail-main");
  const aside = el("div", "detail-aside");

  if (runError) {
    main.appendChild(errorBanner("runs/" + runId + "/run-findings.json", { detail: runError && runError.message }));
  } else if (run) {
    renderFindings(ctx, main, groups, runId, undefined);
    const vpSet = [];
    for (const g of groups) if (g.viewport && vpSet.indexOf(g.viewport) === -1) vpSet.push(g.viewport);
    for (const it of items) if (it.viewport && vpSet.indexOf(it.viewport) === -1) vpSet.push(it.viewport);
    if (!vpSet.length) vpSet.push(...VIEWPORT_ORDER);
    vpSet.sort((a, b) => {
      const ia = VIEWPORT_ORDER.indexOf(a);
      const ib = VIEWPORT_ORDER.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || (a < b ? -1 : a > b ? 1 : 0);
    });
    renderEvidence(ctx, main, {
      run,
      runId,
      slug,
      pageUrl,
      visualItems: items,
      visualMissing,
      viewports: vpSet,
      retention: retentionRuns(state),
    });
  }
  layout.appendChild(main);

  const historyHost = el("section", "detail-section");
  historyHost.appendChild(sectionHeading("History across runs", 3));
  historyHost.appendChild(loading("Loading history..."));
  aside.appendChild(historyHost);
  layout.appendChild(aside);
  container.appendChild(layout);

  // History is lazy: it fills in after the view is on screen.
  pageProm.then((r) => {
    if (!ctx.isCurrent()) return;
    if (r.ok) fillHistory(ctx, historyHost, r.page, slug, runId);
    else {
      historyHost.textContent = "";
      historyHost.appendChild(sectionHeading("History across runs", 3));
      historyHost.appendChild(el("p", "detail-empty", "History is not available for this page (pages/" + slug + ".json was not loaded)."));
    }
  });
}
