// Replay_Timeline: a pure, deterministic model built from Run_Events.
// No DOM access, no clock, no randomness. buildTimeline never throws.
// Nothing is inferred: a Legacy_Run yields a coarse timeline only.

import { formatDuration } from "./format.js";
import { STEP_STATION, STEP_AGENT, STEP_IS_TEMPLATE, TEMPLATE_LABEL, isStepName } from "./stations.js";

export const SETUP_PLACEHOLDER_AGENTS = Object.freeze(["Discovery crawler", "Inventory_Agent", "Specification_Agent"]);

// Components that may appear in a Legacy_Run, and the Station for each.
const COARSE_AGENT_STATION = Object.freeze({
  "Test_Generator": "test-plan-desk",
  "Observation_Runner": "browser-bay",
  "Comparator": "review-desk",
  "Quality_Analysis_Agent": "review-desk",
  "Triage_Agent": "review-desk",
});
const COARSE_AGENT_TEMPLATE = Object.freeze({ "Quality_Analysis_Agent": true, "Triage_Agent": true });

// Kinds that are real but not replayed: skipped without a note.
const SILENT_KINDS = Object.freeze([
  "discovery.validated", "run.record", "a11y.history", "a11y.history.unavailable", "audit",
  "human.review.completed", "replay.meta", "dashboard.regeneration-failed",
]);
const SILENT_PREFIXES = Object.freeze(["publish.", "dashboard."]);

const PAGE_LEVEL_FREE = Object.freeze({ "history": true, "decisions": true });
const VIEWPORT_STEPS = Object.freeze({ "load": true, "screenshot": true, "visual-compare": true, "accessibility-scan": true });

const NOT_RECORDED_COARSE = Object.freeze([
  "page", "viewport", "step name", "timing within the agent", "result summary", "producing step for findings",
]);

export function officeFindingKey(pageUrl, viewport, ruleId) {
  return String(pageUrl) + "|" + String(viewport) + "|" + String(ruleId);
}

function isObj(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function parseTs(v) {
  if (typeof v !== "string") return NaN;
  const n = Date.parse(v);
  return Number.isFinite(n) ? n : NaN;
}

function emptyNotices() {
  return { notRecorded: [], skipped: [], truncated: null, empty: null, unsupported: null };
}

function emptyTimeline(reason, notices) {
  const n = notices || emptyNotices();
  n.empty = reason;
  return {
    mode: "empty", schema: null, runId: null, startedAtMs: 0, durationMs: 0, pagesTotal: null,
    entries: [], pages: [], notices: n,
  };
}

function isSilent(kind) {
  if (SILENT_KINDS.indexOf(kind) !== -1) return true;
  for (let i = 0; i < SILENT_PREFIXES.length; i++) {
    if (kind.indexOf(SILENT_PREFIXES[i]) === 0) return true;
  }
  return false;
}

function scalar(v) {
  if (typeof v === "string") return v.length > 200 ? v.slice(0, 200) : v;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "boolean") return v;
  return undefined;
}

// Shallow-to-two-levels copy of a Result_Summary keeping only scalars.
function cleanResult(r) {
  if (!isObj(r)) return null;
  const out = {};
  const keys = Object.keys(r);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (k === "__proto__") continue;
    const v = r[k];
    const s = scalar(v);
    if (s !== undefined) {
      out[k] = s;
    } else if (Array.isArray(v)) {
      out[k] = v.map(scalar).filter((x) => x !== undefined);
    } else if (isObj(v)) {
      const inner = {};
      const ik = Object.keys(v);
      for (let j = 0; j < ik.length; j++) {
        if (ik[j] === "__proto__") continue;
        const sv = scalar(v[ik[j]]);
        if (sv !== undefined) inner[ik[j]] = sv;
      }
      out[k] = inner;
    }
  }
  return out;
}

function cleanViewport(v) {
  return v === "desktop" || v === "mobile" ? v : null;
}

function stepLabel(step, pageUrl, slug, viewport, template) {
  let s = step;
  const page = pageUrl || slug;
  if (page) s += " - " + page;
  if (viewport) s += " (" + viewport + ")";
  if (template) s += " (" + TEMPLATE_LABEL + ")";
  return s;
}

function blankEntry() {
  return {
    id: "", index: 0, srcIndex: 0, kind: "marker", step: null, station: "records-room",
    agent: null, template: false, pageUrl: null, slug: null, viewport: null,
    startMs: 0, endMs: 0, result: null, findingKeys: [], findingIds: {}, label: "",
  };
}

function buildEnrichedStep(ev, srcIndex, base) {
  const d = ev.data;
  if (!isObj(d)) return { note: "step.completed has no data" };
  if (!isStepName(d.step)) return { note: "step.completed has an unknown step name" };
  if (typeof d.seq !== "number" || !Number.isInteger(d.seq)) return { note: "step.completed has no integer seq" };
  const s = parseTs(d.startedAt);
  const e = parseTs(d.endedAt);
  if (Number.isNaN(s) || Number.isNaN(e)) return { note: "step.completed has an unreadable start or end time" };
  const pageScoped = !PAGE_LEVEL_FREE[d.step];
  if (pageScoped && (typeof d.pageUrl !== "string" || d.pageUrl === "")) {
    return { note: "step.completed is missing pageUrl" };
  }
  const en = blankEntry();
  en.id = "step-" + d.seq;
  en.srcIndex = srcIndex;
  en.kind = "step";
  en.step = d.step;
  en.station = STEP_STATION[d.step];
  en.agent = typeof d.agent === "string" && d.agent ? d.agent : STEP_AGENT[d.step];
  en.template = typeof d.template === "boolean" ? d.template : STEP_IS_TEMPLATE[d.step] === true;
  en.pageUrl = pageScoped ? d.pageUrl : null;
  en.slug = pageScoped && typeof d.slug === "string" && d.slug ? d.slug : null;
  en.viewport = VIEWPORT_STEPS[d.step] ? cleanViewport(d.viewport) : null;
  en.startMs = Math.max(0, s - base);
  en.endMs = Math.max(en.startMs, e - base);
  en.result = cleanResult(d.result);
  if (Array.isArray(d.findings) && en.pageUrl && en.viewport) {
    for (let i = 0; i < d.findings.length; i++) {
      const r = d.findings[i];
      if (typeof r === "string" && r) en.findingKeys.push(officeFindingKey(en.pageUrl, en.viewport, r));
    }
  }
  if (isObj(d.findingIds)) {
    const ks = Object.keys(d.findingIds);
    for (let i = 0; i < ks.length; i++) {
      if (ks[i] !== "__proto__" && typeof d.findingIds[ks[i]] === "string") en.findingIds[ks[i]] = d.findingIds[ks[i]];
    }
  }
  en.label = stepLabel(en.step, en.pageUrl, en.slug, en.viewport, en.template);
  return { entry: en, seq: d.seq };
}

/**
 * Build the Replay_Timeline from Run_Events. Never throws.
 * @param {unknown} events
 */
export function buildTimeline(events) {
  try {
    return build(events);
  } catch (_err) {
    return emptyTimeline("The run events could not be read.");
  }
}

function build(events) {
  if (!Array.isArray(events)) return emptyTimeline("Run events are not a list, so there is nothing to replay.");
  if (events.length === 0) return emptyTimeline("This run has no events, so there is nothing to replay.");

  // Find run.started (first one with a readable time).
  let startIdx = -1;
  let base = 0;
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (isObj(ev) && ev.kind === "run.started") {
      const t = parseTs(ev.ts);
      if (!Number.isNaN(t)) { startIdx = i; base = t; break; }
    }
  }
  if (startIdx === -1) return emptyTimeline("No run.started event was recorded, so times cannot be placed.");

  const notices = emptyNotices();
  const startEv = events[startIdx];
  const sd = isObj(startEv.data) ? startEv.data : {};
  const schemaRaw = typeof sd.replaySchema === "number" && Number.isFinite(sd.replaySchema) ? sd.replaySchema : null;
  let hasSteps = false;
  for (let i = 0; i < events.length; i++) {
    if (isObj(events[i]) && events[i].kind === "step.completed") { hasSteps = true; break; }
  }
  let mode;
  if (schemaRaw !== null && schemaRaw > 1) {
    mode = "coarse";
    notices.unsupported = "This run uses replay schema " + schemaRaw +
      ", which this office does not support, so only a coarse replay is shown.";
  } else {
    mode = hasSteps ? "enriched" : "coarse";
  }

  const entries = [];
  const skip = (i, why) => { notices.skipped.push("Event " + i + " skipped: " + why + "."); };
  const runId = typeof startEv.runId === "string" ? startEv.runId : null;
  const pagesTotal = typeof sd.pages === "number" && Number.isInteger(sd.pages) && sd.pages >= 0 ? sd.pages : null;

  const marker = blankEntry();
  marker.id = "run-started";
  marker.srcIndex = startIdx;
  marker.label = "Run started";
  entries.push(marker);

  let finishedSeen = false;
  let skipCount = 0;
  const seenSeq = Object.create(null);
  const pending = Object.create(null); // coarse: agentName -> queue of working entries

  for (let i = 0; i < events.length; i++) {
    if (i === startIdx) continue;
    const ev = events[i];
    if (!isObj(ev)) { skip(i, "not an event object"); continue; }
    const kind = ev.kind;
    if (typeof kind !== "string" || kind === "") { skip(i, "missing event kind"); continue; }

    if (kind === "run.started") { skip(i, "duplicate run.started"); continue; }

    if (kind === "run.finished") {
      const t = parseTs(ev.ts);
      if (Number.isNaN(t)) { skip(i, "run.finished has an unreadable time"); continue; }
      if (finishedSeen) { skip(i, "duplicate run.finished"); continue; }
      finishedSeen = true;
      const fd = isObj(ev.data) ? ev.data : {};
      const en = blankEntry();
      en.id = "run-finished";
      en.srcIndex = i;
      en.startMs = en.endMs = Math.max(0, t - base);
      const res = {};
      if (typeof fd.health === "string") res.health = scalar(fd.health);
      if (typeof fd.failedChecks === "number" && Number.isFinite(fd.failedChecks)) res.failedChecks = fd.failedChecks;
      if (typeof fd.pages === "number" && Number.isFinite(fd.pages)) res.pages = fd.pages;
      en.result = res;
      en.label = "Run finished" + (res.health ? " (health: " + res.health + ")" : "");
      entries.push(en);
      continue;
    }

    if (kind === "page.skipped") {
      const t = parseTs(ev.ts);
      const d = isObj(ev.data) ? ev.data : null;
      if (!d || typeof d.url !== "string" || d.url === "" || Number.isNaN(t)) {
        skip(i, "page.skipped is missing url or time");
        continue;
      }
      if (mode === "enriched") {
        const en = blankEntry();
        skipCount += 1;
        en.id = "skip-" + skipCount;
        en.srcIndex = i;
        en.kind = "skip";
        en.station = "test-plan-desk";
        en.pageUrl = d.url;
        en.slug = typeof d.slug === "string" && d.slug ? d.slug : null;
        en.startMs = en.endMs = Math.max(0, t - base);
        en.result = { skipped: true };
        if (typeof d.reason === "string") en.result.reason = scalar(d.reason);
        en.label = "Page skipped - " + (en.slug || en.pageUrl);
        entries.push(en);
      }
      continue;
    }

    if (kind === "step.completed") {
      if (mode !== "enriched") continue; // unsupported schema: noted once in notices.unsupported
      const r = buildEnrichedStep(ev, i, base);
      if (!r.entry) { skip(i, r.note); continue; }
      if (seenSeq[r.seq]) { skip(i, "duplicate step seq " + r.seq); continue; }
      seenSeq[r.seq] = true;
      entries.push(r.entry);
      continue;
    }

    if (kind === "agent.working" || kind === "agent.completed") {
      const d = isObj(ev.data) ? ev.data : null;
      const name = d && typeof d.agentName === "string" ? d.agentName : "";
      if (name && SETUP_PLACEHOLDER_AGENTS.indexOf(name) !== -1) continue;
      if (mode === "enriched") continue; // superseded by step events
      const t = parseTs(ev.ts);
      if (!name || Number.isNaN(t)) { skip(i, kind + " is missing agentName or time"); continue; }
      if (!Object.prototype.hasOwnProperty.call(COARSE_AGENT_STATION, name)) {
        skip(i, "unknown agent " + name);
        continue;
      }
      const rel = Math.max(0, t - base);
      if (!pending[name]) pending[name] = [];
      if (kind === "agent.working") {
        const en = blankEntry();
        en.srcIndex = i;
        en.kind = "agent";
        en.station = COARSE_AGENT_STATION[name];
        en.agent = name;
        en.template = COARSE_AGENT_TEMPLATE[name] === true;
        en.startMs = en.endMs = rel;
        en.open = true;
        pending[name].push(en);
        entries.push(en);
      } else {
        const open = pending[name].shift();
        if (open) {
          open.endMs = Math.max(open.startMs, rel);
          open.endSrcIndex = i;
          open.open = false;
        } else {
          const en = blankEntry();
          en.srcIndex = i;
          en.kind = "agent";
          en.station = COARSE_AGENT_STATION[name];
          en.agent = name;
          en.template = COARSE_AGENT_TEMPLATE[name] === true;
          en.startMs = en.endMs = rel;
          en.open = false;
          entries.push(en);
        }
      }
      continue;
    }

    if (isSilent(kind)) continue;
    skip(i, "unknown event kind " + kind);
  }

  // Coarse labels / ids.
  if (mode !== "enriched") {
    for (let i = 0; i < entries.length; i++) {
      const en = entries[i];
      if (en.kind !== "agent") continue;
      en.id = "a" + en.srcIndex;
      en.label = en.agent + (en.template ? " (" + TEMPLATE_LABEL + ")" : "") + " - step, page and viewport not recorded";
    }
    notices.notRecorded = NOT_RECORDED_COARSE.slice();
  }

  // Truncation notice from replay.meta (enriched only).
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (isObj(ev) && ev.kind === "replay.meta" && isObj(ev.data) && isObj(ev.data.truncated)) {
      notices.truncated = cleanResult(ev.data.truncated);
      break;
    }
  }

  // Sort by start then original order (stable via srcIndex tie-break).
  entries.sort((a, b) => (a.startMs - b.startMs) || (a.srcIndex - b.srcIndex));
  let duration = 0;
  for (let i = 0; i < entries.length; i++) {
    entries[i].index = i;
    if (entries[i].endMs > duration) duration = entries[i].endMs;
  }

  // Page rows (enriched only; pages appear in order of first entry).
  const pages = [];
  const pageSeen = Object.create(null);
  for (let i = 0; i < entries.length; i++) {
    const en = entries[i];
    if (!en.pageUrl) continue;
    if (!pageSeen[en.pageUrl]) {
      pageSeen[en.pageUrl] = true;
      pages.push({ url: en.pageUrl, slug: en.slug, firstStartMs: en.startMs, entryId: en.id });
    }
  }

  return {
    mode, schema: schemaRaw, runId, startedAtMs: base, durationMs: duration, pagesTotal,
    entries, pages, notices,
  };
}

export function clampT(tl, t) {
  const n = typeof t === "number" && Number.isFinite(t) ? t : 0;
  const max = tl && typeof tl.durationMs === "number" ? tl.durationMs : 0;
  return Math.min(Math.max(n, 0), max);
}

// Number of entries with startMs <= t (entries are sorted, so this is a prefix).
export function countAt(tl, t) {
  const es = tl.entries;
  if (typeof t !== "number" || Number.isNaN(t)) return 0;
  let lo = 0;
  let hi = es.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (es[mid].startMs <= t) lo = mid + 1; else hi = mid;
  }
  return lo;
}

export function entriesAt(tl, t) {
  return tl.entries.slice(0, countAt(tl, t));
}

export function activeAt(tl, t) {
  const n = countAt(tl, t);
  const out = [];
  for (let i = 0; i < n; i++) {
    const e = tl.entries[i];
    if (e.kind === "marker") continue;
    if (t < e.endMs || (e.startMs === t && e.endMs === t)) out.push(e);
  }
  return out;
}

export function nextStart(tl, t) {
  for (let i = 0; i < tl.entries.length; i++) {
    if (tl.entries[i].startMs > t) return tl.entries[i].startMs;
  }
  return null;
}

export function prevStart(tl, t) {
  let best = 0;
  for (let i = 0; i < tl.entries.length; i++) {
    const s = tl.entries[i].startMs;
    if (s < t) best = s; else break;
  }
  return best;
}

export function firstEntryForPage(tl, pageUrl) {
  for (let i = 0; i < tl.entries.length; i++) {
    if (tl.entries[i].pageUrl === pageUrl) return tl.entries[i];
  }
  return null;
}

export function producingEntry(tl, key) {
  for (let i = 0; i < tl.entries.length; i++) {
    if (tl.entries[i].findingKeys.indexOf(key) !== -1) return tl.entries[i];
  }
  return null;
}

// Plain-text lines for a Result_Summary. Only recorded values are shown.
export function resultLines(entry) {
  const r = entry && entry.result;
  const out = [];
  if (!r) return out;
  if (r.failed === true) out.push("Step failed");
  if (r.skipped === true) out.push("Skipped" + (typeof r.reason === "string" ? ": " + r.reason : ""));
  if (typeof r.httpStatus === "number") out.push("HTTP status: " + r.httpStatus);
  if (r.violations && typeof r.violations === "object") {
    const v = r.violations;
    const parts = [];
    ["critical", "serious", "moderate", "minor", "unrated"].forEach((k) => {
      if (typeof v[k] === "number") parts.push(k + " " + v[k]);
    });
    if (parts.length) out.push("Accessibility findings: " + parts.join(", "));
  }
  if (typeof r.differs === "boolean") out.push("Visual difference: " + (r.differs ? "yes" : "no"));
  if (typeof r.saved === "boolean") out.push("Screenshot saved: " + (r.saved ? "yes" : "no"));
  if (typeof r.outcomes === "number") out.push("Outcomes: " + r.outcomes);
  if (typeof r.failedChecks === "number") out.push("Failed checks: " + r.failedChecks);
  if (typeof r.items === "number") out.push("Items: " + r.items);
  if (typeof r.tracked === "number") out.push("Tracked findings: " + r.tracked);
  if (typeof r.entries === "number") out.push("Decision entries: " + r.entries);
  if (typeof r.status === "string") out.push("Status: " + r.status);
  if (typeof r.health === "string") out.push("Health: " + r.health);
  return out;
}

const CAPTION_VERB = Object.freeze({
  "load": "Loading",
  "screenshot": "Taking screenshot of",
  "visual-compare": "Comparing",
  "accessibility-scan": "Scanning",
  "test-plan": "Planning tests for",
  "compare": "Reviewing results for",
  "notes": "Writing notes for",
  "triage": "Triaging",
  "history": "Updating history",
  "decisions": "Applying decisions",
});

// Multi-segment paths keep only the last segment: "/a/b/c/" -> ".../c/".
function shortenPath(p) {
  const segs = p.split("/").filter(function (s) { return s !== ""; });
  if (segs.length <= 1) return p;
  return ".../" + segs[segs.length - 1] + (p.charAt(p.length - 1) === "/" ? "/" : "");
}

// URL pathname ("/" for home); falls back to the slug, or "" when neither is usable.
function captionPath(pageUrl, slug) {
  if (typeof pageUrl === "string" && pageUrl) {
    try {
      const p = new URL(pageUrl, "http://office.invalid").pathname;
      return shortenPath(p === "" ? "/" : p);
    } catch (_err) { /* fall through to slug */ }
  }
  return typeof slug === "string" ? slug : "";
}

/**
 * Short plain-text caption for a working entry: "<verb> <page path> (<viewport>)".
 * Pure. Coarse (agent) entries have no step, page or viewport, so they read
 * "Working: <agent>".
 */
export function activityCaption(entry) {
  if (!entry || typeof entry !== "object") return "";
  if (entry.kind === "skip") {
    const sp = captionPath(entry.pageUrl, entry.slug);
    return sp ? "Skipping " + sp : "Skipping page";
  }
  const verb = typeof entry.step === "string" && Object.prototype.hasOwnProperty.call(CAPTION_VERB, entry.step)
    ? CAPTION_VERB[entry.step] : null;
  if (!verb) return entry.agent ? "Working: " + entry.agent : "Working";
  let s = verb;
  const path = PAGE_LEVEL_FREE[entry.step] ? "" : captionPath(entry.pageUrl, entry.slug);
  if (path) s += " " + path;
  if (entry.viewport) s += " (" + entry.viewport + ")";
  return s;
}

const EVIDENCE_STEPS = Object.freeze({ "screenshot": true, "visual-compare": true, "accessibility-scan": true });

// Presentation-only minimum time (ms of playback position) a short entry stays highlighted.
export const HIGHLIGHT_HOLD_MS = 1500;

/**
 * Per-agent highlight state at t: { [agent]: { working, held, entry, caption } }.
 * Considers each agent's latest entry started at or before t. `working` is true
 * while t is inside the recorded [start, end); `held` is true when t >= end and t is
 * before min(start + holdMs, next start of the same agent). Agents whose latest
 * entry is neither working nor held are omitted. Pure function of (tl, t, holdMs).
 */
export function highlightAt(tl, t, holdMs) {
  const hold = typeof holdMs === "number" && Number.isFinite(holdMs) && holdMs >= 0 ? holdMs : HIGHLIGHT_HOLD_MS;
  const pos = clampT(tl, t);
  const n = countAt(tl, pos);
  const latest = Object.create(null);
  for (let i = 0; i < n; i++) {
    const e = tl.entries[i];
    if (e.kind === "marker" || e.id === "run-finished" || !e.agent) continue;
    latest[e.agent] = e; // entries are sorted, so the last one wins
  }
  const out = Object.create(null);
  const names = Object.keys(latest);
  for (let i = 0; i < names.length; i++) {
    const e = latest[names[i]];
    const working = pos < e.endMs || (e.startMs === pos && e.endMs === pos);
    // The next entry of the same agent starts after pos (e is the latest started), so
    // it cuts the hold off by construction; start + hold is the only other limit.
    const held = !working && pos >= e.endMs && pos < e.startMs + hold;
    if (!working && !held) continue;
    let caption = activityCaption(e);
    const duration = Math.max(0, e.endMs - e.startMs);
    if (!e.open && (held || duration < hold)) caption += " (took " + formatDuration(duration) + ")";
    out[names[i]] = { working, held, entry: e, caption };
  }
  return out;
}

/**
 * Snapshot of the office at position t. Pure function of (tl, t).
 */
export function stateAt(tl, t) {
  const pos = clampT(tl, t);
  const n = countAt(tl, pos);
  const active = activeAt(tl, pos);
  const activeIds = Object.create(null);
  for (let i = 0; i < active.length; i++) activeIds[active[i].index] = true;

  const figureMap = Object.create(null);
  const figureOrder = [];
  const latestByStation = Object.create(null);
  let finishedEntry = null;
  for (let i = 0; i < n; i++) {
    const e = tl.entries[i];
    if (e.id === "run-finished") finishedEntry = e;
    if (e.kind === "marker" || e.id === "run-finished") continue;
    if (e.agent) {
      if (!figureMap[e.agent]) figureOrder.push(e.agent);
      figureMap[e.agent] = e;
    }
    latestByStation[e.station] = e;
  }

  const hl = highlightAt(tl, pos);
  const highlightedIdx = Object.create(null);
  const figures = figureOrder.map((name) => {
    const e = figureMap[name];
    const h = hl[name];
    if (h) highlightedIdx[h.entry.index] = true;
    return { agent: name, template: e.template, station: e.station, working: activeIds[e.index] === true, entryId: e.id,
      highlighted: !!h && (h.working || h.held), caption: h ? h.caption : "" };
  });

  const screens = {};
  const stationKeys = Object.keys(latestByStation);
  for (let i = 0; i < stationKeys.length; i++) {
    const e = latestByStation[stationKeys[i]];
    const done = e.endMs <= pos && !e.open;
    const lines = [];
    if (e.step) {
      lines.push("Step: " + e.step);
      if (e.pageUrl || e.slug) lines.push("Page: " + (e.pageUrl || e.slug));
      if (e.viewport) lines.push("Viewport: " + e.viewport);
      if (done) Array.prototype.push.apply(lines, resultLines(e));
    } else if (e.kind === "skip") {
      lines.push("Page: " + (e.pageUrl || e.slug));
      Array.prototype.push.apply(lines, resultLines(e));
    } else {
      lines.push("Component: " + e.agent);
      lines.push("Step, page and viewport: not recorded");
    }
    const ref = e.step && EVIDENCE_STEPS[e.step] && e.slug && e.viewport
      ? { pageUrl: e.pageUrl, slug: e.slug, viewport: e.viewport, step: e.step }
      : null;
    screens[stationKeys[i]] = { entryId: e.id, step: e.step, done, lines, evidenceRef: ref,
      highlighted: activeIds[e.index] === true || highlightedIdx[e.index] === true };
  }

  const started = tl.mode !== "empty";
  const health = finishedEntry && finishedEntry.result && typeof finishedEntry.result.health === "string"
    ? finishedEntry.result.health : null;
  return {
    t: pos,
    started,
    finished: finishedEntry !== null,
    health,
    figures,
    screens,
    counts: { reached: n, total: tl.entries.length },
  };
}
