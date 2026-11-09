// Pure Evidence_Caption and alt-text helpers. No window/document at import time.
//
// Requirements 4.7, 5.6, 5.9, 6.1 to 6.6, 16.11. A missing run id or run date
// is rendered as the literal RUN_NOT_RECORDED; no value is ever assumed.
// Dates are formatted in UTC so the output is deterministic everywhere.
//
// Diff_Image colours come from pixelmatch defaults as called by
// src/agents/visual-compare.ts ({ threshold: 0.1 } only): changed pixels are
// drawn in red (diffColor [255,0,0]), anti-aliasing differences that were
// ignored are drawn in yellow (aaColor [255,255,0]), and unchanged pixels are
// a faded grey copy of the baseline (alpha 0.1).

export const RUN_NOT_RECORDED = "Run not recorded";

export const ROLE_LABELS = Object.freeze({
  baseline: "Approved baseline",
  current: "Current run",
  diff: "Difference highlight",
});

export const DIFF_LEGEND =
  "Highlighted areas are pixel differences from the approved baseline; red pixels are changes, yellow pixels are anti-aliasing differences that were ignored, and faded grey is unchanged content.";

const DIFF_LEGEND_SHORT =
  "red pixels mark changes from the approved baseline, yellow pixels mark ignored anti-aliasing differences, faded grey is unchanged";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function isObj(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function str(v) {
  return typeof v === "string" ? v.trim() : "";
}
function pad2(n) {
  return (n < 10 ? "0" : "") + n;
}
function roleOf(r) {
  return r === "baseline" || r === "diff" ? r : "current";
}

/** "27 Oct 2026 08:15 UTC", or RUN_NOT_RECORDED when absent or unparseable. */
export function formatRunDate(iso) {
  const s = str(iso);
  if (!s) return RUN_NOT_RECORDED;
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return RUN_NOT_RECORDED;
  const d = new Date(t);
  return (
    d.getUTCDate() +
    " " +
    MONTHS[d.getUTCMonth()] +
    " " +
    d.getUTCFullYear() +
    " " +
    pad2(d.getUTCHours()) +
    ":" +
    pad2(d.getUTCMinutes()) +
    " UTC"
  );
}

function facts(ctx) {
  const c = isObj(ctx) ? ctx : {};
  const role = roleOf(c.role);
  return {
    role,
    roleLabel: ROLE_LABELS[role],
    pageUrl: str(c.pageUrl) || "Page not recorded",
    viewport: str(c.viewport) || "viewport not recorded",
    runId: str(c.runId) || RUN_NOT_RECORDED,
    runDate: formatRunDate(c.runFinishedAt),
    baselineApprovedAt: str(c.baselineApprovedAt),
    baselineSourceRunId: str(c.baselineSourceRunId),
  };
}

function baselineProvenance(f) {
  const approved = f.baselineApprovedAt ? formatRunDate(f.baselineApprovedAt) : "";
  const approvedText = approved && approved !== RUN_NOT_RECORDED ? approved : "not recorded";
  const source = f.baselineSourceRunId || "not recorded";
  return "baseline approval date: " + approvedText + "; baseline source run: " + source;
}

function roleDescription(f) {
  const capture = "full-page capture at the " + f.viewport + " viewport";
  if (f.role === "diff") return "difference image for the " + f.viewport + " viewport. " + DIFF_LEGEND;
  if (f.role === "baseline") {
    return "approved baseline screenshot, a " + capture + ", that the run was compared with (" + baselineProvenance(f) + ")";
  }
  return capture;
}

/**
 * Evidence_Caption, e.g.
 * "Current run - https://assurity.nz/ - desktop - run_abc - 27 Oct 2026 08:15 UTC - full-page capture at the desktop viewport"
 * ctx: { role: "baseline"|"current"|"diff", pageUrl, viewport, runId, runFinishedAt,
 *        baselineApprovedAt?, baselineSourceRunId? }  (unknown role is treated as "current")
 */
export function evidenceCaption(ctx) {
  const f = facts(ctx);
  return [f.roleLabel, f.pageUrl, f.viewport, f.runId, f.runDate, roleDescription(f)].join(" - ");
}

/** Alt text carrying the same facts as the caption, in one sentence. */
export function imageAlt(ctx) {
  const f = facts(ctx);
  const runPart = "run " + (f.runId === RUN_NOT_RECORDED ? "not recorded" : f.runId) +
    ", run date " + (f.runDate === RUN_NOT_RECORDED ? "not recorded" : f.runDate);
  let what;
  if (f.role === "diff") what = "difference highlight of " + f.pageUrl + " at the " + f.viewport + " viewport (" + DIFF_LEGEND_SHORT + ")";
  else if (f.role === "baseline") what = "approved baseline full-page capture of " + f.pageUrl + " at the " + f.viewport + " viewport (" + baselineProvenance(f) + ")";
  else what = "current run full-page capture of " + f.pageUrl + " at the " + f.viewport + " viewport";
  return f.roleLabel + ": " + what + ", " + runPart + ".";
}

const SUBJECTS = Object.freeze({
  baseline: "The baseline image",
  current: "The current screenshot",
  diff: "The difference image",
});

/**
 * Text shown in place of an image whose published path is null.
 * reason: "image-retention" | "no-baseline-file" | "baseline-changed-since-run"
 *         | "image-cap" | "run-cap" | anything else.
 * retentionRuns: the published Image_Retention_Window size N.
 * role (optional): "baseline" | "current" | "diff".
 */
export function imageUnavailableText(reason, retentionRuns, role) {
  if (reason === "image-retention") {
    const n = typeof retentionRuns === "number" && Number.isFinite(retentionRuns) && retentionRuns >= 1 ? Math.floor(retentionRuns) : 0;
    if (n === 0) return "Images not kept for this run (only the latest runs keep images)";
    if (n === 1) return "Images not kept for this run (only the latest 1 run keeps images)";
    return "Images not kept for this run (only the latest " + n + " runs keep images)";
  }
  const subject = SUBJECTS[role] || "This image";
  const base = subject + " was not published for this run";
  switch (reason) {
    case "no-baseline-file":
      return base + " because no baseline file exists for this page and viewport.";
    case "baseline-changed-since-run":
      return base + " because the baseline has changed since this run, so the image that was compared is no longer available.";
    case "image-cap":
      return base + " because the image is larger than the published size limit for one image.";
    case "run-cap":
      return base + " because the run reached its published size limit.";
    default:
      return base + ".";
  }
}

// ---------------------------------------------------------------------------
// Ignored / Regression / human-resolved wording (R19.4, 19.7, 19.8, 19.10,
// 19.11, 19.23). Pure plain-string helpers; reviewer and reason text is
// published as entered and is only ever placed in the DOM with textContent.
// ---------------------------------------------------------------------------

export const IGNORED_FOOTER_TEXT =
  "Ignored issues are listed on the Ignored page. Reasons and reviewer names are published as entered.";

/** Prefix symbol for a Regression block (text and symbol, never colour alone). */
export const REGRESSION_SYMBOL = "\u25B2";

const SCOPE_WORDS = Object.freeze({
  element: "This element only",
  "page-rule": "This rule on this page, all viewports",
  "site-rule": "This rule on every page",
});

/** Scope in words; unknown scopes read "Scope not recorded". */
export function scopeInWords(scope) {
  const s = str(scope);
  return Object.prototype.hasOwnProperty.call(SCOPE_WORDS, s) ? SCOPE_WORDS[s] : "Scope not recorded";
}

function dateOrNotRecorded(iso) {
  const d = formatRunDate(iso);
  return d === RUN_NOT_RECORDED ? "date not recorded" : d;
}

function reviewerOf(v) {
  return str(v) || "a reviewer";
}

/** "Ignored by <reviewer> on <date>" */
export function ignoredByText(reviewer, at) {
  return "Ignored by " + reviewerOf(reviewer) + " on " + dateOrNotRecorded(at);
}

/** Banner for one Ignored_Finding: "Ignored by X on D. Reason: R. Scope: S." */
export function ignoredBannerText(disposition) {
  const d = isObj(disposition) ? disposition : {};
  return ignoredByText(d.reviewer, d.at) + ". Reason: " + (str(d.reason) || "not recorded") + ". Scope: " + scopeInWords(d.scope) + ".";
}

/** "Reappeared after being marked resolved on <date> by <reviewer>" */
export function regressionLabelText(regression) {
  const r = isObj(regression) ? regression : {};
  return "Reappeared after being marked resolved on " + dateOrNotRecorded(r.at) + " by " + reviewerOf(r.reviewer);
}

/** Full Regression block text, prefixed with the symbol and "Regression:". */
export function regressionBlockText(regression) {
  const r = isObj(regression) ? regression : {};
  return REGRESSION_SYMBOL + " Regression: " + regressionLabelText(r) + ". Original reason: " + (str(r.reason) || "not recorded") + ".";
}

/** "Marked resolved by <reviewer> on <date>" for a resolved item with humanResolved. */
export function humanResolvedText(humanResolved) {
  const h = isObj(humanResolved) ? humanResolved : {};
  return "Marked resolved by " + reviewerOf(h.reviewer) + " on " + dateOrNotRecorded(h.at);
}

/** "N element(s) ignored" for a partly ignored Finding; "" when N is not positive. */
export function ignoredElementsText(n) {
  const k = typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  return k === 0 ? "" : k + (k === 1 ? " element" : " elements") + " ignored";
}

/** "(+N ignored)" shown beside a page count, outside any count; "" when N is not positive. */
export function pageIgnoredText(n) {
  const k = typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  return k === 0 ? "" : "(+" + k + " ignored)";
}
