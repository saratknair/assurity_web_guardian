// Notices view: everything the viewer should know about the data they see.
//
// createNotices(host, handlers) -> { update(model), dispose() }
//   host: the #office-notices container element.
//   handlers: unused (accepted for the shared view convention).
//
// model (plain object):
//   {
//     timeline:    Timeline from buildTimeline | null,
//     loadErrors:  [{ file: string, message?: string }]  files that failed to load,
//     runNotFound: string | null   run id from a deep link that is not in the index,
//     consistency: { status: "match"|"explained"|"differs"|"unavailable",
//                    message: string, reasons?: string[] } | null   (telemetry.reconcile)
//   }
//
// Output is rebuilt only when the rendered notice list changes (compared by
// a text signature), so frequent updates are cheap. Load errors and "differs"
// consistency use role="alert"; the rest use role="note"/"status".

import { el, setChildren } from "../lib/dom.js";

/**
 * Pure notice list model.
 * Returns [{ id, level: "error"|"warn"|"info", text, items?: string[] }].
 * `items` is a list of detail lines (shown collapsed for skipped events).
 */
export function noticeItems(model) {
  const m = model || {};
  const out = [];
  const errs = Array.isArray(m.loadErrors) ? m.loadErrors : [];
  for (let i = 0; i < errs.length; i++) {
    const e = errs[i] || {};
    const file = typeof e.file === "string" && e.file ? e.file : "an unknown file";
    out.push({
      id: "load-" + i,
      level: "error",
      text: "Could not load " + file + "." + (e.message ? " " + e.message : ""),
    });
  }
  if (typeof m.runNotFound === "string" && m.runNotFound) {
    out.push({
      id: "run-not-found",
      level: "warn",
      text: "Run " + m.runNotFound + " was not found, so the newest run is shown.",
    });
  }

  const n = m.timeline && m.timeline.notices ? m.timeline.notices : null;
  if (n) {
    if (n.empty) out.push({ id: "empty", level: "info", text: String(n.empty) });
    if (n.unsupported) out.push({ id: "unsupported", level: "warn", text: String(n.unsupported) });
    if (Array.isArray(n.notRecorded) && n.notRecorded.length) {
      out.push({
        id: "not-recorded",
        level: "info",
        text: "This run was recorded before step detail was captured. Not recorded: " + n.notRecorded.join(", ") + ".",
      });
    }
    if (n.truncated && typeof n.truncated === "object") {
      const keys = Object.keys(n.truncated);
      const details = [];
      for (let i = 0; i < keys.length; i++) {
        const v = n.truncated[keys[i]];
        if (v === null || typeof v === "object") continue;
        details.push(keys[i] + ": " + String(v));
      }
      out.push({
        id: "truncated",
        level: "warn",
        text: "Some detail was left out to keep the file small.",
        items: details.length ? details : undefined,
      });
    }
    if (Array.isArray(n.skipped) && n.skipped.length) {
      out.push({
        id: "skipped",
        level: "info",
        text: "Skipped events (" + n.skipped.length + ")",
        items: n.skipped.map(String),
        collapsed: true,
      });
    }
  }

  const c = m.consistency;
  if (c && typeof c === "object" && c.status !== "match") {
    let text = typeof c.message === "string" && c.message ? c.message : "";
    // A reason already quoted in the message is not repeated as a list item.
    const reasons = (Array.isArray(c.reasons) ? c.reasons.map(String) : []).filter((r) => r && r !== text && !text.endsWith(": " + r));
    if (c.status === "unavailable" && !text) text = "The consistency check could not be performed.";
    if (c.status === "differs" && !text) text = "The totals differ and the reason could not be determined.";
    if (text) {
      out.push({
        id: "consistency",
        level: c.status === "differs" ? "warn" : "info",
        text,
        items: reasons.length ? reasons : undefined,
        alert: c.status === "differs",
      });
    }
  }
  return out;
}

function signature(list) {
  return JSON.stringify(list);
}

function render(list) {
  const nodes = [];
  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    const cls = (it.level === "error" ? "error-panel" : "notice") + " notice--" + it.level;
    const role = it.level === "error" || it.alert ? "alert" : "note";
    let node;
    if (it.collapsed && it.items) {
      node = el("details", { class: cls }, [
        el("summary", { text: it.text }),
        el("ul", null, it.items.map((s) => el("li", { text: s }))),
      ]);
    } else {
      const kids = [el("span", { text: it.text })];
      if (it.items) kids.push(el("ul", null, it.items.map((s) => el("li", { text: s }))));
      node = el("div", { class: cls, role }, kids);
    }
    nodes.push(node);
  }
  return nodes;
}

export function createNotices(host, _handlers) {
  let lastSig = null;

  function update(model) {
    const list = noticeItems(model);
    const sig = signature(list);
    if (sig === lastSig) return;
    lastSig = sig;
    setChildren(host, render(list));
  }

  function dispose() {
    setChildren(host, null);
    lastSig = null;
  }

  return { update, dispose };
}
