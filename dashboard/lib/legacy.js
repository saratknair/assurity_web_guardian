// Legacy (pre rule-level) run handling. Pure; no window/document at import time.
//
// Input is the old published findings.json shape:
//   { runId, pages: [ { page, slug, outcomes: [ { findingId, kind,
//     classification, detail, ... } ] } ] }
// Output is a run shaped like normalizeRun() output with detailLevel
// "legacy". Severity and lifecycle are always "not-recorded": nothing is ever
// inferred from the detail text (not severity, not viewport, not rule).

import { normalizeRun } from "./findings.js";

function isObj(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Never throws; unusable input yields an empty legacy run. */
export function normalizeLegacyRun(raw, extra) {
  const src = isObj(raw) ? raw : {};
  const meta = isObj(extra) ? extra : {};
  const findings = [];
  const pages = [];
  try {
    const srcPages = Array.isArray(src.pages) ? src.pages : [];
    for (const p of srcPages) {
      if (!isObj(p)) continue;
      const url = typeof p.page === "string" ? p.page : typeof p.url === "string" ? p.url : "";
      const slug = typeof p.slug === "string" ? p.slug : "";
      const outcomes = Array.isArray(p.outcomes) ? p.outcomes : [];
      let count = 0;
      outcomes.forEach((o, i) => {
        if (!isObj(o)) return;
        count += 1;
        findings.push({
          id: typeof o.findingId === "string" && o.findingId ? o.findingId : "legacy_" + slug + "_" + i,
          kind: "check",
          pageUrl: url,
          slug,
          viewport: "",
          ruleId: "legacy-outcome",
          severity: "not-recorded",
          lifecycle: "not-recorded",
          title: "Check outcome",
          detail: typeof o.detail === "string" ? o.detail : "",
          hasElementDetail: false,
          nodeCount: 0,
        });
      });
      pages.push({
        url,
        slug,
        title: null,
        counts: {
          total: count,
          critical: 0,
          serious: 0,
          moderate: 0,
          minor: 0,
          unrated: 0,
          notRecorded: count,
        },
        highest: count > 0 ? "not-recorded" : "none",
      });
    }
  } catch (e) {
    // fall through with whatever was collected
  }
  return normalizeRun({
    schemaVersion: 1,
    runId: typeof src.runId === "string" ? src.runId : typeof meta.runId === "string" ? meta.runId : "",
    finishedAt: typeof meta.finishedAt === "string" ? meta.finishedAt : null,
    detailLevel: "legacy",
    historyStatus: "not-recorded",
    pages,
    findings,
  });
}
