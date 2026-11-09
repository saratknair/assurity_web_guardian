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

/** Optional extra context copied into a finding-disposition audit entry. */
export interface DispositionDetail {
  scope?: string;
  matcher?: unknown;
  undoes?: string;
  [key: string]: unknown;
}

export type DispositionKind = "ignore" | "resolve" | "unignore";

export const DISPOSITION_DECISION: Record<DispositionKind, HumanDecisionKind> = {
  ignore: "dismissed",
  resolve: "accepted",
  unignore: "rejected",
};

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
  approveSpecification(
    d: HumanDecision,
    opts: { baselinesRoot?: string } = {},
  ): { baselinePath: string; version: number; reviewId: string } {
    this.assertHuman(d);
    if (d.decision !== "accepted") {
      throw new ApprovalError(`approveSpecification requires decision "accepted", got "${d.decision}"`);
    }
    const draftPath = resolve(this.pendingRoot, `${d.slug}.draft.md`);
    if (!existsSync(draftPath)) {
      throw new ApprovalError(`No draft found for slug "${d.slug}" at ${draftPath}`);
    }

    const dir = resolve(opts.baselinesRoot ?? this.baselinesRoot, d.slug);
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
  disposeFinding(d: HumanDecision & { findingId: string; detail?: DispositionDetail }): string {
    this.assertHuman(d);
    const reviewId = newReviewId();
    const entry: Record<string, unknown> = {
      type: "finding-disposition",
      reviewId,
      reviewer: d.reviewer,
      decision: d.decision,
      reason: d.reason,
      findingId: d.findingId,
    };
    if (d.detail !== undefined) entry.detail = d.detail;
    this.auditLog.append(entry as never);
    return reviewId;
  }

  /** Record a durable disposition decision (Req 18.9, 18.10, 17.11). */
  recordDispositionDecision(args: {
    id: string;
    kind: DispositionKind;
    reviewer: string;
    reason: string;
    slug: string;
    detail?: DispositionDetail;
  }): string {
    return this.disposeFinding({
      reviewer: args.reviewer,
      decision: DISPOSITION_DECISION[args.kind],
      reason: args.reason,
      slug: args.slug,
      findingId: "disposition:" + args.id,
      detail: args.detail,
    });
  }

  /** Authorize a console setup/config action (Req 21.5, 22.12, 24.7, 25.4). */
  authorizeSetupAction(args: {
    reviewer: string;
    action: string;
    detail?: Record<string, unknown>;
  }): string {
    this.assertHuman({
      reviewer: args.reviewer,
      decision: "accepted",
      reason: args.action,
      slug: args.action,
    });
    const reviewId = newReviewId();
    this.auditLog.append({
      type: "config-change-authorized",
      reviewId,
      reviewer: args.reviewer,
      action: args.action,
      detail: args.detail ?? {},
    });
    return reviewId;
  }

  /** Audit a visual baseline approval/update (Req 24.4). Same keys as the CLI script plus source and sha16. */
  approveVisualBaseline(args: {
    reviewer: string;
    slug: string;
    viewport: string;
    source: string;
    sha16: string;
    updated?: boolean;
    baselinePath?: string;
    sourceRun?: string;
  }): string {
    this.assertHuman({
      reviewer: args.reviewer,
      decision: "accepted",
      reason: "visual baseline",
      slug: args.slug,
    });
    const reviewId = newReviewId();
    const baselinePath =
      args.baselinePath ?? resolve("baselines-visual", args.slug, `${args.viewport}.png`);
    const updated = args.updated ?? existsSync(baselinePath);
    this.auditLog.append({
      type: updated ? "visual-baseline-updated" : "visual-baseline-approved",
      reviewId,
      reviewer: args.reviewer,
      slug: args.slug,
      viewport: args.viewport,
      sourceRun: args.sourceRun ?? args.source,
      baselinePath,
      source: args.source,
      sha16: args.sha16,
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
