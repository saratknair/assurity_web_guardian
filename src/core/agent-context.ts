import type { TrackedFinding } from "../agents/a11y-history.js";
import { loadA11yHistory } from "../agents/a11y-history-store.js";

/**
 * Bounded historical context for agents (Phase 4, Req 4-series). Agents receive
 * ONLY relevant, bounded records — never unrestricted access to all history.
 * Each context item exposes a stable record ID that AI outputs MUST cite.
 * Objective measurements stay separate from any prior AI analysis; previous AI
 * output is never provided here as evidence.
 */
export interface ContextItem {
  recordId: string;        // the fingerprint / record id the AI must cite
  statement: string;       // objective, factual statement
  sourceRuns: string[];    // runs that substantiate it
}

export interface BoundedContext {
  findingId: string;
  items: ContextItem[];
}

/**
 * Build bounded context for a specific accessibility finding, identified by its
 * rule + page + viewport. Returns at most `maxItems` relevant facts.
 */
export function contextForFinding(
  ruleId: string,
  pageUrl: string,
  viewport: string,
  findingId: string,
  historyPath = "artifacts/a11y-history.json",
  maxItems = 5,
): BoundedContext {
  const history = loadA11yHistory(historyPath);
  const items: ContextItem[] = [];

  const match = Object.values(history).find(
    (f) => f.ruleId === ruleId && f.pageUrl === pageUrl && f.viewport === viewport,
  );
  if (match) {
    items.push({
      recordId: match.fingerprint,
      statement: `This finding first appeared ${match.firstSeen} and has been seen in ${match.runsSeen.length} run(s); current state: ${match.state}.`,
      sourceRuns: match.runsSeen.slice(-5),
    });
    if (match.humanDisposition) {
      items.push({
        recordId: match.fingerprint,
        statement: `A human previously recorded disposition "${match.humanDisposition}" for this finding.`,
        sourceRuns: match.runsSeen.slice(-1),
      });
    }
  }

  // Same rule affecting other pages (bounded).
  const samRuleOtherPages = Object.values(history).filter(
    (f) => f.ruleId === ruleId && f.pageUrl !== pageUrl,
  );
  if (samRuleOtherPages.length > 0) {
    items.push({
      recordId: match?.fingerprint ?? `rule:${ruleId}`,
      statement: `The same rule "${ruleId}" affects ${samRuleOtherPages.length} other approved page(s).`,
      sourceRuns: [...new Set(samRuleOtherPages.flatMap((f) => f.runsSeen))].slice(-5),
    });
  }

  return { findingId, items: items.slice(0, maxItems) };
}

/**
 * Validate that an AI output cites at least one of the provided record IDs
 * (Req 4-series: AI outputs must reference the historical record IDs used).
 */
export function aiOutputCitesContext(citedRecordIds: string[], ctx: BoundedContext): boolean {
  if (ctx.items.length === 0) return true; // nothing to cite
  const allowed = new Set(ctx.items.map((i) => i.recordId));
  return citedRecordIds.some((id) => allowed.has(id));
}

