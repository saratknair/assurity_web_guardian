// Assurity Web Guardian - Finding_Detail_View (route #/finding/<runId>/<findingId>).
// Plain browser ES module, ASCII-only. See the VIEW MODULE CONTRACT in app.js.
//
// Requirements 3.1 to 3.13, 4.1 to 4.7, 7.1 to 7.4, 7.6, 7.10, 17.9.
//
// Every published string reaches the DOM through textContent / createElement
// (never markup strings). Affected-element HTML snippets are set with
// textContent inside <pre><code>, so they are shown as escaped text and are
// never interpreted as markup (Requirement 3.11). No forms. Nothing touches
// window/document at import time.
//
// Section order: heading, severity, summary, what is affected, facts,
// how to fix, affected elements, screenshot, same rule on other pages,
// Automated guidance (visually distinct, data-guidance="true").
// Visual Findings add the baseline statement, suppression reason, difference
// measure and provenance, and a link to the Visual_Comparison.

import { el, clear, link, badge, lifecycleBadge, sectionHeading, kvList, loading, plural, formatDateTime } from "./common.js";
import { plainEnglishSummary, shownElementsText, fixText, measureText, catalogueEntry } from "../lib/summary.js";
import { FALLBACK_NOTE } from "../rule-catalogue.js";
import { visibleGuidance, GUIDANCE_LABEL, GUIDANCE_SUBTITLE } from "../lib/guidance.js";
import {
  evidenceCaption, imageAlt, imageUnavailableText, DIFF_LEGEND,
  ignoredBannerText, regressionBlockText, ignoredElementsText,
} from "../lib/captions.js";
import { sameRuleOtherPages } from "../lib/findings.js";
import { officeFindingLink } from "../lib/office-link.js";

export const VISUAL_NOT_RATED_TEXT = "Not rated - visual changes need human review";
export const NO_ELEMENT_DETAIL_TEXT = "No element detail was recorded for this finding";
export const MEASURE_NOT_RECORDED_TEXT = "Difference measure not recorded for this run";
export const WITHHELD_TEXT = "[withheld]";
export const WITHHELD_EXPLANATION =
  "A value marked [withheld] was removed before publishing because it could have contained a file path, a secret, or text that could not be made safe.";

function isObj(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function str(v) {
  return typeof v === "string" ? v : "";
}
function arr(v) {
  return Array.isArray(v) ? v : [];
}

/** "wcag244" -> "WCAG 2.4.4", "wcag1410" -> "WCAG 1.4.10". null when not a criterion tag. */
export function wcagLabel(tag) {
  const m = /^wcag(\d)(\d)(\d{1,2})$/.exec(str(tag));
  return m ? "WCAG " + m[1] + "." + m[2] + "." + m[3] : null;
}

/** Only http(s) help links are rendered as links. */
function safeHttpUrl(u) {
  const s = str(u).trim();
  return /^https?:\/\//i.test(s) ? s : "";
}

/** Relative URL of a file inside a published run folder, or "" when the path is unsafe. */
export function runFileUrl(runId, relPath) {
  const p = str(relPath);
  const segs = p.split("/");
  if (!runId || !p || p.indexOf("\\") !== -1 || segs.some((s) => s === "" || s === "." || s === "..")) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(p)) return "";
  return "./data/runs/" + encodeURIComponent(runId) + "/" + segs.map(encodeURIComponent).join("/");
}

function findFinding(run, id) {
  for (const f of arr(run && run.findings)) if (isObj(f) && f.id === id) return { finding: f, ignored: false };
  for (const f of arr(run && run.ignored)) if (isObj(f) && f.id === id) return { finding: f, ignored: true };
  return null;
}

function openLightboxLazy(payload, opener) {
  import("./lightbox.js")
    .then((m) => m.openLightbox(payload, opener))
    .catch(() => {
      /* lightbox unavailable: the image stays visible inline */
    });
}

/** Figure with an image that opens the lightbox, and a caption. */
function imageFigure(src, altText, captionText, focusKey) {
  const fig = el("figure", "figure");
  const open = el("button", "figure__open", null, {
    type: "button",
    "data-focus-key": focusKey,
    "aria-label": "Open full-size image: " + captionText,
  });
  const img = el("img", "", null, { src, alt: altText, loading: "lazy", decoding: "async" });
  open.appendChild(img);
  open.addEventListener("click", () => openLightboxLazy({ src, alt: altText, caption: captionText }, open));
  fig.appendChild(open);
  fig.appendChild(el("figcaption", "caption", captionText));
  return fig;
}

function section(title, level) {
  const s = el("section", "detail-section");
  s.appendChild(sectionHeading(title, level || 3));
  return s;
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function severityBlock(f) {
  const p = el("p", "detail-severity");
  p.appendChild(badge(f.severity));
  if (f.kind === "visual" && f.severity === "unrated") {
    p.appendChild(document.createTextNode(" " + VISUAL_NOT_RATED_TEXT));
  } else if (f.severity === "unrated") {
    p.appendChild(document.createTextNode(" Not rated"));
  } else if (f.severity === "not-recorded") {
    p.appendChild(document.createTextNode(" Severity not recorded for this run"));
  }
  return p;
}

function dispositionBlocks(f, ignored) {
  const out = [];
  if (ignored && isObj(f.disposition)) {
    const d = f.disposition;
    const box = el("div", "notice", null, { role: "note" });
    box.appendChild(el("p", "", ignoredBannerText(d)));
    if (str(d.decisionId)) box.appendChild(el("p", "muted", "Decision id: " + d.decisionId));
    out.push(box);
  }
  if (f.lifecycle === "regression" && isObj(f.regression)) {
    const r = f.regression;
    const box = el("div", "notice notice--warn", null, { role: "note" });
    box.appendChild(el("p", "", regressionBlockText(r)));
    out.push(box);
  }
  const ignElems = ignoredElementsText(f.ignoredNodeCount);
  if (ignElems) out.push(el("p", "", ignElems));
  return out;
}

function affectedSection(f, nodeCount, viol) {
  const s = section("What is affected");
  let text;
  if (f.kind !== "a11y-rule" || nodeCount === 0) {
    text = "The whole page.";
  } else {
    const entry = catalogueEntry(f.ruleId);
    text = entry && entry.scope === "page" ? "The whole page." : plural(nodeCount, "element", "elements") + " on the page.";
  }
  s.appendChild(el("p", "", text));
  return s;
}

function factsSection(f, run, runId) {
  const s = section("Facts");
  const entries = [];
  if (f.kind === "a11y-rule") entries.push(["Rule id", f.ruleId || "not recorded"]);
  else if (f.kind === "check") entries.push(["Check", f.ruleId || "not recorded"]);
  else entries.push(["Rule id", f.ruleId || "visual-diff"]);

  if (f.kind === "a11y-rule") {
    const tags = arr(f.wcag).map(wcagLabel).filter(Boolean);
    entries.push(["WCAG", tags.length ? tags.join(", ") : "not recorded"]);
    const url = safeHttpUrl(f.helpUrl);
    if (url) {
      entries.push(["Help", link("Rule help (opens in a new tab)", url, "", { rel: "noopener noreferrer", target: "_blank" })]);
    } else {
      entries.push(["Help", "No help link was published"]);
    }
  }
  entries.push(["Page", f.pageUrl || "not recorded"]);
  entries.push(["Viewport", f.viewport || "not recorded"]);
  entries.push(["Run ID", runId || "Run not recorded"]);
  entries.push(["Run date", formatDateTime(run.finishedAt)]);
  entries.push(["Lifecycle", lifecycleBadge(f.lifecycle)]);
  s.appendChild(kvList(entries));
  return s;
}

function fixSection(f) {
  const s = section("How to fix");
  const text = fixText(f);
  if (text) s.appendChild(el("p", "", text));
  else s.appendChild(el("p", "muted", "No fix guidance was published for this finding."));
  return s;
}

function nodeField(label, value, withheldNames, truncatedNames, key, asCode) {
  const wrap = el("div", "node-field");
  wrap.appendChild(el("p", "node-field__label", label));
  const isWithheld = arr(withheldNames).indexOf(key) !== -1 || value === WITHHELD_TEXT;
  let shown = str(value);
  if (isWithheld) shown = WITHHELD_TEXT;
  if (asCode) {
    const pre = el("pre", "code-snippet", null, { tabindex: "0" });
    const code = document.createElement("code");
    code.textContent = shown;
    pre.appendChild(code);
    wrap.appendChild(pre);
  } else {
    wrap.appendChild(el("p", "mono", shown === "" ? "not recorded" : shown));
  }
  if (isWithheld) wrap.appendChild(el("p", "muted", WITHHELD_EXPLANATION));
  else if (arr(truncatedNames).indexOf(key) !== -1) {
    wrap.appendChild(el("p", "muted", "This value was shortened before publishing."));
  }
  return wrap;
}

function elementsSection(f, viol, evidenceError) {
  const s = section("Affected elements");
  if (f.hasElementDetail !== true) {
    s.appendChild(el("p", "", NO_ELEMENT_DETAIL_TEXT));
    if (str(f.detail)) s.appendChild(el("p", "", "Recorded detail: " + f.detail));
    return s;
  }
  if (evidenceError) {
    s.appendChild(el("p", "", "Element detail could not be loaded: " + evidenceError));
    return s;
  }
  const nodes = viol ? arr(viol.nodes) : [];
  if (!viol || nodes.length === 0) {
    s.appendChild(el("p", "", NO_ELEMENT_DETAIL_TEXT));
    if (str(f.detail)) s.appendChild(el("p", "", "Recorded detail: " + f.detail));
    return s;
  }
  const total = typeof viol.nodeCount === "number" ? viol.nodeCount : f.nodeCount;
  const omitted = typeof viol.omittedNodeCount === "number" ? viol.omittedNodeCount : 0;
  s.appendChild(el("p", "", shownElementsText({ nodeCount: total, omittedNodeCount: omitted, shownNodeCount: nodes.length })));
  const list = el("ol", "node-list");
  let anyWithheld = false;
  nodes.forEach((n, i) => {
    const node = isObj(n) ? n : {};
    const li = el("li", "node-item");
    li.appendChild(el("h4", "node-item__title", "Element " + (i + 1)));
    li.appendChild(nodeField("HTML", node.html, node.withheld, node.truncated, "html", true));
    li.appendChild(nodeField("CSS target", node.target, node.withheld, node.truncated, "target", false));
    li.appendChild(nodeField("Failure summary", node.failureSummary, node.withheld, node.truncated, "failureSummary", false));
    if (arr(node.withheld).length) anyWithheld = true;
    list.appendChild(li);
  });
  s.appendChild(list);
  if (anyWithheld) s.appendChild(el("p", "muted", WITHHELD_EXPLANATION));
  return s;
}

function screenshotSection(f, run, runId, ctx, retentionRuns, visualItem) {
  const s = section("Screenshot");
  const captionCtx = { role: "current", pageUrl: f.pageUrl, viewport: f.viewport, runId, runFinishedAt: run.finishedAt };
  let rel = "screenshots/" + f.slug + "." + f.viewport + ".png";
  if (visualItem && isObj(visualItem.images) && visualItem.images.current) rel = visualItem.images.current;
  const src = run.hasImages === false ? "" : runFileUrl(runId, rel);
  if (!src || !f.slug || !f.viewport) {
    s.appendChild(el("p", "", imageUnavailableText("image-retention", retentionRuns, "current")));
    return s;
  }
  s.appendChild(imageFigure(src, imageAlt(captionCtx), evidenceCaption(captionCtx), "shot-current"));
  return s;
}

function otherPagesSection(f, run, ctx, runId) {
  const s = section("Same rule on other pages");
  const same = sameRuleOtherPages(arr(run.findings), f);
  if (same.count === 0) {
    s.appendChild(el("p", "", "No other page in this run has a finding for this rule."));
    return s;
  }
  const href = ctx.formatRoute({ view: "findings", params: { run: runId, rule: [f.ruleId] } });
  s.appendChild(el("p", "", "The same rule also failed on " + plural(same.count, "other page", "other pages") + " in this run."));
  s.appendChild(link("Show all findings for this rule in this run", href));
  return s;
}

function suppressedNames(f, item) {
  const fromItem = item && Array.isArray(item.suppressedBy) ? item.suppressedBy : [];
  const list = fromItem.length ? fromItem : arr(f.suppressedBy);
  return list.filter((x) => typeof x === "string" && x);
}

function visualSection(f, run, runId, ctx, retentionRuns, item) {
  const s = section("Visual difference");
  const where = (f.pageUrl || "this page") + " at the " + (f.viewport || "recorded") + " viewport";
  s.appendChild(el("p", "", "The current screenshot differs from the approved baseline image for " + where + "."));

  const names = suppressedNames(f, item);
  if (f.suppressed === true || (item && item.suppressed === true) || names.length) {
    s.appendChild(
      el(
        "p",
        "",
        "This difference is not reported as a separate failure because the page already has failing accessibility rules" +
          (names.length ? ": " + names.join(", ") : "") +
          ". Fix those first, then check whether the visual difference remains."
      )
    );
  }

  if (!item) {
    s.appendChild(el("p", "", "Visual details are not available for this run."));
    s.appendChild(el("p", "", MEASURE_NOT_RECORDED_TEXT));
  } else {
    const m = measureText(item.measure);
    if (m) {
      const src = isObj(item.measure) ? item.measure.source : null;
      const prov =
        src === "recorded" ? "recorded during the run" : src === "derived-from-diff-image" ? "derived from the difference image" : "";
      s.appendChild(
        el("p", "", "Difference measure for " + where + ": " + m + (prov ? " (" + prov + ")" : "") + ".")
      );
    } else {
      s.appendChild(el("p", "", MEASURE_NOT_RECORDED_TEXT));
    }
    if (item.dimensionsChanged === true) {
      s.appendChild(el("p", "", "The screenshot size changed compared with the approved baseline (for example the page got longer), so a pixel comparison is not possible. A new baseline may need to be approved."));
    }
    const base = isObj(item.baseline) ? item.baseline : {};
    const approved = str(base.approvedAt) ? formatDateTime(base.approvedAt) : "not recorded";
    const source = str(base.sourceRunId) || "not recorded";
    const prov = kvList([
      ["Current image run", (runId || "Run not recorded") + ", " + formatDateTime(run.finishedAt)],
      ["Baseline approval date", approved],
      ["Baseline source run", source],
    ]);
    s.appendChild(prov);
    if (base.published === false && base.reason) {
      s.appendChild(el("p", "", imageUnavailableText(base.reason, retentionRuns, "baseline")));
    }
  }
  s.appendChild(el("p", "muted", DIFF_LEGEND));
  if (f.slug && f.viewport) {
    s.appendChild(
      link("Compare baseline, current and difference images", ctx.formatRoute({ view: "visual", runId, slug: f.slug, viewport: f.viewport, params: {} }))
    );
  }
  return s;
}

function guidanceSection(f, run, guidance) {
  const wrap = el("section", "guidance", null, { "data-guidance": "true", "aria-label": GUIDANCE_LABEL });
  wrap.appendChild(el("span", "guidance__label", GUIDANCE_LABEL));
  wrap.appendChild(el("p", "muted", GUIDANCE_SUBTITLE));
  const ids = new Set();
  for (const x of arr(run.findings)) if (isObj(x) && x.id) ids.add(x.id);
  for (const x of arr(run.ignored)) if (isObj(x) && x.id) ids.add(x.id);
  const items = visibleGuidance(isObj(guidance) ? guidance.items : [], ids).filter((g) => g.findingId === f.id);
  if (items.length === 0) {
    wrap.appendChild(el("p", "", "No automated guidance is available for this finding."));
    return wrap;
  }
  const ul = el("ul", "guidance__list");
  for (const g of items) {
    const li = el("li");
    li.appendChild(el("p", "", str(g.text)));
    li.appendChild(
      el(
        "p",
        "muted",
        "Page: " + (str(g.pageUrl) || f.pageUrl || "not recorded") +
          ". Rule or check: " + (str(g.checkId) || f.ruleId || "not recorded") +
          ". Severity: " + (str(g.severity) || f.severity || "not recorded") + "."
      )
    );
    if (str(g.reviewerDecision)) li.appendChild(el("p", "", "What the reviewer decides: " + g.reviewerDecision));
    ul.appendChild(li);
  }
  wrap.appendChild(ul);
  return wrap;
}

// ---------------------------------------------------------------------------
// render
// ---------------------------------------------------------------------------

export async function render(container, ctx) {
  const runId = ctx.route.runId;
  const findingId = ctx.route.findingId;
  clear(container);
  const wait = loading("Loading finding...");
  container.appendChild(wait);

  const bundle = await ctx.loadRun(runId, ["visual", "guidance"]);
  if (typeof ctx.isCurrent === "function" && !ctx.isCurrent()) return;
  const run = bundle && bundle.run;
  const hit = findFinding(run, findingId);
  if (!hit) {
    clear(container);
    ctx.notFound(container);
    return;
  }
  const f = hit.finding;

  // Evidence (element detail) is loaded only when the Finding has it.
  let viol = null;
  let evidenceError = "";
  if (f.kind === "a11y-rule" && f.hasElementDetail === true && f.slug && f.viewport) {
    try {
      const ev = await ctx.loadEvidence(runId, f.slug, f.viewport);
      const list = isObj(ev) ? arr(ev.violations) : [];
      viol = list.find((v) => isObj(v) && v.findingId === f.id) || null;
    } catch (err) {
      evidenceError = err && err.message ? String(err.message) : "the evidence file could not be loaded";
    }
    if (typeof ctx.isCurrent === "function" && !ctx.isCurrent()) return;
  }

  const visual = bundle && isObj(bundle.visual) ? bundle.visual : null;
  const item =
    visual && arr(visual.items).find((v) => isObj(v) && (v.findingId === f.id || (v.slug === f.slug && v.viewport === f.viewport && f.kind === "visual"))) || null;
  const retention =
    ctx.state && isObj(ctx.state.index) && typeof ctx.state.index.imageRetentionRuns === "number" ? ctx.state.index.imageRetentionRuns : 10;

  const nodeCount = viol && typeof viol.nodeCount === "number" ? viol.nodeCount : f.nodeCount || 0;
  const firstTarget = viol && arr(viol.nodes)[0] && isObj(viol.nodes[0]) ? str(viol.nodes[0].target) : "";
  const summary = plainEnglishSummary(f, undefined, { firstTarget, measure: item ? item.measure : undefined });

  clear(container);
  const heading = f.kind === "visual" ? f.title || "Screenshot differs from approved baseline" : f.title || f.ruleId || "Finding";
  const root = el("div", "view finding-detail");
  root.appendChild(el("h2", "", heading));
  root.appendChild(link("Back to this run", ctx.formatRoute({ view: "run", runId, params: {} })));
  const officeHref = officeFindingLink(runId, f);
  if (officeHref) {
    const op = el("p", "office-link");
    op.appendChild(link("See how this was found", officeHref));
    if (!f.producedAt) {
      op.appendChild(el("span", "muted", " The moment this was found was not recorded for this run."));
    }
    root.appendChild(op);
  }
  root.appendChild(severityBlock(f));
  for (const b of dispositionBlocks(f, hit.ignored)) root.appendChild(b);

  const sum = section("Summary");
  sum.appendChild(el("p", "", summary));
  if (f.kind === "a11y-rule" && !catalogueEntry(f.ruleId)) {
    sum.appendChild(el("p", "muted", FALLBACK_NOTE));
    if (str(f.description) && f.description !== f.title) sum.appendChild(el("p", "", "Description: " + f.description));
    if (str(f.help)) sum.appendChild(el("p", "", "Help: " + f.help));
  }
  root.appendChild(sum);

  root.appendChild(affectedSection(f, nodeCount, viol));
  root.appendChild(factsSection(f, run, runId));
  if (f.kind === "visual") {
    root.appendChild(visualSection(f, run, runId, ctx, retention, item));
  } else {
    root.appendChild(fixSection(f));
    root.appendChild(elementsSection(f, viol, evidenceError));
  }
  if (f.slug && f.viewport) root.appendChild(screenshotSection(f, run, runId, ctx, retention, item));
  if (f.kind === "a11y-rule" && f.ruleId) root.appendChild(otherPagesSection(f, run, ctx, runId));
  root.appendChild(guidanceSection(f, run, bundle ? bundle.guidance : null));

  container.appendChild(root);
  return { announce: "Finding: " + heading };
}
