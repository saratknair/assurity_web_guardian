import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import type { TrackedFinding } from "../agents/a11y-history.js";

/**
 * Historical analytics (Phase 4, Req 4-series). DETERMINISTIC calculation over
 * completed run records. READ-ONLY: never rewrites history. Keeps objective
 * measurements strictly separate from prior AI analysis / recommendations /
 * human decisions. Previous AI output is NEVER promoted to objective evidence.
 */
export interface RunSummary {
  runId: string;
  correlationId: string;
  startedAt?: string;
  finishedAt?: string;
  result?: string;
  pages: number;
  failedChecks: number;
  a11yFindings: number;
  visualChanges: number;
}

export interface Analytics {
  totalRuns: number;
  successfulRuns: number; // result === "passed"
  reviewRequiredRuns: number; // requires-human-review
  pagesCheckedLatest: number;
  deterministicFailuresLatest: number;
  a11yBySeverity: Record<string, number>;
  findingLifecycle: { new: number; recurring: number; resolved: number; reopened: number; dismissedReappeared: number; existingUnresolved: number };
  visualChangesLatest: number;
  runs: RunSummary[];
}

function readJson<T>(p: string): T | null {
  try { return JSON.parse(readFileSync(p, "utf8")) as T; } catch { return null; }
}

export function computeAnalytics(runsRoot = "artifacts/runs", historyPath = "artifacts/a11y-history.json"): Analytics {
  const root = resolve(runsRoot);
  const runDirs = existsSync(root)
    ? readdirSync(root).filter((n) => statSync(join(root, n)).isDirectory())
        .sort((a, b) => statSync(join(root, a)).mtimeMs - statSync(join(root, b)).mtimeMs)
    : [];

  const runs: RunSummary[] = [];
  for (const id of runDirs) {
    const dir = join(root, id);
    const findings = readJson<{ runId?: string; correlationId?: string; pages?: { outcomes?: { kind: string; detail: string }[] }[]; outcomes?: { kind: string; detail: string }[] }>(join(dir, "findings.json"));
    if (!findings) continue;
    const pageList = findings.pages ?? (findings.outcomes ? [{ outcomes: findings.outcomes }] : []);
    const allOutcomes = pageList.flatMap((p) => p.outcomes ?? []);
    runs.push({
      runId: findings.runId ?? id,
      correlationId: findings.correlationId ?? "",
      pages: pageList.length,
      failedChecks: allOutcomes.filter((o) => o.kind === "failed-check").length,
      a11yFindings: allOutcomes.filter((o) => /a11y/.test(o.detail)).length,
      visualChanges: allOutcomes.filter((o) => o.kind === "visual-finding").length,
    });
  }

  const history = readJson<Record<string, TrackedFinding>>(resolve(historyPath)) ?? {};
  const a11yBySeverity: Record<string, number> = {};
  const lifecycle = { new: 0, recurring: 0, resolved: 0, reopened: 0, dismissedReappeared: 0, existingUnresolved: 0 };
  for (const f of Object.values(history)) {
    const sev = f.impact ?? "unknown";
    a11yBySeverity[sev] = (a11yBySeverity[sev] ?? 0) + 1;
    if (f.state === "new") lifecycle.new++;
    else if (f.state === "recurring") lifecycle.recurring++;
    else if (f.state === "resolved") lifecycle.resolved++;
    else if (f.state === "reopened") lifecycle.reopened++;
    else if (f.state === "dismissed-reappeared") lifecycle.dismissedReappeared++;
    else lifecycle.existingUnresolved++;
  }

  const latest = runs[runs.length - 1];
  return {
    totalRuns: runs.length,
    successfulRuns: runs.filter((r) => r.failedChecks === 0).length,
    reviewRequiredRuns: runs.filter((r) => r.failedChecks > 0).length,
    pagesCheckedLatest: latest?.pages ?? 0,
    deterministicFailuresLatest: latest?.failedChecks ?? 0,
    a11yBySeverity,
    findingLifecycle: lifecycle,
    visualChangesLatest: latest?.visualChanges ?? 0,
    runs,
  };
}

