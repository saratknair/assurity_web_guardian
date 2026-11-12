// Telemetry panel: running totals and "where the time went", as HTML text (dl + tables).
//
// Model passed to update(model):
//   { timeline: Replay_Timeline, t: number }   t = playback position in ms
// Handlers: none used (the panel is read-only); accepted for the shared view convention.
//
// Every value derives from the timeline through office/lib/telemetry.js. A value the run did
// not record prints "not recorded". Share percentages are against total recorded step time
// for the whole run; time not attributed to any Station is shown separately as a duration.
// No DOM access at import time.

import { el, setText, setChildren } from "../lib/dom.js";
import { STATIONS, stationName } from "../lib/stations.js";
import { telemetryAt, stationShares } from "../lib/telemetry.js";
import { formatDuration, formatPercent, NOT_RECORDED } from "../lib/format.js";

function count(n) {
  return typeof n === "number" && isFinite(n) ? String(n) : NOT_RECORDED;
}

function dur(ms) {
  return typeof ms === "number" && isFinite(ms) ? formatDuration(ms) : NOT_RECORDED;
}

/**
 * Pure rows model for the panel.
 * Returns { summary:[{key,label,value}], stations:[{id,name,soFar,whole,share}],
 *           steps:[{step,count,soFar}], stepsNote, unattributed, mode }.
 */
export function telemetryRows(tl, t) {
  const m = telemetryAt(tl, t);
  const shares = stationShares(tl);
  const shareById = Object.create(null);
  for (let i = 0; i < shares.length; i++) shareById[shares[i].station] = shares[i];

  const f = m.findings;
  const pages = m.pagesCompleted === null || m.pagesTotal === null
    ? NOT_RECORDED
    : m.pagesCompleted + " of " + m.pagesTotal;
  const summary = [
    { key: "pages", label: "Pages completed", value: pages },
    { key: "skipped", label: "Pages skipped", value: count(m.pagesSkipped) },
    { key: "visual", label: "Visual differences so far", value: count(m.visualDifferences) },
    { key: "f-total", label: "Findings so far", value: f ? String(f.total) : NOT_RECORDED },
    { key: "f-critical", label: "Critical", value: f ? String(f.critical) : NOT_RECORDED },
    { key: "f-serious", label: "Serious", value: f ? String(f.serious) : NOT_RECORDED },
    { key: "f-moderate", label: "Moderate", value: f ? String(f.moderate) : NOT_RECORDED },
    { key: "f-minor", label: "Minor", value: f ? String(f.minor) : NOT_RECORDED },
    { key: "f-unrated", label: "Unrated", value: f ? String(f.unrated) : NOT_RECORDED },
    { key: "run", label: "Run duration", value: dur(m.runDurationMs) },
    { key: "recorded", label: "Recorded step time", value: dur(m.recordedStepMs) },
    { key: "unattributed", label: "Not attributed to any Station", value: dur(m.unattributedMs) },
  ];

  const soFar = Object.create(null);
  for (let i = 0; i < m.stationDurations.length; i++) soFar[m.stationDurations[i].station] = m.stationDurations[i].totalMs;
  const stations = STATIONS.map((s) => {
    const sh = shareById[s.id];
    return {
      id: s.id,
      name: stationName(s.id),
      soFar: m.mode === "empty" ? NOT_RECORDED : dur(soFar[s.id] || 0),
      whole: sh ? dur(sh.ms) : NOT_RECORDED,
      share: sh ? formatPercent(sh.percent) : NOT_RECORDED,
    };
  });

  const steps = m.stepDurations.map((s) => ({ step: s.step, count: String(s.count), soFar: dur(s.totalMs) }));
  let stepsNote = "";
  if (m.mode === "empty") stepsNote = "No steps recorded for this run.";
  else if (m.mode === "coarse") stepsNote = "Step durations: " + NOT_RECORDED + " for this run.";
  else if (steps.length === 0) stepsNote = "No step has finished yet at this position.";

  return { mode: m.mode, summary, stations, steps, stepsNote };
}

export function createTelemetryPanel(host, handlers) {
  void handlers;
  let built = false;
  const dd = Object.create(null); // summary key -> dd node
  const dt = Object.create(null);
  const stationCells = Object.create(null); // id -> [soFar, whole, share] nodes
  let stepsBody = null;
  let stepsNoteNode = null;
  let stepsSig = "";
  let titleNode = null;

  function build(rows) {
    const dl = el("dl", { class: "telemetry__list" });
    for (let i = 0; i < rows.summary.length; i++) {
      const r = rows.summary[i];
      dt[r.key] = el("dt", { text: r.label });
      dd[r.key] = el("dd", { text: r.value });
      dl.appendChild(el("div", { class: "telemetry__row" }, [dt[r.key], dd[r.key]]));
    }

    const stBody = el("tbody");
    for (let i = 0; i < rows.stations.length; i++) {
      const s = rows.stations[i];
      const a = el("td", { text: s.soFar });
      const b = el("td", { text: s.whole });
      const c = el("td", { text: s.share });
      stationCells[s.id] = [a, b, c];
      stBody.appendChild(el("tr", null, [el("th", { scope: "row", text: s.name }), a, b, c]));
    }
    const stationTable = el("table", { class: "telemetry__table" }, [
      el("caption", { text: "Where the time went, by Station. Shares are of the whole run's recorded step time." }),
      el("thead", null, el("tr", null, [
        el("th", { scope: "col", text: "Station" }),
        el("th", { scope: "col", text: "Time so far" }),
        el("th", { scope: "col", text: "Whole run" }),
        el("th", { scope: "col", text: "Share" }),
      ])),
      stBody,
    ]);

    stepsBody = el("tbody");
    stepsNoteNode = el("p", { class: "telemetry__note" });
    const stepTable = el("table", { class: "telemetry__table" }, [
      el("caption", { text: "Step durations so far" }),
      el("thead", null, el("tr", null, [
        el("th", { scope: "col", text: "Step" }),
        el("th", { scope: "col", text: "Count" }),
        el("th", { scope: "col", text: "Time so far" }),
      ])),
      stepsBody,
    ]);

    titleNode = el("p", { class: "telemetry__note" });
    setChildren(host, [
      titleNode, dl,
      el("div", { class: "scroll-x" }, stationTable),
      el("div", { class: "scroll-x" }, [stepTable, stepsNoteNode]),
    ]);
    built = true;
  }

  function sync(node, value) {
    if (node.textContent !== value) setText(node, value);
  }

  function update(model) {
    const rows = telemetryRows(model && model.timeline, model && model.t);
    if (!built) build(rows);
    sync(titleNode, rows.mode === "coarse"
      ? "This run recorded only coarse agent timings. Values it did not record read \"" + NOT_RECORDED + "\"."
      : rows.mode === "empty" ? "No telemetry was recorded for this run." : "");
    for (let i = 0; i < rows.summary.length; i++) sync(dd[rows.summary[i].key], rows.summary[i].value);
    for (let i = 0; i < rows.stations.length; i++) {
      const s = rows.stations[i];
      const c = stationCells[s.id];
      sync(c[0], s.soFar); sync(c[1], s.whole); sync(c[2], s.share);
    }
    const sig = rows.steps.map((s) => s.step + ":" + s.count + ":" + s.soFar).join("|");
    if (sig !== stepsSig) {
      stepsSig = sig;
      setChildren(stepsBody, rows.steps.map((s) => el("tr", null, [
        el("th", { scope: "row", text: s.step }), el("td", { text: s.count }), el("td", { text: s.soFar }),
      ])));
    }
    sync(stepsNoteNode, rows.stepsNote);
  }

  function dispose() {
    setChildren(host, null);
    built = false;
  }

  return { update, dispose };
}
