/**
 * Dispositions API (design I.7, Requirements 18, 20). Testable without sockets: every function
 * takes plain ports (artifacts folder, gate, audit, clock) and returns `{ status, json }`.
 * Order for a new decision: validate, Approval_Gate (human check and audit), append to the
 * local log. The server sets `at` and the id. No AI, no network.
 */
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { AppendOnlyLog } from "../telemetry/audit-log.js";
import { ApprovalError, ApprovalGate, SelfApprovalError } from "../approval/approval-gate.js";
import type { DispositionDetail, DispositionKind } from "../approval/approval-gate.js";
import {
  applyDispositions,
  effectiveEntries,
  normalizePageUrl,
  validateNewEntry,
} from "../core/dispositions.js";
import type {
  DetectedFinding,
  DispositionDecision,
  DispositionEntry,
  DispositionSource,
  EntryError,
} from "../core/dispositions.js";
import { appendEntries, logPath, readLog, readSyncState, syncPath, unsyncedIds } from "../core/disposition-store.js";
import { sanitizeEvidenceText } from "../publish/evidence.js";
import { buildRunFindings, loadRawRunInputs } from "../publish/run-findings.js";
import { readRunFacts } from "../publish/published-data.js";
import { scrubForDisplay } from "./scrub.js";
import type { ConsoleResponse, HandlerContext, RouteDef } from "./console-routes.js";

/** Ceiling for node targets returned per Finding (Req 18.3). */
export const MAX_NODE_TARGETS = 50;
const MAX_TARGET_CHARS = 300;
const RUN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;

/** The part of the Approval_Gate this API needs (a fake in tests). */
export interface DispositionGate {
  recordDispositionDecision(args: {
    id: string;
    kind: DispositionKind;
    reviewer: string;
    reason: string;
    slug: string;
    detail?: DispositionDetail;
  }): string;
}

export interface DispositionAudit {
  append(record: Record<string, unknown>): void;
}

export interface DispositionPorts {
  /** Absolute path of the `artifacts` folder. */
  artifactsDir: string;
  gate: DispositionGate;
  audit: DispositionAudit;
  now(): Date;
}

export interface ApiResult {
  status: number;
  json: unknown;
}

/** Production ports for the project at `root` (audit log: artifacts/audit.jsonl). */
export function realDispositionPorts(root: string, now: () => Date = () => new Date()): DispositionPorts {
  const artifactsDir = join(root, "artifacts");
  mkdirSync(artifactsDir, { recursive: true });
  const audit = new AppendOnlyLog(join(artifactsDir, "audit.jsonl"));
  return { artifactsDir, gate: new ApprovalGate(audit), audit, now };
}

// ---------------------------------------------------------------------------
// GET /api/dispositions
// ---------------------------------------------------------------------------

export interface DispositionView extends DispositionEntry {
  undone: boolean;
  syncState: "synced" | "not-yet-synced";
}

export function listDispositions(ports: Pick<DispositionPorts, "artifactsDir">): ApiResult {
  const read = readLog(logPath(ports.artifactsDir));
  if (read.status === "unavailable") {
    return { status: 500, json: { error: "The decisions file cannot be read.", detail: scrub(read.reason) } };
  }
  const sync = readSyncState(syncPath(ports.artifactsDir));
  const synced = new Set(sync.syncedIds);
  const undone = new Set<string>();
  for (const e of read.log.entries) if (e.decision === "unignore" && e.undoes) undone.add(e.undoes);
  const entries: DispositionView[] = read.log.entries.map((e) => ({
    ...e,
    undone: e.decision === "ignore" && undone.has(e.id),
    syncState: synced.has(e.id) ? "synced" : "not-yet-synced",
  }));
  return {
    status: 200,
    json: {
      entries,
      sync: {
        lastSyncedAt: sync.lastSyncedAt,
        notYetSynced: unsyncedIds(read.log, sync).length,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// GET /api/findings
// ---------------------------------------------------------------------------

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function flattenTarget(t: unknown): string {
  const parts: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === "string") parts.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
  };
  walk(t);
  return parts.join(" >> ");
}

/** Sanitized node targets per `${slug}.${viewport}.${ruleId}` from the raw axe results. */
function collectNodeTargets(axe: { slug: string; viewport: string; raw: unknown }[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const entry of axe) {
    if (!isObj(entry.raw) || !Array.isArray(entry.raw.violations)) continue;
    for (const v of entry.raw.violations) {
      if (!isObj(v) || typeof v.id !== "string" || !Array.isArray(v.nodes)) continue;
      const key = `${entry.slug}.${entry.viewport}.${v.id}`;
      const list = out.get(key) ?? [];
      for (const n of v.nodes) {
        if (!isObj(n)) continue;
        const r = sanitizeEvidenceText(flattenTarget(n.target), MAX_TARGET_CHARS);
        if (r.withheld || r.value === "" || list.includes(r.value)) continue;
        list.push(r.value);
      }
      out.set(key, list);
    }
  }
  return out;
}

interface ResolvedRun {
  dirName: string;
  runId: string;
  finishedAt: string | null;
}

function resolveRun(runsRoot: string, run: string): ResolvedRun | null {
  let dirs: string[] = [];
  try {
    dirs = existsSync(runsRoot)
      ? readdirSync(runsRoot).filter((n) => {
          try {
            return statSync(join(runsRoot, n)).isDirectory();
          } catch {
            return false;
          }
        })
      : [];
  } catch {
    dirs = [];
  }
  const facts = dirs.map((dirName) => {
    const f = readRunFacts(join(runsRoot, dirName), dirName);
    return { dirName, runId: f.runId, finishedAt: f.finishedAt ?? null };
  });
  if (run === "latest") {
    facts.sort((a, b) => {
      const fa = a.finishedAt ?? "";
      const fb = b.finishedAt ?? "";
      if (fa !== fb) return fa < fb ? 1 : -1;
      return a.dirName < b.dirName ? 1 : a.dirName > b.dirName ? -1 : 0;
    });
    return facts[0] ?? null;
  }
  if (!RUN_ID_RE.test(run)) return null;
  return facts.find((f) => f.dirName === run || f.runId === run) ?? null;
}

export type FindingStatus = "active" | "ignored" | "decision-pending";

interface ScopeCounts {
  element: number;
  "page-rule": number;
  "site-rule": number;
}

export function listFindings(
  ports: Pick<DispositionPorts, "artifactsDir">,
  run: string | undefined,
): ApiResult {
  const wanted = run === undefined || run === "" ? "latest" : run;
  const runsRoot = join(ports.artifactsDir, "runs");
  const found = resolveRun(runsRoot, wanted);
  if (!found) {
    return { status: 404, json: { error: wanted === "latest" ? "No local run was found." : "Run not found." } };
  }
  const read = readLog(logPath(ports.artifactsDir));
  if (read.status === "unavailable") {
    return { status: 500, json: { error: "The decisions file cannot be read.", detail: scrub(read.reason) } };
  }
  const inputs = loadRawRunInputs(join(runsRoot, found.dirName));
  inputs.runId = found.runId;
  inputs.finishedAt = found.finishedAt;
  const built = buildRunFindings(inputs);
  const targets = collectNodeTargets(inputs.axe);

  const detected: DetectedFinding[] = built.runFindings.findings.map((f) => ({
    id: f.id,
    kind: f.kind,
    pageUrl: f.pageUrl,
    slug: f.slug,
    viewport: f.viewport,
    ruleId: f.ruleId,
    severity: f.severity,
    lifecycle: f.lifecycle,
    nodeTargets: f.kind === "a11y-rule" ? (targets.get(`${f.slug}.${f.viewport}.${f.ruleId}`) ?? []) : [],
    nodeCount: typeof f.nodeCount === "number" ? f.nodeCount : undefined,
  }));

  const all = read.log.entries;
  const effective = found.finishedAt ? effectiveEntries(read.log, found.finishedAt) : [];
  const nowState = applyDispositions(detected, effective);
  const allState = applyDispositions(detected, all);
  const ignoredNow = new Set(nowState.ignored.map((f) => f.id));
  const ignoredAll = new Set(allState.ignored.map((f) => f.id));
  const regressionNow = new Set(nowState.active.filter((f) => f.regression).map((f) => f.id));
  const regressionAll = new Set(allState.active.filter((f) => f.regression).map((f) => f.id));

  const byRule = new Map<string, number>();
  const byPageRule = new Map<string, number>();
  for (const f of detected) {
    byRule.set(f.ruleId, (byRule.get(f.ruleId) ?? 0) + 1);
    const k = `${normalizePageUrl(f.pageUrl)}\n${f.ruleId}`;
    byPageRule.set(k, (byPageRule.get(k) ?? 0) + 1);
  }

  const findings = built.runFindings.findings.map((f, i) => {
    const d = detected[i] as DetectedFinding;
    let status: FindingStatus = ignoredNow.has(f.id) ? "ignored" : "active";
    if (
      ignoredNow.has(f.id) !== ignoredAll.has(f.id) ||
      regressionNow.has(f.id) !== regressionAll.has(f.id)
    ) {
      status = "decision-pending";
    }
    const counts: ScopeCounts = {
      element: 1,
      "page-rule": byPageRule.get(`${normalizePageUrl(f.pageUrl)}\n${f.ruleId}`) ?? 1,
      "site-rule": byRule.get(f.ruleId) ?? 1,
    };
    return {
      id: f.id,
      kind: f.kind,
      pageUrl: f.pageUrl,
      slug: f.slug,
      viewport: f.viewport,
      ruleId: f.ruleId,
      severity: f.severity,
      title: f.title,
      nodeCount: typeof f.nodeCount === "number" ? f.nodeCount : 0,
      nodeTargets: d.nodeTargets.slice(0, MAX_NODE_TARGETS),
      status,
      matches: counts,
    };
  });

  return {
    status: 200,
    json: {
      run: { runId: found.runId, finishedAt: found.finishedAt },
      findings,
    },
  };
}

// ---------------------------------------------------------------------------
// POST /api/dispositions
// ---------------------------------------------------------------------------

export interface CreateDispositionInput {
  decision?: unknown;
  scope?: unknown;
  pageUrl?: unknown;
  viewport?: unknown;
  ruleId?: unknown;
  cssTarget?: unknown;
  reason?: unknown;
  reviewer?: unknown;
  undoes?: unknown;
}

function scrub(text: string): string {
  return scrubForDisplay(text);
}

/** Flat request fields to the shape `validateNewEntry` expects. */
export function toEntryInput(input: unknown, source: DispositionSource): Record<string, unknown> {
  const i = (isObj(input) ? input : {}) as CreateDispositionInput;
  const s = (v: unknown): string => (typeof v === "string" ? v : "");
  return {
    decision: i.decision,
    scope: i.scope,
    matcher: {
      pageUrl: s(i.pageUrl),
      viewport: s(i.viewport),
      ruleId: s(i.ruleId),
      cssTarget: s(i.cssTarget),
    },
    reason: i.reason,
    reviewer: i.reviewer,
    undoes: i.undoes,
    source,
  };
}

function auditSafe(ports: DispositionPorts, record: Record<string, unknown>): void {
  try {
    ports.audit.append(record);
  } catch {
    /* the audit line is best effort here; the response still reports the failure */
  }
}

function fieldErrors(errors: EntryError[]): { field: string; message: string }[] {
  return errors.map((e) => ({ field: e.field, message: e.message }));
}

export function createDisposition(
  ports: DispositionPorts,
  input: unknown,
  source: DispositionSource = "admin-gui",
): ApiResult {
  const path = logPath(ports.artifactsDir);
  const read = readLog(path);
  if (read.status === "unavailable") {
    // Never write over an unreadable or partly invalid log.
    return {
      status: 409,
      json: { error: "The decisions file cannot be read, so nothing was recorded.", detail: scrub(read.reason) },
    };
  }
  const existing = read.log.entries;
  const now = ports.now();
  const entryInput = toEntryInput(input, source);
  const result = validateNewEntry(entryInput, existing, now);

  if (!result.ok) {
    if (result.errors.length === 1 && result.errors[0]?.field === "id" && result.errors[0].message === "duplicate") {
      // Exact duplicate: idempotent success. Find the entry that already holds this id.
      const twin = validateNewEntry(
        entryInput,
        existing.filter((e) => e.at !== now.toISOString()),
        now,
      );
      const same = twin.ok ? existing.find((e) => e.id === twin.entry.id) : undefined;
      return { status: 200, json: { duplicate: true, entry: same ?? null, effectiveFrom: "next-run" } };
    }
    return { status: 400, json: { errors: fieldErrors(result.errors) } };
  }

  const entry = result.entry;
  const kind = entry.decision as DispositionDecision;
  const detail: DispositionDetail = { scope: entry.scope, matcher: entry.matcher };
  if (entry.undoes) detail.undoes = entry.undoes;

  try {
    ports.gate.recordDispositionDecision({
      id: entry.id,
      kind,
      reviewer: entry.reviewer,
      reason: entry.reason,
      slug: "",
      detail,
    });
  } catch (err) {
    if (err instanceof SelfApprovalError || err instanceof ApprovalError) {
      // A gate rejection stops the flow before the log is touched.
      return { status: 403, json: { error: scrub(err.message) } };
    }
    auditSafe(ports, {
      type: "disposition-write-failed",
      id: entry.id,
      stage: "approval-gate",
      reason: scrub(err instanceof Error ? err.message : String(err)),
    });
    return { status: 500, json: { error: "The decision could not be recorded." } };
  }

  const written = appendEntries(path, [entry]);
  if (!written.ok) {
    auditSafe(ports, {
      type: "disposition-write-failed",
      id: entry.id,
      stage: "log-write",
      reason: scrub(written.reason),
    });
    return { status: 500, json: { error: "The decision was approved but could not be saved to the local file." } };
  }
  return { status: 201, json: { entry, effectiveFrom: "next-run" } };
}

// ---------------------------------------------------------------------------
// Route table
// ---------------------------------------------------------------------------

function portsFor(ctx: HandlerContext): DispositionPorts {
  const base = realDispositionPorts(ctx.deps.fs.root, () => ctx.deps.clock.now());
  // A gate supplied through the console approval port (tests, future wiring) takes priority.
  const supplied = (ctx.deps.approval as unknown as Partial<DispositionGate>).recordDispositionDecision;
  if (typeof supplied === "function") {
    return { ...base, gate: { recordDispositionDecision: (a) => supplied.call(ctx.deps.approval, a) } };
  }
  return base;
}

function toResponse(r: ApiResult): ConsoleResponse {
  return { status: r.status, json: r.json };
}

async function getFindings(ctx: HandlerContext): Promise<ConsoleResponse> {
  const artifactsDir = join(ctx.deps.fs.root, "artifacts");
  return toResponse(listFindings({ artifactsDir }, ctx.query.run));
}

async function getDispositions(ctx: HandlerContext): Promise<ConsoleResponse> {
  return toResponse(listDispositions({ artifactsDir: join(ctx.deps.fs.root, "artifacts") }));
}

async function postDisposition(ctx: HandlerContext): Promise<ConsoleResponse> {
  return toResponse(createDisposition(portsFor(ctx), ctx.body, "admin-gui"));
}

export const DISPOSITION_BODY_LIMIT = 8 * 1024;

export const DISPOSITIONS_GROUP: RouteDef[] = [
  { method: "GET", pattern: "/api/findings", mutating: false, maxBodyBytes: 0, handler: getFindings },
  { method: "GET", pattern: "/api/dispositions", mutating: false, maxBodyBytes: 0, handler: getDispositions },
  {
    method: "POST",
    pattern: "/api/dispositions",
    mutating: true,
    maxBodyBytes: DISPOSITION_BODY_LIMIT,
    handler: postDisposition,
  },
];
