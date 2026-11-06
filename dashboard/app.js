// Assurity Web Guardian - static dashboard shell.
// Plain browser ES module (no build step). ASCII-only on purpose.
//
// This file is the BOOTSTRAP and ROUTER only:
//   - boot: resolves the data mode, then loads ONLY index.json and dashboard.json
//   - routing: hash routes (lib/route.js) driven by history.pushState; ONE
//     popstate listener handles back, forward and manual hash edits
//   - scroll/focus: history.scrollRestoration is "manual"; before each
//     navigation the current history entry stores { scrollY, focusKey } with
//     history.replaceState, and a popped entry restores them
//   - load failures: loaders tag rejections with { file, status }; the shell
//     shows file name, HTTP status and Retry (failed promises are evicted from
//     the caches first). Unexpected view exceptions go to #sr-alert.
//   - render dispatcher: lazy-loads one view module per route with import()
//
// All published strings reach the DOM through textContent / createElement
// (never markup strings). No forms, no POST, relative URLs only.
//
// ---------------------------------------------------------------------------
// VIEW MODULE CONTRACT (implemented by later tasks in dashboard/views/)
// ---------------------------------------------------------------------------
//   route.view      module
//   overview        ./views/overview.js
//   run             ./views/run-view.js
//   findings        ./views/filtered-findings.js
//   page            ./views/page-detail.js
//   finding         ./views/finding-detail.js
//   visual          ./views/visual-comparison.js
//
// Every view module exports:
//
//   export async function render(container, ctx)
//
// - container: the empty <main id="view"> element. The view appends its DOM to
//   it with createElement/textContent. It MUST render exactly one <h2> (the
//   view heading); the shell moves keyboard focus to that heading when the
//   view (not just its filter parameters) changes, and uses its text for the
//   document title and the screen reader announcement.
// - It may return nothing, or { announce: "text" } to override the announced
//   text. If it throws (or rejects), the shell shows a visible error panel and
//   announces the error through the alert region.
// - ctx = {
//     route,                 normalized route object (see lib/route.js)
//     state,                 the shared state object (mode, dashboard, index,
//                            runCache, evidenceCache, pageCache, ui)
//     navigate(target, opts) target = route object or "#/..." hash string.
//                            opts: { replace: bool, rerender: bool (default
//                            true), focusKey: string }. rerender:false only
//                            updates the URL (for example search typing uses
//                            { replace: true, rerender: false }).
//     formatRoute(route)     canonical "#/..." string for use in href values
//                            (clicks on a[href^="#/"] are routed by the shell)
//     loadRun(runId, parts)  Promise<{ run, visual?, guidance? }>; run is the
//                            normalized run-findings.json; parts is an array
//                            from ["visual", "guidance"] for the optional files
//     loadEvidence(runId, slug, viewport)  Promise<evidence json>
//     loadPage(slug)         Promise<pages/<slug>.json>
//     announce(text)         polite message to the #sr-status live region
//     alert(text)            assertive message to the #sr-alert live region
//     isCurrent()            false once a newer render has started; async views
//                            should stop touching the DOM when this is false
//     notFound(container)    renders the "That item is not in the published
//                            data" message with a link to the overview
//   }
// - Opener controls that must get focus back on Back/close carry a
//   data-focus-key attribute; the shell remembers the focused key per entry.
// - Loaders reject with an Error whose message names the failing file.
// ---------------------------------------------------------------------------

import { resolveDataSource, loadPublished } from "./data-source.js";
import { parseRoute, formatRoute } from "./lib/route.js";
import { normalizeRun } from "./lib/findings.js";

const VIEW_MODULES = {
  overview: "./views/overview.js",
  run: "./views/run-view.js",
  findings: "./views/filtered-findings.js",
  page: "./views/page-detail.js",
  finding: "./views/finding-detail.js",
  visual: "./views/visual-comparison.js",
};

// import() needs literal specifiers for static tooling and bundlers.
const IMPORTERS = {
  overview: () => import("./views/overview.js"),
  run: () => import("./views/run-view.js"),
  findings: () => import("./views/filtered-findings.js"),
  page: () => import("./views/page-detail.js"),
  finding: () => import("./views/finding-detail.js"),
  visual: () => import("./views/visual-comparison.js"),
};

const TITLE = "Assurity Web Guardian";

const state = {
  mode: "static",
  dashboard: null,
  index: null,
  runCache: new Map(),
  evidenceCache: new Map(),
  pageCache: new Map(),
  route: null,
  ui: { expandedGroups: new Set(), listScroll: 0, lastListHash: "#/", lastFocusKey: "" },
};

let renderToken = 0;
let prevViewKey = null;
let bootFailed = false;

boot();

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot() {
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  const view = viewEl();
  try {
    const src = await resolveDataSource();
    state.mode = src.mode;
    if (src.mode === "static") {
      const [index, dashboard] = await Promise.all([
        loadPublished("index.json"),
        loadPublished("dashboard.json"),
      ]);
      state.index = index;
      state.dashboard = dashboard;
    } else {
      state.dashboard = await src.load();
      try { state.index = await loadPublished("index.json"); } catch (e) { state.index = null; }
      showLiveNotice();
    }
  } catch (err) {
    console.error("[dashboard] boot failed:", err);
    bootFailed = true;
    view.textContent = "";
    errorPanel(view, "The dashboard could not be loaded", errMsg(err));
    alertMsg(errMsg(err));
    return;
  }

  renderHeader(state.dashboard);
  wireNavigation();
  state.route = parseRoute(location.hash);
  await dispatch(state.route, null, true);
}

function showLiveNotice() {
  const nav = document.getElementById("primary-nav");
  if (!nav || document.getElementById("mode-notice")) return;
  const n = document.createElement("p");
  n.id = "mode-notice";
  n.className = "notice notice--warn";
  n.textContent =
    "Live mode: the overview shows data from the local Event Server. " +
    "Run, page, finding and visual comparison views need the published site.";
  nav.insertAdjacentElement("afterend", n);
}

function renderHeader(data) {
  const el = document.getElementById("header-meta");
  if (!el || !data) return;
  const parts = [];
  if (data.domain) parts.push(String(data.domain));
  const ts = fmtTs(data.generatedAt);
  if (ts) parts.push("generated " + ts);
  el.textContent = parts.join("  |  ");
}

// ---------------------------------------------------------------------------
// Navigation, history, scroll and focus
// ---------------------------------------------------------------------------

function wireNavigation() {
  window.addEventListener("popstate", onPop); // the ONLY popstate listener
  document.addEventListener("awg:retry", retryCurrent); // fired by errorBanner()

  document.addEventListener("focusin", (e) => {
    const t = e.target && e.target.closest ? e.target.closest("[data-focus-key]") : null;
    if (t) state.ui.lastFocusKey = t.getAttribute("data-focus-key") || "";
  });

  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (!a || (a.target && a.target !== "_self")) return;
    const href = a.getAttribute("href") || "";
    if (href.slice(0, 2) !== "#/") return;
    e.preventDefault();
    navigate(href, { focusKey: a.getAttribute("data-focus-key") || undefined });
  });
}

function currentHash() {
  return formatRoute(parseRoute(location.hash));
}

function isListView(route) {
  return !!route && (route.view === "overview" || route.view === "findings");
}

// Remember where the list (overview or findings) was scrolled to, and its full
// hash including the query, so page detail's "Back to list" can restore both.
function rememberList(fromRoute, toRoute) {
  if (isListView(fromRoute) && !isListView(toRoute)) state.ui.listScroll = Math.max(0, Math.round(window.scrollY || 0));
  if (isListView(toRoute)) state.ui.lastListHash = formatRoute(toRoute);
}

function saveEntry(focusKey) {
  try {
    history.replaceState(
      { scrollY: window.scrollY, focusKey: focusKey != null ? focusKey : state.ui.lastFocusKey },
      "",
      location.href,
    );
  } catch (e) { /* history unavailable; navigation still works */ }
}

function navigate(target, opts) {
  const o = opts || {};
  const hash = typeof target === "string" ? formatRoute(parseRoute(target)) : formatRoute(target);
  const route = parseRoute(hash);
  const same = hash === currentHash();
  rememberList(state.route, route);
  saveEntry(o.focusKey);
  try {
    if (o.replace || same) history.replaceState({ scrollY: 0, focusKey: "" }, "", hash);
    else history.pushState({ scrollY: 0, focusKey: "" }, "", hash);
  } catch (e) {
    location.hash = hash;
    return Promise.resolve();
  }
  state.route = route;
  if (o.rerender === false) return Promise.resolve();
  return dispatch(route, null, false);
}

function onPop(event) {
  if (bootFailed) return;
  const route = parseRoute(location.hash);
  rememberList(state.route, route);
  state.route = route;
  const st = event && event.state && typeof event.state === "object" ? event.state : null;
  dispatch(route, st, false);
}

function viewKeyOf(r) {
  return [r.view, r.runId || "", r.slug || "", r.findingId || "", r.viewport || ""].join("|");
}

// ---------------------------------------------------------------------------
// Render dispatcher
// ---------------------------------------------------------------------------

async function dispatch(route, restore, initial) {
  const token = ++renderToken;
  const view = viewEl();
  const key = viewKeyOf(route);
  const viewChanged = key !== prevViewKey;
  if (isListView(route)) state.ui.lastListHash = formatRoute(route);

  markNav(route);
  view.textContent = "";
  const loading = document.createElement("p");
  loading.className = "loading";
  loading.textContent = "Loading...";
  view.appendChild(loading);
  statusMsg("Loading...");

  const ctx = makeCtx(route, token);
  let announceText = "";

  if (state.mode === "live" && route.view !== "overview" && !state.index) {
    view.textContent = "";
    liveOnlyPanel(view);
  } else {
    let mod = null;
    let loadErr = null;
    try { mod = await IMPORTERS[route.view](); } catch (err) { loadErr = err; }
    if (token !== renderToken) return;
    view.textContent = "";
    if (mod && typeof mod.render === "function") {
      try {
        const out = await mod.render(view, ctx);
        if (token !== renderToken) return;
        if (out && typeof out.announce === "string") announceText = out.announce;
      } catch (err) {
        if (token !== renderToken) return;
        console.error("[dashboard] view failed:", route.view, err);
        view.textContent = "";
        if (err && err.file) {
          loadErrorPanel(view, err);
          alertMsg("The data file " + err.file + " could not be loaded" + (err.status ? " (HTTP " + err.status + ")" : "") + ". Retry or go to the overview.");
        } else {
          errorPanel(view, "This view could not be shown", errMsg(err));
          alertMsg("Something went wrong: " + errMsg(err) + ". Use the link to go to the overview.");
        }
      }
    } else if (route.view === "overview") {
      // FALLBACK ONLY: used when views/overview.js cannot be loaded (it is
      // added by a later task). Replace-by-module: once the module exists this
      // branch is never taken.
      console.warn("[dashboard] overview module unavailable, using built-in fallback:", loadErr);
      fallbackOverview(view);
    } else {
      const file = VIEW_MODULES[route.view];
      const msg = "The view module " + file + " could not be loaded" + (loadErr && loadErr.message ? " (" + loadErr.message + ")" : "") + ".";
      errorPanel(view, "This view is not available", msg);
      alertMsg(msg);
    }
  }

  prevViewKey = key;
  afterRender(view, route, restore, viewChanged, initial, announceText);
}

function afterRender(view, route, restore, viewChanged, initial, announceText) {
  const heading = view.querySelector("h2") || view.querySelector("h1");
  const text = (announceText || (heading && heading.textContent) || "").trim();
  document.title = text ? text + " - " + TITLE : TITLE + " - Dashboard";

  if (restore && typeof restore.scrollY === "number") window.scrollTo(0, restore.scrollY);
  else if (viewChanged) window.scrollTo(0, 0);

  let focused = false;
  if (restore && restore.focusKey) {
    const els = view.querySelectorAll("[data-focus-key]");
    for (const el of els) {
      if (el.getAttribute("data-focus-key") === restore.focusKey) { el.focus({ preventScroll: true }); focused = true; break; }
    }
  }
  if (!focused && viewChanged && !initial && heading) {
    heading.setAttribute("tabindex", "-1");
    heading.focus({ preventScroll: !!(restore && typeof restore.scrollY === "number") });
  }
  if (text && (viewChanged || announceText)) statusMsg(text);
  else if (!text) statusMsg("");
}

function makeCtx(route, token) {
  return {
    route,
    state,
    navigate,
    formatRoute,
    loadRun,
    loadEvidence,
    loadPage,
    announce: statusMsg,
    alert: alertMsg,
    isCurrent: () => token === renderToken,
    notFound,
  };
}

function markNav(route) {
  const links = document.querySelectorAll("#primary-nav a[data-nav]");
  for (const a of links) {
    const on = a.getAttribute("data-nav") === route.view;
    if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  }
}

// ---------------------------------------------------------------------------
// Lazy, cached loaders (promises are cached so concurrent opens share one fetch)
// ---------------------------------------------------------------------------

function cached(map, key, make, file) {
  if (!map.has(key)) {
    if (file) noteLoading(file);
    const p = file ? tagged(file, make()) : make();
    map.set(key, p);
    p.catch(() => { if (map.get(key) === p) map.delete(key); });
  }
  return map.get(key);
}

const OPTIONAL_PARTS = { visual: "visual.json", guidance: "guidance.json" };

// Tag a loader promise's rejection with the failing file name and HTTP status
// (parsed from the "Could not load <file>: HTTP <n>" message) so the shell can
// show a section-level error with Retry. The same Error object is rethrown.
function tagged(file, promise) {
  return promise.catch((err) => {
    if (err && typeof err === "object" && !err.file) {
      err.file = file;
      const m = /HTTP (\d{3})/.exec(String(err.message || ""));
      if (m) err.status = Number(m[1]);
    }
    throw err;
  });
}

// Show which file is loading in the visible loading line and the status region.
function noteLoading(file) {
  const text = "Loading " + file + "...";
  const v = viewEl();
  const p = v ? v.querySelector(".loading") : null;
  if (p) p.textContent = text;
  statusMsg(text);
}

function loadRun(runId, parts) {
  const id = String(runId || "");
  const runFile = "runs/" + id + "/run-findings.json";
  const base = cached(state.runCache, id, () =>
    loadPublished(runFile).then((raw) => normalizeRun(raw)), runFile,
  );
  const wanted = Array.isArray(parts) ? parts.filter((p) => OPTIONAL_PARTS[p]) : [];
  return Promise.all([base, ...wanted.map((p) => {
    const f = "runs/" + id + "/" + OPTIONAL_PARTS[p];
    return cached(state.runCache, id + "#" + p, () => loadPublished(f), f);
  })]).then(([run, ...extras]) => {
    const out = { run };
    wanted.forEach((p, i) => { out[p] = extras[i]; });
    return out;
  });
}

function loadEvidence(runId, slug, viewport) {
  const key = runId + "/" + slug + "." + viewport;
  const f = "runs/" + runId + "/evidence/" + slug + "." + viewport + ".json";
  return cached(state.evidenceCache, key, () => loadPublished(f), f);
}

function loadPage(slug) {
  const f = "pages/" + slug + ".json";
  return cached(state.pageCache, String(slug), () => loadPublished(f), f);
}

// Retry: failed promises are already evicted from the caches (see cached()),
// so re-rendering the current route re-fetches only what failed.
function retryCurrent() {
  if (bootFailed || !state.route) return;
  prevViewKey = null; // treat as a fresh view so focus moves to the new heading
  dispatch(state.route, null, false);
}

// ---------------------------------------------------------------------------
// Messages, panels and live regions
// ---------------------------------------------------------------------------

function viewEl() { return document.getElementById("view"); }

function setLive(id, text) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = "";
  // Re-set on the next frame so repeated identical messages are announced.
  const set = () => { el.textContent = text || ""; };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(set); else set();
}
function statusMsg(text) { setLive("sr-status", text); }
function alertMsg(text) { setLive("sr-alert", text); }

function errMsg(err) {
  return err && err.message ? String(err.message) : String(err || "Unknown error");
}

function errorPanel(host, title, message) {
  const h = document.createElement("h2");
  h.textContent = title;
  host.appendChild(h);
  const p = document.createElement("div");
  p.className = "error-panel";
  p.textContent = message;
  host.appendChild(p);
  const back = document.createElement("p");
  const a = document.createElement("a");
  a.href = "#/";
  a.textContent = "Back to the overview";
  back.appendChild(a);
  host.appendChild(back);
}

// Section-level load error: file name, HTTP status, Retry and a link home.
function loadErrorPanel(host, err) {
  const h = document.createElement("h2");
  h.textContent = "This data could not be loaded";
  host.appendChild(h);
  const box = document.createElement("div");
  box.className = "error-panel";
  box.setAttribute("role", "alert");
  const p1 = document.createElement("p");
  p1.textContent = "The data file " + err.file + " could not be loaded.";
  box.appendChild(p1);
  const p2 = document.createElement("p");
  p2.textContent = err.status ? "HTTP status: " + err.status : errMsg(err);
  box.appendChild(p2);
  const b = document.createElement("button");
  b.type = "button";
  b.className = "btn";
  b.textContent = "Retry";
  b.addEventListener("click", retryCurrent);
  box.appendChild(b);
  host.appendChild(box);
  const q = document.createElement("p");
  const a = document.createElement("a");
  a.href = "#/";
  a.textContent = "Back to the overview";
  q.appendChild(a);
  host.appendChild(q);
}

function notFound(host) {
  host.textContent = "";
  const h = document.createElement("h2");
  h.textContent = "Not found";
  host.appendChild(h);
  const p = document.createElement("p");
  p.textContent = "That item is not in the published data";
  host.appendChild(p);
  const q = document.createElement("p");
  const a = document.createElement("a");
  a.href = "#/";
  a.textContent = "Go to the overview";
  q.appendChild(a);
  host.appendChild(q);
}

function liveOnlyPanel(host) {
  const h = document.createElement("h2");
  h.textContent = "Needs the published site";
  host.appendChild(h);
  const p = document.createElement("p");
  p.className = "notice notice--warn";
  p.textContent = "This view needs the published site. Live mode only shows the overview.";
  host.appendChild(p);
  const q = document.createElement("p");
  const a = document.createElement("a");
  a.href = "#/";
  a.textContent = "Back to the overview";
  q.appendChild(a);
  host.appendChild(q);
}

function fmtTs(v) {
  if (typeof v !== "string" || !v) return "";
  const d = new Date(v);
  return isNaN(d.getTime()) ? v : d.toLocaleString();
}

// ---------------------------------------------------------------------------
// Built-in FALLBACK overview. Used ONLY when views/overview.js fails to load.
// Minimal on purpose: KPI summary and a run list, textContent only.
// ---------------------------------------------------------------------------

function fallbackOverview(host) {
  const data = state.dashboard || {};
  const trend = Array.isArray(data.runHealthTrend) ? data.runHealthTrend : [];
  const h = document.createElement("h2");
  h.textContent = "Overview";
  host.appendChild(h);

  if (data.empty === true || (trend.length === 0 && !runList().length)) {
    const card = document.createElement("div");
    card.className = "empty-state";
    const t = document.createElement("p");
    t.textContent = "No run data yet. Once a Guardian run completes and publishes, its results will appear here.";
    card.appendChild(t);
    host.appendChild(card);
    return;
  }

  const latest = trend[trend.length - 1] || null;
  const sev = data.findingsBySeverity || {};
  const total = (Array.isArray(data.findingsByPage) ? data.findingsByPage : [])
    .reduce((a, r) => a + Number((r && r.count) || 0), 0);
  const grid = document.createElement("div");
  grid.className = "kpi-grid";
  kpi(grid, "Latest health", latest && latest.health ? cap(latest.health) : "Unknown");
  kpi(grid, "Runs tracked", String(trend.length));
  kpi(grid, "Total findings", String(total));
  kpi(grid, "Critical", String(Number(sev.critical || 0)));
  kpi(grid, "Serious", String(Number(sev.serious || 0)));
  kpi(grid, "Pages scanned", String((Array.isArray(data.findingsByPage) ? data.findingsByPage : []).length));
  host.appendChild(grid);

  const runs = runList();
  if (runs.length) {
    const h3 = document.createElement("h3");
    h3.className = "section-title";
    h3.textContent = "Runs";
    host.appendChild(h3);
    const ul = document.createElement("ul");
    ul.className = "page-list";
    for (const r of runs) {
      const li = document.createElement("li");
      const label = r.runId + (r.finishedAt ? " - " + fmtTs(r.finishedAt) : "");
      if (r.hasRunData === false) {
        li.textContent = label + " (run data not published)";
      } else {
        const a = document.createElement("a");
        a.href = formatRoute({ view: "run", runId: r.runId });
        a.textContent = label;
        li.appendChild(a);
      }
      ul.appendChild(li);
    }
    host.appendChild(ul);
  }
}

function runList() {
  const src = state.index && Array.isArray(state.index.runs) ? state.index.runs
    : Array.isArray(state.index) ? state.index
    : state.dashboard && Array.isArray(state.dashboard.runs) ? state.dashboard.runs
    : [];
  const out = [];
  for (const r of src) {
    const id = r && (typeof r.runId === "string" ? r.runId : typeof r.id === "string" ? r.id : "");
    if (id) out.push({ runId: id, finishedAt: typeof r.finishedAt === "string" ? r.finishedAt : "", hasRunData: r.hasRunData });
  }
  return out;
}

function kpi(host, label, value) {
  const card = document.createElement("div");
  card.className = "kpi";
  const l = document.createElement("div"); l.className = "kpi__label"; l.textContent = label;
  const v = document.createElement("div"); v.className = "kpi__value"; v.textContent = value;
  card.appendChild(l); card.appendChild(v);
  host.appendChild(card);
}
function cap(s) { s = String(s || ""); return s ? s[0].toUpperCase() + s.slice(1) : "-"; }
