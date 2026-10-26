import {
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
  renameSync,
  readdirSync,
  statSync,
  rmSync,
} from "node:fs";
import { resolve, join, dirname } from "node:path";
import { newEvidenceId } from "./ids.js";

export interface EvidenceRef {
  evidenceId: string;
  kind: "screenshot" | "trace" | "accessibility" | "agent-task" | "report" | "other";
  path: string;
  page?: string;
  viewport?: string;
}

/**
 * EvidenceStore owns the per-run directory layout (Req 24) and atomic writes.
 * Retention never deletes or modifies a run awaiting human review (Req 10.5, 24.6).
 *
 * artifacts/runs/<run-id>/
 *   run.json events.jsonl results.json findings.json audit.jsonl test-manifest.json
 *   screenshots/ traces/ accessibility/ agent-tasks/ report/index.html
 */
export class EvidenceStore {
  readonly runDir: string;
  readonly eventsPath: string;
  readonly auditPath: string;
  private readonly evidence: EvidenceRef[] = [];

  constructor(
    readonly runId: string,
    readonly rootDir = "artifacts/runs",
  ) {
    this.runDir = resolve(rootDir, runId);
    for (const sub of ["screenshots", "traces", "accessibility", "agent-tasks", "report"]) {
      mkdirSync(join(this.runDir, sub), { recursive: true });
    }
    this.eventsPath = join(this.runDir, "events.jsonl");
    this.auditPath = join(this.runDir, "audit.jsonl");
  }

  /** Atomic JSON write: temp file then rename into place. */
  writeJson(relPath: string, data: unknown): string {
    const full = join(this.runDir, relPath);
    mkdirSync(dirname(full), { recursive: true });
    const tmp = full + ".tmp";
    writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
    renameSync(tmp, full);
    return full;
  }

  addEvidence(ref: Omit<EvidenceRef, "evidenceId">): EvidenceRef {
    const full: EvidenceRef = { evidenceId: newEvidenceId(), ...ref };
    this.evidence.push(full);
    return full;
  }

  listEvidence(): EvidenceRef[] {
    return [...this.evidence];
  }

  /** True if every recorded evidence reference resolves to an existing file. */
  evidenceResolves(): boolean {
    return this.evidence.every((e) => existsSync(e.path));
  }

  isAwaitingReview(): boolean {
    const f = join(this.runDir, "findings.json");
    if (!existsSync(f)) return false;
    try {
      const data = JSON.parse(readFileSync(f, "utf8")) as { awaitingReview?: boolean };
      return data.awaitingReview === true;
    } catch {
      return false;
    }
  }
}

/**
 * Retention cleanup honouring maxRuns / maxAgeDays, but NEVER deleting or
 * modifying a run directory that is awaiting human review (Req 10.5, 24.6).
 */
export function applyRetention(
  rootDir: string,
  maxRuns: number,
  maxAgeDays: number,
  now = Date.now(),
): string[] {
  if (!existsSync(rootDir)) return [];
  const deleted: string[] = [];
  const runs = readdirSync(rootDir)
    .map((name) => ({ name, dir: join(rootDir, name) }))
    .filter((r) => statSync(r.dir).isDirectory())
    .map((r) => ({ ...r, mtime: statSync(r.dir).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime); // newest first

  const ageCutoff = now - maxAgeDays * 24 * 60 * 60 * 1000;

  runs.forEach((r, index) => {
    const awaiting = runAwaitingReview(r.dir);
    const tooOld = r.mtime < ageCutoff;
    const overCount = index >= maxRuns;
    if ((tooOld || overCount) && !awaiting) {
      rmSync(r.dir, { recursive: true, force: true });
      deleted.push(r.name);
    }
  });
  return deleted;
}

function runAwaitingReview(runDir: string): boolean {
  const f = join(runDir, "findings.json");
  if (!existsSync(f)) return false;
  try {
    const data = JSON.parse(readFileSync(f, "utf8")) as { awaitingReview?: boolean };
    return data.awaitingReview === true;
  } catch {
    return false;
  }
}
