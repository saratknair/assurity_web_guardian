import { newFindingId } from "../core/ids.js";
import type { FindingClassification } from "../telemetry/types.js";
import type { Outcome } from "./comparator.js";

/**
 * Fixed-template text generators (no model calls). Their outputs are separate,
 * linked records (relatedFindingId) classified ai-generated-analysis or
 * agent-recommendation (stored values kept so published runs stay readable;
 * the text is produced from templates, not by a model). They never overwrite a deterministic finding's
 * classification and are always labeled, never presented as fact.
 */
export interface TemplateItem {
  findingId: string;
  relatedFindingId: string;
  classification: FindingClassification;
  agent: string;
  label: string; // human-visible "Template text" label
  text: string;
  confidence?: number;
}

/** Quality_Analysis_Agent: interprets a deterministic outcome. */
export function qualityText(outcome: Outcome): TemplateItem {
  return {
    findingId: newFindingId(),
    relatedFindingId: outcome.findingId,
    classification: "ai-generated-analysis",
    agent: "Quality_Analysis_Agent",
    label: "Template text (not a deterministic fact)",
    text:
      outcome.kind === "failed-check"
        ? `Likely impact: a failing deterministic check ("${outcome.detail}") may affect users; recommend human review.`
        : `Observed change ("${outcome.detail}") is not a deterministic failure; a human should decide if it matters.`,
    confidence: 0.6,
  };
}

/** Visual_Explanation_Agent: explains a visual finding in plain language. */
export function visualText(outcome: Outcome): TemplateItem | null {
  if (outcome.kind !== "visual-finding") return null;
  return {
    findingId: newFindingId(),
    relatedFindingId: outcome.findingId,
    classification: "ai-generated-analysis",
    agent: "Visual_Explanation_Agent",
    label: "Template text (not a deterministic fact)",
    text: "The current screenshot differs visually from the baseline. This may be a layout or content change; a human should confirm whether it is expected.",
    confidence: 0.5,
  };
}

/** Triage_Agent: proposes a consolidated recommendation across outcomes. */
export function triageText(outcomes: Outcome[]): TemplateItem {
  const failed = outcomes.filter((o) => o.kind === "failed-check").length;
  const changes = outcomes.filter((o) => o.kind !== "failed-check").length;
  const text =
    failed > 0
      ? `Recommend prioritising ${failed} failing check(s) for human review before the ${changes} observed change(s).`
      : `No deterministic failures; recommend a human reviews ${changes} observed change(s) at normal priority.`;
  return {
    findingId: newFindingId(),
    relatedFindingId: outcomes[0]?.findingId ?? "none",
    classification: "agent-recommendation",
    agent: "Triage_Agent",
    label: "Agent recommendation (not a deterministic fact)",
    text,
    confidence: 0.55,
  };
}
