// Pure helpers for office/app.js. No DOM, no window access, never throws.
// Kept separate so vitest can import them under Node.

import { clampT, countAt, stateAt } from "./timeline.js";
import { eventTotals, reconcile } from "./telemetry.js";
import { isStationId } from "./stations.js";

function isObj(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Run_Index entries, newest first (by finishedAt when present, else index order). */
export function sortedRuns(index) {
  const runs = isObj(index) && Array.isArray(index.runs) ? index.runs.filter((r) => isObj(r) && typeof r.runId === "string" && r.runId) : [];
  const keyed = runs.map((r, i) => ({ r, i, k: typeof r.finishedAt === "string" ? r.finishedAt : "" }));
  keyed.sort((a, b) => (a.k === b.k ? a.i - b.i : a.k < b.k ? 1 : -1));
  return keyed.map((x) => x.r);
}

/**
 * Resolve the first state from a parsed route and the index.
 * Returns { runId, runNotFound, t, station }.
 *  - no route run id: newest run
 *  - route run id not in the index: runNotFound = that id, newest run
 *  - t is carried as parsed; clamp it with clampToDuration once the run loads
 */
export function resolveInitialState(route, index) {
  const r = isObj(route) ? route : {};
  const runs = sortedRuns(index);
  const newest = runs.length ? runs[0].runId : null;
  let runId = newest;
  let runNotFound = null;
  let t = typeof r.t === "number" && Number.isFinite(r.t) && r.t > 0 ? Math.floor(r.t) : 0;
  const station = isStationId(r.station) ? r.station : null;
  if (typeof r.runId === "string" && r.runId) {
    if (runs.some((x) => x.runId === r.runId)) runId = r.runId;
    else { runNotFound = r.runId; t = 0; }
  }
  return { runId, runNotFound, t, station: runNotFound ? null : station };
}

/** Clamp a position to the loaded timeline duration. */
export function clampToDuration(t, tl) {
  return tl && typeof tl.durationMs === "number" ? clampT(tl, t) : 0;
}

export function hasImagesFor(index, runId) {
  const runs = sortedRuns(index);
  for (let i = 0; i < runs.length; i++) if (runs[i].runId === runId) return runs[i].hasImages === true;
  return false;
}

/** Route object for formatOfficeRoute from the store state. */
export function routeFromState(s) {
  const sel = s && s.selection;
  return {
    runId: s && s.runId ? s.runId : null,
    t: s && typeof s.t === "number" ? Math.floor(s.t) : 0,
    station: sel && sel.type === "station" && isStationId(sel.id) ? sel.id : null,
  };
}

/** Step name (or label) of the latest entry reached at t, or null. */
export function currentStepAt(tl, t) {
  try {
    const n = countAt(tl, t);
    if (n <= 0) return null;
    const e = tl.entries[n - 1];
    return e.step || e.label || null;
  } catch (e) {
    return null;
  }
}

export function buildControlsModel(s) {
  const tl = s && s.timeline;
  const has = !!tl && tl.mode !== "empty" && tl.entries.length > 0;
  const pages = has && Array.isArray(tl.pages) ? tl.pages.map((p) => ({ url: p.url, label: p.slug || p.url })) : [];
  return {
    hasRun: has,
    playing: !!(s && s.playing),
    speed: s ? s.speed : 1,
    t: s && typeof s.t === "number" ? s.t : 0,
    durationMs: has ? tl.durationMs : 0,
    currentStep: has ? currentStepAt(tl, s.t) : null,
    pages,
    legacy: !!tl && tl.mode === "coarse",
    announce: !!(s && s.announce),
  };
}

export function buildRunPickerModel(s) {
  const runs = sortedRuns(s && s.index).map((r) => ({ runId: r.runId, finishedAt: r.finishedAt, health: r.health }));
  return { runs, selectedRunId: s && s.runId ? s.runId : null, loading: !!(s && s.loading) };
}

export function buildStationsModel(s) {
  const tl = s && s.timeline;
  let activeIds = [];
  if (tl && tl.mode !== "empty") {
    const snap = stateAt(tl, s.t);
    activeIds = snap.figures.filter((f) => f.working).map((f) => f.station);
  }
  const sel = s && s.selection;
  return { selectedId: sel && sel.type === "station" ? sel.id : null, activeIds };
}

export function buildConsistency(tl, runFindings) {
  try {
    if (!tl || tl.mode === "empty") return null;
    return reconcile(eventTotals(tl), runFindings);
  } catch (e) {
    return null;
  }
}

export function buildNoticesModel(s) {
  return {
    timeline: s.timeline || null,
    loadErrors: s.loadErrors || [],
    runNotFound: s.runNotFound || null,
    consistency: s.timeline && s.runFindings ? buildConsistency(s.timeline, s.runFindings) : null,
  };
}

export function buildInspectorModel(s) {
  return {
    timeline: s.timeline,
    t: s.t,
    selection: s.selection,
    run: s.runFindings || null,
    index: s.index || null,
    failedImages: s.failedImages || [],
  };
}

/** Initial store state. */
export function initialState() {
  return {
    index: null, runId: null, timeline: null, runFindings: null,
    t: 0, playing: false, speed: 1, selection: null, announce: false,
    loadErrors: [], runNotFound: null, hasImages: false, failedImages: [],
    loading: true, fallback: null,
  };
}

/**
 * Diorama-scoped keys that app.js handles itself (camera keys go to the Diorama).
 * Returns { type: "toggle-play" | "prev" | "next" | "escape" | "station", index? } or null.
 * Tab is never mapped, so focus is never trapped.
 */
export function appKeyAction(key, mods) {
  const m = mods || {};
  if (m.ctrlKey || m.altKey || m.metaKey) return null;
  if (key === " " || key === "Spacebar") return { type: "toggle-play" };
  if (key === ",") return { type: "prev" };
  if (key === ".") return { type: "next" };
  if (key === "Escape") return { type: "escape" };
  if (typeof key === "string" && /^[1-6]$/.test(key) && !m.shiftKey) return { type: "station", index: Number(key) - 1 };
  return null;
}

const FALLBACK_REASONS = {
  "no-webgl": "WebGL is not available in this browser.",
  "context-lost": "The graphics context was lost and did not recover.",
  "import-failed": "The 3D files (office/diorama/diorama.js) could not be loaded.",
  "setup-failed": "The 3D renderer could not start.",
  "create-failed": "The 3D renderer could not start.",
  "unavailable": "The 3D renderer could not start.",
};

/** Fallback_Mode message pieces. Never throws. */
export function fallbackMessage(reason) {
  const key = typeof reason === "string" ? reason : "";
  const why = Object.prototype.hasOwnProperty.call(FALLBACK_REASONS, key) ? FALLBACK_REASONS[key] : "The 3D renderer could not start.";
  return {
    headline: "The 3D view is unavailable in this browser.",
    reason: why,
    detail: "All the same information is in the Stations list, Transcript, Telemetry, Swimlane, and Inspector.",
  };
}

/** Text for the polite live region, or null when nothing should be said. */
export function announceDecision(state, lastCount, lastAt, now, minMs) {
  if (!state || !state.announce || !state.timeline) return { text: null, count: lastCount, at: lastAt };
  const n = countAt(state.timeline, state.t);
  if (n === lastCount) return { text: null, count: lastCount, at: lastAt };
  if (now - lastAt < minMs) return { text: null, count: lastCount, at: lastAt };
  if (n <= 0) return { text: null, count: n, at: now };
  const e = state.timeline.entries[n - 1];
  return { text: (e.label || e.step || "step"), startMs: e.startMs, count: n, at: now };
}
