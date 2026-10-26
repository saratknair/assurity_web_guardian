import { existsSync, writeFileSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { loadConfig } from "../config/app-config.js";
import { runGuardian } from "./orchestrator.js";

/**
 * ScheduledTrigger (Phase 7, Req 7-series). Reuses the EXISTING orchestration
 * path (runGuardian) — same approved pages, safety, agents, baselines, telemetry,
 * evidence, reporting, review gates. Scheduled runs NEVER bypass human approval.
 * Overlap is prevented with a lockfile; if a run is active, a skipped-run event
 * is recorded and the active run is preserved.
 */
const LOCK = "artifacts/.guardian.lock";

export class ScheduledTrigger {
  readonly kind = "scheduled" as const;

  async start(): Promise<string> {
    const lockPath = resolve(LOCK);
    mkdirSync(dirname(lockPath), { recursive: true });

    if (existsSync(lockPath)) {
      const owner = safeRead(lockPath);
      recordSkipped(owner);
      console.log("SKIPPED_OVERLAP: a Guardian run is already active (" + owner + ")");
      return "skipped-overlap";
    }

    const token = `pid:${process.pid} started:${new Date().toISOString()}`;
    writeFileSync(lockPath, token, "utf8");
    try {
      const cfg = loadConfig();
      const runId = await runGuardian(cfg);
      writeDailySummary(runId);
      return runId;
    } finally {
      // Only remove the lock if we still own it.
      if (existsSync(lockPath) && safeRead(lockPath) === token) rmSync(lockPath, { force: true });
    }
  }
}

function safeRead(p: string): string {
  try { return readFileSync(p, "utf8"); } catch { return ""; }
}

function recordSkipped(owner: string): void {
  const p = resolve("artifacts/skipped-runs.jsonl");
  const line = JSON.stringify({ ts: new Date().toISOString(), type: "scheduled-run-skipped", reason: "overlap", activeRun: owner }) + "\n";
  try { writeFileSync(p, (existsSync(p) ? readFileSync(p, "utf8") : "") + line, "utf8"); } catch { /* ignore */ }
}

/** Daily summary (Req 7-series). No external messaging/email — local file only. */
export function writeDailySummary(runId: string): string {
  const runDir = resolve("artifacts/runs", runId);
  const findingsPath = join(runDir, "findings.json");
  let pages = 0, failed = 0, pending = false;
  if (existsSync(findingsPath)) {
    const d = JSON.parse(readFileSync(findingsPath, "utf8"));
    const pageList = d.pages ?? [];
    pages = pageList.length;
    failed = pageList.flatMap((p: { outcomes?: { kind: string }[] }) => p.outcomes ?? []).filter((o: { kind: string }) => o.kind === "failed-check").length;
    pending = d.awaitingReview === true;
  }
  const summary = {
    date: new Date().toISOString().slice(0, 10),
    runId,
    status: failed > 0 ? "requires-human-review" : "passed",
    pagesChecked: pages,
    deterministicFailures: failed,
    pendingReviews: pending,
    evidenceLocation: runDir,
  };
  const out = resolve("artifacts/daily-summary.json");
  writeFileSync(out, JSON.stringify(summary, null, 2), "utf8");
  return out;
}
