// Office hash router: parseOfficeRoute / formatOfficeRoute / clampT.
// Pure functions. No window/document access at import time.
//
// Canonical hash:  #/run/<runId>?t=<ms>&station=<id>
//   "#/" (no run) means "load the newest run".
// Route object: { runId: string|null, t: integer ms, station: StationId|null }

import { isStationId } from "./stations.js";

export const MAX_T = 2147483647; // 2^31 - 1

function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch (e) {
    return null;
  }
}

/** Clamp t to an integer in [0, durationMs]. Invalid t or duration gives 0. */
export function clampT(t, durationMs) {
  const n = typeof t === "number" && Number.isFinite(t) ? Math.floor(t) : 0;
  const d = typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs > 0
    ? Math.floor(durationMs) : 0;
  if (n < 0) return 0;
  return n > d ? d : n;
}

function parseT(raw) {
  if (typeof raw !== "string" || !/^[0-9]+$/.test(raw.trim())) return 0;
  const n = Number(raw.trim());
  if (!Number.isFinite(n)) return 0;
  return n > MAX_T ? MAX_T : n;
}

/** Parse a location hash (with or without leading "#"). Never throws. */
export function parseOfficeRoute(hash) {
  let h = typeof hash === "string" ? hash : "";
  if (h.charAt(0) === "#") h = h.slice(1);
  const qi = h.indexOf("?");
  const path = qi === -1 ? h : h.slice(0, qi);
  const query = qi === -1 ? "" : h.slice(qi + 1);

  const seg = path.split("/").filter((s) => s !== "");
  let runId = null;
  if (seg[0] === "run" && seg[1]) {
    const d = safeDecode(seg[1]);
    if (d !== null && d.trim() !== "") runId = d.trim();
  }

  let tRaw;
  let stationRaw;
  if (query) {
    for (const pair of query.split("&")) {
      if (!pair) continue;
      const ei = pair.indexOf("=");
      const k = safeDecode(ei === -1 ? pair : pair.slice(0, ei));
      const v = ei === -1 ? "" : safeDecode(pair.slice(ei + 1));
      if (k === "t" && tRaw === undefined && v !== null) tRaw = v;
      else if (k === "station" && stationRaw === undefined && v !== null) stationRaw = v;
    }
  }
  const station = isStationId(stationRaw) ? stationRaw : null;
  return { runId, t: parseT(tRaw), station };
}

/** Format a route as its canonical hash string (always begins with "#/"). */
export function formatOfficeRoute(route) {
  const r = route && typeof route === "object" ? route : {};
  const runId = typeof r.runId === "string" && r.runId.trim() !== "" ? r.runId.trim() : null;
  const tNum = typeof r.t === "number" && Number.isFinite(r.t) ? Math.floor(r.t) : 0;
  const t = tNum < 0 ? 0 : tNum > MAX_T ? MAX_T : tNum;
  const parts = [];
  if (runId !== null || t > 0) parts.push("t=" + t);
  if (isStationId(r.station)) parts.push("station=" + encodeURIComponent(r.station));
  const path = runId === null ? "/" : "/run/" + encodeURIComponent(runId);
  return "#" + path + (parts.length ? "?" + parts.join("&") : "");
}
