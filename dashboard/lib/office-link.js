// Dashboard -> Virtual Office deep links. Pure functions, no DOM.
// Format: ./office/#/run/<enc runId>?t=<ms>[&station=<id>]
// Station ids mirror office/lib/stations.js (dashboard must not import office/).

var STATION_IDS = [
  "test-plan-desk", "browser-bay", "visual-check",
  "accessibility-check", "review-desk", "records-room",
];

function isStationId(s) {
  return typeof s === "string" && STATION_IDS.indexOf(s) !== -1;
}

function toT(n) {
  if (typeof n !== "number" || !isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function build(runId, t, station) {
  if (typeof runId !== "string" || runId.trim() === "") return null;
  var link = "./office/#/run/" + encodeURIComponent(runId.trim()) + "?t=" + t;
  if (isStationId(station)) link += "&station=" + encodeURIComponent(station);
  return link;
}

/** Link to the start of a run's replay. */
export function officeRunLink(runId) {
  return build(runId, 0, null);
}

/** Link to the moment a finding was produced; t=0 and no station if unknown. */
export function officeFindingLink(runId, finding) {
  var p = finding && typeof finding === "object" ? finding.producedAt : null;
  if (!p || typeof p !== "object") return build(runId, 0, null);
  return build(runId, toT(p.t), p.station);
}

/** Link to a page's replay time; null unless the run is enriched and replayT is finite. */
export function officePageLink(runId, page, run) {
  var enriched = !!(run && run.replay && run.replay.enriched);
  if (!enriched || !page || typeof page.replayT !== "number" || !isFinite(page.replayT)) return null;
  return build(runId, toT(page.replayT), null);
}
