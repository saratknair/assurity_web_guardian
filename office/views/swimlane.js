// Swimlane view: inline SVG, one lane per Station, one focusable bar per Timeline_Entry.
//
// Model passed to update(model):
//   { timeline: Replay_Timeline, t: number }   t = playback position in ms
// Handlers: onSeek(t) is called with the start of the activated entry;
//           onSelectEntry(entryId) is called with that entry's id.
//
// Bars are built once per timeline (identity of model.timeline). Later updates only move the
// marker and change the reached state of bars. Bars appear in the DOM, and so in the tab
// order, sorted by start time. Positions come only from the timeline:
// x = labelWidth + startMs / durationMs * plotWidth, with a minimum bar width of 2 px.
// The SVG has a fixed width and scrolls inside the host (no page horizontal scroll).
// No DOM access at import time.

import { setChildren, setText, el } from "../lib/dom.js";
import { STATIONS, stationName } from "../lib/stations.js";
import { formatClock, formatDuration, NOT_RECORDED } from "../lib/format.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const LABEL_W = 150;
const PLOT_W = 900;
const LANE_H = 34;
const BAR_H = 20;
const TOP = 6;
const MIN_BAR_W = 2;

const LANE_COLOURS = Object.freeze([
  "var(--accent)", "var(--accent-2)", "var(--lc-new)", "var(--serious)", "var(--lc-existing)", "var(--ok)",
]);

/** Accessible name of a bar: step, page, viewport, relative start time (plus duration). */
export function barLabel(e) {
  const start = "starts at " + formatClock(e.startMs);
  const d = e.endMs > e.startMs ? ", lasts " + formatDuration(e.endMs - e.startMs) : "";
  if (e.kind === "step") {
    const page = e.pageUrl || e.slug || "run-level, no page";
    const vp = e.viewport || "no viewport";
    return e.step + ", " + page + ", " + vp + ", " + start + d;
  }
  if (e.kind === "agent") {
    return (e.label || e.agent || "agent") + ", page " + NOT_RECORDED + ", viewport " + NOT_RECORDED + ", " + start + d;
  }
  return (e.label || e.kind) + ", " + start;
}

/**
 * Pure geometry model. Returns
 *   { width, height, labelW, plotW, durationMs, lanes:[{id,name,y,colour}],
 *     bars:[{id,x,w,y,h,station,startMs,endMs,label}] }
 * Bars are sorted by startMs then entry index (time order).
 */
export function swimlaneModel(tl) {
  const entries = tl && Array.isArray(tl.entries) ? tl.entries : [];
  const durationMs = tl && typeof tl.durationMs === "number" && tl.durationMs > 0 ? tl.durationMs : 0;
  const lanes = STATIONS.map((s, i) => ({
    id: s.id, name: stationName(s.id), y: TOP + i * LANE_H, colour: LANE_COLOURS[i % LANE_COLOURS.length],
  }));
  const laneIdx = Object.create(null);
  for (let i = 0; i < lanes.length; i++) laneIdx[lanes[i].id] = i;
  const bars = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const li = laneIdx[e.station];
    if (li === undefined) continue;
    const frac = durationMs > 0 ? Math.min(1, Math.max(0, e.startMs / durationMs)) : 0;
    const endFrac = durationMs > 0 ? Math.min(1, Math.max(0, e.endMs / durationMs)) : 0;
    let w = Math.max(MIN_BAR_W, (endFrac - frac) * PLOT_W);
    let x = LABEL_W + frac * PLOT_W;
    if (x + w > LABEL_W + PLOT_W) { x = Math.max(LABEL_W, LABEL_W + PLOT_W - w); }
    bars.push({
      id: e.id, x, w, y: lanes[li].y + (LANE_H - BAR_H) / 2 - 2, h: BAR_H, station: e.station,
      startMs: e.startMs, endMs: e.endMs, label: barLabel(e), order: i, colour: lanes[li].colour,
    });
  }
  bars.sort((a, b) => (a.startMs - b.startMs) || (a.order - b.order));
  return {
    width: LABEL_W + PLOT_W + 10, height: TOP * 2 + lanes.length * LANE_H, labelW: LABEL_W, plotW: PLOT_W,
    durationMs, lanes, bars,
  };
}

/** x position of the playback marker. */
export function markerX(model, t) {
  const d = model.durationMs;
  const f = d > 0 && typeof t === "number" && isFinite(t) ? Math.min(1, Math.max(0, t / d)) : 0;
  return model.labelW + f * model.plotW;
}

/** Reached state of a bar at t: "done", "active" or "future". */
export function barState(bar, t) {
  const p = typeof t === "number" && isFinite(t) ? t : 0;
  if (bar.endMs <= p && bar.startMs <= p) return "done";
  if (bar.startMs <= p) return "active";
  return "future";
}

function svg(tag, attrs) {
  const n = document.createElementNS(SVG_NS, tag);
  const keys = attrs ? Object.keys(attrs) : [];
  for (let i = 0; i < keys.length; i++) n.setAttribute(keys[i], String(attrs[keys[i]]));
  return n;
}

const OPACITY = { done: "1", active: "1", future: "0.45" };

export function createSwimlane(host, handlers) {
  const h = handlers || {};
  let builtFor = null;
  let model = null;
  let barNodes = [];
  let states = [];
  let marker = null;
  let notice = null;
  let lastMarker = null;
  let listeners = [];

  function activate(bar) {
    if (typeof h.onSeek === "function") h.onSeek(bar.startMs);
    if (typeof h.onSelectEntry === "function") h.onSelectEntry(bar.id);
  }

  function clearListeners() {
    for (let i = 0; i < listeners.length; i++) listeners[i][0].removeEventListener(listeners[i][1], listeners[i][2]);
    listeners = [];
  }

  function listen(node, type, fn) {
    node.addEventListener(type, fn);
    listeners.push([node, type, fn]);
  }

  function build(tl) {
    clearListeners();
    model = swimlaneModel(tl);
    const root = svg("svg", {
      width: model.width, height: model.height, viewBox: "0 0 " + model.width + " " + model.height,
      role: "group", "aria-label": "Swimlane timeline, one lane per Station. Bars are listed in time order.",
    });
    root.style.display = "block";
    root.style.maxWidth = "none";

    for (let i = 0; i < model.lanes.length; i++) {
      const lane = model.lanes[i];
      const band = svg("rect", { x: 0, y: lane.y, width: model.width, height: LANE_H, "aria-hidden": "true" });
      band.style.fill = i % 2 === 0 ? "var(--surface)" : "var(--surface-2)";
      root.appendChild(band);
      const label = svg("text", { x: 6, y: lane.y + LANE_H / 2 + 4, "aria-hidden": "true" });
      label.style.fill = "var(--text)";
      label.style.fontSize = "12px";
      label.style.fontFamily = "var(--font)";
      label.textContent = lane.name;
      root.appendChild(label);
    }

    barNodes = [];
    states = [];
    for (let i = 0; i < model.bars.length; i++) {
      const bar = model.bars[i];
      const g = svg("g", { role: "button", tabindex: "0", "aria-label": bar.label, "data-entry": bar.id });
      g.style.cursor = "pointer";
      g.style.outline = "none";
      const title = svg("title");
      title.textContent = bar.label;
      const rect = svg("rect", { x: bar.x, y: bar.y, width: bar.w, height: bar.h, rx: 3 });
      rect.style.fill = bar.colour;
      rect.style.stroke = "var(--border-strong)";
      rect.style.strokeWidth = "1";
      g.appendChild(title);
      g.appendChild(rect);
      listen(g, "click", () => activate(bar));
      listen(g, "keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " " || ev.key === "Spacebar") {
          ev.preventDefault();
          activate(bar);
        }
      });
      listen(g, "focus", () => { rect.style.stroke = "var(--focus)"; rect.style.strokeWidth = "3"; });
      listen(g, "blur", () => { rect.style.stroke = "var(--border-strong)"; rect.style.strokeWidth = "1"; });
      root.appendChild(g);
      barNodes.push(g);
      states.push("");
    }

    marker = svg("line", { x1: model.labelW, x2: model.labelW, y1: 0, y2: model.height, "aria-hidden": "true" });
    marker.style.stroke = "var(--text)";
    marker.style.strokeWidth = "2";
    marker.style.pointerEvents = "none";
    root.appendChild(marker);
    lastMarker = null;

    notice = el("p", { class: "swimlane__note" });
    const scroller = el("div", { class: "scroll-x" });
    scroller.appendChild(root);
    setChildren(host, [scroller, notice]);

    let msg = "";
    if (tl && tl.mode === "empty") msg = "No steps were recorded for this run, so the swimlane has no bars.";
    else if (tl && tl.mode === "coarse") {
      const nr = tl.notices && Array.isArray(tl.notices.notRecorded) ? tl.notices.notRecorded : [];
      msg = "This run recorded only coarse agent timings. Not recorded: " + (nr.length ? nr.join(", ") : "page, viewport and step") + ".";
    }
    setText(notice, msg);
    builtFor = tl;
  }

  function update(m) {
    const tl = m && m.timeline;
    if (tl !== builtFor || !model) build(tl);
    const t = m ? m.t : 0;
    const mx = markerX(model, t);
    if (mx !== lastMarker) {
      lastMarker = mx;
      marker.setAttribute("x1", String(mx));
      marker.setAttribute("x2", String(mx));
    }
    for (let i = 0; i < model.bars.length; i++) {
      const s = barState(model.bars[i], t);
      if (s === states[i]) continue;
      states[i] = s;
      barNodes[i].setAttribute("data-reached", s === "future" ? "false" : "true");
      barNodes[i].style.opacity = OPACITY[s];
    }
  }

  function dispose() {
    clearListeners();
    setChildren(host, null);
    builtFor = null;
    model = null;
    barNodes = [];
    states = [];
  }

  return { update, dispose };
}
