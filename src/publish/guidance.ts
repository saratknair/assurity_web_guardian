/**
 * Deterministic Automated_Guidance (Requirements 7.3, 7.4, 7.5, 7.7, 7.9, 7.10).
 *
 * Pure. Built from Active_Findings only (run.runFindings.findings; the ignored
 * list is never read). Fixed templates by kind and severity; no model, no
 * confidence value. src/agents/ai-agents.ts is untouched.
 */
import { createHash } from "node:crypto";
import type { BuiltRun, PublishedFinding } from "./run-findings.js";
import type { VisualItem } from "./visual.js";
import type { PublishCaps } from "./evidence.js";

export interface GuidanceItem {
  guidanceId: string;
  findingId: string;
  pageUrl: string;
  checkId: string;
  severity: string;
  label: "Automated guidance";
  generatedBy: "fixed-rules";
  title: string;
  text: string;
  reviewerDecision: string;
}

export interface GuidanceResult {
  items: GuidanceItem[];
  omitted: number;
}

// ---------------------------------------------------------------------------
// isGenericGuidance: MUST mirror dashboard/lib/guidance.js exactly (R7.5).
// ---------------------------------------------------------------------------

export const GENERIC_GUIDANCE_CORES: readonly string[] = Object.freeze([
  "a failing deterministic check may affect users; recommend human review",
  "observed change is not a deterministic failure; a human should decide if it matters",
  "the current screenshot differs visually from the baseline. this may be a layout or content change; a human should confirm whether it is expected",
]);

/** True when the text carries no more information than a generic template. */
export function isGenericGuidance(text: unknown): boolean {
  if (typeof text !== "string") return true;
  let t = text.replace(/\s+/g, " ").trim().toLowerCase();
  if (t === "") return true;
  const open = t.indexOf('("');
  const close = t.lastIndexOf('")');
  if (open !== -1 && close !== -1 && close >= open) {
    const start = open > 0 && t.charAt(open - 1) === " " ? open - 1 : open;
    t = t.slice(0, start) + t.slice(close + 2);
  }
  if (t.indexOf("likely impact:") === 0) t = t.slice("likely impact:".length).replace(/^ +/, "");
  t = t.replace(/\.+$/, "").trim();
  return GENERIC_GUIDANCE_CORES.indexOf(t) !== -1;
}

// ---------------------------------------------------------------------------
// builder
// ---------------------------------------------------------------------------

const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  serious: 1,
  moderate: 2,
  minor: 3,
  unrated: 4,
  "not-recorded": 5,
};

function rank(s: string): number {
  return s in SEVERITY_RANK ? SEVERITY_RANK[s] : 6;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** First sentence of published help text; never invented. */
function firstSentence(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t === "") return "";
  const m = /^.*?[.!?](?=\s|$)/.exec(t);
  const sentence = m ? m[0] : t;
  return /[.!?]$/.test(sentence) ? sentence : sentence + ".";
}

function severityLabel(s: string): string {
  return s === "not-recorded" ? "not recorded" : s;
}

function measureText(v: VisualItem | undefined): string {
  const m = v?.measure;
  if (!m) return "difference measure not recorded";
  return `${m.diffPixels} of ${m.totalPixels} pixels differ, ${(m.diffRatio * 100).toFixed(2)}%`;
}

const VISUAL_DECISION =
  "Decide whether this visual change is intended. If it is, approve a new baseline; if it is not, investigate the change.";
const A11Y_DECISION = "Confirm the fix on the listed elements and re-run the check.";
const CHECK_DECISION = "Decide whether the page content is intended.";

function draft(f: PublishedFinding, visualById: Map<string, VisualItem>): Omit<GuidanceItem, "guidanceId" | "label" | "generatedBy"> {
  const base = { findingId: f.id, pageUrl: f.pageUrl, checkId: f.ruleId, severity: f.severity };
  const sev = severityLabel(f.severity);
  if (f.kind === "visual") {
    const suppressedBy = Array.isArray(f.suppressedBy) ? (f.suppressedBy as unknown[]).filter((x) => typeof x === "string") : [];
    let text = `The ${f.viewport} screenshot of ${f.pageUrl} differs from the approved baseline (${measureText(visualById.get(f.id))}). Rule visual-diff, severity ${sev}.`;
    if (f.suppressed === true && suppressedBy.length > 0) {
      text += ` A failing rule (${suppressedBy.join(", ")}) on this page also needs attention.`;
    }
    return { ...base, title: `Review the ${f.viewport} visual change on ${f.pageUrl}`, text, reviewerDecision: VISUAL_DECISION };
  }
  if (f.kind === "check") {
    const name = f.ruleId.replace(/^check:/, "");
    const detail = str(f.detail).replace(/\s+/g, " ").trim().replace(/\.+$/, "");
    const text =
      `The "${name}" check failed on ${f.pageUrl} (${f.viewport}), severity ${sev}` + (detail ? `: ${detail}.` : ".");
    return { ...base, title: `Check "${name}" failed on ${f.pageUrl}`, text, reviewerDecision: CHECK_DECISION };
  }
  const nodeCount = typeof f.nodeCount === "number" ? f.nodeCount : 0;
  const help = str(f.title) || f.ruleId;
  const hint = firstSentence(str(f.title) || str(f.description));
  const text =
    `On ${f.pageUrl} (${f.viewport}), the rule "${f.ruleId}" failed on ${nodeCount} element(s) and has ${sev} impact.` +
    (hint ? ` ${hint}` : "");
  return { ...base, title: `Fix "${help}" on ${f.pageUrl}`, text, reviewerDecision: A11Y_DECISION };
}

/**
 * Build guidance for the Active_Findings of a run. Items are sorted by
 * severity rank, page URL, rule id (then viewport and id for stability) and
 * capped at caps.maxGuidancePerRun; `omitted` counts findings left out.
 */
export function buildGuidance(run: BuiltRun, visual: VisualItem[], caps: PublishCaps): GuidanceResult {
  const visualById = new Map<string, VisualItem>();
  for (const v of visual) visualById.set(v.findingId, v);
  const active = [...run.runFindings.findings].sort(
    (a, b) =>
      rank(a.severity) - rank(b.severity) ||
      a.pageUrl.localeCompare(b.pageUrl) ||
      a.ruleId.localeCompare(b.ruleId) ||
      a.viewport.localeCompare(b.viewport) ||
      a.id.localeCompare(b.id),
  );
  const items: GuidanceItem[] = [];
  let omitted = 0;
  for (const f of active) {
    const d = draft(f, visualById);
    // Never publish generic text (R7.5); templates are specific, so this is a safety net.
    if (items.length >= caps.maxGuidancePerRun || isGenericGuidance(d.text)) {
      omitted++;
      continue;
    }
    const guidanceId = "gd_" + createHash("sha1").update(`${run.runFindings.runId}#${f.id}`).digest("hex").slice(0, 12);
    items.push({ guidanceId, ...d, label: "Automated guidance", generatedBy: "fixed-rules" });
  }
  return { items, omitted };
}
