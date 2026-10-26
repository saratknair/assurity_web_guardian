import type { FindingClassification } from "../telemetry/types.js";

/**
 * Finding_Classification taxonomy + strict precedence (Req 26). When an item
 * qualifies as multiple source types, precedence decides the single label:
 *   human-decision > agent-recommendation > ai-generated-analysis
 *   > observed-website-change > deterministic-test-evidence
 */
const PRECEDENCE: FindingClassification[] = [
  "human-decision",
  "agent-recommendation",
  "ai-generated-analysis",
  "observed-website-change",
  "deterministic-test-evidence",
];

export function resolveClassification(
  candidates: FindingClassification[],
): FindingClassification {
  if (candidates.length === 0) {
    throw new Error("resolveClassification requires at least one candidate");
  }
  for (const c of PRECEDENCE) {
    if (candidates.includes(c)) return c;
  }
  // Unreachable if candidates are valid classifications.
  return candidates[0];
}

export function precedenceRank(c: FindingClassification): number {
  return PRECEDENCE.indexOf(c);
}

/** True if `a` outranks (takes precedence over) `b`. */
export function outranks(a: FindingClassification, b: FindingClassification): boolean {
  return precedenceRank(a) < precedenceRank(b);
}
