// Assurity Web Guardian - shared DOM helpers for dashboard views.
// Plain browser ES module, ASCII-only. NOT a routed view.
//
// Every helper builds nodes with createElement / textContent only (never
// markup strings), so published strings cannot inject markup. Nothing here
// touches window/document at import time; the DOM helpers use `document`
// only when called, and the pure helpers (plural, formatDateTime,
// shortSeverityLabel, uniqueId) run under Node.
//
// Exports
//   el(tag, cls?, text?, attrs?)   create an element. attrs: { name: value };
//                                  null/undefined/false skip, true => "".
//   append(parent, ...children)    append nodes (null/undefined/strings ok;
//                                  strings become text nodes). Returns parent.
//   clear(node)                    remove all children.
//   link(text, href, cls?, attrs?) <a href> (href from ctx.formatRoute).
//   button(text, cls?, attrs?)     <button type="button">.
//   badge(sev)                     <span class="sev-badge sev-X"> with the
//                                  severity label as text (glyph via CSS).
//   lifecycleBadge(state)          <span class="lc-badge lc-X"> with label.
//   errorBanner(file, opts?)       <div class="error-panel" role="alert">
//                                  naming the failed data file. opts:
//                                  { detail, note, retry }. Shows the HTTP
//                                  status found in detail and a Retry button
//                                  (fires "awg:retry"; opts.retry === false
//                                  omits it).
//   sectionHeading(text, level?, cls?)  h2..h6 (default h3, class
//                                  "section-title"). Views render exactly one
//                                  h2 themselves; use level 3+ for sections.
//   kvList(entries, cls?)          <dl class="kv"> from [[key, value], ...];
//                                  value may be a string or a Node.
//   loading(text?)                 <p class="loading" role="status">.
//   plural(n, one, many)           "1 page" / "2 pages".
//   formatDateTime(iso)            "2026-10-26 08:00 UTC" or "Date not recorded".
//   shortSeverityLabel(sev)        short lowercase phrase for sentences.
//   uniqueId(prefix)               unique DOM id such as "kpi-def-3".

import { label as sevLabel } from "../lib/severity.js";
import { LIFECYCLE_LABELS } from "../lib/findings.js";

let idCounter = 0;

/** Unique id for aria-describedby / label wiring. */
export function uniqueId(prefix) {
  idCounter += 1;
  return String(prefix || "id") + "-" + idCounter;
}

export function plural(n, one, many) {
  return n + " " + (n === 1 ? one : many);
}

/** "2026-10-26T08:00:00.000Z" -> "2026-10-26 08:00 UTC". */
export function formatDateTime(iso) {
  if (typeof iso !== "string") return "Date not recorded";
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
  return m ? m[1] + " " + m[2] + " UTC" : "Date not recorded";
}

const SHORT = {
  critical: "critical",
  serious: "serious",
  moderate: "moderate",
  minor: "minor",
  unrated: "not rated",
  "not-recorded": "severity not recorded",
};

/** Short lowercase severity phrase for use inside sentences. */
export function shortSeverityLabel(sev) {
  return Object.prototype.hasOwnProperty.call(SHORT, sev) ? SHORT[sev] : SHORT["not-recorded"];
}

export function el(tag, cls, text, attrs) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = String(text);
  if (attrs && typeof attrs === "object") {
    for (const k of Object.keys(attrs)) {
      const v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      n.setAttribute(k, v === true ? "" : String(v));
    }
  }
  return n;
}

export function append(parent, ...children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    parent.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return parent;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function link(text, href, cls, attrs) {
  const a = el("a", cls, text, attrs);
  a.setAttribute("href", href);
  return a;
}

export function button(text, cls, attrs) {
  const b = el("button", cls, text, attrs);
  b.setAttribute("type", "button");
  return b;
}

/** Severity badge: colour + CSS glyph + the label as text (never colour alone). */
export function badge(sev) {
  const key = Object.prototype.hasOwnProperty.call(SHORT, sev) ? sev : "not-recorded";
  return el("span", "sev-badge sev-" + key, sevLabel(key));
}

export function lifecycleBadge(state) {
  const key = Object.prototype.hasOwnProperty.call(LIFECYCLE_LABELS, state) ? state : "not-recorded";
  return el("span", "lc-badge lc-" + key, LIFECYCLE_LABELS[key]);
}

/**
 * Error banner that names the data file that failed to load.
 * opts.detail: the underlying error message (shown when it adds information).
 * opts.note: extra sentence, for example which run is shown instead.
 */
export function errorBanner(file, opts) {
  const o = opts || {};
  const box = el("div", "error-panel", null, { role: "alert" });
  const name = String(file || "a data file");
  box.appendChild(el("p", "", "The data file " + name + " could not be loaded."));
  if (o.detail) box.appendChild(el("p", "", String(o.detail)));
  if (o.note) box.appendChild(el("p", "", String(o.note)));
  // HTTP status as its own line when the detail carries one (for example
  // "Could not load x.json: HTTP 404").
  const st = /HTTP (\d{3})/.exec(String(o.detail || ""));
  if (st) box.appendChild(el("p", "", "HTTP status: " + st[1]));
  // Retry: the shell listens for this event and re-renders the current route
  // (failed loader promises are evicted from the caches first).
  if (o.retry !== false) {
    const b = button("Retry", "btn", { "data-focus-key": "retry-load" });
    b.addEventListener("click", () => {
      document.dispatchEvent(new CustomEvent("awg:retry"));
    });
    box.appendChild(b);
  }
  return box;
}

export function sectionHeading(text, level, cls) {
  const lv = Math.min(6, Math.max(2, Number(level) || 3));
  return el("h" + lv, cls === undefined ? "section-title" : cls, text);
}

/** Definition list from [[key, value], ...]; value is a string or a Node. */
export function kvList(entries, cls) {
  const dl = el("dl", cls === undefined ? "kv" : cls);
  for (const pair of Array.isArray(entries) ? entries : []) {
    if (!Array.isArray(pair)) continue;
    dl.appendChild(el("dt", "", pair[0]));
    const dd = el("dd");
    const v = pair[1];
    if (v && typeof v === "object" && v.nodeType) dd.appendChild(v);
    else dd.textContent = v === undefined || v === null ? "" : String(v);
    dl.appendChild(dd);
  }
  return dl;
}

export function loading(text) {
  return el("p", "loading", text || "Loading...", { role: "status" });
}
