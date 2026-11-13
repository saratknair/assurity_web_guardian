// Inspector view (requirements 7.1-7.8, 11.1, 11.2, 13.1).
//
// createInspector(host, handlers) -> { update(model), dispose() }
//   host     : #inspector element.
//   handlers : { onImageError(slug, viewport) } called when a screenshot <img> fails.
//   model    : {
//     timeline : Timeline (lib/timeline.js),
//     t        : number, playback position in ms,
//     selection: { type: "station", id: StationId } | { type: "agent", id: string } | null,
//     run      : parsed run-findings.json or null,
//     index    : parsed data/index.json or null,
//     failedImages: string[]  // "<slug>.<viewport>" whose image failed to load
//   }
// buildInspectorModel(model) is the pure part (no DOM) and is unit tested.
// Content is re-rendered only when its signature changes; focus is never moved.

import { el, setChildren } from "../lib/dom.js";
import { STEP_AGENT, STEP_IS_TEMPLATE, TEMPLATE_LABEL, stationById } from "../lib/stations.js";
import { TEMPLATE_STATEMENT } from "../lib/honesty.js";
import { entriesAt, resultLines } from "../lib/timeline.js";
import { evidenceAt } from "../lib/evidence.js";
import { entryFindingLinks, entryLink, runLink } from "../lib/links.js";
import { formatDuration, formatClock, NOT_RECORDED } from "../lib/format.js";

export const EMPTY_TEXT = "Select a Station or an agent to see what it did so far.";

export const AGENT_DESCRIPTIONS = Object.freeze({
  Test_Generator: "Prepares the test plan for each page before the browser opens it.",
  Observation_Runner: "Opens each page in a real browser, reads the response, takes the screenshot, compares it with the baseline and runs the accessibility scan.",
  Comparator: "Turns the checks into outcomes by comparing them with the expected results.",
  Quality_Analysis_Agent: "Writes the quality notes for each page from fixed text templates.",
  Triage_Agent: "Writes the triage items for the findings from fixed text templates.",
  Lifecycle_Tracker: "Keeps the run history of new, recurring and resolved findings.",
  Decision_Recorder: "Applies the saved reviewer decisions to the findings.",
});

function agentSteps(name) {
  return Object.keys(STEP_AGENT).filter((s) => STEP_AGENT[s] === name);
}

/** Resolve the selection to { name, description, steps[], stationIds[] } or null. */
export function describeSelection(sel) {
  if (!sel || typeof sel.id !== "string") return null;
  if (sel.type === "station") {
    const st = stationById(sel.id);
    if (!st) return null;
    return { kind: "Station", name: st.name, description: st.description, steps: st.steps.slice(), stationId: st.id, agent: null };
  }
  if (sel.type === "agent") {
    const steps = agentSteps(sel.id);
    if (!steps.length) return null;
    return {
      kind: "Agent", name: sel.id.replace(/_/g, " "),
      description: AGENT_DESCRIPTIONS[sel.id] || NOT_RECORDED,
      steps, stationId: null, agent: sel.id,
    };
  }
  return null;
}

function belongs(entry, d) {
  if (d.stationId) return entry.station === d.stationId;
  return entry.agent === d.agent;
}

function pageText(e) {
  return e.pageUrl || e.slug || (e.kind === "agent" || e.kind === "step" ? "run level" : NOT_RECORDED);
}

/** Pure model builder. Never throws. */
export function buildInspectorModel(model) {
  const m = model && typeof model === "object" ? model : {};
  const tl = m.timeline;
  const d = describeSelection(m.selection);
  if (!d || !tl || !Array.isArray(tl.entries)) return { empty: true, text: EMPTY_TEXT };
  const t = typeof m.t === "number" && isFinite(m.t) ? m.t : 0;
  const runId = typeof tl.runId === "string" ? tl.runId : null;

  const templateSteps = d.steps.filter((s) => STEP_IS_TEMPLATE[s] === true);
  let templateText;
  if (templateSteps.length === 0) templateText = "No: these steps are not automated template steps.";
  else if (templateSteps.length === d.steps.length) templateText = "Yes: these are " + TEMPLATE_LABEL + "s. " + TEMPLATE_STATEMENT;
  else templateText = "Some: " + templateSteps.join(", ") + " are " + TEMPLATE_LABEL + "s. " + TEMPLATE_STATEMENT;

  const listed = entriesAt(tl, t).filter((e) => (e.kind === "step" || e.kind === "agent" || e.kind === "skip") && belongs(e, d));
  const rows = listed.map((e) => {
    const ended = e.open !== true && e.endMs <= t;
    const lines = ended ? resultLines(e) : [];
    return {
      ended,
      id: e.id,
      step: e.step || e.label || NOT_RECORDED,
      page: pageText(e),
      viewport: e.viewport || NOT_RECORDED,
      start: formatClock(e.startMs),
      duration: e.kind === "skip" ? NOT_RECORDED : (ended ? formatDuration(e.endMs - e.startMs) : "running"),
      result: !ended ? ["In progress"] : (lines.length ? lines : [NOT_RECORDED]),
      hasResult: !ended || lines.length > 0,
      pageLink: entryLink(runId, e),
      findings: entryFindingLinks(runId, e).map((f) => ({ key: f.key, ruleId: f.ruleId || f.key, link: f.link })),
    };
  });

  // Evidence for the most recent listed entry that has a page and viewport, per step type.
  const failed = Array.isArray(m.failedImages) ? m.failedImages : [];
  const evidence = { screenshot: null, a11y: null, visual: null, runId };
  const wants = { screenshot: "screenshot", a11y: "accessibility-scan", visual: "visual-compare" };
  Object.keys(wants).forEach((k) => {
    for (let i = listed.length - 1; i >= 0; i--) {
      const e = listed[i];
      if (e.step === wants[k] && e.slug && e.viewport) {
        const ev = evidenceAt(tl, t, m.run || null, m.index || null, { slug: e.slug, viewport: e.viewport, failedImages: failed });
        evidence[k] = ev[k];
        break;
      }
    }
  });
  const hasEvidence = !!(evidence.screenshot || evidence.a11y || evidence.visual);

  return {
    empty: false,
    kind: d.kind,
    name: d.name,
    description: d.description,
    templateText,
    isTemplate: templateSteps.length > 0,
    stepsText: d.steps.join(", "),
    rows,
    evidence: hasEvidence ? evidence : null,
    runLink: runLink(runId),
    runId,
    notice: tl.mode === "coarse" ? "Only coarse step order was recorded for this run; details are not recorded." : null,
  };
}

function link(href, label) {
  return el("a", { href, text: label });
}

function renderRow(r) {
  const result = r.hasResult ? r.result.map((ln) => el("div", { text: ln })) : [el("div", { text: NOT_RECORDED })];
  const links = [];
  if (r.pageLink) links.push(link(r.pageLink, "Dashboard view"));
  r.findings.forEach((f) => {
    if (f.link) links.push(link(f.link, "Finding " + f.ruleId));
    else links.push(el("span", { text: "Finding " + f.ruleId + " (no Dashboard view)" }));
  });
  const linkCell = links.length ? links.map((a, i) => (i ? [" ", a] : a)) : [NOT_RECORDED];
  return el("tr", null, [
    el("td", { text: r.start }),
    el("th", { scope: "row", text: r.step }),
    el("td", { text: r.page }),
    el("td", { text: r.viewport }),
    el("td", { text: r.duration }),
    el("td", null, result),
    el("td", null, linkCell),
  ]);
}

function renderEvidence(ev, handlers) {
  const parts = [el("h3", { text: "Evidence" })];
  const s = ev.screenshot;
  if (s) {
    if (s.imageSrc) {
      const img = el("img", { src: s.imageSrc, alt: s.caption, class: "evidence__img", loading: "lazy" });
      img.addEventListener("error", () => {
        if (handlers && typeof handlers.onImageError === "function") handlers.onImageError(s.slug, s.viewport);
      });
      const inner = s.link ? el("a", { href: s.link }, img) : img;
      parts.push(el("figure", { class: "evidence" }, [inner, el("figcaption", { text: s.caption })]));
    } else {
      parts.push(el("p", { class: "notice", role: "note", text: s.message || NOT_RECORDED }));
    }
    if (s.link) parts.push(el("p", null, link(s.link, "Open Visual comparison for " + s.slug + ", " + s.viewport)));
  }
  const v = ev.visual;
  if (v) {
    parts.push(el("p", null, [v.text + ". ", v.link ? link(v.link, "Open Visual comparison") : null]));
  }
  const a = ev.a11y;
  if (a) {
    if (a.rules.length) {
      parts.push(el("p", { text: "Accessibility rules for " + a.slug + ", " + a.viewport + ":" }));
      parts.push(el("ul", null, a.rules.map((r) => el("li", null, [
        r.link ? link(r.link, r.ruleId) : r.ruleId,
        " x" + r.count + (r.ignored ? " (ignored)" : "") + (r.severity ? ", " + r.severity : ""),
      ]))));
    }
    if (a.message) parts.push(el("p", { class: "notice", text: a.message.charAt(0).toUpperCase() + a.message.slice(1) + "." }));
  }
  return el("div", { class: "inspector__evidence" }, parts);
}

export function createInspector(host, handlers) {
  let lastSig = null;

  function update(model) {
    if (!host) return;
    const vm = buildInspectorModel(model);
    const sig = JSON.stringify(vm);
    if (sig === lastSig) return;
    lastSig = sig;
    if (vm.empty) {
      setChildren(host, el("p", { text: vm.text }));
      return;
    }
    const nodes = [
      el("h3", { text: vm.name + " (" + vm.kind + ")" }),
      el("p", { text: vm.description }),
      vm.isTemplate ? el("p", { text: vm.templateText }) : null,
      el("p", { text: "Steps: " + vm.stepsText }),
    ];
    if (vm.notice) nodes.push(el("p", { class: "notice", text: vm.notice }));
    if (vm.rows.length) {
      nodes.push(el("div", { class: "table-scroll", tabindex: "0", role: "region", "aria-label": "Entries handled so far" }, [
        el("table", null, [
          el("caption", { text: "Entries handled so far (" + vm.rows.length + ")" }),
          el("thead", null, el("tr", null, ["Start", "Step", "Page", "Viewport", "Duration", "Result", "Dashboard"].map(
            (h) => el("th", { scope: "col", text: h })))),
          el("tbody", null, vm.rows.map(renderRow)),
        ]),
      ]));
    } else {
      nodes.push(el("p", { text: "Nothing handled yet at this position." }));
    }
    if (vm.evidence) nodes.push(renderEvidence(vm.evidence, handlers));
    if (vm.runLink) nodes.push(el("p", null, link(vm.runLink, "Open this run in the Dashboard")));
    setChildren(host, nodes);
  }

  function dispose() {
    if (host) setChildren(host, []);
    lastSig = null;
  }

  return { update, dispose };
}
