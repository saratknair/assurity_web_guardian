// Assurity Web Guardian — static dashboard app (entry point, task 4.6).
//
// Plain browser ES module (NO TypeScript, NO build step). Served same-origin as
// static HTML + JS + CSS. This file renders the redesigned dashboard from the
// `DashboardData` contract (see dashboard/data-source.js and design.md →
// DashboardData) using the vendored Chart.js UMD global (`window.Chart`).
//
// Responsibilities (Req 1.1, 1.2, 1.3, 1.5, 1.6, 1.7, 1.8, 1.9, 11.3):
//   - Resolve the data source (static | live) and load DashboardData.
//   - Build four Chart.js charts (line, bar, doughnut, stacked bar) bound to the
//     existing <canvas> ids in index.html, responsive and filling their panels.
//   - Empty state (1.7): when data.empty or there are no runs, reveal the
//     empty-state panel and HIDE the chart grid + AI aside so there are NO
//     blank/broken chart containers and NO canvases are created.
//   - AI labelling (1.8, 1.9, 11.3), fail-closed: every AI item is rendered with
//     class .ai-assisted, data-ai="true", a visible "not a deterministic fact"
//     badge, the agent name, and the text. A render-time assertion walks all
//     [data-ai="true"] nodes; if any is missing its badge or .ai-assisted class,
//     it throws and the app falls back to the empty state instead of presenting
//     unlabelled AI content.
//   - Any error anywhere (load failure, missing Chart, chart failure, AI-label
//     assertion failure) is caught and shown as the empty state — never a broken
//     chart container.

import { resolveDataSource } from "./data-source.js";

/** Canvas ids in index.html, one per chart (keep in sync with the markup). */
const CANVAS_IDS = {
  runHealthTrend: "chart-run-health-trend",
  findingsByPage: "chart-findings-by-page",
  findingsBySeverity: "chart-findings-by-severity",
  a11yNewVsRecurring: "chart-a11y-new-vs-recurring",
};

/** Severity buckets, in presentation order. */
const SEVERITY_ORDER = ["critical", "serious", "moderate", "minor"];

/** Colors (mirror the CSS treatments where it helps readability). */
const COLORS = {
  det: "#2b6cb0", // deterministic blue
  critical: "#c53030",
  serious: "#dd6b20",
  moderate: "#d69e2e",
  minor: "#718096",
  fresh: "#2b6cb0", // "new" a11y issues
  recurring: "#c05621", // recurring a11y issues (AI-accent orange reused)
  gridLine: "rgba(45, 55, 72, 0.08)",
};

/** Live Chart.js instances, so a re-render can dispose cleanly. */
const charts = [];

// ---------------------------------------------------------------------------
// Entry point.
// ---------------------------------------------------------------------------

init();

/**
 * Async entry point. Resolves and loads the data, then renders. ANY failure —
 * data load, missing Chart library, chart construction, or the AI-labelling
 * assertion — is caught here and converted into the visible empty state, so the
 * page never shows blank or broken chart containers (Req 1.7, 1.9).
 */
async function init() {
  try {
    const src = await resolveDataSource();
    const data = await src.load();

    if (isEmpty(data)) {
      showEmptyState();
      return;
    }

    // Chart library must be present (vendored UMD). If it is not, fail closed to
    // a clear empty-state message rather than crashing on an undefined global.
    if (typeof Chart === "undefined") {
      showEmptyState(
        "Charting library unavailable",
        "The dashboard charting library has not been vendored yet, so charts cannot be drawn.",
      );
      return;
    }

    renderHeaderMeta(data);
    renderCharts(data);
    renderAiAnalysis(data); // includes the fail-closed render-time assertion
    showContent();
  } catch (err) {
    // Fail closed: never present partial/broken content. Surface the empty
    // state (default message) and keep the console trail for diagnosis.
    // eslint-disable-next-line no-console
    console.error("[dashboard] render failed; showing empty state:", err);
    disposeCharts();
    showEmptyState();
  }
}

// ---------------------------------------------------------------------------
// Empty state / visibility (Req 1.7).
// ---------------------------------------------------------------------------

/** True when the data source reports empty or carries no runs. */
function isEmpty(data) {
  if (!data || typeof data !== "object") return true;
  if (data.empty === true) return true;
  const trend = Array.isArray(data.runHealthTrend) ? data.runHealthTrend : [];
  return trend.length === 0;
}

/**
 * Reveal the empty-state panel and hide the chart grid + AI aside so there are
 * NO blank/broken chart containers and NO canvases on screen (Req 1.7).
 * Optionally override the title/body text (used for the missing-library case).
 */
function showEmptyState(title, body) {
  const empty = document.getElementById("empty-state");
  const grid = document.getElementById("chart-grid");
  const ai = document.getElementById("ai-analysis");

  if (title != null) {
    const titleEl = empty && empty.querySelector(".empty-state__title");
    if (titleEl) titleEl.textContent = title;
  }
  if (body != null) {
    const bodyEl = empty && empty.querySelector(".empty-state__body");
    if (bodyEl) bodyEl.textContent = body;
  }

  if (empty) empty.hidden = false;
  if (grid) grid.classList.add("is-hidden");
  if (ai) ai.classList.add("is-hidden");
}

/** Reveal the chart grid + AI aside and keep the empty-state hidden. */
function showContent() {
  const empty = document.getElementById("empty-state");
  const grid = document.getElementById("chart-grid");
  const ai = document.getElementById("ai-analysis");

  if (empty) empty.hidden = true;
  if (grid) grid.classList.remove("is-hidden");
  if (ai) ai.classList.remove("is-hidden");
}

// ---------------------------------------------------------------------------
// Header meta (Req 1 — presentation).
// ---------------------------------------------------------------------------

/** Set the header meta line to the domain and the generated-at timestamp. */
function renderHeaderMeta(data) {
  const el = document.getElementById("header-meta");
  if (!el) return;
  const domain = typeof data.domain === "string" ? data.domain : "";
  const generatedAt = formatTimestamp(data.generatedAt);
  const parts = [];
  if (domain) parts.push(domain);
  if (generatedAt) parts.push(`generated ${generatedAt}`);
  el.textContent = parts.join(" · ");
}

/** Best-effort human timestamp; falls back to the raw string. */
function formatTimestamp(value) {
  if (typeof value !== "string" || !value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

// ---------------------------------------------------------------------------
// Charts (Req 1.1, 1.2, 1.3).
// ---------------------------------------------------------------------------

/** Shared options: fill the panel wrapper, no forced aspect ratio. */
function baseOptions(extra) {
  return Object.assign(
    {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
    },
    extra || {},
  );
}

/** Build all four charts. Throws if any canvas or construction fails. */
function renderCharts(data) {
  disposeCharts();
  buildRunHealthTrend(data);
  buildFindingsByPage(data);
  buildFindingsBySeverity(data);
  buildA11yNewVsRecurring(data);
}

/** Dispose any existing Chart.js instances (safe to call repeatedly). */
function disposeCharts() {
  while (charts.length) {
    const c = charts.pop();
    try {
      c.destroy();
    } catch {
      /* already gone */
    }
  }
}

/** Resolve a canvas element by id or throw (so init() can fail closed). */
function canvas(id) {
  const el = document.getElementById(id);
  if (!el || el.tagName !== "CANVAS") {
    throw new Error(`dashboard: missing <canvas id="${id}">`);
  }
  return el;
}

/** #chart-run-health-trend — LINE of failedChecks over time, chronological. */
function buildRunHealthTrend(data) {
  const trend = Array.isArray(data.runHealthTrend) ? data.runHealthTrend : [];
  // data-source already returns chronological (oldest→newest); be defensive and
  // keep input order as the authoritative chronological ordering.
  const labels = trend.map((p) =>
    p && typeof p.finishedAt === "string" && p.finishedAt
      ? formatTimestamp(p.finishedAt)
      : String((p && p.runId) || ""),
  );
  const values = trend.map((p) => Number((p && p.failedChecks) || 0));

  charts.push(
    new Chart(canvas(CANVAS_IDS.runHealthTrend), {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Failed checks",
            data: values,
            borderColor: COLORS.det,
            backgroundColor: "rgba(43, 108, 176, 0.15)",
            fill: true,
            tension: 0.25,
            pointRadius: 3,
          },
        ],
      },
      options: baseOptions({
        scales: {
          x: { grid: { color: COLORS.gridLine } },
          y: {
            beginAtZero: true,
            ticks: { precision: 0 },
            grid: { color: COLORS.gridLine },
          },
        },
      }),
    }),
  );
}

/** #chart-findings-by-page — BAR of count per page. */
function buildFindingsByPage(data) {
  const rows = Array.isArray(data.findingsByPage) ? data.findingsByPage : [];
  const labels = rows.map((r) => String((r && r.page) || "(unknown)"));
  const values = rows.map((r) => Number((r && r.count) || 0));

  charts.push(
    new Chart(canvas(CANVAS_IDS.findingsByPage), {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Findings",
            data: values,
            backgroundColor: COLORS.det,
          },
        ],
      },
      options: baseOptions({
        scales: {
          x: { grid: { display: false } },
          y: {
            beginAtZero: true,
            ticks: { precision: 0 },
            grid: { color: COLORS.gridLine },
          },
        },
      }),
    }),
  );
}

/** #chart-findings-by-severity — DOUGHNUT of the severity partition. */
function buildFindingsBySeverity(data) {
  const sev =
    data.findingsBySeverity && typeof data.findingsBySeverity === "object"
      ? data.findingsBySeverity
      : {};
  const labels = SEVERITY_ORDER;
  const values = SEVERITY_ORDER.map((k) => Number(sev[k] || 0));
  const bg = SEVERITY_ORDER.map((k) => COLORS[k]);

  charts.push(
    new Chart(canvas(CANVAS_IDS.findingsBySeverity), {
      type: "doughnut",
      data: {
        labels,
        datasets: [{ data: values, backgroundColor: bg }],
      },
      options: baseOptions({
        cutout: "55%",
        plugins: { legend: { display: true, position: "right" } },
      }),
    }),
  );
}

/** #chart-a11y-new-vs-recurring — STACKED BAR of new vs recurring. */
function buildA11yNewVsRecurring(data) {
  const nvr =
    data.a11yNewVsRecurring && typeof data.a11yNewVsRecurring === "object"
      ? data.a11yNewVsRecurring
      : {};
  const fresh = Number(nvr.new || 0);
  const recurring = Number(nvr.recurring || 0);

  charts.push(
    new Chart(canvas(CANVAS_IDS.a11yNewVsRecurring), {
      type: "bar",
      data: {
        labels: ["Accessibility issues"],
        datasets: [
          { label: "New", data: [fresh], backgroundColor: COLORS.fresh },
          {
            label: "Recurring",
            data: [recurring],
            backgroundColor: COLORS.recurring,
          },
        ],
      },
      options: baseOptions({
        plugins: { legend: { display: true, position: "bottom" } },
        scales: {
          x: { stacked: true, grid: { display: false } },
          y: {
            stacked: true,
            beginAtZero: true,
            ticks: { precision: 0 },
            grid: { color: COLORS.gridLine },
          },
        },
      }),
    }),
  );
}

// ---------------------------------------------------------------------------
// AI-assisted analysis (Req 1.8, 1.9, 11.3) — fail closed.
// ---------------------------------------------------------------------------

/**
 * Populate #ai-analysis-items from data.aiItems. Every item becomes an element
 * carrying class .ai-assisted, data-ai="true", a visible "not a deterministic
 * fact" badge, the agent name, and the text. After building, a render-time
 * assertion verifies the labelling; if it fails, it throws and init() falls back
 * to the empty state (fail-closed) rather than presenting unlabelled AI content.
 */
function renderAiAnalysis(data) {
  const host = document.getElementById("ai-analysis-items");
  if (!host) throw new Error("dashboard: missing #ai-analysis-items");

  host.textContent = ""; // clear any prior render

  const items = Array.isArray(data.aiItems) ? data.aiItems : [];
  for (const item of items) {
    host.appendChild(buildAiElement(item));
  }

  assertAiLabelling();
}

/**
 * Build a single AI-assisted element. Uses textContent for all untrusted values
 * (agent/text) so published AI copy can never inject markup.
 */
function buildAiElement(item) {
  const el = document.createElement("article");
  el.className = "ai-assisted";
  el.setAttribute("data-ai", "true");

  const badge = document.createElement("span");
  badge.className = "not-a-fact";
  badge.textContent = "not a deterministic fact";
  el.appendChild(badge);

  const agent = document.createElement("div");
  agent.className = "ai-assisted__agent";
  agent.textContent = (item && item.agent) || "AI agent";
  el.appendChild(agent);

  const text = document.createElement("p");
  text.className = "ai-assisted__text";
  text.textContent = (item && item.text) || "";
  el.appendChild(text);

  return el;
}

/**
 * Render-time assertion (Req 1.9, 11.3). Walk every element claiming to be AI
 * (data-ai="true"); each MUST carry the .ai-assisted treatment AND contain a
 * visible .not-a-fact badge. If any fails, throw so the app fails closed to the
 * empty state instead of presenting an unlabelled AI element. Passes for
 * correctly-built items; fails if a label is missing.
 */
function assertAiLabelling() {
  const aiNodes = document.querySelectorAll('[data-ai="true"]');
  for (const node of aiNodes) {
    const hasClass = node.classList.contains("ai-assisted");
    const hasBadge = !!node.querySelector(".not-a-fact");
    if (!hasClass || !hasBadge) {
      throw new Error(
        "dashboard: AI-assisted element is mislabelled (missing .ai-assisted class or 'not a deterministic fact' badge); failing closed",
      );
    }
  }
}
