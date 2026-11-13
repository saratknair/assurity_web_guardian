// Virtual Office bootstrap, router and wiring. ASCII only, DOM built with lib/dom.js.
//
// Boot order (requirement 16.4):
//   1. shell + Transcript (and the other views, empty)
//   2. load index.json, choose a run, load events.json + run-findings.json in
//      parallel, build the timeline, render every text view
//   3. lazy import("./diorama/diorama.js"); any failure -> enterFallback(reason)
//
// Pure decisions (initial state from route + index, view models) live in
// lib/app-model.js and are unit tested. This file only touches the DOM.

import { el, setChildren, setText } from "./lib/dom.js";
import { createStore } from "./lib/store.js";
import { parseOfficeRoute, formatOfficeRoute } from "./lib/route.js";
import * as clock from "./lib/clock.js";
import { loadIndex, loadEvents, loadRunFindings } from "./lib/data.js";
import { buildTimeline, stateAt, countAt, nextStart, prevStart, firstEntryForPage } from "./lib/timeline.js";
import { STATIONS } from "./lib/stations.js";
import { formatClock } from "./lib/format.js";
import {
  initialState, resolveInitialState, clampToDuration, hasImagesFor, routeFromState,
  appKeyAction, fallbackMessage, announceDecision,
  buildControlsModel, buildRunPickerModel, buildStationsModel, buildNoticesModel, buildInspectorModel,
} from "./lib/app-model.js";
import { createControls } from "./views/controls.js";
import { createRunPicker } from "./views/run-picker.js";
import { createStationsList } from "./views/stations-list.js";
import { createTranscript } from "./views/transcript.js";
import { createNotices } from "./views/notices.js";
import { createTelemetryPanel } from "./views/telemetry-panel.js";
import { createSwimlane } from "./views/swimlane.js";
import { createInspector } from "./views/inspector.js";
import { createHelp } from "./views/help.js";

const URL_DEBOUNCE_MS = 250;
const ANNOUNCE_MIN_MS = 1500;

function byId(id) {
  return document.getElementById(id);
}

export function boot() {
  const store = createStore(initialState());
  const hosts = {
    notices: byId("office-notices"),
    picker: byId("run-picker"),
    controls: byId("playback-controls"),
    readAloud: byId("read-aloud-host"),
    diorama: byId("diorama-host"),
    help: byId("help-content"),
    stations: byId("stations-list"),
    transcript: byId("transcript"),
    telemetry: byId("telemetry-panel"),
    swimlane: byId("swimlane"),
    inspector: byId("inspector"),
    live: byId("office-live"),
  };

  // Assertive channel for per-view failures.
  const alertEl = el("div", { class: "sr-only", role: "alert", "aria-live": "assertive" });
  document.body.appendChild(alertEl);

  let diorama = null;      // api object once mounted
  let dioramaTried = false;
  let loadToken = 0;
  let urlTimer = null;
  let rafId = 0;
  let lastFrame = 0;
  let viewErrors = {};     // view name -> true after a throw (reset on run change)
  let lastAnnounceAt = 0;
  let lastAnnounceCount = -1;

  // ---- clock helpers -------------------------------------------------------
  function clockState() {
    const s = store.get();
    return { t: s.t, playing: s.playing, speed: s.speed, durationMs: s.timeline ? s.timeline.durationMs : 0 };
  }
  function applyClock(c) {
    store.set({ t: c.t, playing: c.playing, speed: c.speed });
  }
  function seekTo(t) {
    applyClock(clock.seek(clockState(), t));
  }

  // ---- selection -----------------------------------------------------------
  function selectStation(id) {
    store.set({ selection: { type: "station", id } });
    if (diorama) {
      try { diorama.focusStation(id); } catch (e) { reportViewError("diorama", e); }
    }
  }

  const handlers = {
    onPlay() { applyClock(clock.play(clockState())); },
    onPause() { applyClock(clock.pause(clockState())); },
    onSpeed(s) { applyClock(clock.setSpeed(clockState(), s)); },
    onSeek(t) { seekTo(t); },
    onPrev() {
      const tl = store.get().timeline;
      if (tl) seekTo(prevStart(tl, store.get().t));
    },
    onNext() {
      const tl = store.get().timeline;
      if (!tl) return;
      const n = nextStart(tl, store.get().t);
      if (n !== null) seekTo(n);
    },
    onJumpPage(url) {
      const tl = store.get().timeline;
      const e = tl ? firstEntryForPage(tl, url) : null;
      if (e) seekTo(e.startMs);
    },
    onResetView() {
      if (diorama) {
        try { diorama.resetView(); } catch (e) { reportViewError("diorama", e); }
      }
    },
    onAnnounceToggle(on) { store.set({ announce: !!on }); },
    onSelectRun(runId) { selectRun(runId, {}); },
    onSelectStation(id) { selectStation(id); const r = document.getElementById("diorama-region"); if (r && !store.get().fallback && typeof r.scrollIntoView === "function") r.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" }); },
    onSelectEntry(entryId) {
      const tl = store.get().timeline;
      if (!tl) return;
      for (let i = 0; i < tl.entries.length; i++) {
        if (tl.entries[i].id === entryId) {
          if (tl.entries[i].station) selectStation(tl.entries[i].station);
          return;
        }
      }
    },
    onImageError(slug, viewport) {
      const key = slug + "." + viewport;
      const cur = store.get().failedImages;
      if (cur.indexOf(key) === -1) store.set({ failedImages: cur.concat([key]) });
    },
  };

  // ---- views ---------------------------------------------------------------
  const viewDefs = [
    { name: "notices", host: hosts.notices, make: createNotices, model: buildNoticesModel },
    { name: "run picker", host: hosts.picker, make: createRunPicker, model: buildRunPickerModel },
    { name: "playback controls", host: hosts.controls, make: createControls, model: buildControlsModel, extra: hosts.readAloud },
    { name: "help", host: hosts.help, make: createHelp, model: () => ({}) },
    { name: "stations list", host: hosts.stations, make: createStationsList, model: buildStationsModel },
    { name: "transcript", host: hosts.transcript, make: createTranscript, model: (s) => ({ timeline: s.timeline, runId: s.runId, t: s.t }) },
    { name: "telemetry", host: hosts.telemetry, make: createTelemetryPanel, model: (s) => ({ timeline: s.timeline, t: s.t }) },
    { name: "swimlane", host: hosts.swimlane, make: createSwimlane, model: (s) => ({ timeline: s.timeline, t: s.t }) },
    { name: "inspector", host: hosts.inspector, make: createInspector, model: buildInspectorModel },
  ];
  // Views that need a timeline stay untouched until one exists.
  const needsTimeline = { "telemetry": true, "swimlane": true, "inspector": true };
  const views = viewDefs.map((d) => ({ def: d, inst: null }));

  function reportViewError(name, err) {
    const msg = "The " + name + " panel could not be shown." + (err && err.message ? " " + err.message : "");
    setText(alertEl, msg);
  }

  function renderView(v, s) {
    const d = v.def;
    if (!d.host) return;
    if (viewErrors[d.name]) return;
    if (needsTimeline[d.name] && !s.timeline) {
      return;
    }
    try {
      if (!v.inst) v.inst = d.make(d.host, handlers, d.extra);
      v.inst.update(d.model(s));
    } catch (err) {
      viewErrors[d.name] = true;
      try { if (v.inst) v.inst.dispose(); } catch (e2) { /* ignore */ }
      v.inst = null;
      try {
        setChildren(d.host, el("p", { class: "muted", role: "alert", text: "This panel could not be shown (" + d.name + ")." }));
      } catch (e3) { /* ignore */ }
      reportViewError(d.name, err);
    }
  }

  function renderDiorama(s) {
    if (!diorama || !s.timeline) return;
    try {
      diorama.update({
        snapshot: stateAt(s.timeline, s.t),
        scrubbed: !s.playing,
        runId: s.runId,
        hasImages: s.hasImages,
      });
    } catch (err) {
      reportViewError("diorama", err);
    }
  }

  function renderAll() {
    const s = store.get();
    for (let i = 0; i < views.length; i++) renderView(views[i], s);
    renderDiorama(s);
    syncFallbackControls();
    maybeAnnounce(s);
  }

  // Polite live region: written only while "Read steps aloud" is on, at most once per 1.5 s.
  function maybeAnnounce(s) {
    if (!hosts.live) return;
    const d = announceDecision(s, lastAnnounceCount, lastAnnounceAt, Date.now(), ANNOUNCE_MIN_MS);
    lastAnnounceCount = d.count;
    lastAnnounceAt = d.at;
    if (d.text) setText(hosts.live, formatClock(d.startMs) + ": " + d.text);
  }

  // In Fallback_Mode the camera reset has nothing to act on; keep it disabled and explained.
  function syncFallbackControls() {
    if (!store.get().fallback || !hosts.controls) return;
    const btns = hosts.controls.querySelectorAll("button");
    for (let i = 0; i < btns.length; i++) {
      if (btns[i].textContent === "Reset view") {
        btns[i].disabled = true;
        btns[i].setAttribute("title", "Not available because the 3D view is unavailable");
      }
    }
  }

  // ---- URL sync ------------------------------------------------------------
  function writeUrl() {
    urlTimer = null;
    const s = store.get();
    if (!s.runId) return;
    const hash = formatOfficeRoute(routeFromState(s));
    if (location.hash !== hash) {
      try { history.replaceState(null, "", hash); } catch (e) { /* ignore */ }
    }
  }
  function scheduleUrl() {
    if (urlTimer !== null) clearTimeout(urlTimer);
    urlTimer = setTimeout(writeUrl, URL_DEBOUNCE_MS);
  }

  // ---- playback loop -------------------------------------------------------
  function frame(ts) {
    rafId = 0;
    const s = store.get();
    if (!s.playing) return;
    const delta = lastFrame ? ts - lastFrame : 0;
    lastFrame = ts;
    applyClock(clock.advance(clockState(), delta));
    if (store.get().playing) rafId = requestAnimationFrame(frame);
  }
  function syncLoop() {
    const playing = store.get().playing;
    if (playing && !rafId) {
      lastFrame = 0;
      rafId = requestAnimationFrame(frame);
    } else if (!playing && rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  store.subscribe((s, prev) => {
    renderAll();
    syncLoop();
    const positionChanged = s.t !== prev.t && !s.playing;
    if (s.runId !== prev.runId || s.selection !== prev.selection || positionChanged || (prev.playing && !s.playing)) {
      scheduleUrl();
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && store.get().playing) applyClock(clock.pause(clockState()));
  });

  // ---- run loading ---------------------------------------------------------
  function failure(file, err) {
    const raw = err && err.message ? String(err.message) : "";
    const i = raw.indexOf(": ");
    return { file, message: i === -1 ? raw : raw.slice(i + 2) };
  }

  async function selectRun(runId, opts) {
    const o = opts || {};
    const token = ++loadToken;
    viewErrors = {};
    const index = store.get().index;
    store.set({
      runId, loading: true, timeline: null, runFindings: null, loadErrors: [],
      runNotFound: o.runNotFound || null, hasImages: hasImagesFor(index, runId),
      selection: null, t: 0, playing: false, failedImages: [],
    });
    if (!runId) {
      store.set({ loading: false });
      return;
    }
    const evFile = "runs/" + runId + "/events.json";
    const rfFile = "runs/" + runId + "/run-findings.json";
    const [ev, rf] = await Promise.allSettled([loadEvents(runId), loadRunFindings(runId)]);
    if (token !== loadToken) return; // a newer selection superseded this one
    const errors = [];
    if (ev.status === "rejected") errors.push(failure(evFile, ev.reason));
    if (rf.status === "rejected") errors.push(failure(rfFile, rf.reason));
    const tl = buildTimeline(ev.status === "fulfilled" ? ev.value : []);
    const t = clampToDuration(o.t || 0, tl);
    const station = o.station || null;
    store.set({
      timeline: tl,
      runFindings: rf.status === "fulfilled" ? rf.value : null,
      loadErrors: errors,
      loading: false,
      t,
      selection: station ? { type: "station", id: station } : null,
    });
    if (diorama) {
      try {
        diorama.setRun({ runId, hasImages: store.get().hasImages });
        if (station) diorama.focusStation(station);
      } catch (err) { reportViewError("diorama", err); }
    }
  }

  async function loadAndStart() {
    const route = parseOfficeRoute(location.hash);
    let index = null;
    const errors = [];
    try {
      index = await loadIndex();
    } catch (err) {
      errors.push(failure("index.json", err));
    }
    store.set({ index, loadErrors: errors });
    if (!index) {
      store.set({ loading: false });
      return;
    }
    const init = resolveInitialState(route, index);
    await selectRun(init.runId, { t: init.t, station: init.station, runNotFound: init.runNotFound });
  }

  function onHashChange() {
    const s = store.get();
    if (!s.index) return;
    const route = parseOfficeRoute(location.hash);
    const cur = routeFromState(s);
    if (formatOfficeRoute(route) === formatOfficeRoute(cur)) return;
    const init = resolveInitialState(route, s.index);
    if (init.runId !== s.runId || init.runNotFound) {
      selectRun(init.runId, { t: init.t, station: init.station, runNotFound: init.runNotFound });
      return;
    }
    store.set({
      t: clampToDuration(init.t, s.timeline),
      selection: init.station ? { type: "station", id: init.station } : null,
      playing: false,
    });
    if (init.station && diorama) {
      try { diorama.focusStation(init.station); } catch (e) { reportViewError("diorama", e); }
    }
  }
  window.addEventListener("hashchange", onHashChange);

  // ---- Diorama (lazy) and Fallback_Mode seam --------------------------------
  /**
   * Fallback_Mode. Called when WebGL is missing, the renderer throws, the dynamic
   * import fails, or the context is lost for good. Safe to call more than once.
   * Every non-3D view keeps working; only diorama-only affordances are turned off.
   */
  function enterFallback(reason) {
    const old = diorama;
    diorama = null;
    if (old) {
      try { old.dispose(); } catch (e) { /* ignore */ }
    }
    if (store.get().fallback) return; // already in Fallback_Mode, keep the first reason
    const msg = fallbackMessage(reason);
    try {
      if (hosts.diorama) {
        // The host is no longer an interactive group: it must not be a tab stop.
        ["tabindex", "role", "aria-label", "aria-describedby"].forEach((a) => hosts.diorama.removeAttribute(a));
        setChildren(hosts.diorama, el("div", { class: "muted", role: "status" }, [
          el("p", { text: msg.headline + " " + msg.reason }),
          el("p", { text: msg.detail }),
        ]));
      }
      const help = byId("diorama-help");
      if (help) help.hidden = true;
      const shortcuts = byId("shortcut-help");
      if (shortcuts) shortcuts.hidden = true;
    } catch (e) { /* the message is best effort; the other views must still work */ }
    store.set({ fallback: String(reason || "unknown") });
  }

  // Reduced_Motion: read live from the media query so a change applies immediately.
  let motionQuery = null;
  try {
    motionQuery = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  } catch (e) {
    motionQuery = null;
  }
  function reducedMotion() {
    return !!(motionQuery && motionQuery.matches);
  }
  if (motionQuery && typeof motionQuery.addEventListener === "function") {
    motionQuery.addEventListener("change", () => {
      if (diorama && typeof diorama.setReducedMotion === "function") {
        try { diorama.setReducedMotion(reducedMotion()); } catch (e) { /* ignore */ }
      }
    });
  }

  async function mountDiorama() {
    if (dioramaTried) return;
    dioramaTried = true;
    let mod;
    try {
      mod = await import("./diorama/diorama.js");
    } catch (err) {
      enterFallback("import-failed");
      return;
    }
    let api = null;
    try {
      api = await mod.createDiorama(hosts.diorama, {
        onSelectStation(id) { selectStation(id); },
        onFallback(reason) { enterFallback(reason); },
        reducedMotion,
      });
    } catch (err) {
      enterFallback("create-failed");
      return;
    }
    if (!api) {
      if (!store.get().fallback) enterFallback("unavailable");
      return;
    }
    diorama = api;
    const s = store.get();
    try {
      api.setRun({ runId: s.runId, hasImages: s.hasImages });
      if (s.selection && s.selection.type === "station") api.focusStation(s.selection.id);
    } catch (err) { reportViewError("diorama", err); }
    renderDiorama(s);
  }

  // Keyboard: shortcuts apply only while focus is inside the Diorama host.
  if (hosts.diorama) {
    hosts.diorama.addEventListener("keydown", (ev) => {
      if (ev.ctrlKey || ev.altKey || ev.metaKey) return;
      let handled = false;
      if (diorama) {
        try { handled = diorama.handleKey(ev) === true; } catch (e) { handled = false; }
      }
      if (!handled) {
        // Tab is never mapped, so focus can always leave the Diorama.
        const act = appKeyAction(ev.key, ev);
        if (act && act.type === "toggle-play") {
          if (store.get().playing) handlers.onPause(); else handlers.onPlay();
          handled = true;
        } else if (act && act.type === "prev") { handlers.onPrev(); handled = true; }
        else if (act && act.type === "next") { handlers.onNext(); handled = true; }
        else if (act && act.type === "escape") {
          const b = hosts.stations && hosts.stations.querySelector("button");
          if (b) b.focus();
          handled = true;
        } else if (act && act.type === "station") {
          const st = STATIONS[act.index];
          if (st) { selectStation(st.id); handled = true; }
        }
      }
      if (handled) ev.preventDefault();
    });
  }

  // ---- go ------------------------------------------------------------------
  renderAll(); // shell: picker, controls, stations list, help (no timeline yet)
  loadAndStart().then(mountDiorama, mountDiorama);

  return { store, handlers };
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
}
