import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { AppendOnlyLog } from "../telemetry/audit-log.js";
import { newReviewId } from "../core/ids.js";

export type HumanDecisionKind =
  | "accepted"
  | "rejected"
  | "dismissed"
  | "baseline-update-approved";

export interface HumanDecision {
  reviewer: string; // human identity; never an agent name
  decision: HumanDecisionKind;
  reason: string;
  slug: string;
  producedBy?: string; // agent/process that produced the artifact
}

export class SelfApprovalError extends Error {}
export class ApprovalError extends Error {}

const AGENT_IDENTITIES = new Set([
  "Specification_Agent",
  "Spec_Generator",
  "Discovery crawler",
  "Quality_Analysis_Agent",
  "Visual_Explanation_Agent",
  "Triage_Agent",
  "Orchestrator",
]);

/**
 * Approval_Gate (Req 4, 10, 14, 15, 31.4). The ONLY path that promotes a draft
 * to a baseline. Human-driven, atomic, audited, never self-approved.
 */
export class ApprovalGate {
  constructor(
    private readonly auditLog: AppendOnlyLog,
    private readonly pendingRoot = "artifacts/pending-review/spec-drafts",
    private readonly baselinesRoot = "baselines",
  ) {}

  /** Promote a draft to a versioned baseline atomically, then audit (Req 4.3, 4.7). */
  approveSpecification(d: HumanDecision): { baselinePath: string; version: number; reviewId: string } {
    this.assertHuman(d);
    if (d.decision !== "accepted") {
      throw new ApprovalError(`approveSpecification requires decision "accepted", got "${d.decision}"`);
    }
    const draftPath = resolve(this.pendingRoot, `${d.slug}.draft.md`);
    if (!existsSync(draftPath)) {
      throw new ApprovalError(`No draft found for slug "${d.slug}" at ${draftPath}`);
    }

    const dir = resolve(this.baselinesRoot, d.slug);
    mkdirSync(dir, { recursive: true });
    const version = this.nextVersion(dir);
    const finalPath = join(dir, `baseline.v${version}.md`);
    const reviewId = newReviewId();

    // Atomic: write promoted content to temp, then rename into place. The audit
    // success entry is written ONLY after the rename succeeds (Req 4.3, 4.7).
    try {
      const tmp = finalPath + ".tmp";
      const body = readFileSync(draftPath, "utf8").replace("- **State:** draft", `- **State:** baseline v${version} (approved by ${d.reviewer})`);
      writeFileSync(tmp, body, "utf8");
      renameSync(tmp, finalPath);
    } catch (err) {
      this.auditLog.append({
        type: "baseline-promotion-failed",
        reviewId,
        reviewer: d.reviewer,
        slug: d.slug,
        reason: String(err),
      });
      throw new ApprovalError(`Promotion failed; recorded failed attempt. ${String(err)}`);
    }

    this.auditLog.append({
      type: "baseline-approved",
      reviewId,
      reviewer: d.reviewer,
      decision: d.decision,
      reason: d.reason,
      slug: d.slug,
      baselineVersion: version,
      baselinePath: finalPath,
    });
    return { baselinePath: finalPath, version, reviewId };
  }

  /** Record a finding disposition (accept/reject/dismiss). Never auto. (Req 15.3) */
  disposeFinding(d: HumanDecision & { findingId: string }): string {
    this.assertHuman(d);
    const reviewId = newReviewId();
    this.auditLog.append({
      type: "finding-disposition",
      reviewId,
      reviewer: d.reviewer,
      decision: d.decision,
      reason: d.reason,
      findingId: d.findingId,
    });
    return reviewId;
  }

  private assertHuman(d: HumanDecision): void {
    if (!d.reviewer || d.reviewer.trim().length === 0) {
      throw new ApprovalError("A human reviewer identity is required.");
    }
    if (AGENT_IDENTITIES.has(d.reviewer)) {
      this.auditLog.append({ type: "self-approval-rejected", reviewer: d.reviewer, slug: d.slug });
      throw new SelfApprovalError(`Agent "${d.reviewer}" may not approve. A human reviewer is required.`);
    }
    if (d.producedBy && d.producedBy === d.reviewer) {
      this.auditLog.append({ type: "self-approval-rejected", reviewer: d.reviewer, slug: d.slug });
      throw new SelfApprovalError("An actor may not approve its own output.");
    }
  }

  private nextVersion(dir: string): number {
    let v = 1;
    while (existsSync(join(dir, `baseline.v${v}.md`))) v++;
    return v;
  }
}
