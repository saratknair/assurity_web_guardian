// Pure helpers for the Ignored list (R19.8). No window/document at import time.
//
// groupIgnoredByDecision(ignored) groups run.ignored[] by the decision that
// ignored each Finding (disposition.decisionId). Findings without a
// disposition go into one trailing "decision not recorded" group so nothing
// is lost. Groups are ordered by decision date (newest first), then id.

import { scopeInWords, ignoredByText } from "./captions.js";

function isObj(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function str(v) {
  return typeof v === "string" ? v : "";
}

export const UNKNOWN_DECISION_ID = "";

/**
 * Returns [{ decisionId, scope, scopeText, reason, reviewer, at, byText,
 * findings[], pageCount }]. pageCount is the number of distinct pages the
 * group covers in this run (shown for site-wide groups).
 */
export function groupIgnoredByDecision(ignored) {
  const map = new Map();
  for (const f of Array.isArray(ignored) ? ignored : []) {
    if (!isObj(f)) continue;
    const d = isObj(f.disposition) ? f.disposition : null;
    const id = d ? str(d.decisionId) : UNKNOWN_DECISION_ID;
    let g = map.get(id);
    if (!g) {
      g = {
        decisionId: id,
        scope: d ? str(d.scope) : "",
        scopeText: scopeInWords(d ? d.scope : ""),
        reason: d ? str(d.reason) : "",
        reviewer: d ? str(d.reviewer) : "",
        at: d ? str(d.at) : "",
        byText: ignoredByText(d ? d.reviewer : "", d ? d.at : ""),
        findings: [],
        pageCount: 0,
      };
      map.set(id, g);
    }
    g.findings.push(f);
  }
  const groups = Array.from(map.values());
  for (const g of groups) {
    g.pageCount = new Set(g.findings.map((f) => str(f.pageUrl) || str(f.slug))).size;
  }
  groups.sort((a, b) => {
    if ((a.decisionId === "") !== (b.decisionId === "")) return a.decisionId === "" ? 1 : -1;
    const x = Date.parse(a.at);
    const y = Date.parse(b.at);
    const hx = Number.isFinite(x);
    const hy = Number.isFinite(y);
    if (hx && hy && x !== y) return y - x;
    if (hx !== hy) return hx ? -1 : 1;
    return a.decisionId < b.decisionId ? -1 : a.decisionId > b.decisionId ? 1 : 0;
  });
  return groups;
}

/** "Covers N pages in this run" for site-wide groups; "" otherwise. */
export function groupPagesText(g) {
  if (!isObj(g) || g.scope !== "site-rule") return "";
  const n = typeof g.pageCount === "number" ? g.pageCount : 0;
  return "Covers " + n + (n === 1 ? " page" : " pages") + " in this run";
}

/** Count of ignored Findings per page slug: { [slug]: n }. */
export function ignoredCountBySlug(ignored) {
  const out = {};
  for (const f of Array.isArray(ignored) ? ignored : []) {
    if (!isObj(f) || !str(f.slug)) continue;
    out[f.slug] = (out[f.slug] || 0) + 1;
  }
  return out;
}

/** Resolved items of a run that belong to one page (matched by slug or page URL). */
export function resolvedItemsForPage(resolved, slug, pageUrl) {
  const out = [];
  for (const r of Array.isArray(resolved) ? resolved : []) {
    if (!isObj(r)) continue;
    const bySlug = str(slug) && str(r.slug) === slug;
    const byUrl = str(pageUrl) && str(r.pageUrl) === pageUrl;
    if (bySlug || byUrl) out.push(r);
  }
  return out;
}

/** One-line description of a resolved item: "rule, viewport viewport" with safe fallbacks. */
export function resolvedItemName(r) {
  const o = isObj(r) ? r : {};
  const rule = str(o.title) || str(o.ruleId) || "Resolved item";
  const vp = str(o.viewport);
  return vp ? rule + " (" + vp + " viewport)" : rule;
}
