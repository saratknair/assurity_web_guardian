// Assurity Web Guardian - chart helpers (trend, severity, lifecycle).
// Plain browser ES module, ASCII-only. NOT a routed view: the overview and run
// views call these helpers with a host element and the view ctx.
//
// Chart.js 4.4.6 is the UMD global window.Chart (vendor/chart.umd.min.js).
// Nothing here touches window/document at import time, so the pure row
// helpers (trendRows, severityRows, lifecycleRows, summaries) run under Node.
//
// Accessibility (R15): every chart has a canvas role="img" + aria-label, a
// visible summary line, a legend and a <details> data table whose rows hold
// the same actions as the pointer (real links, keyboard operable). Series use
// canvas pattern fills plus text labels, never colour alone. If Chart.js is
// missing or throws, the tables are shown instead (details opened).
//
// Click targets (routed through ctx.formatRoute / ctx.navigate):
//   trend point      -> { view: "run", runId }
//   severity segment -> { view: "findings", params: { run, sev: [s] } }
//   lifecycle bar    -> { view: "findings", params: { run, state: [s] } }

import { LIFECYCLE_PRESENT, LIFECYCLE_LABELS, decisionEffectText } from "../lib/findings.js";
import { SEVERITY_ORDER, label as sevLabel, symbol as sevSymbol } from "../lib/severity.js";

export const RUN_DATA_MISSING_TEXT = "Run data not published";

// ---------------------------------------------------------------------------
// Pure helpers (no DOM)
// ---------------------------------------------------------------------------

function isObj(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function count(v) {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}
function camel(key) {
  return key.replace(/-([a-z])/g, (m, c) => c.toUpperCase());
}
/** Read a count by kebab-case key, also accepting the camelCase published keys. */
function pick(obj, key) {
  if (!isObj(obj)) return 0;
  return count(obj[key] !== undefined ? obj[key] : obj[camel(key)]);
}

/** "2026-10-26T08:00:00.000Z" -> "2026-10-26 08:00 UTC"; unparseable -> "Date not recorded". */
export function formatRunDate(iso) {
  if (typeof iso !== "string") return "Date not recorded";
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
  return m ? m[1] + " " + m[2] + " UTC" : "Date not recorded";
}

function plural(n, one, many) {
  return n + " " + (n === 1 ? one : many);
}

/**
 * One row per run, oldest first (stable; runs without a date go last).
 * Row: { runId, finishedAt, dateText, total, hasRunData, route, note, effect }
 * route is null when the run's data is not published (no empty Run_View).
 */
export function trendRows(runs) {
  const list = Array.isArray(runs) ? runs.filter(isObj) : [];
  const items = list.map((r, i) => ({ r, i }));
  items.sort((a, b) => {
    const x = typeof a.r.finishedAt === "string" ? a.r.finishedAt : "\uffff";
    const y = typeof b.r.finishedAt === "string" ? b.r.finishedAt : "\uffff";
    return x < y ? -1 : x > y ? 1 : a.i - b.i;
  });
  return items.map(({ r }) => {
    const runId = typeof r.runId === "string" ? r.runId : "";
    const hasRunData = r.hasRunData !== false;
    return {
      runId,
      finishedAt: typeof r.finishedAt === "string" ? r.finishedAt : null,
      dateText: formatRunDate(r.finishedAt),
      total: count(r.total),
      hasRunData,
      route: hasRunData && runId ? { view: "run", runId } : null,
      note: hasRunData ? "" : RUN_DATA_MISSING_TEXT,
      effect: decisionEffectText(isObj(r.decisions) ? r.decisions : {}),
    };
  });
}

/** Visible summary for the trend chart. */
export function trendSummary(rows) {
  if (!rows.length) return "No runs have been published yet.";
  const last = rows[rows.length - 1];
  let s = plural(rows.length, "run", "runs") + ". Latest run " + last.runId + " (" + last.dateText + "): " +
    plural(last.total, "active finding", "active findings");
  if (rows.length > 1) {
    const d = last.total - rows[rows.length - 2].total;
    s += d === 0 ? ", no change from the previous run" : ", " + (d > 0 ? "up " : "down ") + Math.abs(d) + " from the previous run";
  }
  return s + ".";
}

/**
 * Severity rows: only severities with at least one Finding (R11.1), in
 * SEVERITY_ORDER. Accepts counts keyed kebab-case or camelCase.
 * Row: { key, label, symbol, count, route }
 */
export function severityRows(counts, runId) {
  const rows = [];
  for (const key of SEVERITY_ORDER) {
    const n = pick(counts, key);
    if (n > 0) {
      rows.push({
        key,
        label: sevLabel(key),
        symbol: sevSymbol(key),
        count: n,
        route: { view: "findings", params: { run: runId || "", sev: [key] } },
      });
    }
  }
  return rows;
}

export function severitySummary(rows) {
  if (!rows.length) return "No active findings in this run.";
  const total = rows.reduce((a, r) => a + r.count, 0);
  return plural(total, "active finding", "active findings") + ": " + rows.map((r) => r.label + " " + r.count).join(", ") + ".";
}

/**
 * Lifecycle rows. `lifecycle` may be countByLifecycle() output ({series,
 * resolved}), a dashboard.json runs[] entry ({byLifecycle, resolved}) or a flat
 * count object. All five present-state rows are always returned (including
 * "State not recorded") so nothing is omitted (R12.6); their counts sum to the
 * active total. `resolved` is separate (present:false) and has no route
 * because resolved items are not Active_Findings.
 * Row: { key, label, count, present, route }
 */
export function lifecycleRows(lifecycle, runId) {
  const src = isObj(lifecycle) ? lifecycle : {};
  const series = isObj(src.series) ? src.series : isObj(src.byLifecycle) ? src.byLifecycle : src;
  const rows = LIFECYCLE_PRESENT.map((key) => ({
    key,
    label: LIFECYCLE_LABELS[key],
    count: pick(series, key),
    present: true,
    route: { view: "findings", params: { run: runId || "", state: [key] } },
  }));
  const resolved = Array.isArray(src.resolved) ? src.resolved.length : count(src.resolved);
  rows.push({ key: "resolved", label: LIFECYCLE_LABELS.resolved, count: resolved, present: false, route: null });
  return rows;
}

export function lifecycleTotal(rows) {
  return rows.filter((r) => r.present).reduce((a, r) => a + r.count, 0);
}

export function lifecycleSummary(rows) {
  const total = lifecycleTotal(rows);
  const present = rows.filter((r) => r.present).map((r) => r.label + " " + r.count).join(", ");
  const res = rows.find((r) => !r.present);
  return plural(total, "active finding", "active findings") + ": " + present + ". " +
    (res ? "Resolved in this run, not part of the total: " + res.count + "." : "");
}

// ---------------------------------------------------------------------------
// Browser-only rendering
// ---------------------------------------------------------------------------

const PATTERN_KINDS = {
  critical: "solid", serious: "stripes", moderate: "dots", minor: "cross", unrated: "horiz", "not-recorded": "vert",
  new: "solid", recurring: "stripes", "existing-unresolved": "dots", regression: "cross", resolved: "vert",
};
const SEV_COLOR_VAR = {
  critical: "--critical", serious: "--serious", moderate: "--moderate", minor: "--minor",
  unrated: "--unrated", "not-recorded": "--muted",
};
const LC_COLOR_VAR = {
  new: "--lc-new", recurring: "--lc-recurring", "existing-unresolved": "--lc-existing",
  regression: "--lc-regression", "not-recorded": "--muted", resolved: "--ok",
};
const FALLBACK_COLOR = {
  "--critical": "#f87171", "--serious": "#fb923c", "--moderate": "#facc15", "--minor": "#a8b5c9",
  "--unrated": "#c4b5fd", "--muted": "#a3b1c6", "--lc-new": "#67e8f9", "--lc-recurring": "#fdba74",
  "--lc-existing": "#c4b5fd", "--lc-regression": "#fda4af", "--ok": "#4ade80", "--link": "#7cb4ff",
  "--text": "#e6edf6", "--border": "#243044", "--surface-2": "#1b2433",
};

const live = []; // { host, chart }
let motionBound = false;

function cssVar(name) {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name);
    if (typeof v === "string" && v.trim()) return v.trim();
  } catch (e) {
    /* fall through */
  }
  return FALLBACK_COLOR[name] || "#888888";
}

function prefersReducedMotion() {
  try {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  } catch (e) {
    return false;
  }
}

function applyMotion(Chart) {
  const reduce = prefersReducedMotion();
  if (reduce) {
    Chart.defaults.animation = false;
    if (Chart.defaults.transitions && Chart.defaults.transitions.active && Chart.defaults.transitions.active.animation) {
      Chart.defaults.transitions.active.animation.duration = 0;
    }
  }
  return reduce;
}

function bindMotionListener(Chart) {
  if (motionBound) return;
  motionBound = true;
  try {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => {
      const reduce = applyMotion(Chart);
      for (const l of live) {
        l.chart.options.animation = reduce ? false : {};
        l.chart.update("none");
      }
    };
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else if (mq.addListener) mq.addListener(onChange);
  } catch (e) {
    /* no matchMedia */
  }
}

/** Destroy every chart created by this module (call before re-rendering). */
export function destroyCharts() {
  while (live.length) {
    const l = live.pop();
    try {
      l.chart.destroy();
    } catch (e) {
      /* already gone */
    }
  }
}

function destroyFor(host) {
  for (let i = live.length - 1; i >= 0; i--) {
    if (live[i].host === host) {
      try {
        live[i].chart.destroy();
      } catch (e) {
        /* already gone */
      }
      live.splice(i, 1);
    }
  }
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function makeTile(kind, color) {
  const c = document.createElement("canvas");
  c.width = 12;
  c.height = 12;
  const g = c.getContext("2d");
  if (!g) return null;
  if (kind === "solid") {
    g.fillStyle = color;
    g.fillRect(0, 0, 12, 12);
    return c;
  }
  g.fillStyle = cssVar("--surface-2");
  g.fillRect(0, 0, 12, 12);
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = 3;
  const diag = () => {
    g.beginPath();
    g.moveTo(0, 12); g.lineTo(12, 0);
    g.moveTo(-6, 6); g.lineTo(6, -6);
    g.moveTo(6, 18); g.lineTo(18, 6);
    g.stroke();
  };
  if (kind === "stripes") diag();
  else if (kind === "cross") {
    diag();
    g.beginPath();
    g.moveTo(0, 0); g.lineTo(12, 12);
    g.moveTo(-6, 6); g.lineTo(6, 18);
    g.moveTo(6, -6); g.lineTo(18, 6);
    g.stroke();
  } else if (kind === "dots") {
    g.beginPath(); g.arc(3, 3, 2.2, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(9, 9, 2.2, 0, Math.PI * 2); g.fill();
  } else if (kind === "horiz") {
    g.fillRect(0, 2, 12, 2.5);
    g.fillRect(0, 8, 12, 2.5);
  } else {
    g.fillRect(2, 0, 2.5, 12);
    g.fillRect(8, 0, 2.5, 12);
  }
  return c;
}

/** Returns { color, fill, tile } for a series key; fill is a CanvasPattern or the colour. */
function seriesStyle(key, colorVar) {
  const color = cssVar(colorVar);
  const tile = makeTile(PATTERN_KINDS[key] || "solid", color);
  let fill = color;
  if (tile) {
    try {
      const p = tile.getContext("2d").createPattern(tile, "repeat");
      if (p) fill = p;
    } catch (e) {
      fill = color;
    }
  }
  return { color, fill, tile };
}

function swatch(style) {
  const c = el("canvas", "chart-swatch");
  c.width = 16;
  c.height = 16;
  c.setAttribute("aria-hidden", "true");
  c.style.width = "16px";
  c.style.height = "16px";
  c.style.border = "1px solid " + style.color;
  c.style.flex = "none";
  const g = c.getContext("2d");
  if (g) {
    g.fillStyle = style.tile ? g.createPattern(style.tile, "repeat") || style.color : style.color;
    g.fillRect(0, 0, 16, 16);
  }
  return c;
}

function actionLink(ctx, route, text, extraLabel) {
  const a = el("a", "", text);
  a.href = ctx.formatRoute(route);
  if (extraLabel) a.setAttribute("aria-label", extraLabel);
  return a;
}

function legendList(ctx, items) {
  const ul = el("ul", "chart-legend");
  ul.style.listStyle = "none";
  ul.style.display = "flex";
  ul.style.flexWrap = "wrap";
  ul.style.gap = "6px 16px";
  ul.style.padding = "0";
  ul.style.margin = "12px 0 0";
  for (const it of items) {
    const li = el("li");
    li.style.display = "inline-flex";
    li.style.alignItems = "center";
    li.style.gap = "6px";
    li.style.minHeight = "24px";
    if (it.style) li.appendChild(swatch(it.style));
    const text = it.label + ": " + it.count;
    if (it.route) li.appendChild(actionLink(ctx, it.route, text));
    else li.appendChild(el("span", "", text));
    ul.appendChild(li);
  }
  return ul;
}

function buildTable(captionText, headers, rowCells) {
  const wrap = el("div", "table-scroll");
  wrap.setAttribute("role", "region");
  wrap.setAttribute("tabindex", "0");
  wrap.setAttribute("aria-label", captionText);
  const table = el("table", "data-table");
  table.appendChild(el("caption", "caption", captionText));
  const thead = el("thead");
  const hr = el("tr");
  for (const h of headers) {
    const th = el("th", "", h);
    th.setAttribute("scope", "col");
    hr.appendChild(th);
  }
  thead.appendChild(hr);
  table.appendChild(thead);
  const tbody = el("tbody");
  for (const cells of rowCells) {
    const tr = el("tr");
    for (const c of cells) {
      const td = el("td");
      if (typeof c === "string") td.textContent = c;
      else if (c) td.appendChild(c);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

function badge(kind, key, text) {
  return el("span", kind + "-badge " + (kind === "sev" ? "sev-" : "lc-") + key, text);
}

/** Card scaffold shared by the three charts. */
function scaffold(host, o) {
  destroyFor(host);
  while (host.firstChild) host.removeChild(host.firstChild);
  const card = el("section", "chart-card" + (o.wide ? " chart-card--wide" : ""));
  card.appendChild(el("h3", "chart-card__title", o.title));
  if (o.hint) card.appendChild(el("p", "chart-card__hint", o.hint));
  const summary = el("p", "chart-summary", o.summary);
  card.appendChild(summary);
  const canvasWrap = el("div", "chart-card__canvas" + (o.tall ? " chart-card__canvas--tall" : ""));
  const canvas = el("canvas");
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", o.title + ". " + o.summary);
  canvasWrap.appendChild(canvas);
  card.appendChild(canvasWrap);
  host.appendChild(card);
  return { card, canvasWrap, canvas };
}

function finishCard(card, legend, tableTitle, table) {
  if (legend) card.appendChild(legend);
  const details = el("details", "chart-text");
  details.appendChild(el("summary", "", tableTitle));
  details.appendChild(table);
  card.appendChild(details);
  return details;
}

/** Create the Chart, wiring click/hover. On any failure, show the tables instead. */
function mount(host, parts, details, config, hit) {
  const Chart = typeof window !== "undefined" ? window.Chart : undefined;
  const fallback = (why) => {
    if (parts.canvasWrap.parentNode) parts.canvasWrap.parentNode.removeChild(parts.canvasWrap);
    const note = el("p", "chart-card__hint", why);
    parts.card.insertBefore(note, details);
    details.open = true;
  };
  if (typeof Chart !== "function") {
    fallback("The chart library could not be loaded. The data is shown as a table.");
    return null;
  }
  try {
    const reduce = applyMotion(Chart);
    bindMotionListener(Chart);
    config.options = config.options || {};
    if (reduce) config.options.animation = false;
    config.options.responsive = true;
    config.options.maintainAspectRatio = false;
    config.options.onClick = (evt, _els, chart) => {
      const els = chart.getElementsAtEventForMode(evt, "nearest", { intersect: true }, true);
      if (els && els.length) hit.click(els[0]);
    };
    config.options.onHover = (evt, els) => {
      const t = evt && evt.native && evt.native.target;
      if (!t || !t.style) return;
      const hot = els && els.length && hit.clickable(els[0]);
      t.style.cursor = hot ? "pointer" : "default";
    };
    const chart = new Chart(parts.canvas, config);
    live.push({ host, chart });
    return chart;
  } catch (e) {
    fallback("The chart could not be drawn. The data is shown as a table.");
    return null;
  }
}

function axisColors() {
  return { text: cssVar("--muted"), grid: cssVar("--border"), fg: cssVar("--text") };
}

// ---------------------------------------------------------------------------
// Trend
// ---------------------------------------------------------------------------

/** One point per run from dashboard.json runs[]. */
export function renderTrendChart(host, runs, ctx) {
  const rows = trendRows(runs);
  const summary = trendSummary(rows);
  const parts = scaffold(host, {
    title: "Issues per run",
    hint: "Each point is one run. Select a point to open that run.",
    summary,
    wide: true,
  });
  const color = cssVar("--link");
  const ax = axisColors();

  const tableRows = rows.map((r) => {
    const runCell = r.route
      ? actionLink(ctx, r.route, r.runId, "Open run " + r.runId)
      : el("span", "", r.runId + " - " + RUN_DATA_MISSING_TEXT);
    const note = [r.note, r.effect].filter(Boolean).join("; ");
    return [runCell, r.dateText, String(r.total), note];
  });
  const table = buildTable("Active findings per run", ["Run", "Date", "Active findings", "Notes"], tableRows);
  const details = finishCard(parts.card, null, "Show data table", table);
  if (!rows.length) {
    parts.canvasWrap.parentNode.removeChild(parts.canvasWrap);
    return null;
  }

  const config = {
    type: "line",
    data: {
      labels: rows.map((r) => r.dateText.slice(0, 10)),
      datasets: [
        {
          label: "Active findings",
          data: rows.map((r) => r.total),
          borderColor: color,
          backgroundColor: color,
          borderWidth: 2,
          tension: 0,
          pointRadius: rows.map((r) => (r.effect ? 7 : 5)),
          pointHoverRadius: 8,
          pointHitRadius: 12,
          pointStyle: rows.map((r) => (r.hasRunData ? "circle" : "rectRot")),
          pointBackgroundColor: rows.map((r) => (r.hasRunData ? color : "rgba(0,0,0,0)")),
          pointBorderColor: color,
          pointBorderWidth: rows.map((r) => (r.hasRunData ? 1 : 2.5)),
        },
      ],
    },
    options: {
      scales: {
        x: { ticks: { color: ax.text, maxRotation: 45 }, grid: { color: ax.grid } },
        y: { beginAtZero: true, ticks: { color: ax.text, precision: 0 }, grid: { color: ax.grid }, title: { display: true, text: "Active findings", color: ax.text } },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => (items.length ? rows[items[0].dataIndex].runId : ""),
            label: (item) => {
              const r = rows[item.dataIndex];
              return r.dateText + " - " + plural(r.total, "active finding", "active findings");
            },
            afterLabel: (item) => {
              const r = rows[item.dataIndex];
              return [r.note, r.effect].filter(Boolean).join("; ");
            },
          },
        },
      },
    },
  };
  return mount(host, parts, details, config, {
    clickable: (e) => !!rows[e.index].route,
    click: (e) => {
      const r = rows[e.index];
      if (r.route) ctx.navigate(r.route);
      else if (typeof ctx.announce === "function") ctx.announce(r.runId + ": " + RUN_DATA_MISSING_TEXT);
    },
  });
}

// ---------------------------------------------------------------------------
// Severity doughnut
// ---------------------------------------------------------------------------

/** counts: countBySeverity() output or runs[].bySeverity. */
export function renderSeverityChart(host, counts, ctx, opts) {
  const runId = opts && typeof opts.runId === "string" ? opts.runId : "";
  const rows = severityRows(counts, runId);
  const summary = severitySummary(rows);
  const parts = scaffold(host, {
    title: "Findings by severity",
    hint: "Select a segment to list those findings.",
    summary,
    tall: true,
  });
  const styles = rows.map((r) => seriesStyle(r.key, SEV_COLOR_VAR[r.key]));
  const legend = legendList(ctx, rows.map((r, i) => ({ label: r.symbol + " " + r.label, count: r.count, route: r.route, style: styles[i] })));
  const table = buildTable(
    "Active findings by severity",
    ["Severity", "Active findings", "Action"],
    rows.map((r) => [badge("sev", r.key, r.label), String(r.count), actionLink(ctx, r.route, "Show " + r.count, "Show " + r.count + " " + r.label + " findings")])
  );
  const details = finishCard(parts.card, legend, "Show data table", table);
  if (!rows.length) {
    parts.canvasWrap.parentNode.removeChild(parts.canvasWrap);
    return null;
  }
  const bg = cssVar("--surface-2");
  const config = {
    type: "doughnut",
    data: {
      labels: rows.map((r) => r.label),
      datasets: [{
        data: rows.map((r) => r.count),
        backgroundColor: styles.map((s) => s.fill),
        borderColor: styles.map((s) => s.color),
        borderWidth: 2,
        hoverBorderColor: axisColors().fg,
        hoverOffset: 6,
        spacing: 1,
      }],
    },
    options: {
      layout: { padding: 4 },
      cutout: "50%",
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (item) => rows[item.dataIndex].label + ": " + rows[item.dataIndex].count,
          },
          backgroundColor: bg,
        },
      },
    },
  };
  return mount(host, parts, details, config, {
    clickable: () => true,
    click: (e) => ctx.navigate(rows[e.index].route),
  });
}

// ---------------------------------------------------------------------------
// Lifecycle stacked bar
// ---------------------------------------------------------------------------

/** lifecycle: countByLifecycle() output or a runs[] entry. Resolved is a separate bar. */
export function renderLifecycleChart(host, lifecycle, ctx, opts) {
  const runId = opts && typeof opts.runId === "string" ? opts.runId : "";
  const rows = lifecycleRows(lifecycle, runId);
  const summary = lifecycleSummary(rows);
  const parts = scaffold(host, {
    title: "New versus recurring",
    hint: "Select a bar to list those findings. Resolved issues are shown separately and are not part of the total.",
    summary,
    tall: true,
  });
  const styles = rows.map((r) => seriesStyle(r.key, LC_COLOR_VAR[r.key]));
  const legend = legendList(ctx, rows.map((r, i) => ({ label: r.label, count: r.count, route: r.route, style: styles[i] })));
  const table = buildTable(
    "Findings by lifecycle state",
    ["State", "Findings", "Action"],
    rows.map((r) => [
      badge("lc", r.key, r.label),
      String(r.count),
      r.route ? actionLink(ctx, r.route, "Show " + r.count, "Show " + r.count + " " + r.label + " findings") : "Not listed (resolved)",
    ])
  );
  const details = finishCard(parts.card, legend, "Show data table", table);
  const ax = axisColors();
  // One bar per state with a solid fill: each bar is named on the
  // category axis and in the legend, so colour is not the only cue, and small or
  // single-state data stays clearly visible (patterns made it look empty).
  const config = {
    type: "bar",
    data: {
      // Short axis label for Resolved; the legend and table keep the full wording.
      labels: rows.map((r) => (r.present ? r.label : "Resolved (not in total)")),
      datasets: [{
        label: "Findings",
        data: rows.map((r) => r.count),
        backgroundColor: styles.map((s) => s.color),
        borderColor: axisColors().fg,
        borderWidth: 1,
        barPercentage: 0.8,
        categoryPercentage: 0.85,
      }],
    },
    options: {
      // Horizontal bars keep the state names readable on narrow screens.
      indexAxis: "y",
      scales: {
        x: { beginAtZero: true, ticks: { color: ax.text, precision: 0 }, grid: { color: ax.grid }, title: { display: true, text: "Findings", color: ax.text } },
        y: { ticks: { color: ax.text, autoSkip: false }, grid: { display: false } },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: (item) => rows[item.dataIndex].label + ": " + rows[item.dataIndex].count },
        },
      },
    },
  };
  return mount(host, parts, details, config, {
    clickable: (e) => !!rows[e.index].route,
    click: (e) => {
      const r = rows[e.index];
      if (r.route) ctx.navigate(r.route);
    },
  });
}
