import { createHash } from "node:crypto";

/**
 * Accessibility finding fingerprinting + recurrence (Phase 3, Req 3-series).
 * A fingerprint deterministically identifies "the same" finding across runs
 * using Axe rule + page + viewport + stable element context + failure summary.
 * The Axe rule ID ALONE is never used to decide identity.
 */
export interface A11yViolationInput {
  ruleId: string;
  pageUrl: string;
  viewport: string;
  impact: string | null;
  help?: string;
  helpUrl?: string;
  targets?: string[]; // stable CSS selectors / contexts where safely available
  summary?: string;
}

export function fingerprint(v: A11yViolationInput): string {
  const ctx = (v.targets && v.targets.length ? v.targets.slice().sort().join("|") : "") + "::" + (v.summary ?? "");
  const basis = [v.ruleId, v.pageUrl, v.viewport, ctx].join("##");
  return "a11y_" + createHash("sha1").update(basis).digest("hex").slice(0, 16);
}

export type FindingState =
  | "new"
  | "existing-unresolved"
  | "recurring"
  | "resolved"
  | "reopened"
  | "dismissed-reappeared";

export interface TrackedFinding {
  fingerprint: string;
  ruleId: string;
  pageUrl: string;
  viewport: string;
  impact: string | null;
  help?: string;
  helpUrl?: string;
  firstSeen: string;
  lastSeen: string;
  occurrenceCount: number;
  runsSeen: string[];
  state: FindingState;
  humanDisposition?: "accepted" | "rejected" | "dismissed" | null;
  resolutionDate?: string | null;
}

/**
 * Merge the current run's violations into the prior history, computing state
 * transitions deterministically. Never auto-dismisses a recurring finding.
 */
export function updateHistory(
  prior: Record<string, TrackedFinding>,
  current: A11yViolationInput[],
  runId: string,
  ts: string,
): Record<string, TrackedFinding> {
  const next: Record<string, TrackedFinding> = {};
  // Clone prior.
  for (const [k, v] of Object.entries(prior)) next[k] = { ...v, runsSeen: [...v.runsSeen] };

  const currentFps = new Set<string>();
  for (const v of current) {
    const fp = fingerprint(v);
    currentFps.add(fp);
    const existing = next[fp];
    if (!existing) {
      next[fp] = {
        fingerprint: fp, ruleId: v.ruleId, pageUrl: v.pageUrl, viewport: v.viewport,
        impact: v.impact, help: v.help, helpUrl: v.helpUrl,
        firstSeen: ts, lastSeen: ts, occurrenceCount: 1, runsSeen: [runId],
        state: "new", humanDisposition: null, resolutionDate: null,
      };
    } else {
      existing.lastSeen = ts;
      existing.occurrenceCount += 1;
      if (!existing.runsSeen.includes(runId)) existing.runsSeen.push(runId);
      if (existing.state === "resolved") existing.state = "reopened";
      else if (existing.humanDisposition === "dismissed") existing.state = "dismissed-reappeared";
      else if (existing.state === "new") existing.state = "recurring";
      else existing.state = "existing-unresolved";
    }
  }

  // Findings not seen this run but previously unresolved => resolved (only if
  // they were previously present AND not seen now). Never auto-dismiss.
  for (const [fp, f] of Object.entries(next)) {
    if (!currentFps.has(fp) && f.state !== "resolved" && f.humanDisposition !== "dismissed") {
      f.state = "resolved";
      f.resolutionDate = ts;
    }
  }
  return next;
}
