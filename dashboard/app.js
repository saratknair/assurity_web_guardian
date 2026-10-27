// Assurity Web Guardian - static dashboard app.
// Plain browser ES module (no build step). Renders the DashboardData contract
// using the vendored Chart.js UMD global (window.Chart). ASCII-only on purpose.
//
// Sections (top to bottom): KPI row, charts, pages explorer (clickable
// drill-down to findings + screenshots), AI-assisted analysis. The whole page
// scrolls as a normal document; the detail drawer scrolls independently.
//
// Honesty: every AI element carries .ai-assisted + data-ai="true" + a visible
// "not a deterministic fact" badge; a render-time assertion fails closed to the
// empty state if any AI node is mislabelled. All published strings go in via
// textContent (never innerHTML), so copy cannot inject markup.

import { resolveDataSource } from "./data-source.js";

const CANVAS = {
  trend: "chart-run-health-trend",
  byPage: "chart-findings-by-page",
  bySeverity: "chart-findings-by-severity",
  a11y: "chart-a11y-new-vs-recurring",
};
const SEVERITIES = ["critical", "serious", "moderate", "minor"];
const C = {
  accent: "#3b82f6",
  accentFill: "rgba(59,130,246,0.18)",
  critical: "#ef4444",
  serious: "#f97316",
  moderate: "#eab308",
  minor: "#64748b",
  fresh: "#3b82f6",
  recurring: "#f97316",
  grid: "rgba(144,160,183,0.12)",
  tick: "#90a0b7",
};

const charts = [];
let _latestRunId = null;
let _findingsCache = null;
let _pageRows = [];

init();

async function init() {
  try {
    const src = await resolveDataSource();
    const data = await src.load();
    if (isEmpty(data)) { showEmpty(); return; }
    if (typeof Chart === "undefined") {
      showEmpty("Charting library unavailable", "The charting library did not load.");
      return;
    }
    renderHeader(data);
    renderKpis(data);
    renderCharts(data);
    renderPageList(data);
    renderAi(data.aiItems || [], document.getElementById("ai-analysis-items"), true);
    showContent();
    wireDetail();
    void resolveLatestRunId();
  } catch (err) {
    console.error("[dashboard] render failed:", err);
    disposeCharts();
    showEmpty();
  }
}

function isEmpty(d) {
  if (!d || typeof d !== "object") return true;
  if (d.empty === true) return true;
  const t = Array.isArray(d.runHealthTrend) ? d.runHealthTrend : [];
  return t.length === 0;
}

function showEmpty(title, body) {
  const e = document.getElementById("empty-state");
  const d = document.getElementById("dashboard");
  if (title != null) { const el = e && e.querySelector(".empty-state__title"); if (el) el.textContent = title; }
  if (body != null) { const el = e && e.querySelector(".empty-state__body"); if (el) el.textContent = body; }
  if (e) e.hidden = false;
  if (d) d.classList.add("is-hidden");
}
function showContent() {
  const e = document.getElementById("empty-state");
  const d = document.getElementById("dashboard");
  if (e) e.hidden = true;
  if (d) d.classList.remove("is-hidden");
}

function renderHeader(data) {
  const el = document.getElementById("header-meta");
  if (!el) return;
  const parts = [];
  if (data.domain) parts.push(String(data.domain));
  const ts = fmtTs(data.generatedAt);
  if (ts) parts.push("generated " + ts);
  el.textContent = parts.join("  |  ");
}
function fmtTs(v) {
  if (typeof v !== "string" || !v) return "";
  const d = new Date(v);
  return isNaN(d.getTime()) ? v : d.toLocaleString();
}

function renderKpis(data) {
  const host = document.getElementById("kpi-row");
  if (!host) return;
  host.textContent = "";
  const trend = Array.isArray(data.runHealthTrend) ? data.runHealthTrend : [];
  const latest = trend[trend.length - 1] || null;
  const sev = data.findingsBySeverity || {};
  const totalFindings = (data.findingsByPage || []).reduce((a, r) => a + Number(r.count || 0), 0);
  const health = latest ? latest.health : "unknown";
  const healthClass = health === "healthy" ? "good" : health === "attention" ? "warn" : health === "failing" ? "bad" : "";
  kpi(host, "Latest health", cap(health), healthClass, latest && latest.finishedAt ? fmtTs(latest.finishedAt) : "");
  kpi(host, "Runs tracked", String(trend.length), "", "chronological");
  kpi(host, "Failed checks (latest)", String(latest ? latest.failedChecks : 0), (latest && latest.failedChecks > 0) ? "warn" : "good", "in most recent run");
  kpi(host, "Critical findings", String(Number(sev.critical || 0)), Number(sev.critical || 0) > 0 ? "bad" : "good", "highest severity");
  kpi(host, "Total findings", String(totalFindings), "", "across scanned pages");
  kpi(host, "Pages scanned", String((data.findingsByPage || []).length), "", "approved scope");
}
function kpi(host, label, value, cls, sub) {
  const card = document.createElement("div");
  card.className = "kpi";
  const l = document.createElement("div"); l.className = "kpi__label"; l.textContent = label;
  const v = document.createElement("div"); v.className = "kpi__value" + (cls ? " " + cls : ""); v.textContent = value;
  const s = document.createElement("div"); s.className = "kpi__sub"; s.textContent = sub || "";
  card.appendChild(l); card.appendChild(v); card.appendChild(s);
  host.appendChild(card);
}
function cap(s) { s = String(s || ""); return s ? s[0].toUpperCase() + s.slice(1) : "-"; }

function baseOpts(extra) {
  return Object.assign({
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false, labels: { color: C.tick } } },
  }, extra || {});
}
function renderCharts(data) {
  disposeCharts();
  trendChart(data);
  severityChart(data);
  a11yChart(data);
  byPageChart(data);
}
function disposeCharts() { while (charts.length) { try { charts.pop().destroy(); } catch {} } }
function cv(id) {
  const el = document.getElementById(id);
  if (!el || el.tagName !== "CANVAS") throw new Error("missing canvas " + id);
  return el;
}
function axis() {
  return {
    x: { grid: { color: C.grid }, ticks: { color: C.tick } },
    y: { beginAtZero: true, ticks: { precision: 0, color: C.tick }, grid: { color: C.grid } },
  };
}
function trendChart(data) {
  const t = Array.isArray(data.runHealthTrend) ? data.runHealthTrend : [];
  const labels = t.map((p) => (p && p.finishedAt ? fmtTs(p.finishedAt) : String((p && p.runId) || "")));
  const vals = t.map((p) => Number((p && p.failedChecks) || 0));
  charts.push(new Chart(cv(CANVAS.trend), {
    type: "line",
    data: { labels, datasets: [{ label: "Failed checks", data: vals, borderColor: C.accent, backgroundColor: C.accentFill, fill: true, tension: 0.3, pointRadius: 3, pointBackgroundColor: C.accent }] },
    options: baseOpts({ scales: axis() }),
  }));
}
function severityChart(data) {
  const sev = data.findingsBySeverity || {};
  const vals = SEVERITIES.map((k) => Number(sev[k] || 0));
  charts.push(new Chart(cv(CANVAS.bySeverity), {
    type: "doughnut",
    data: { labels: SEVERITIES.map(cap), datasets: [{ data: vals, backgroundColor: SEVERITIES.map((k) => C[k]), borderColor: "#141b27", borderWidth: 2 }] },
    options: baseOpts({ cutout: "58%", plugins: { legend: { display: true, position: "right", labels: { color: C.tick } } } }),
  }));
}
function a11yChart(data) {
  const n = data.a11yNewVsRecurring || {};
  charts.push(new Chart(cv(CANVAS.a11y), {
    type: "bar",
    data: { labels: ["Accessibility"], datasets: [
      { label: "New", data: [Number(n.new || 0)], backgroundColor: C.fresh },
      { label: "Recurring", data: [Number(n.recurring || 0)], backgroundColor: C.recurring },
    ] },
    options: baseOpts({ plugins: { legend: { display: true, position: "bottom", labels: { color: C.tick } } }, scales: { x: { stacked: true, grid: { display: false }, ticks: { color: C.tick } }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0, color: C.tick }, grid: { color: C.grid } } } }),
  }));
}
function byPageChart(data) {
  const rows = Array.isArray(data.findingsByPage) ? data.findingsByPage : [];
  const labels = rows.map((r) => shortPage(String((r && r.page) || "")));
  const vals = rows.map((r) => Number((r && r.count) || 0));
  charts.push(new Chart(cv(CANVAS.byPage), {
    type: "bar",
    data: { labels, datasets: [{ label: "Findings", data: vals, backgroundColor: C.accent, borderRadius: 4 }] },
    options: baseOpts({
      onClick: (_e, els) => { if (els && els.length) { const i = els[0].index; const r = rows[i]; if (r) openDetail(String(r.page || ""), i); } },
      scales: { x: { grid: { display: false }, ticks: { color: C.tick, maxRotation: 60, minRotation: 30 } }, y: { beginAtZero: true, ticks: { precision: 0, color: C.tick }, grid: { color: C.grid } } },
    }),
  }));
}

function renderPageList(data) {
  _pageRows = Array.isArray(data.findingsByPage) ? data.findingsByPage : [];
  const ul = document.getElementById("page-list");
  if (!ul) return;
  ul.textContent = "";
  for (let i = 0; i < _pageRows.length; i++) {
    const r = _pageRows[i];
    const page = String((r && r.page) || "");
    if (!page) continue;
    const count = Number((r && r.count) || 0);
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "page-row";
    const url = document.createElement("span");
    url.className = "page-row__url";
    url.textContent = page;
    const chip = document.createElement("span");
    chip.className = "page-row__chip " + (count > 0 ? "chip-find" : "chip-clean");
    chip.textContent = count > 0 ? (count + " findings") : "clean";
    const go = document.createElement("span");
    go.className = "page-row__go";
    go.textContent = "Inspect >";
    btn.appendChild(url);
    btn.appendChild(chip);
    btn.appendChild(go);
    const idx = i;
    btn.addEventListener("click", () => openDetail(page, idx));
    li.appendChild(btn);
    ul.appendChild(li);
  }
}

function shortPage(url) {
  try { const u = new URL(url); return u.pathname === "/" ? u.host : u.pathname; } catch { return url; }
}

async function resolveLatestRunId() {
  if (_latestRunId) return _latestRunId;
  try {
    const res = await fetch("./data/index.json", { cache: "no-store" });
    if (!res.ok) return null;
    const idx = await res.json();
    const runs = Array.isArray(idx) ? idx : (idx && Array.isArray(idx.runs) ? idx.runs : []);
    const first = runs[0];
    const id = first && (typeof first.runId === "string" ? first.runId : (typeof first.id === "string" ? first.id : null));
    if (typeof id === "string" && id) _latestRunId = id;
  } catch {}
  return _latestRunId;
}
async function loadFindings() {
  if (_findingsCache) return _findingsCache;
  const runId = await resolveLatestRunId();
  if (!runId) return null;
  try {
    const res = await fetch("./data/runs/" + encodeURIComponent(runId) + "/findings.json", { cache: "no-store" });
    if (!res.ok) return null;
    _findingsCache = await res.json();
    return _findingsCache;
  } catch { return null; }
}

async function openDetail(pageUrl, pageIndex) {
  const panel = document.getElementById("page-detail");
  const overlay = document.getElementById("page-detail-overlay");
  const body = document.getElementById("detail-body");
  const title = document.getElementById("detail-title");
  if (!panel || !body || !title) return;
  title.textContent = pageUrl;
  body.textContent = "";
  const loading = document.createElement("p");
  loading.className = "detail-empty";
  loading.textContent = "Loading findings...";
  body.appendChild(loading);
  if (overlay) overlay.hidden = false;
  panel.hidden = false;
  const closeBtn = document.getElementById("detail-close");
  if (closeBtn) closeBtn.focus();

  const findings = await loadFindings();
  const runId = _latestRunId;
  body.textContent = "";

  const pages = findings && Array.isArray(findings.pages) ? findings.pages : [];
  // Match by URL first; fall back to positional index because the published
  // findings.json pages are built from the same ordered scope as findingsByPage
  // (and a sanitized page URL may not string-match the dashboard URL).
  let match = pages.find((p) => p && (p.page === pageUrl || shortPage(String(p.page || "")) === shortPage(pageUrl)));
  if (!match && typeof pageIndex === "number" && pageIndex >= 0 && pageIndex < pages.length) {
    match = pages[pageIndex];
  }

  const h1 = document.createElement("h3");
  h1.className = "detail-section__title";
  h1.textContent = "Findings";
  body.appendChild(h1);
  const outcomes = match && Array.isArray(match.outcomes) ? match.outcomes : [];
  if (!outcomes.length) {
    const none = document.createElement("p");
    none.className = "detail-empty";
    none.textContent = findings ? "No findings recorded - this page passed all checks." : "Findings data is unavailable.";
    body.appendChild(none);
  } else {
    for (const o of outcomes) body.appendChild(outcomeEl(o));
  }

  const ai = match && Array.isArray(match.aiItems) ? match.aiItems : [];
  if (ai.length) {
    const h2 = document.createElement("h3");
    h2.className = "detail-section__title";
    h2.textContent = "AI-assisted notes";
    body.appendChild(h2);
    renderAi(ai, body, false);
  }

  const h3 = document.createElement("h3");
  h3.className = "detail-section__title";
  h3.textContent = "Evidence screenshots";
  body.appendChild(h3);
  const slug = match && typeof match.slug === "string" ? match.slug : null;
  if (slug && runId) body.appendChild(shotsEl(runId, slug));
  else { const none = document.createElement("p"); none.className = "detail-empty"; none.textContent = "No screenshots available."; body.appendChild(none); }
}

function outcomeEl(o) {
  const sev = severityOf(o);
  const card = document.createElement("div");
  card.className = "outcome " + (sev ? "b-" + sev : "b-none");
  const meta = document.createElement("div");
  meta.className = "outcome__meta";
  if (sev) { const b = document.createElement("span"); b.className = "sev-badge sev-" + sev; b.textContent = sev; meta.appendChild(b); }
  const kind = (o && (o.classification || o.kind)) || "finding";
  const k = document.createElement("span"); k.className = "kind-tag"; k.textContent = String(kind); meta.appendChild(k);
  card.appendChild(meta);
  const d = document.createElement("p"); d.className = "outcome__detail"; d.textContent = String((o && o.detail) || ""); card.appendChild(d);
  return card;
}
function severityOf(o) {
  const text = String((o && o.detail) || "").toLowerCase();
  for (const s of SEVERITIES) if (text.indexOf(s) !== -1) return s;
  return null;
}
function shotsEl(runId, slug) {
  const grid = document.createElement("div");
  grid.className = "shots";
  const base = "./data/runs/" + encodeURIComponent(runId) + "/screenshots/";
  const variants = [
    { label: "Desktop", file: slug + ".desktop.png" },
    { label: "Desktop (diff)", file: slug + ".desktop.diff.png" },
    { label: "Mobile", file: slug + ".mobile.png" },
    { label: "Mobile (diff)", file: slug + ".mobile.diff.png" },
  ];
  for (const v of variants) {
    const fig = document.createElement("div");
    fig.className = "shot";
    const label = document.createElement("span"); label.className = "shot__label"; label.textContent = v.label;
    const a = document.createElement("a"); a.href = base + v.file; a.target = "_blank"; a.rel = "noopener";
    const img = document.createElement("img"); img.loading = "lazy"; img.alt = v.label; img.src = base + v.file;
    img.addEventListener("error", () => { fig.remove(); });
    a.appendChild(img);
    fig.appendChild(label); fig.appendChild(a);
    grid.appendChild(fig);
  }
  return grid;
}

function renderAi(items, host, assertAfter) {
  if (!host) return;
  for (const item of (items || [])) {
    const el = document.createElement("article");
    el.className = "ai-assisted";
    el.setAttribute("data-ai", "true");
    const badge = document.createElement("span"); badge.className = "not-a-fact"; badge.textContent = "not a deterministic fact"; el.appendChild(badge);
    const agent = document.createElement("div"); agent.className = "ai-assisted__agent"; agent.textContent = (item && item.agent) || "AI agent"; el.appendChild(agent);
    const text = document.createElement("p"); text.className = "ai-assisted__text"; text.textContent = (item && item.text) || ""; el.appendChild(text);
    host.appendChild(el);
  }
  if (assertAfter) assertAi();
}
function assertAi() {
  const nodes = document.querySelectorAll('[data-ai="true"]');
  for (const n of nodes) {
    if (!n.classList.contains("ai-assisted") || !n.querySelector(".not-a-fact")) {
      throw new Error("AI element mislabelled; failing closed");
    }
  }
}

let _wired = false;
function wireDetail() {
  if (_wired) return;
  _wired = true;
  const close = document.getElementById("detail-close");
  const overlay = document.getElementById("page-detail-overlay");
  if (close) close.addEventListener("click", closeDetail);
  if (overlay) overlay.addEventListener("click", closeDetail);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDetail(); });
}
function closeDetail() {
  const panel = document.getElementById("page-detail");
  const overlay = document.getElementById("page-detail-overlay");
  if (panel) panel.hidden = true;
  if (overlay) overlay.hidden = true;
}