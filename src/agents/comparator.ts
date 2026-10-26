import { newFindingId } from "../core/ids.js";
import type { FindingClassification } from "../telemetry/types.js";

/**
 * Comparator (Req 8, 26, 27). Classifies comparison outcomes rather than
 * treating every difference as a failure:
 *   - violated explicit deterministic expectation => Failed_Check (deterministic-test-evidence)
 *   - difference w/o violated expectation => Observed_Website_Change (observed-website-change)
 *   - screenshot difference => Visual_Finding (observed-website-change), UNLESS a
 *     deterministic rule is violated in the same comparison => only the
 *     Failed_Check is recorded and the Visual_Finding is suppressed (Req 8.4).
 */
export type OutcomeKind = "failed-check" | "observed-website-change" | "visual-finding";

export interface DeterministicCheck {
  name: string;
  passed: boolean; // false = explicit expectation violated
  detail: string;
}

export interface ComparatorInput {
  page: string;
  deterministicChecks: DeterministicCheck[];
  observedDifferences: string[]; // differences with NO explicit violated expectation
  screenshotDiffers: boolean;
  screenshotDeterministicRuleViolated?: boolean; // e.g. missing element / overlap / CTA gone
}

export interface Outcome {
  findingId: string;
  kind: OutcomeKind;
  classification: FindingClassification;
  detail: string;
  requiresHumanReview: boolean;
}

export interface ComparisonResult {
  page: string;
  outcomes: Outcome[];
  failedCheckCount: number;
}

export function compare(input: ComparatorInput): ComparisonResult {
  const outcomes: Outcome[] = [];

  // 1. Deterministic failures => Failed_Check.
  for (const c of input.deterministicChecks) {
    if (!c.passed) {
      outcomes.push({
        findingId: newFindingId(),
        kind: "failed-check",
        classification: "deterministic-test-evidence",
        detail: `${c.name}: ${c.detail}`,
        requiresHumanReview: true,
      });
    }
  }

  // 2. Differences without a violated expectation => Observed_Website_Change.
  for (const d of input.observedDifferences) {
    outcomes.push({
      findingId: newFindingId(),
      kind: "observed-website-change",
      classification: "observed-website-change",
      detail: d,
      requiresHumanReview: true,
    });
  }

  // 3. Screenshot difference => Visual_Finding, UNLESS a deterministic rule was
  //    violated in the same comparison (then only the Failed_Check stands, and
  //    the standalone Visual_Finding is suppressed — Req 8.4). Visual evidence
  //    is still attached to the deterministic finding by the caller; it is not
  //    discarded.
  if (input.screenshotDiffers) {
    if (input.screenshotDeterministicRuleViolated) {
      outcomes.push({
        findingId: newFindingId(),
        kind: "failed-check",
        classification: "deterministic-test-evidence",
        detail: "Screenshot difference with a violated deterministic rule (visual finding suppressed; evidence attached).",
        requiresHumanReview: true,
      });
    } else {
      outcomes.push({
        findingId: newFindingId(),
        kind: "visual-finding",
        classification: "observed-website-change",
        detail: "Screenshot differs from baseline; visual finding requires human review (not an automatic failure).",
        requiresHumanReview: true,
      });
    }
  }

  const failedCheckCount = outcomes.filter((o) => o.kind === "failed-check").length;
  return { page: input.page, outcomes, failedCheckCount };
}
