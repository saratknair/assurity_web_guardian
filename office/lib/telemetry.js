// Telemetry_Panel model and totals reconciliation. Pure, deterministic, never throws.
// Every value derives from the Replay_Timeline (and, for reconcile, run-findings.json).
// A value the run did not record is null; the view prints "not recorded".

import { STATION_IDS, STEP_NAMES } from "./stations.js";
import { officeFindingKey } from "./timeline.js";

const SEVERITIES = Object.freeze(["critical", "serious", "moderate", "minor", "unrated"]);

function isObj(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function num(v) {
  return typeof v === "number" && isFinite(v) ? v : null;
}

function zeroSeverity() {
  return { critical: 0, serious: 0, moderate: 0, minor: 0, unrated: 0, total: 0 };
}

function hasEntries(tl) {
  return isObj(tl) && Array.isArray(tl.entries);
}

// Entries that carry a real duration: step entries (enriched) or closed agent bars (coarse).
function timedEntries(tl) {
  const out = [];
  if (!hasEntries(tl)) return out;
  const wantKind = tl.mode === "enriched" ? "step" : tl.mode === "coarse" ? "agent" : "";
  for (let i = 0; i < tl.entries.length; i++) {
    const e = tl.entries[i];
    if (e.kind !== wantKind) continue;
    if (e.open === true) continue;
    out.push(e);
  }
  return out;
}

function dur(e) {
  return Math.max(0, e.endMs - e.startMs);
}

// Add one entry's findings (by severity) into acc. Only recorded values are counted.
function addFindings(acc, e) {
  const r = isObj(e.result) ? e.result : null;
  if (!r || r.failed === true) return;
  if (e.step === "accessibility-scan" && isObj(r.violations)) {
    for (let i = 0; i < SEVERITIES.length; i++) {
      const n = num(r.violations[SEVERITIES[i]]);
      if (n !== null && n > 0) { acc[SEVERITIES[i]] += n; acc.total += n; }
    }
  } else if (e.step === "load" && Array.isArray(r.checksFailed)) {
    acc.unrated += r.checksFailed.length;
    acc.total += r.checksFailed.length;
  } else if (e.step === "visual-compare" && r.differs === true) {
    acc.unrated += 1;
    acc.total += 1;
  }
}

/**
 * Whole-run time breakdown: run duration, recorded step time, unattributed time.
 * Returns nulls when the run recorded no steps.
 */
export function timeBreakdown(tl) {
  try {
    if (!hasEntries(tl) || tl.mode === "empty") return { runDurationMs: null, recordedStepMs: null, unattributedMs: null };
    const run = num(tl.durationMs) !== null ? tl.durationMs : 0;
    if (tl.mode !== "enriched") return { runDurationMs: run, recordedStepMs: null, unattributedMs: null };
    let rec = 0;
    const es = timedEntries(tl);
    for (let i = 0; i < es.length; i++) rec += dur(es[i]);
    return { runDurationMs: run, recordedStepMs: rec, unattributedMs: Math.max(0, run - rec) };
  } catch (_err) {
    return { runDurationMs: null, recordedStepMs: null, unattributedMs: null };
  }
}

/**
 * Running totals at playback position t. Only entries that have ended at or before t
 * are counted, so every total is non-decreasing in t.
 */
export function telemetryAt(tl, t) {
  const blank = {
    mode: "empty", pagesCompleted: null, pagesTotal: null, pagesSkipped: null,
    findings: null, visualDifferences: null, stepDurations: [], stationDurations: [],
    runDurationMs: null, recordedStepMs: null, unattributedMs: null,
  };
  try {
    if (!hasEntries(tl) || tl.mode === "empty") return blank;
    const pos = typeof t === "number" && isFinite(t) ? t : 0;
    const enriched = tl.mode === "enriched";
    const tb = timeBreakdown(tl);

    // Durations of entries finished by pos.
    const stepMap = Object.create(null);
    const stationMap = Object.create(null);
    for (let i = 0; i < STATION_IDS.length; i++) stationMap[STATION_IDS[i]] = 0;
    const done = [];
    const timed = timedEntries(tl);
    for (let i = 0; i < timed.length; i++) {
      const e = timed[i];
      if (e.endMs > pos) continue;
      done.push(e);
      stationMap[e.station] = (stationMap[e.station] || 0) + dur(e);
      if (e.step) {
        if (!stepMap[e.step]) stepMap[e.step] = { step: e.step, count: 0, totalMs: 0 };
        stepMap[e.step].count += 1;
        stepMap[e.step].totalMs += dur(e);
      }
    }
    const stepDurations = [];
    for (let i = 0; i < STEP_NAMES.length; i++) {
      if (stepMap[STEP_NAMES[i]]) stepDurations.push(stepMap[STEP_NAMES[i]]);
    }
    const stationDurations = STATION_IDS.map((id) => ({ station: id, totalMs: stationMap[id] || 0 }));

    const out = {
      mode: tl.mode, pagesCompleted: null, pagesTotal: null, pagesSkipped: null,
      findings: null, visualDifferences: null, stepDurations, stationDurations,
      runDurationMs: tb.runDurationMs, recordedStepMs: tb.recordedStepMs, unattributedMs: tb.unattributedMs,
    };
    if (!enriched) return out;

    out.pagesTotal = num(tl.pagesTotal);
    const findings = zeroSeverity();
    let visual = 0;
    for (let i = 0; i < done.length; i++) {
      addFindings(findings, done[i]);
      if (done[i].step === "visual-compare" && isObj(done[i].result) && done[i].result.differs === true) visual += 1;
    }
    out.findings = findings;
    out.visualDifferences = visual;

    // A page is completed once all of its step entries have ended and its notes step exists.
    const pageState = Object.create(null);
    const pageOrder = [];
    let skipped = 0;
    for (let i = 0; i < tl.entries.length; i++) {
      const e = tl.entries[i];
      if (e.kind === "skip" && e.startMs <= pos) skipped += 1;
      if (e.kind !== "step" || !e.pageUrl) continue;
      let p = pageState[e.pageUrl];
      if (!p) { p = pageState[e.pageUrl] = { notes: false, allEnded: true }; pageOrder.push(e.pageUrl); }
      if (e.step === "notes") p.notes = true;
      if (e.endMs > pos) p.allEnded = false;
    }
    let completed = 0;
    for (let i = 0; i < pageOrder.length; i++) {
      const p = pageState[pageOrder[i]];
      if (p.notes && p.allEnded) completed += 1;
    }
    out.pagesCompleted = completed;
    out.pagesSkipped = skipped;
    return out;
  } catch (_err) {
    return blank;
  }
}

/**
 * Whole-run share of recorded step time per Station, in Station order.
 * Percentages use largest-remainder rounding at one decimal and sum to exactly 100.0.
 * Returns [] when recorded step time is 0. Time not attributed to a Station is NOT part of
 * the denominator; see timeBreakdown for that duration.
 */
export function stationShares(tl) {
  try {
    const timed = timedEntries(tl);
    const ms = Object.create(null);
    for (let i = 0; i < STATION_IDS.length; i++) ms[STATION_IDS[i]] = 0;
    let total = 0;
    for (let i = 0; i < timed.length; i++) {
      const d = dur(timed[i]);
      ms[timed[i].station] = (ms[timed[i].station] || 0) + d;
      total += d;
    }
    if (!(total > 0)) return [];
    const UNITS = 1000; // tenths of a percent
    const rows = STATION_IDS.map((id, i) => {
      const raw = (ms[id] * UNITS) / total;
      const base = Math.floor(raw + 1e-9);
      return { station: id, ms: ms[id], units: base, rem: raw - base, i };
    });
    let left = UNITS;
    for (let i = 0; i < rows.length; i++) left -= rows[i].units;
    const order = rows.slice().sort((a, b) => (b.rem - a.rem) || (a.i - b.i));
    for (let k = 0; left > 0 && k < order.length; k++, left--) order[k].units += 1;
    return rows.map((r) => ({ station: r.station, ms: r.ms, percent: r.units / 10 }));
  } catch (_err) {
    return [];
  }
}

/**
 * End-of-run totals derived from step results, for reconciliation.
 * Returns null when the run did not record per-step results (Legacy_Run or empty).
 */
export function eventTotals(tl) {
  try {
    if (!hasEntries(tl) || tl.mode !== "enriched") return null;
    const sev = zeroSeverity();
    const keySeen = Object.create(null);
    const keys = [];
    for (let i = 0; i < tl.entries.length; i++) {
      const e = tl.entries[i];
      if (e.kind !== "step") continue;
      addFindings(sev, e);
      for (let j = 0; j < e.findingKeys.length; j++) {
        if (!keySeen[e.findingKeys[j]]) { keySeen[e.findingKeys[j]] = true; keys.push(e.findingKeys[j]); }
      }
    }
    const bySeverity = {};
    for (let i = 0; i < SEVERITIES.length; i++) bySeverity[SEVERITIES[i]] = sev[SEVERITIES[i]];
    return { total: sev.total, bySeverity, keys };
  } catch (_err) {
    return null;
  }
}

function keyOfFinding(f) {
  if (!isObj(f)) return null;
  if (typeof f.pageUrl !== "string" || typeof f.viewport !== "string" || typeof f.ruleId !== "string") return null;
  return officeFindingKey(f.pageUrl, f.viewport, f.ruleId);
}

function listKeys(arr) {
  const out = Object.create(null);
  let readable = true;
  const list = Array.isArray(arr) ? arr : [];
  for (let i = 0; i < list.length; i++) {
    const k = keyOfFinding(list[i]);
    if (k === null) readable = false; else out[k] = true;
  }
  return { set: out, readable };
}

function findingsWord(n) {
  return n === 1 ? "1 finding was" : n + " findings were";
}

function unavailable(reason, eventTotal) {
  return {
    status: "unavailable", eventTotal: eventTotal === undefined ? null : eventTotal,
    detected: null, ignored: null, dashboardTotal: null, difference: null,
    reasons: [reason], message: "The consistency check could not be performed: " + reason,
  };
}

/**
 * Compare event-derived totals with run-findings.json totals.
 *  match       event total equals totals.detected and nothing was ignored
 *  explained   totals equal and totals.ignored > 0 (reviewer decisions)
 *  differs     totals differ; reasons are given only when published fields prove them
 *  unavailable event totals or run-findings totals are not available
 * A difference is never hidden.
 */
export function reconcile(totals, runFindings) {
  try {
    if (!isObj(totals) || num(totals.total) === null) {
      return unavailable("The event stream of this run did not record per-step results.", null);
    }
    const eventTotal = totals.total;
    if (!isObj(runFindings) || !isObj(runFindings.totals)) {
      return unavailable("The Dashboard totals for this run are not available.", eventTotal);
    }
    const t = runFindings.totals;
    const detected = num(t.detected);
    if (detected === null) return unavailable("The Dashboard totals for this run are not available.", eventTotal);
    const ignored = num(t.ignored) !== null ? t.ignored : 0;
    const dashboardTotal = num(t.all) !== null ? t.all : Math.max(0, detected - ignored);
    const base = { eventTotal, detected, ignored, dashboardTotal, difference: eventTotal - detected };

    if (eventTotal === detected) {
      if (ignored === 0) {
        return Object.assign(base, {
          status: "match", reasons: [],
          message: "The Office and the Dashboard agree: " + eventTotal + " findings.",
        });
      }
      const msg = findingsWord(ignored) + " ignored by a reviewer decision and " +
        (ignored === 1 ? "is" : "are") + " not counted on the Dashboard.";
      return Object.assign(base, { status: "explained", reasons: [msg], message: msg });
    }

    // Totals differ. Collect only reasons that published fields prove.
    const reasons = [];
    if (runFindings.detailLevel === "legacy") {
      reasons.push("This run was published with legacy detail, so findings are not recorded per rule.");
    }
    const om = Array.isArray(runFindings.omissions) ? runFindings.omissions : [];
    const relevant = om.filter((o) => isObj(o) && typeof o.path === "string" && /accessibility|findings|results|events/.test(o.path));
    if (relevant.length > 0) {
      reasons.push(relevant.length + " published file" + (relevant.length === 1 ? " was" : "s were") +
        " omitted (" + relevant.slice(0, 3).map((o) => o.path).join(", ") +
        (relevant.length > 3 ? ", ..." : "") + "), so some findings may not be published.");
    }
    const active = listKeys(runFindings.findings);
    const ign = listKeys(runFindings.ignored);
    if (active.readable && ign.readable && Array.isArray(totals.keys)) {
      let nIgnored = 0;
      let nAbsent = 0;
      const ev = Object.create(null);
      for (let i = 0; i < totals.keys.length; i++) {
        const k = totals.keys[i];
        ev[k] = true;
        if (active.set[k]) continue;
        if (ign.set[k]) nIgnored += 1; else nAbsent += 1;
      }
      let nExtra = 0;
      const pk = Object.keys(active.set).concat(Object.keys(ign.set));
      for (let i = 0; i < pk.length; i++) if (!ev[pk[i]]) nExtra += 1;
      if (nIgnored > 0) reasons.push(findingsWord(nIgnored) + " ignored by a reviewer decision and not counted on the Dashboard.");
      if (nAbsent > 0) reasons.push(nAbsent + " recorded finding" + (nAbsent === 1 ? " has" : "s have") + " no published finding.");
      if (nExtra > 0) reasons.push(nExtra + " published finding" + (nExtra === 1 ? " was" : "s were") + " not recorded in the events.");
    }
    if (reasons.length === 0) reasons.push("The reason could not be determined.");
    const d = base.difference;
    const head = "The Office counts " + eventTotal + " findings and the published data counts " + detected +
      " (difference " + (d > 0 ? "+" : "") + d + "). ";
    return Object.assign(base, { status: "differs", reasons, message: head + reasons.join(" ") });
  } catch (_err) {
    return unavailable("The totals could not be read.", null);
  }
}
