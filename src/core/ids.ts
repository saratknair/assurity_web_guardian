import { randomUUID } from "node:crypto";

/**
 * Identifier model (Req 20.3, 20.4). Every child entity references the parent
 * correlationId. IDs are prefixed and time-sortable (timestamp + random tail).
 */
export type IdPrefix = "run" | "cor" | "task" | "chk" | "fnd" | "evd" | "rev";

function mint(prefix: IdPrefix): string {
  const ts = Date.now().toString(36);
  const rand = randomUUID().replace(/-/g, "").slice(0, 12);
  return `${prefix}_${ts}${rand}`;
}

export const newRunId = () => mint("run");
export const newCorrelationId = () => mint("cor");
export const newTaskId = () => mint("task");
export const newCheckId = () => mint("chk");
export const newFindingId = () => mint("fnd");
export const newEvidenceId = () => mint("evd");
export const newReviewId = () => mint("rev");

export interface CorrelatedEntity {
  correlationId: string;
}

/** A run mints one runId and one shared correlationId for all children. */
export interface RunIds {
  runId: string;
  correlationId: string;
}

export function newRunIds(): RunIds {
  return { runId: newRunId(), correlationId: newCorrelationId() };
}
