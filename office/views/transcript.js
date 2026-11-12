// Transcript view: ordered, plain-text list of every Timeline_Entry.
//
// createTranscript(host, handlers) -> { update(model), dispose() }
//   host: the #transcript container element.
//   handlers: { onSeek(t), onSelectEntry(entryId) }  (both optional)
//
// model (plain object):
//   {
//     timeline: Timeline from buildTimeline (null before a run is loaded),
//     runId:    string | null  (used to form Dashboard Deep_Links),
//     t:        number         (playback position in ms)
//   }
//
// The list is built once per timeline object. Later updates only toggle
// aria-current, data-reached, and the "not yet reached" suffix. Focus is never
// moved. The current entry is scrolled into view with behavior "auto" (never
// smooth) and only if the viewer has not scrolled the list away by hand.

import { el, setChildren, setText } from "../lib/dom.js";
import { countAt, resultLines } from "../lib/timeline.js";
import { entryFindingLinks, entryLink, runLink } from "../lib/links.js";
import { formatClock } from "../lib/format.js";
import { stationById, TEMPLATE_LABEL } from "../lib/stations.js";

/**
 * Pure row model for one entry. Only recorded values are included.
 * Returns { id, startMs, time, summary, lines, links: [{text, href}] }.
 */
export function rowModel(entry, runId) {
  const e = entry || {};
  const label = typeof e.label === "string" && e.label ? e.label : "";
  let summary;
  if (e.kind === "marker" || e.id === "run-finished") {
    // Run started / Run finished: not performed at any Station.
    summary = label || "Entry";
  } else if (e.kind === "skip") {
    summary = label || "Page skipped";
  } else {
    const who = [];
    if (e.agent) who.push(String(e.agent));
    if (e.station) {
      const st = stationById(e.station);
      who.push("at " + (st ? st.name : String(e.station)));
    }
    const what = [];
    if (e.step) what.push(String(e.step));
    if (e.pageUrl) what.push("on " + e.pageUrl);
    if (e.viewport) what.push("(" + e.viewport + ")");
    summary = who.join(" ");
    if (what.length) summary += (summary ? ": " : "") + what.join(" ");
    if (!summary) summary = label || "Entry";
    if (e.template === true) summary += " (" + TEMPLATE_LABEL + ")";
  }

  const links = [];
  const fl = entryFindingLinks(runId, e);
  for (let i = 0; i < fl.length; i++) {
    if (fl[i].link) links.push({ text: "Finding " + (fl[i].ruleId || ""), href: fl[i].link });
  }
  const pl = entryLink(runId, e);
  if (pl) links.push({ text: e.step === "visual-compare" ? "Visual comparison" : "Page in Dashboard", href: pl });

  return {
    id: e.id,
    startMs: typeof e.startMs === "number" ? e.startMs : 0,
    time: formatClock(e.startMs),
    summary,
    lines: resultLines(e),
    links,
  };
}

/** Index of the current entry (latest reached) or -1 when none is reached. */
export function currentIndex(tl, t) {
  if (!tl || !Array.isArray(tl.entries)) return -1;
  return countAt(tl, t) - 1;
}

export function createTranscript(host, handlers) {
  const h = handlers || {};
  let builtFor = null;
  let builtRunId = null;
  let items = []; // { li, button, suffix, entry }
  let lastCurrent = -2;
  let lastReached = -2;
  let userScrolled = false;
  let seeking = false;

  const onUserScroll = () => {
    userScrolled = true;
  };
  host.addEventListener("wheel", onUserScroll, { passive: true });
  host.addEventListener("touchmove", onUserScroll, { passive: true });

  function build(tl, runId) {
    items = [];
    const entries = tl && Array.isArray(tl.entries) ? tl.entries : [];
    const kids = [];
    if (runId && runLink(runId)) {
      kids.push(el("p", { class: "transcript__run" }, [el("a", { href: runLink(runId), text: "Open this run in the Dashboard" })]));
    }
    const nr = tl && tl.notices && Array.isArray(tl.notices.notRecorded) ? tl.notices.notRecorded : [];
    if (nr.length) {
      kids.push(
        el("p", { class: "transcript__notice", role: "note" }, [
          "Not recorded for this run: " + nr.join(", ") + ". Only coarse agent timing is available.",
        ])
      );
    }
    if (!entries.length) {
      kids.push(el("p", { class: "transcript__empty", text: "No steps to show." }));
    } else {
      const lis = [];
      for (let i = 0; i < entries.length; i++) {
        const row = rowModel(entries[i], runId);
        const button = el("button", { type: "button", class: "transcript__entry" }, [
          el("span", { class: "transcript__time", text: row.time }),
          " ",
          el("span", { class: "transcript__summary", text: row.summary }),
        ]);
        const suffix = el("span", { class: "sr-only", text: "" });
        button.appendChild(suffix);
        const idx = i;
        button.addEventListener("click", () => {
          seeking = true;
          userScrolled = false;
          if (h.onSelectEntry) h.onSelectEntry(entries[idx].id);
          if (h.onSeek) h.onSeek(row.startMs);
        });
        const extra = [];
        if (row.lines.length) {
          extra.push(el("span", { class: "transcript__result" }, row.lines.join("; ")));
        }
        for (let k = 0; k < row.links.length; k++) {
          extra.push(" ");
          extra.push(el("a", { class: "transcript__link", href: row.links[k].href, text: row.links[k].text }));
        }
        const li = el("li", { class: "transcript__item", "data-reached": "false" }, [button, extra.length ? el("div", { class: "transcript__extra" }, extra) : null]);
        lis.push(li);
        items.push({ li, button, suffix });
      }
      kids.push(el("ol", { class: "transcript__list", "aria-label": "Run transcript" }, lis));
    }
    setChildren(host, kids);
    builtFor = tl;
    builtRunId = runId;
    lastCurrent = -2;
    lastReached = -2;
  }

  function update(model) {
    const m = model || {};
    const tl = m.timeline || null;
    const runId = m.runId || null;
    if (tl !== builtFor || runId !== builtRunId) build(tl, runId);
    if (!tl) return;
    const reached = countAt(tl, m.t);
    const cur = reached - 1;
    if (reached === lastReached && cur === lastCurrent) return;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const isReached = i < reached;
      it.li.setAttribute("data-reached", isReached ? "true" : "false");
      it.li.className = "transcript__item" + (isReached ? "" : " transcript__item--pending");
      setText(it.suffix, isReached ? "" : " (not yet reached)");
      if (i === cur) it.button.setAttribute("aria-current", "step");
      else it.button.removeAttribute("aria-current");
    }
    const changed = cur !== lastCurrent;
    lastReached = reached;
    lastCurrent = cur;
    if (changed && cur >= 0 && items[cur]) {
      if (seeking) {
        userScrolled = false;
        seeking = false;
      }
      if (!userScrolled && typeof host.getBoundingClientRect === "function") {
        /* Scroll only inside the Transcript box; never move the page. */ const hr = host.getBoundingClientRect(); const lr = items[cur].li.getBoundingClientRect(); if (lr.top < hr.top) host.scrollTop += lr.top - hr.top; else if (lr.bottom > hr.bottom) host.scrollTop += lr.bottom - hr.bottom;
      }
    }
  }

  function dispose() {
    host.removeEventListener("wheel", onUserScroll);
    host.removeEventListener("touchmove", onUserScroll);
    setChildren(host, null);
    items = [];
    builtFor = null;
  }

  return { update, dispose };
}
