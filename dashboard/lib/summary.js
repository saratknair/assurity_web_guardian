// Pure Plain_English_Summary helpers. No window/document at import time.
//
// a11y-rule Findings with a Rule_Catalogue entry:
//   "{what}. {scopeSentence} {who}"
// a11y-rule Findings WITHOUT a catalogue entry (Requirement 3.8): only the
// published description, the published help text (the Finding `title`, or
// `help` when present), and a scope sentence derived only from nodeCount.
// No explanatory text is invented for unknown rules.
// check Findings:  'The "<name>" check failed on <viewport>: <detail>.' + scope
// visual Findings: 'The <viewport> screenshot differs from the approved
//                  baseline.' (+ measure when known) + scope

import { RULE_CATALOGUE } from "../rule-catalogue.js";

function isObj(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function str(v) {
  return typeof v === "string" ? v.trim() : "";
}
function count(v) {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}
function plural(n, one, many) {
  return n + " " + (n === 1 ? one : many);
}
/** Ensure a non-empty string ends with sentence punctuation. */
function sentence(s) {
  const t = str(s);
  if (!t) return "";
  return /[.!?]$/.test(t) ? t : t + ".";
}
function joinSentences(parts) {
  return parts.filter((p) => typeof p === "string" && p !== "").join(" ");
}

/** Catalogue entry for a rule id, or null. Own properties only. */
export function catalogueEntry(ruleId, catalogue) {
  const cat = isObj(catalogue) ? catalogue : RULE_CATALOGUE;
  if (typeof ruleId !== "string" || !ruleId) return null;
  if (!Object.prototype.hasOwnProperty.call(cat, ruleId)) return null;
  const e = cat[ruleId];
  return isObj(e) ? e : null;
}

/**
 * Scope sentence. `scope` is "page" or "elements" (catalogue) or null
 * (unknown rule: derived only from nodeCount). `firstTarget` is used only
 * when the evidence is already loaded.
 */
export function scopeSentence(scope, nodeCount, firstTarget) {
  const n = count(nodeCount);
  if (scope === "page" || n === 0) return "This affects the whole page.";
  const target = str(firstTarget);
  const base = "This affects " + plural(n, "element", "elements") + " on the page";
  return target ? base + ': the first is "' + target + '".' : base + ".";
}

/**
 * "Showing X of Y" text for Affected_Elements (Requirement 3.6).
 * e.g. "Showing 10 of 27 elements (17 not shown)" or "Showing all 7 elements".
 */
export function shownElementsText(finding) {
  const f = isObj(finding) ? finding : {};
  const total = count(f.nodeCount);
  const omitted = Math.min(count(f.omittedNodeCount), total);
  const shown = f.shownNodeCount !== undefined ? Math.min(count(f.shownNodeCount), total) : total - omitted;
  if (omitted > 0) {
    return "Showing " + shown + " of " + total + " elements (" + omitted + " not shown)";
  }
  if (total === 0) return "No affected elements were recorded";
  return total === 1 ? "Showing the 1 affected element" : "Showing all " + total + " elements";
}

function publishedHelp(f) {
  return str(f.help) || str(f.title);
}

function a11ySummary(f, catalogue, opts) {
  const entry = catalogueEntry(f.ruleId, catalogue);
  const nodeCount = count(f.nodeCount);
  if (entry) {
    const scope = entry.scope === "page" ? "page" : "elements";
    return joinSentences([sentence(entry.what), scopeSentence(scope, nodeCount, opts.firstTarget), sentence(entry.who)]);
  }
  // Fallback: published text only.
  const desc = sentence(f.description);
  const help = sentence(publishedHelp(f));
  const parts = [desc];
  if (help && help !== desc) parts.push(help);
  parts.push(scopeSentence(null, nodeCount, null));
  return joinSentences(parts);
}

function checkName(ruleId) {
  const id = str(ruleId);
  return id.indexOf("check:") === 0 ? id.slice("check:".length) : id;
}

function checkSummary(f) {
  const vp = str(f.viewport) || "an unrecorded viewport";
  const detail = str(f.detail);
  const name = checkName(f.ruleId);
  let head;
  if (name === "legacy-outcome" || !name) {
    head = "A recorded check failed on " + vp;
  } else {
    head = 'The "' + name + '" check failed on ' + vp;
  }
  const first = detail ? sentence(head + ": " + detail) : head + ".";
  return joinSentences([first, scopeSentence("page", 0, null)]);
}

/** Difference measure as text, or "" when not recorded. */
export function measureText(measure) {
  if (!isObj(measure)) return "";
  const px = measure.diffPixels;
  const ratio = measure.diffRatio;
  const hasPx = typeof px === "number" && Number.isFinite(px) && px >= 0;
  const hasRatio = typeof ratio === "number" && Number.isFinite(ratio) && ratio >= 0;
  if (!hasPx && !hasRatio) return "";
  const pct = hasRatio ? (ratio * 100).toFixed(3).replace(/\.?0+$/, "") + "%" : "";
  if (hasPx && hasRatio) return Math.floor(px) + " pixels differ (" + pct + " of the image)";
  if (hasPx) return Math.floor(px) + " pixels differ";
  return pct + " of the image differs";
}

function visualSummary(f, opts) {
  const vp = str(f.viewport);
  const head = vp
    ? "The " + vp + " screenshot differs from the approved baseline."
    : "The screenshot differs from the approved baseline.";
  const m = measureText(opts.measure !== undefined ? opts.measure : f.measure);
  return joinSentences([head, m ? sentence(m) : "", scopeSentence("page", 0, null)]);
}

/**
 * Plain_English_Summary for a normalized Finding.
 * @param finding   normalized Finding (dashboard/lib/findings.js)
 * @param catalogue Rule_Catalogue (defaults to RULE_CATALOGUE)
 * @param opts      { firstTarget?: string (from loaded evidence), measure?: {diffPixels, diffRatio} }
 * Never throws; always returns non-empty text.
 */
export function plainEnglishSummary(finding, catalogue, opts) {
  const f = isObj(finding) ? finding : {};
  const o = isObj(opts) ? opts : {};
  const cat = isObj(catalogue) ? catalogue : RULE_CATALOGUE;
  if (f.kind === "a11y-rule") return a11ySummary(f, cat, o);
  if (f.kind === "visual") return visualSummary(f, o);
  return checkSummary(f);
}

/**
 * "How to fix" text (Requirement 3.7): the catalogue `fix`, or the published
 * help text when the rule is not in the catalogue. "" when neither exists.
 */
export function fixText(finding, catalogue) {
  const f = isObj(finding) ? finding : {};
  const entry = f.kind === "a11y-rule" ? catalogueEntry(f.ruleId, catalogue) : null;
  if (entry && str(entry.fix)) return str(entry.fix);
  return publishedHelp(f);
}
