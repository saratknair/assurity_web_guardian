/**
 * Ports for the Management_Console pure API layer (design J.1). Handlers receive only
 * these ports, so tests drive them with fakes: no sockets, no git, no child processes.
 * `realDeps()` is the production wiring. No AI, no network.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AppendOnlyLog } from "../telemetry/audit-log.js";
import { createJobRunner } from "./job-runner.js";
import type { JobPort as RunnerPort } from "./job-runner.js";
import { ApprovalGate } from "../approval/approval-gate.js";
import { atomicWriteText, resolveInside } from "./atomic-file.js";
import { realGit } from "./git-port.js";
import type { GitPort } from "./git-port.js";

/** File access confined to the project root. Paths are relative to the root. */
export interface ProjectFs {
  readonly root: string;
  exists(rel: string): boolean;
  readText(rel: string): string;
  readBytes(rel: string): Uint8Array;
  /** Atomic write (temp then rename), EOL style of an existing file preserved. */
  writeText(rel: string, text: string): void;
  /** File and folder names directly inside `rel`; empty when missing. */
  listDir(rel: string): string[];
}

// GitPort, GitResult, and realGit live in git-port.ts (design J.8.3); re-exported here.
export type { GitPort, GitResult } from "./git-port.js";
export { realGit } from "./git-port.js";

export interface JobSnapshot {
  id: string;
  kind: string;
  state: "running" | "succeeded" | "failed";
  startedAt: string;
  elapsedMs: number;
  progress?: string;
  outputTail?: string;
}

export type JobStartResult = { ok: true; job: JobSnapshot } | { ok: false; reason: string };

/** Legacy job shape (current / start(kind, args)); still accepted so older fakes keep working. */
export interface JobPort {
  current(): JobSnapshot | null;
  start(kind: string, args: string[]): JobStartResult;
}

/** The real job runner shape (job-runner.ts), plus current() for the status route. */
export interface RunnerJobs extends RunnerPort {
  current(): JobSnapshot | null;
}

/** Either shape. Handlers detect a status() method; getStatus reads runningJob via runningJobOf. */
export type ConsoleJobs = JobPort | RunnerPort | RunnerJobs;

/** The running job (if any) as a snapshot, for either jobs shape. */
export function runningJobOf(jobs: ConsoleJobs): JobSnapshot | null {
  const j = jobs as Partial<RunnerPort & JobPort>;
  if (typeof j.status === "function") {
    const s = j.status();
    if (s.state !== "running" || !s.kind) return null;
    return {
      id: `${s.kind}-${s.startedAt ?? ""}`,
      kind: s.kind,
      state: "running",
      startedAt: s.startedAt ?? "",
      elapsedMs: s.elapsedMs,
      progress: s.progress ? `${s.progress.done}/${s.progress.total}` : undefined,
      outputTail: s.tail.length ? s.tail.slice(-20).join("\n") : undefined,
    };
  }
  return typeof j.current === "function" ? j.current() : null;
}

export interface SetupActionInput {
  reviewer: string;
  action: string;
  detail: Record<string, unknown>;
}

export interface VisualBaselineInput {
  reviewer: string;
  slug: string;
  viewport: string;
  source: string;
  sha16: string;
  /** True when a baseline already existed before this promotion (audit type "updated"). */
  updated?: boolean;
  baselinePath?: string;
  sourceRun?: string;
}

export interface SpecApprovalInput {
  reviewer: string;
  slug: string;
  scope: "project" | "draft";
}

/** The Approval_Gate seen from the console. Throws SelfApprovalError for agent names. */
export interface ApprovalPort {
  authorizeSetupAction(input: SetupActionInput): void;
  approveVisualBaseline(input: VisualBaselineInput): void;
  /** Promote artifacts/.../<slug>.draft.md to baselines/<slug>/baseline.v{N}.md. */
  approveSpecification?(input: SpecApprovalInput): { baselinePath: string; version: number };
}

export interface Clock {
  now(): Date;
}

export interface ConsoleDeps {
  /** Loopback port the console listens on (for Host / Origin checks). */
  port: number;
  fs: ProjectFs;
  git: GitPort;
  jobs: ConsoleJobs;
  approval: ApprovalPort;
  clock: Clock;
}

export function realFs(root: string): ProjectFs {
  return {
    root,
    exists: (rel) => existsSync(resolveInside(root, rel)),
    readText: (rel) => readFileSync(resolveInside(root, rel), "utf8"),
    readBytes: (rel) => new Uint8Array(readFileSync(resolveInside(root, rel))),
    writeText: (rel, text) => atomicWriteText(resolveInside(root, rel), text),
    listDir: (rel) => {
      try {
        return readdirSync(resolveInside(root, rel)).sort();
      } catch {
        return [];
      }
    },
  };
}

/** Placeholder until job-runner.ts lands: nothing runs, nothing can be started. */
export function idleJobs(): JobPort {
  return {
    current: () => null,
    start: () => ({ ok: false, reason: "Jobs are not available yet" }),
  };
}

/** The real single-flight job runner for the project at `root` (state under artifacts/admin). */
export function realJobs(root: string): RunnerJobs {
  const runner = createJobRunner({ projectRoot: root, stateDir: join(root, "artifacts", "admin") });
  const port: RunnerPort = runner;
  return {
    start: (spec) => runner.start(spec),
    status: () => runner.status(),
    current: () => runningJobOf(port),
  };
}

/** Approval port backed by the Approval_Gate and the audit log only (never telemetry). */
export function realApproval(root: string): ApprovalPort {
  const gate = new ApprovalGate(new AppendOnlyLog(resolveInside(root, "artifacts", "audit.jsonl")));
  // The setup-action methods are added to the gate by a sibling task; call them when present.
  const g = gate as unknown as Partial<{
    authorizeSetupAction(i: SetupActionInput): void;
    approveVisualBaseline(i: VisualBaselineInput): void;
  }>;
  const auditLog = new AppendOnlyLog(resolveInside(root, "artifacts", "audit.jsonl"));
  return {
    approveSpecification: (i) => {
      const staging = i.scope === "draft";
      const pending = staging
        ? resolveInside(root, "artifacts", "admin", "new-domain", "spec-drafts")
        : resolveInside(root, "artifacts", "pending-review", "spec-drafts");
      const baselines = staging
        ? resolveInside(root, "artifacts", "admin", "new-domain", "baselines")
        : resolveInside(root, "baselines");
      const specGate = new ApprovalGate(auditLog, pending, baselines);
      const r = specGate.approveSpecification({
        reviewer: i.reviewer,
        decision: "accepted",
        reason: "Specification baseline approved in the console",
        slug: i.slug,
      });
      return { baselinePath: r.baselinePath, version: r.version };
    },
    authorizeSetupAction: (i) => {
      if (typeof g.authorizeSetupAction !== "function") throw new Error("Approval gate setup actions unavailable");
      g.authorizeSetupAction(i);
    },
    approveVisualBaseline: (i) => {
      if (typeof g.approveVisualBaseline !== "function") throw new Error("Approval gate baseline approval unavailable");
      g.approveVisualBaseline(i);
    },
  };
}

export const systemClock: Clock = { now: () => new Date() };

/** Production wiring for the project at `root`. */
export function realDeps(opts: { root: string; port: number }): ConsoleDeps {
  return {
    port: opts.port,
    fs: realFs(opts.root),
    git: realGit(opts.root),
    jobs: realJobs(opts.root),
    approval: realApproval(opts.root),
    clock: systemClock,
  };
}
