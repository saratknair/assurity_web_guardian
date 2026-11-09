/**
 * Run viewer routes (design J.11; Requirement 29) and the cloud pull (Requirement 29, J.9.1).
 *
 *   GET  /api/runs                         known runs, newest first, latest flagged
 *   GET  /api/runs/:id                     details and the available logs; each section reads alone
 *   GET  /api/runs/:id/log?file=&before=   bounded, scrubbed plain-text log lines
 *   GET  /api/runs/:id/log/:name           same, with the log name in the path
 *   POST /api/sync                         pull cloud runs (runs-data), then decisions; single-flight
 *   GET  /api/sync/status                  state of the last or running pull
 *
 * Only runs that exist under artifacts/runs/ are ever shown; nothing is fabricated. Log text is
 * plain text (never markup), runs through scrubForDisplay, and uses a fixed two-name whitelist.
 * No AI, no new dependencies.
 */
import { closeSync, fstatSync, lstatSync, openSync, readFileSync, readSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { RUN_ID_PATTERN, resolveInside } from "./atomic-file.js";
import { scrubForDisplay } from "./scrub.js";
import { cloudSync } from "./cloud-sync.js";
import type { CloudSyncResult } from "./cloud-sync.js";
import { pullDispositions, REMOTE_BRANCH } from "./disposition-sync.js";
import type { PullResult } from "./disposition-sync.js";
import { normalizeRemote } from "./git-feedback.js";
import { deriveRunDomain, readRunFacts, readRunsNewestFirst } from "../publish/published-data.js";
import type { ConsoleDeps } from "./console-deps.js";
import type { ConsoleResponse, HandlerContext, RouteDef } from "./console-routes.js";

export const LOG_MAX_BYTES = 128 * 1024;
export const LOG_LINE_MAX = 2000;
const FIELDS_MAX = 300;
const JSON_MAX_BYTES = 20 * 1024 * 1024;

/** The only log files the console will read, by public name. */
export const LOG_WHITELIST: Readonly<Record<string, string>> = { events: "events.jsonl", audit: "audit.jsonl" };

/** Replaceable in tests so nothing touches a real remote. */
export const runsApiHooks: {
  cloudSync: (opts: { repoDir: string; branch: string; runsRoot: string }) => Promise<CloudSyncResult>;
  pullDispositions: typeof pullDispositions;
} = { cloudSync, pullDispositions };

function runsRoot(deps: ConsoleDeps): string {
  return resolveInside(deps.fs.root, "artifacts", "runs");
}

function scrub(text: string, deps: ConsoleDeps): string {
  return scrubForDisplay(text, { projectRoot: deps.fs.root, home: homedir() });
}

/** Safe path of a file inside one run folder, or null when the id/name is not allowed. */
function runFile(deps: ConsoleDeps, id: string, file: string): string | null {
  if (!RUN_ID_PATTERN.test(id)) return null;
  try {
    return resolveInside(deps.fs.root, "artifacts", "runs", id, file);
  } catch {
    return null;
  }
}

function isRegularFile(p: string): number | null {
  try {
    const st = lstatSync(p);
    return st.isFile() && !st.isSymbolicLink() ? st.size : null;
  } catch {
    return null;
  }
}

function runDirExists(deps: ConsoleDeps, id: string): boolean {
  const p = runFile(deps, id, ".");
  if (!p) return false;
  try {
    const st = lstatSync(p);
    return st.isDirectory() && !st.isSymbolicLink();
  } catch {
    return false;
  }
}

// ---- run-source.json ------------------------------------------------------------------------

interface RunSource {
  trigger: string | null;
  githubRunId: string | null;
  githubRunNumber: string | null;
  sha: string | null;
  eventName: string | null;
}

type SourceRead = { ok: true; source: RunSource } | { ok: false; reason: string };

function token(v: unknown, re: RegExp): string | null {
  return typeof v === "string" && re.test(v) ? v : null;
}

function readSource(deps: ConsoleDeps, id: string): SourceRead {
  const p = runFile(deps, id, "run-source.json");
  if (!p) return { ok: false, reason: "run-source.json could not be read" };
  const size = isRegularFile(p);
  if (size === null) return { ok: false, reason: "GitHub run not recorded" };
  try {
    if (size > 64 * 1024) throw new Error("too large");
    const v: unknown = JSON.parse(readFileSync(p, "utf8"));
    if (v === null || typeof v !== "object" || Array.isArray(v)) throw new Error("not an object");
    const o = v as Record<string, unknown>;
    return {
      ok: true,
      source: {
        trigger: token(o.trigger, /^[a-z_]{1,32}$/),
        githubRunId: token(o.githubRunId, /^[0-9]{1,20}$/),
        githubRunNumber: token(o.githubRunNumber, /^[0-9]{1,20}$/),
        sha: token(o.sha, /^[0-9a-f]{40}$/),
        eventName: token(o.eventName, /^[a-z_]{1,32}$/),
      },
    };
  } catch {
    return { ok: false, reason: "run-source.json could not be read" };
  }
}

/** "https://github.com/<owner>/<repo>" from the origin remote, or null (also when not GitHub). */
async function githubBase(deps: ConsoleDeps): Promise<string | null> {
  try {
    const r = await deps.git.run(["remote", "get-url", "origin"]);
    if (r.code !== 0) return null;
    const norm = normalizeRemote(r.stdout.trim());
    const m = /^github\.com\/([A-Za-z0-9_.-]{1,100})\/([A-Za-z0-9_.-]{1,100})$/.exec(norm);
    return m ? `https://github.com/${m[1]}/${m[2]}` : null;
  } catch {
    return null;
  }
}

function actionsUrl(base: string | null, src: RunSource | null): string | null {
  return base && src && src.githubRunId ? `${base}/actions/runs/${src.githubRunId}` : null;
}

// ---- GET /api/runs --------------------------------------------------------------------------

async function getRuns(ctx: HandlerContext): Promise<ConsoleResponse> {
  const { deps } = ctx;
  let facts;
  try {
    facts = readRunsNewestFirst(runsRoot(deps));
  } catch {
    return { status: 500, json: { error: "runs could not be listed" } };
  }
  const known = facts.filter((f) => RUN_ID_PATTERN.test(f.runId) && runDirExists(deps, f.runId));
  const sources = new Map<string, RunSource>();
  for (const f of known) {
    const s = readSource(deps, f.runId);
    if (s.ok) sources.set(f.runId, s.source);
  }
  const base = [...sources.values()].some((s) => s.githubRunId) ? await githubBase(deps) : null;
  const runs = known.map((f, i) => {
    const src = sources.get(f.runId) ?? null;
    return {
      runId: f.runId,
      date: f.finishedAt ?? null,
      finishedAt: f.finishedAt ?? null,
      status: f.status,
      health: f.health,
      pages: f.pages,
      failedChecks: f.failedChecks,
      pendingReview: f.pendingReview,
      origin: f.origin,
      trigger: src?.trigger ?? null,
      githubRunId: src?.githubRunId ?? null,
      githubRunNumber: src?.githubRunNumber ?? null,
      githubRunUrl: actionsUrl(base, src),
      hasLogs: Object.values(LOG_WHITELIST).some((n) => {
        const p = runFile(deps, f.runId, n);
        return p !== null && isRegularFile(p) !== null;
      }),
      latest: i === 0,
    };
  });
  return { status: 200, json: { ok: true, runs, latestRunId: runs.length > 0 ? runs[0]!.runId : null } };
}

// ---- GET /api/runs/:id ----------------------------------------------------------------------

type Section = Record<string, unknown> & { ok: boolean };

function jsonSection(deps: ConsoleDeps, id: string, file: string, summarize: (v: unknown) => Record<string, unknown>): Section {
  const p = runFile(deps, id, file);
  if (!p) return { ok: false, reason: `${file} could not be read` };
  const size = isRegularFile(p);
  if (size === null) return { ok: false, reason: `${file} is not present` };
  try {
    if (size > JSON_MAX_BYTES) throw new Error("too large");
    return { ok: true, ...summarize(JSON.parse(readFileSync(p, "utf8"))) };
  } catch {
    return { ok: false, reason: `${file} could not be read` };
  }
}

function obj(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function logSection(deps: ConsoleDeps, id: string, file: string): Section {
  const p = runFile(deps, id, file);
  if (!p) return { ok: false, reason: `${file} could not be read` };
  const size = isRegularFile(p);
  if (size === null) return { ok: false, reason: `${file} is not present` };
  return { ok: true, bytes: size };
}

async function getRun(ctx: HandlerContext): Promise<ConsoleResponse> {
  const { deps } = ctx;
  const id = ctx.params.id ?? "";
  if (!RUN_ID_PATTERN.test(id)) return { status: 400, json: { error: "invalid run id" } };
  if (!runDirExists(deps, id)) return { status: 404, json: { error: "run not found" } };
  const dir = runFile(deps, id, ".") as string;

  let summary: Section;
  try {
    const f = readRunFacts(dir, id);
    summary = {
      ok: true,
      runId: f.runId,
      finishedAt: f.finishedAt ?? null,
      status: f.status,
      health: f.health,
      pages: f.pages,
      failedChecks: f.failedChecks,
      pendingReview: f.pendingReview,
      origin: f.origin,
    };
  } catch {
    summary = { ok: false, reason: "run summary could not be read" };
  }

  const src = readSource(deps, id);
  const source: Section = src.ok ? { ok: true, ...src.source } : { ok: false, reason: src.reason };
  if (summary.ok && src.ok) {
    summary.trigger = src.source.trigger;
    try {
      summary.domain = deriveRunDomain(dir, []);
    } catch {
      summary.domain = null;
    }
  }
  const base = src.ok && src.source.githubRunId ? await githubBase(deps) : null;

  const run = isRegularFile(runFile(deps, id, "run.json") ?? "") !== null
    ? jsonSection(deps, id, "run.json", (v) => ({ keys: Object.keys(obj(v)).length }))
    : null;
  const results = jsonSection(deps, id, "results.json", (v) => {
    const pages = obj(v).pages;
    return { pages: Array.isArray(pages) ? pages.length : 0 };
  });
  const findings = jsonSection(deps, id, "findings.json", (v) => {
    const o = obj(v);
    return { pages: Array.isArray(o.pages) ? o.pages.length : 0, awaitingReview: o.awaitingReview === true };
  });
  const events = logSection(deps, id, LOG_WHITELIST.events as string);
  const audit = logSection(deps, id, LOG_WHITELIST.audit as string);
  const logs = [
    ...(events.ok ? [{ name: "events", bytes: events.bytes }] : []),
    ...(audit.ok ? [{ name: "audit", bytes: audit.bytes }] : []),
  ];
  const unreadable = [
    ["summary", summary],
    ["run-source", source],
    ["results", results],
    ["findings", findings],
  ]
    .filter(([, s]) => !(s as Section).ok)
    .map(([n]) => n as string);

  return {
    status: 200,
    json: {
      ok: true,
      runId: id,
      summary,
      source,
      ...(run ? { run } : {}),
      results,
      findings,
      events,
      audit,
      logs,
      githubRunUrl: actionsUrl(base, src.ok ? src.source : null),
      unreadable,
    },
  };
}

// ---- GET /api/runs/:id/log -------------------------------------------------------------------

/** One JSONL record as "time type message key=value ..."; a non-JSON line is kept as raw text. */
export function formatLogLine(raw: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return raw;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return raw;
  const o = parsed as Record<string, unknown>;
  const used = new Set<string>();
  const pick = (keys: string[]): string => {
    for (const k of keys) {
      if (typeof o[k] === "string" && (o[k] as string).length > 0) {
        used.add(k);
        return o[k] as string;
      }
    }
    return "";
  };
  const time = pick(["time", "ts", "timestamp", "at"]);
  const type = pick(["kind", "type", "event", "action"]);
  const message = pick(["message", "msg", "reason", "detail"]);
  const rest = Object.keys(o)
    .filter((k) => !used.has(k))
    .map((k) => {
      const v = o[k];
      let t: string;
      try {
        t = typeof v === "string" ? v : (JSON.stringify(v) ?? "");
      } catch {
        t = "";
      }
      return `${k}=${t}`;
    })
    .join(" ")
    .slice(0, FIELDS_MAX);
  return [time, type, message, rest].filter((s) => s.length > 0).join(" ");
}

export interface LogPage {
  lines: string[];
  totalBytes: number;
  startOffset: number;
  endOffset: number;
  truncated: boolean;
}

/**
 * Read at most `maxBytes` ending at `before` (default: end of file). A partial first line is
 * dropped, so paging back with `before = startOffset` covers the file without gaps or repeats.
 */
export function readLogPage(path: string, before: number | undefined, maxBytes = LOG_MAX_BYTES): LogPage {
  const fd = openSync(path, "r");
  try {
    const total = fstatSync(fd).size;
    let end = before === undefined ? total : Math.min(Math.max(0, Math.floor(before)), total);
    const probe = Buffer.alloc(1);
    // An end that is not on a line boundary would cut a line in half: pull it back to one.
    let cutTail = false;
    if (end > 0 && end < total) {
      readSync(fd, probe, 0, 1, end - 1);
      cutTail = probe[0] !== 0x0a;
    }
    const start = Math.max(0, end - maxBytes);
    const buf = Buffer.alloc(end - start);
    let got = 0;
    while (got < buf.length) {
      const n = readSync(fd, buf, got, buf.length - got, start + got);
      if (n <= 0) break;
      got += n;
    }
    let chunk = buf.subarray(0, got);
    let from = start;
    if (cutTail) {
      const nl = chunk.lastIndexOf(0x0a);
      chunk = nl === -1 ? chunk.subarray(0, 0) : chunk.subarray(0, nl + 1);
      end = start + chunk.length;
    }
    if (start > 0) {
      let boundary = false;
      readSync(fd, probe, 0, 1, start - 1);
      boundary = probe[0] === 0x0a;
      if (!boundary) {
        const nl = chunk.indexOf(0x0a);
        if (nl === -1) {
          // One line longer than the window: show nothing, but keep moving back.
          return { lines: [], totalBytes: total, startOffset: start, endOffset: end, truncated: true };
        }
        chunk = chunk.subarray(nl + 1);
        from = start + nl + 1;
      }
    }
    const text = chunk.toString("utf8");
    const lines = text.split(/\r?\n/);
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    return { lines, totalBytes: total, startOffset: from, endOffset: end, truncated: from > 0 };
  } finally {
    closeSync(fd);
  }
}

async function serveLog(ctx: HandlerContext, name: string | undefined): Promise<ConsoleResponse> {
  const { deps, query } = ctx;
  const id = ctx.params.id ?? "";
  if (!RUN_ID_PATTERN.test(id)) return { status: 400, json: { error: "invalid run id" } };
  if (typeof name !== "string" || !Object.prototype.hasOwnProperty.call(LOG_WHITELIST, name)) {
    return { status: 400, json: { error: "unknown log file" } };
  }
  let before: number | undefined;
  if (query.before !== undefined && query.before !== "") {
    if (!/^\d{1,15}$/.test(query.before)) return { status: 400, json: { error: "invalid offset" } };
    before = Number(query.before);
  }
  if (!runDirExists(deps, id)) return { status: 404, json: { error: "run not found" } };
  const path = runFile(deps, id, LOG_WHITELIST[name] as string);
  if (!path || isRegularFile(path) === null) return { status: 404, json: { error: "log not found" } };
  let page: LogPage;
  try {
    page = readLogPage(path, before);
  } catch {
    return { status: 200, json: { ok: false, file: name, reason: "the log could not be read" } };
  }
  const lines = page.lines.map((l) => scrub(formatLogLine(l), deps).slice(0, LOG_LINE_MAX));
  return {
    status: 200,
    json: {
      ok: true,
      runId: id,
      file: name,
      lines,
      totalBytes: page.totalBytes,
      startOffset: page.startOffset,
      endOffset: page.endOffset,
      truncated: page.truncated,
    },
  };
}

const getLogQuery = (ctx: HandlerContext): Promise<ConsoleResponse> => serveLog(ctx, ctx.query.file);
const getLogPath = (ctx: HandlerContext): Promise<ConsoleResponse> => serveLog(ctx, ctx.params.name);

// ---- POST /api/sync --------------------------------------------------------------------------

export type RunsSyncState = "idle" | "running" | "done";

interface RunsSyncRecord {
  state: RunsSyncState;
  startedAt: string | null;
  finishedAt: string | null;
  runs: { ok: boolean; added: number; skipped: number; reason: string | null } | null;
  decisions: { ok: boolean; added: number; reason: string | null } | null;
  done: Promise<void> | null;
}

const syncRecords = new Map<string, RunsSyncRecord>();

function syncRecord(root: string): RunsSyncRecord {
  let r = syncRecords.get(root);
  if (!r) {
    r = { state: "idle", startedAt: null, finishedAt: null, runs: null, decisions: null, done: null };
    syncRecords.set(root, r);
  }
  return r;
}

/** Resolves when the pull for this root (if any) has finished. For tests. */
export function waitForRunsSync(root: string): Promise<void> {
  return syncRecord(root).done ?? Promise.resolve();
}

/** Forget remembered pull results (tests). */
export function resetRunsSync(): void {
  syncRecords.clear();
}

function shortReason(text: string, deps: ConsoleDeps): string {
  const s = scrub(text, deps).replace(/\s+/g, " ").trim();
  return s.length > 0 ? s.slice(0, 300) : "unknown error";
}

async function postSync(ctx: HandlerContext): Promise<ConsoleResponse> {
  const { deps } = ctx;
  const rec = syncRecord(deps.fs.root);
  if (rec.state === "running") {
    return { status: 409, json: { error: "A sync is already running.", state: "running" } };
  }
  rec.state = "running";
  rec.startedAt = deps.clock.now().toISOString();
  rec.finishedAt = null;
  rec.runs = null;
  rec.decisions = null;
  rec.done = (async () => {
    try {
      try {
        const r = await runsApiHooks.cloudSync({ repoDir: deps.fs.root, branch: REMOTE_BRANCH, runsRoot: runsRoot(deps) });
        rec.runs = {
          ok: r.ok,
          added: r.added.length,
          skipped: r.skipped.length,
          reason: r.ok ? null : shortReason(r.reason ?? "sync failed", deps),
        };
      } catch (err) {
        rec.runs = { ok: false, added: 0, skipped: 0, reason: shortReason(err instanceof Error ? err.message : String(err), deps) };
      }
      try {
        const d: PullResult = await runsApiHooks.pullDispositions({
          git: deps.git,
          root: deps.fs.root,
          artifactsDir: join(deps.fs.root, "artifacts"),
          now: () => deps.clock.now(),
        });
        rec.decisions = d.ok
          ? { ok: true, added: d.added, reason: null }
          : { ok: false, added: 0, reason: shortReason(d.reason, deps) };
      } catch (err) {
        rec.decisions = { ok: false, added: 0, reason: shortReason(err instanceof Error ? err.message : String(err), deps) };
      }
    } finally {
      rec.state = "done";
      rec.finishedAt = deps.clock.now().toISOString();
    }
  })();
  return { status: 202, json: { state: "running", startedAt: rec.startedAt } };
}

async function getSyncStatus(ctx: HandlerContext): Promise<ConsoleResponse> {
  const rec = syncRecord(ctx.deps.fs.root);
  return {
    status: 200,
    json: {
      state: rec.state,
      startedAt: rec.startedAt,
      finishedAt: rec.finishedAt,
      runs: rec.runs,
      decisions: rec.decisions,
    },
  };
}

export const RUNS_SYNC_BODY_LIMIT = 1024;

export const RUNS_GROUP: RouteDef[] = [
  { method: "GET", pattern: "/api/runs", mutating: false, maxBodyBytes: 0, handler: getRuns },
  { method: "GET", pattern: "/api/runs/:id", mutating: false, maxBodyBytes: 0, handler: getRun },
  { method: "GET", pattern: "/api/runs/:id/log", mutating: false, maxBodyBytes: 0, handler: getLogQuery },
  { method: "GET", pattern: "/api/runs/:id/log/:name", mutating: false, maxBodyBytes: 0, handler: getLogPath },
  { method: "POST", pattern: "/api/sync", mutating: true, maxBodyBytes: RUNS_SYNC_BODY_LIMIT, handler: postSync },
  { method: "GET", pattern: "/api/sync/status", mutating: false, maxBodyBytes: 0, handler: getSyncStatus },
];
