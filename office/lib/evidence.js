// Evidence view-model for the Inspector and Station screens. Pure, no DOM, never throws.
// evidenceAt(timeline, t, run, index, opts) -> { runId, hasImages, screenshot, a11y, visual }
//   run   = parsed run-findings.json (or null if it failed to load)
//   index = parsed data/index.json (or null)
//   opts  = { slug, viewport } to pick one page and viewport (default: latest finished),
//           { failedImages } array of "<slug>.<viewport>" whose <img> failed to load.
// Each of screenshot / a11y / visual is null until its step has finished at t.

import { imageUrl } from "./data.js";
import { runLink, visualLink, findingLink } from "./links.js";

const DEFAULT_RETENTION = 10;
export const RULES_UNAVAILABLE = "rule ids not available for this page and viewport";

function isObj(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Message for an image that could not be loaded; names the file. */
export function imageLoadFailureMessage(slug, viewport) {
  return "The screenshot screenshots/" + slug + "." + viewport + ".png could not be loaded.";
}

function retentionOf(index) {
  const n = isObj(index) ? index.imageRetentionRuns : undefined;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : DEFAULT_RETENTION;
}

// Missing run entry or missing flag: images are not claimed to exist.
function hasImagesFor(index, runId) {
  if (!isObj(index) || !Array.isArray(index.runs) || !runId) return false;
  for (let i = 0; i < index.runs.length; i++) {
    const r = index.runs[i];
    if (isObj(r) && r.runId === runId) return r.hasImages === true;
  }
  return false;
}

function latestFinished(tl, t, step, opts) {
  let best = null;
  const es = tl.entries;
  for (let i = 0; i < es.length; i++) {
    const e = es[i];
    if (e.step !== step || !e.slug || !e.viewport) continue;
    if (e.open || e.endMs > t) continue;
    if (opts.slug && e.slug !== opts.slug) continue;
    if (opts.viewport && e.viewport !== opts.viewport) continue;
    best = e;
  }
  return best;
}

function failedSet(opts) {
  const set = Object.create(null);
  const list = Array.isArray(opts.failedImages) ? opts.failedImages : [];
  for (let i = 0; i < list.length; i++) if (typeof list[i] === "string") set[list[i]] = true;
  return set;
}

function buildScreenshot(e, runId, hasImages, retention, failed) {
  const base = {
    entryId: e.id, pageUrl: e.pageUrl, slug: e.slug, viewport: e.viewport, runId,
    role: "current screenshot",
    caption: "Page " + (e.pageUrl || e.slug) + ", viewport " + e.viewport + ", run " + (runId || "unknown") +
      ", current screenshot",
    imageSrc: null, link: visualLink(runId, e.slug, e.viewport), message: null,
  };
  if (!hasImages) {
    base.message = "Images are not published for this run (only the latest " + retention + " runs keep images).";
    return base;
  }
  if (failed[e.slug + "." + e.viewport]) {
    base.message = imageLoadFailureMessage(e.slug, e.viewport);
    return base;
  }
  try {
    base.imageSrc = imageUrl(runId, e.slug, e.viewport);
  } catch (_err) {
    base.message = imageLoadFailureMessage(e.slug, e.viewport);
  }
  return base;
}

function findingsFor(run, slug, viewport) {
  const rows = [];
  if (!isObj(run)) return rows;
  const lists = [["findings", false], ["ignored", true]];
  for (let l = 0; l < lists.length; l++) {
    const arr = Array.isArray(run[lists[l][0]]) ? run[lists[l][0]] : [];
    for (let i = 0; i < arr.length; i++) {
      const f = arr[i];
      if (isObj(f) && f.kind === "a11y-rule" && f.slug === slug && f.viewport === viewport) {
        rows.push({ f, ignored: lists[l][1] });
      }
    }
  }
  return rows;
}

function buildA11y(e, runId, run) {
  const rows = findingsFor(run, e.slug, e.viewport);
  const counts = Object.create(null);
  const rules = [];
  for (let i = 0; i < rows.length; i++) {
    const f = rows[i].f;
    const id = typeof f.ruleId === "string" ? f.ruleId : "";
    if (!id) continue;
    const key = id + (rows[i].ignored ? "|ignored" : "");
    if (counts[key]) { counts[key].count += 1; continue; }
    counts[key] = {
      ruleId: id,
      count: 1,
      ignored: rows[i].ignored,
      severity: typeof f.severity === "string" ? f.severity : null,
      link: rows[i].ignored ? null : findingLink(runId, f.id),
    };
    rules.push(counts[key]);
  }
  const recorded = e.findingKeys.length;
  const published = rules.length;
  // Recorded in the timeline but absent from run-findings: say so, never invent ids.
  let message = null;
  if (!isObj(run)) message = RULES_UNAVAILABLE;
  else if (recorded > 0 && published === 0) message = RULES_UNAVAILABLE;
  else if (recorded > published && recorded > 0) message = RULES_UNAVAILABLE;
  return {
    entryId: e.id, slug: e.slug, viewport: e.viewport, recordedCount: recorded,
    rules, message,
  };
}

function buildVisual(e, runId) {
  const r = e.result && typeof e.result.differs === "boolean" ? e.result.differs : null;
  return {
    entryId: e.id, slug: e.slug, viewport: e.viewport,
    differs: r,
    text: r === null ? "Visual difference: not recorded" : "Visual difference: " + (r ? "yes" : "no"),
    link: visualLink(runId, e.slug, e.viewport),
  };
}

export function evidenceAt(timeline, t, run, index, opts) {
  const empty = { runId: null, hasImages: false, retention: DEFAULT_RETENTION, runLink: null, screenshot: null, a11y: null, visual: null };
  try {
    if (!isObj(timeline) || !Array.isArray(timeline.entries)) return empty;
    const o = isObj(opts) ? opts : {};
    const pos = typeof t === "number" && Number.isFinite(t) ? t : 0;
    const runId = typeof timeline.runId === "string" ? timeline.runId : null;
    const hasImages = hasImagesFor(index, runId);
    const retention = retentionOf(index);
    const shot = latestFinished(timeline, pos, "screenshot", o);
    const scan = latestFinished(timeline, pos, "accessibility-scan", o);
    const cmp = latestFinished(timeline, pos, "visual-compare", o);
    return {
      runId, hasImages, retention, runLink: runLink(runId),
      screenshot: shot ? buildScreenshot(shot, runId, hasImages, retention, failedSet(o)) : null,
      a11y: scan ? buildA11y(scan, runId, run) : null,
      visual: cmp ? buildVisual(cmp, runId) : null,
    };
  } catch (_err) {
    return empty;
  }
}
