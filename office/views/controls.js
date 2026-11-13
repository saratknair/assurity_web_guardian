/**
 * Playback controls view.
 *
 * createControls(host, handlers, readAloudHost?) -> { update(model), dispose() }
 *
 * model: {
 *   hasRun: boolean,            // false disables everything
 *   playing: boolean,
 *   speed: number,              // one of SPEEDS (1, 2, 5, 10)
 *   t: number,                  // playback position in ms
 *   durationMs: number,
 *   currentStep: string|null,   // Step_Name (or event label) at t, for aria-valuetext
 *   pages: Array<{ url: string, label: string }>,  // pages in the timeline
 *   legacy: boolean,            // Legacy_Run: jump-to-page disabled with a note
 *   announce: boolean           // announce-steps checkbox state (default off)
 * }
 *
 * handlers: onPlay(), onPause(), onSpeed(s), onSeek(t), onPrev(), onNext(),
 *   onJumpPage(url), onResetView(), onAnnounceToggle(bool)
 *
 * No DOM access at import time. DOM is built with office/lib/dom.js only.
 */
import { el, setText, setChildren } from "../lib/dom.js";
import { formatClock } from "../lib/format.js";
import { SPEEDS } from "../lib/clock.js";

export const LEGACY_JUMP_NOTE = "Pages were not recorded for this run, so jump to page is unavailable.";

export const READ_ALOUD_LABEL = "Read steps aloud (screen reader)";

/** Pure: aria-valuetext for the scrubber, e.g. "00:12.3 of 01:35.0, step accessibility-scan". */
export function scrubberValueText(t, durationMs, step) {
  const base = formatClock(t) + " of " + formatClock(durationMs);
  return step ? base + ", step " + step : base;
}

/** Pure: label for the play/pause button. */
export function playButtonLabel(playing) {
  return playing ? "Pause" : "Play";
}

let uid = 0;

export function createControls(host, handlers, readAloudHost) {
  const h = handlers || {};
  const id = "ctl" + (uid++);
  const last = {};
  const cleanups = [];

  function on(node, type, fn) {
    node.addEventListener(type, fn);
    cleanups.push(function () { node.removeEventListener(type, fn); });
  }
  function call(name, arg) {
    if (typeof h[name] === "function") h[name](arg);
  }
  function changed(key, value) {
    if (last[key] === value) return false;
    last[key] = value;
    return true;
  }

  const playBtn = el("button", { type: "button", class: "btn btn--primary", text: "Play" });
  const prevBtn = el("button", { type: "button", class: "btn", text: "Previous event" });
  const nextBtn = el("button", { type: "button", class: "btn", text: "Next event" });
  const resetBtn = el("button", { type: "button", class: "btn", text: "Reset view" });

  const speedSel = el("select", { id: id + "-speed", class: "select" },
    SPEEDS.map(function (s) { return el("option", { value: String(s), text: s + "x" }); }));
  const speedField = el("div", { class: "row" }, [
    el("label", { for: id + "-speed", text: "Speed" }), speedSel,
  ]);

  const jumpSel = el("select", { id: id + "-jump", class: "select", "aria-describedby": id + "-jump-note" });
  const jumpNote = el("p", { id: id + "-jump-note", class: "muted" });
  const jumpField = el("div", { class: "row" }, [
    el("label", { for: id + "-jump", text: "Jump to page" }), jumpSel,
  ]);

  const announceBox = el("input", { type: "checkbox", id: id + "-announce" });
  const announceField = el("div", { class: "row" }, [
    announceBox, el("label", { for: id + "-announce", text: READ_ALOUD_LABEL }),
  ]);

  const scrubber = el("input", {
    type: "range", id: id + "-scrub", class: "field", min: "0", max: "0", step: "100", value: "0",
  });
  const scrubField = el("div", { class: "row" }, [
    el("label", { for: id + "-scrub", text: "Position" }), scrubber,
  ]);

  const toolbar = el("div", {
    role: "toolbar", "aria-label": "Playback", class: "playback-controls__bar",
  }, [playBtn, prevBtn, nextBtn, speedField, resetBtn]);

  // The read-aloud toggle lives beside the keyboard shortcuts help when a host is given.
  if (readAloudHost) {
    setChildren(host, [toolbar, scrubField, jumpField, jumpNote]);
    setChildren(readAloudHost, announceField);
  } else {
    setChildren(host, [toolbar, scrubField, jumpField, jumpNote, announceField]);
  }

  on(playBtn, "click", function () {
    call(last.playing ? "onPause" : "onPlay");
  });
  on(prevBtn, "click", function () { call("onPrev"); });
  on(nextBtn, "click", function () { call("onNext"); });
  on(resetBtn, "click", function () { call("onResetView"); });
  on(speedSel, "change", function () { call("onSpeed", Number(speedSel.value)); });
  on(scrubber, "input", function () { call("onSeek", Number(scrubber.value)); });
  on(jumpSel, "change", function () {
    const url = jumpSel.value;
    if (url) call("onJumpPage", url);
    jumpSel.value = "";
  });
  on(announceBox, "change", function () { call("onAnnounceToggle", !!announceBox.checked); });

  function update(model) {
    const m = model || {};
    const hasRun = !!m.hasRun;
    const playing = !!m.playing;
    const duration = typeof m.durationMs === "number" && m.durationMs > 0 ? m.durationMs : 0;
    const t = typeof m.t === "number" && m.t > 0 ? Math.min(m.t, duration) : 0;
    const legacy = !!m.legacy;
    const pages = Array.isArray(m.pages) ? m.pages : [];

    if (changed("playing", playing)) setText(playBtn, playButtonLabel(playing));
    const enabled = hasRun && duration > 0;
    if (changed("enabled", enabled)) {
      playBtn.disabled = prevBtn.disabled = nextBtn.disabled = scrubber.disabled = !enabled;
    }
    if (changed("hasRun", hasRun)) resetBtn.disabled = !hasRun;
    if (changed("speed", m.speed)) speedSel.value = String(m.speed);
    if (changed("announce", !!m.announce)) announceBox.checked = !!m.announce;

    if (changed("duration", duration)) scrubber.max = String(duration);
    if (changed("t", t)) scrubber.value = String(t);
    const vt = scrubberValueText(t, duration, m.currentStep || null);
    if (changed("vt", vt)) scrubber.setAttribute("aria-valuetext", vt);

    const pagesKey = pages.map(function (p) { return p.url + "\u0001" + p.label; }).join("\u0002");
    if (changed("pages", pagesKey)) {
      const opts = [el("option", { value: "", text: "Choose a page" })];
      for (let i = 0; i < pages.length; i++) {
        opts.push(el("option", { value: pages[i].url, text: pages[i].label || pages[i].url }));
      }
      setChildren(jumpSel, opts);
      jumpSel.value = "";
    }
    const jumpDisabled = !hasRun || legacy || pages.length === 0;
    if (changed("jumpDisabled", jumpDisabled)) jumpSel.disabled = jumpDisabled;
    if (changed("legacy", legacy)) setText(jumpNote, legacy ? LEGACY_JUMP_NOTE : "");
  }

  function dispose() {
    for (let i = 0; i < cleanups.length; i++) cleanups[i]();
    cleanups.length = 0;
    setChildren(host, null);
    if (readAloudHost) setChildren(readAloudHost, null);
  }

  update({});
  return { update: update, dispose: dispose };
}
