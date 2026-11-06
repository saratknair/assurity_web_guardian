// Hash router: parseRoute / formatRoute / normalizeRoute.
// Pure functions. No window/document access at import time.
//
// Route object:
//   { view, runId?, slug?, findingId?, viewport?, params }
// view: "overview" | "run" | "findings" | "page" | "finding" | "visual"
//
// Canonical hashes:
//   #/                                   overview
//   #/run/<runId>                        run view
//   #/findings                           filtered findings
//   #/page/<slug>                        page detail
//   #/finding/<runId>/<findingId>        finding detail
//   #/visual/<runId>/<slug>/<viewport>   visual comparison
// Query params (fixed order): run,q,sev,state,has,sort,dir,group,rule,page,scope
//
// Invariants: formatRoute(parseRoute(h)) is the canonical form of h, and
// parseRoute(formatRoute(r)) deep-equals normalizeRoute(r).

import { SEVERITY_ORDER } from "./severity.js";

export const VIEWS = Object.freeze(["overview", "run", "findings", "page", "finding", "visual"]);
export const PARAM_ORDER = Object.freeze([
  "run", "q", "sev", "state", "has", "sort", "dir", "group", "rule", "page", "scope",
]);

const STATES = ["new", "recurring", "existing-unresolved", "regression", "resolved", "not-recorded"];
const VIEWPORTS = ["desktop", "mobile"];
const DEFAULT_SCOPE = "active";

const PARAM_KIND = {
  run: "string",
  q: "string",
  page: "string",
  sev: "list",
  state: "list",
  group: "list",
  rule: "list",
  has: "enum",
  sort: "enum",
  dir: "enum",
  scope: "enum",
};

const ENUMS = {
  has: ["yes", "no"],
  sort: ["url", "count", "severity"],
  dir: ["asc", "desc"],
  scope: ["active", "ignored"],
};

// List params restricted to a known vocabulary; others (group, rule) are free text.
const LIST_ENUMS = { sev: SEVERITY_ORDER, state: STATES };

function has(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch (e) {
    return null;
  }
}

function cleanString(v) {
  return typeof v === "string" ? v.trim() : "";
}

function cleanList(value, allowed) {
  let items;
  if (Array.isArray(value)) items = value;
  else if (typeof value === "string") items = value.split(",");
  else return [];
  const out = new Set();
  for (const raw of items) {
    if (typeof raw !== "string") continue;
    const s = raw.trim();
    if (!s) continue;
    if (allowed && !allowed.includes(s)) continue;
    out.add(s);
  }
  return Array.from(out).sort();
}

function cleanParams(input) {
  const src = input && typeof input === "object" ? input : {};
  const out = {};
  for (const key of PARAM_ORDER) {
    if (!has(src, key)) continue;
    const v = src[key];
    const kind = PARAM_KIND[key];
    if (kind === "string") {
      const s = cleanString(v);
      if (s) out[key] = s;
    } else if (kind === "list") {
      const list = cleanList(v, LIST_ENUMS[key]);
      if (list.length) out[key] = list;
    } else if (typeof v === "string" && ENUMS[key].includes(v)) {
      out[key] = v;
    }
  }
  out.scope = out.scope || DEFAULT_SCOPE;
  return out;
}

/** Return the canonical form of a route-like object. Never throws. */
export function normalizeRoute(route) {
  const r = route && typeof route === "object" ? route : {};
  let view = typeof r.view === "string" && VIEWS.includes(r.view) ? r.view : "overview";
  const runId = cleanString(r.runId);
  const slug = cleanString(r.slug);
  const findingId = cleanString(r.findingId);
  const viewport = VIEWPORTS.includes(r.viewport) ? r.viewport : "";

  // Routes missing required path segments fall back to the Overview.
  if (view === "run" && !runId) view = "overview";
  if (view === "page" && !slug) view = "overview";
  if (view === "finding" && !(runId && findingId)) view = "overview";
  if (view === "visual" && !(runId && slug && viewport)) view = "overview";

  const out = { view };
  if (view === "run" || view === "finding" || view === "visual") out.runId = runId;
  if (view === "page" || view === "visual") out.slug = slug;
  if (view === "finding") out.findingId = findingId;
  if (view === "visual") out.viewport = viewport;
  out.params = cleanParams(r.params);
  return out;
}

function parseQuery(query) {
  const raw = {};
  if (!query) return raw;
  for (const pair of query.split("&")) {
    if (!pair) continue;
    const ei = pair.indexOf("=");
    const k = safeDecode(ei === -1 ? pair : pair.slice(0, ei));
    const vRaw = ei === -1 ? "" : pair.slice(ei + 1);
    if (k === null || !has(PARAM_KIND, k) || has(raw, k)) continue; // unknown ignored; first wins
    if (PARAM_KIND[k] === "list") {
      // Split before decoding so an encoded comma stays inside one value.
      const items = [];
      for (const part of vRaw.split(",")) {
        const d = safeDecode(part);
        if (d !== null) items.push(d);
      }
      raw[k] = items;
    } else {
      const d = safeDecode(vRaw);
      if (d !== null) raw[k] = d;
    }
  }
  return raw;
}

/** Parse a location hash (with or without leading "#") into a normalized route. */
export function parseRoute(hash) {
  let h = typeof hash === "string" ? hash : "";
  if (h.charAt(0) === "#") h = h.slice(1);
  const qi = h.indexOf("?");
  const path = qi === -1 ? h : h.slice(0, qi);
  const query = qi === -1 ? "" : h.slice(qi + 1);

  const seg = path
    .split("/")
    .filter((s) => s !== "")
    .map((s) => {
      const d = safeDecode(s);
      return d === null ? "" : d;
    });

  const route = { view: "overview", params: parseQuery(query) };
  switch (seg[0]) {
    case "run":
      route.view = "run";
      route.runId = seg[1] || "";
      break;
    case "findings":
      route.view = "findings";
      break;
    case "page":
      route.view = "page";
      route.slug = seg[1] || "";
      break;
    case "finding":
      route.view = "finding";
      route.runId = seg[1] || "";
      route.findingId = seg[2] || "";
      break;
    case "visual":
      route.view = "visual";
      route.runId = seg[1] || "";
      route.slug = seg[2] || "";
      route.viewport = seg[3] || "";
      break;
    default:
      break;
  }
  return normalizeRoute(route);
}

/** Format a route as its canonical hash string (always begins with "#/"). */
export function formatRoute(route) {
  const r = normalizeRoute(route);
  const enc = encodeURIComponent;
  let path;
  switch (r.view) {
    case "run":
      path = "/run/" + enc(r.runId);
      break;
    case "findings":
      path = "/findings";
      break;
    case "page":
      path = "/page/" + enc(r.slug);
      break;
    case "finding":
      path = "/finding/" + enc(r.runId) + "/" + enc(r.findingId);
      break;
    case "visual":
      path = "/visual/" + enc(r.runId) + "/" + enc(r.slug) + "/" + enc(r.viewport);
      break;
    default:
      path = "/";
  }
  const parts = [];
  for (const key of PARAM_ORDER) {
    const v = r.params[key];
    if (v === undefined) continue;
    if (key === "scope" && v === DEFAULT_SCOPE) continue; // default is implied
    const val = Array.isArray(v) ? v.map(enc).join(",") : enc(v);
    parts.push(key + "=" + val);
  }
  return "#" + path + (parts.length ? "?" + parts.join("&") : "");
}
