/**
 * Discovery API (design J.5, Requirement 23). Handlers use ports only (ConsoleDeps).
 *
 * - POST /api/discovery/run starts the local Discovery_Crawler job (no GitHub, no push).
 * - GET /api/jobs/status reports the single current or last job.
 * - GET /api/discovery/candidates shows the validated candidates file, each marked already
 *   approved or not, and approvable or not.
 * - POST /api/discovery/approve stages the selected candidates through the same path as
 *   adding a URL (urls-api prepare/commit): Approval_Gate, pending file or draft, one
 *   Setup_Activity_Log entry. Any failing URL rejects the whole request and nothing is staged.
 * Running discovery alone never changes the seed, pending file, or draft.
 * No AI. The only network traffic is the crawler's own page loads (and an injectable draft DNS check).
 */
import { existsSync } from "node:fs";
import type { ConsoleDeps } from "./console-deps.js";
import type { ConsoleResponse, HandlerContext, RouteDef } from "./console-routes.js";
import type { JobPort as RunnerPort, JobStatus } from "./job-runner.js";
import { scrubForDisplay } from "./scrub.js";
import { applyUrlOps, normaliseApprovedUrl } from "./url-set.js";
import {
  authorize,
  commit,
  fail,
  isEnv,
  isPrepared,
  loadEnv,
  logSetup,
  parseScope,
  prepare,
  stagedOp,
} from "./urls-api.js";
import type { Env } from "./urls-api.js";

export const DISCOVERY_BODY_MAX = 16 * 1024;
export const MAX_CANDIDATES = 100;
const FIELD_MAX = 200;

/** Preflight checks owned by the API layer. Injectable so tests never touch the network. */
export interface DiscoveryChecks {
  chromiumInstalled(): Promise<boolean>;
  /** True when `host` resolves in DNS. */
  hostResolves(host: string): Promise<boolean>;
}

async function defaultChromiumInstalled(): Promise<boolean> {
  try {
    const pw = await import("@playwright/test");
    return existsSync(pw.chromium.executablePath());
  } catch {
    return false;
  }
}

async function defaultHostResolves(host: string): Promise<boolean> {
  try {
    const dns = await import("node:dns/promises");
    const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 5000).unref());
    await Promise.race([dns.lookup(host), timeout]);
    return true;
  } catch {
    return false;
  }
}

export const discoveryChecks: DiscoveryChecks = {
  chromiumInstalled: defaultChromiumInstalled,
  hostResolves: defaultHostResolves,
};

/** The job-runner port when the deps carry one (status() present); otherwise null. */
function runnerOf(deps: ConsoleDeps): RunnerPort | null {
  const j = deps.jobs as unknown as Partial<RunnerPort>;
  return typeof j.status === "function" && typeof j.start === "function" ? (j as RunnerPort) : null;
}

function idleStatus(): JobStatus {
  return {
    state: "idle", kind: null, scope: null, startedAt: null, finishedAt: null,
    elapsedMs: 0, exitCode: null, progress: null, tail: [],
  };
}

function relPath(p: string): string {
  return p.replace(/^\.\//, "");
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// ---------------------------------------------------------------------------
// Candidates file
// ---------------------------------------------------------------------------

export interface Candidate {
  url: string;
  httpStatus: number | null;
  title: string;
  h1: string;
  concern: string;
}

export interface CandidateFile {
  generatedAt: string;
  approvedDomain: string;
  candidates: Candidate[];
}

function cap(v: unknown): string {
  return typeof v === "string" ? scrubForDisplay(v).slice(0, FIELD_MAX) : "";
}

/** Validate the crawler output; unknown fields are dropped. Null when the file is unusable. */
export function parseCandidateFile(text: string): CandidateFile | null {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObj(doc) || typeof doc.generatedAt !== "string" || typeof doc.approvedDomain !== "string") return null;
  if (!Array.isArray(doc.candidates)) return null;
  const out: Candidate[] = [];
  for (const c of doc.candidates) {
    if (out.length >= MAX_CANDIDATES) break;
    if (!isObj(c) || typeof c.url !== "string" || c.url.length === 0 || c.url.length > 2048) continue;
    out.push({
      url: c.url,
      httpStatus: typeof c.httpStatus === "number" && Number.isFinite(c.httpStatus) ? c.httpStatus : null,
      title: cap(c.title),
      h1: cap(c.h1),
      concern: cap(c.concern),
    });
  }
  return { generatedAt: cap(doc.generatedAt), approvedDomain: doc.approvedDomain, candidates: out };
}

interface View {
  /** idle | running | failed | empty | mismatch | ready */
  state: "idle" | "running" | "failed" | "empty" | "mismatch" | "ready";
  outcome: string;
  file: CandidateFile | null;
}

function discoveryJobStatus(deps: ConsoleDeps): JobStatus | null {
  const r = runnerOf(deps);
  if (!r) return null;
  const s = r.status();
  return s.kind === "discovery" ? s : null;
}

function loadView(deps: ConsoleDeps, env: Env): View {
  const job = discoveryJobStatus(deps);
  if (job && job.state === "running") return { state: "running", outcome: "Finding pages. Please wait.", file: null };
  if (job && (job.state === "failed" || job.state === "timed-out" || job.state === "interrupted")) {
    const why = job.state === "timed-out" ? "took too long and was stopped" : "did not finish";
    return { state: "failed", outcome: `The page search ${why}. The approved pages are unchanged.`, file: null };
  }
  const path = relPath(env.ws.candidatesPath);
  if (!deps.fs.exists(path)) return { state: "idle", outcome: "Discovery has not been run yet.", file: null };
  let text: string;
  try {
    text = deps.fs.readText(path);
  } catch {
    return { state: "failed", outcome: "The discovery results could not be read. The approved pages are unchanged.", file: null };
  }
  const file = parseCandidateFile(text);
  if (!file) {
    return { state: "failed", outcome: "The discovery results are not valid. The approved pages are unchanged.", file: null };
  }
  if (file.approvedDomain !== env.approvedDomain) {
    return {
      state: "mismatch",
      outcome: `These pages were found for ${scrubForDisplay(file.approvedDomain).slice(0, FIELD_MAX)}. Run discovery again.`,
      file,
    };
  }
  if (file.candidates.length === 0) {
    return { state: "empty", outcome: "No pages were found. The approved pages are unchanged.", file };
  }
  return { state: "ready", outcome: `${file.candidates.length} page(s) found.`, file };
}

function approvableReason(c: Candidate, env: Env): { url: string | null; reason: string | null } {
  if (c.httpStatus === null || c.httpStatus < 200 || c.httpStatus > 299) {
    return { url: null, reason: "The page did not load successfully" };
  }
  if (c.concern) return { url: null, reason: `The crawler flagged this page: ${c.concern}` };
  const n = normaliseApprovedUrl(c.url, env.approvedDomain, env.approvedSchemes);
  if (!n.ok) return { url: null, reason: n.reason };
  return { url: n.url, reason: null };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function getJobsStatus(ctx: HandlerContext): Promise<ConsoleResponse> {
  const r = runnerOf(ctx.deps);
  const s = r ? r.status() : idleStatus();
  return { status: 200, json: { ...s, jobId: s.kind && s.startedAt ? `${s.kind}-${s.startedAt}` : null } };
}

async function postRun(ctx: HandlerContext): Promise<ConsoleResponse> {
  const body = isObj(ctx.body) ? ctx.body : {};
  const scope = parseScope(body.scope);
  if (!scope) return fail(400, "Unknown scope");
  const runner = runnerOf(ctx.deps);
  if (!runner) return fail(503, "Jobs are not available yet");
  const env = loadEnv(ctx.deps, scope);
  if (!isEnv(env)) return env;

  if (runner.status().state === "running") return fail(409, "Another job is already running", { reason: "busy" });

  if (!(await discoveryChecks.chromiumInstalled())) {
    return fail(409, "The browser is not installed. Run npx playwright install chromium", { reason: "preflight-failed" });
  }
  const awg: Record<string, string> = {
    AWG_DISCOVERY_OUT: relPath(env.ws.candidatesPath),
  };
  if (scope === "draft") {
    const host = env.approvedDomain;
    if (!(await discoveryChecks.hostResolves(host))) {
      return fail(409, `The address ${host} could not be found. Check the spelling and your connection.`, {
        reason: "preflight-failed",
      });
    }
    const baseUrl = typeof env.doc.baseUrl === "string" && env.doc.baseUrl ? env.doc.baseUrl : `https://${host}`;
    awg.AWG_DISCOVERY_DOMAIN = host;
    awg.AWG_DISCOVERY_BASE_URL = baseUrl.replace(/\/+$/, "");
  }

  const res = runner.start({ kind: "discovery", scope: scope === "draft" ? "draft" : "current", env: awg });
  if (!res.ok) {
    return fail(409, scrubForDisplay(res.detail), { reason: res.reason });
  }
  const s = runner.status();
  return { status: 202, json: { started: true, jobId: `${s.kind}-${s.startedAt}`, state: s.state } };
}

async function getCandidates(ctx: HandlerContext): Promise<ConsoleResponse> {
  const scope = parseScope(ctx.query.scope);
  if (!scope) return fail(400, "Unknown scope");
  const env = loadEnv(ctx.deps, scope);
  if (!isEnv(env)) return env;
  const view = loadView(ctx.deps, env);
  const have = new Set(env.urls);
  // Include staged additions for the project scope.
  const p = prepare({ ...ctx, body: { scope: ctx.query.scope, reviewer: "viewer" } });
  if (isPrepared(p)) for (const u of p.projected) have.add(u);
  const candidates =
    view.file && (view.state === "ready")
      ? view.file.candidates.map((c) => {
          const a = approvableReason(c, env);
          const alreadyApproved = a.url !== null && have.has(a.url);
          return {
            url: c.url,
            httpStatus: c.httpStatus,
            title: c.title,
            h1: c.h1,
            concern: c.concern,
            alreadyApproved,
            alreadyApprovedText: alreadyApproved ? "Already approved" : "Not yet approved",
            approvable: a.url !== null && !alreadyApproved,
            reason: a.reason,
          };
        })
      : [];
  return {
    status: 200,
    json: {
      scope: scope === "draft" ? "draft" : "current",
      state: view.state,
      outcome: view.outcome,
      generatedAt: view.file ? view.file.generatedAt : null,
      domain: env.approvedDomain,
      approvalDisabled: view.state !== "ready",
      candidates,
    },
  };
}

async function postApprove(ctx: HandlerContext): Promise<ConsoleResponse> {
  const p = prepare(ctx);
  if (!isPrepared(p)) return p;
  const view = loadView(ctx.deps, p.env);
  if (view.state !== "ready" || !view.file) return fail(409, view.outcome);

  const list = Array.isArray(p.body.urls) ? p.body.urls : [];
  if (list.length === 0 || list.length > MAX_CANDIDATES) return fail(400, "Select at least one page to approve");

  const file = view.file;
  const byKey = new Map<string, Candidate>();
  for (const c of file.candidates) {
    byKey.set(c.url, c);
    const n = normaliseApprovedUrl(c.url, p.env.approvedDomain, p.env.approvedSchemes);
    if (n.ok && !byKey.has(n.url)) byKey.set(n.url, c);
  }

  const reasons: { input: string; reason: string }[] = [];
  const chosen: string[] = [];
  for (const raw of list) {
    const input = typeof raw === "string" ? raw : "";
    const c = byKey.get(input);
    if (!c) {
      reasons.push({ input: scrubForDisplay(input).slice(0, FIELD_MAX), reason: "That page was not found by the crawler" });
      continue;
    }
    const a = approvableReason(c, p.env);
    if (a.url === null) {
      reasons.push({ input: scrubForDisplay(input).slice(0, FIELD_MAX), reason: a.reason ?? "That page cannot be approved" });
      continue;
    }
    if (!chosen.includes(a.url)) chosen.push(a.url);
  }

  const res = applyUrlOps(
    p.projected,
    chosen.map((url) => ({ op: "add" as const, url })),
    { approvedDomain: p.env.approvedDomain, approvedSchemes: p.env.approvedSchemes, max: p.env.max },
  );
  for (const o of res.outcomes) {
    if (o.status === "rejected") {
      reasons.push({ input: o.op.op === "add" ? o.op.url : "", reason: o.reason ?? "That page cannot be approved" });
    }
  }
  if (reasons.length > 0) {
    return fail(400, reasons[0].reason, { results: reasons, approved: 0 });
  }

  const added = res.outcomes.filter((o) => o.status === "added");
  const discovered = file.candidates.length;
  if (added.length === 0) {
    return { status: 200, json: { approved: 0, discovered, message: "Those pages are already approved", usedText: res.usedText } };
  }

  const denied = authorize(ctx.deps, p.reviewer, "candidates-approve", { added: added.map((o) => o.added ?? "") });
  if (denied) return denied;
  const newOps = added.map((o, i) => stagedOp(ctx.deps, p, "add", o.added ?? "", null, i));
  try {
    commit(ctx.deps, p, newOps, res.urls);
  } catch {
    return fail(500, "The change could not be saved.");
  }
  const logged = logSetup(
    ctx.deps,
    p.reviewer,
    "candidates-approved",
    `Approved ${added.length} of ${discovered} discovered page(s)`,
    { discovered, approved: added.length },
    { scope: p.env.scope },
  );
  if (logged) return logged;
  return {
    status: 200,
    json: {
      approved: added.length,
      discovered,
      urls: added.map((o) => o.added),
      used: res.urls.length,
      max: res.max,
      usedText: res.usedText,
      staged: p.env.scope === "project",
    },
  };
}

export const DISCOVERY_GROUP: RouteDef[] = [
  { method: "POST", pattern: "/api/discovery/run", mutating: true, maxBodyBytes: DISCOVERY_BODY_MAX, handler: postRun },
  { method: "GET", pattern: "/api/jobs/status", mutating: false, maxBodyBytes: 0, handler: getJobsStatus },
  { method: "GET", pattern: "/api/discovery/candidates", mutating: false, maxBodyBytes: 0, handler: getCandidates },
  { method: "POST", pattern: "/api/discovery/approve", mutating: true, maxBodyBytes: DISCOVERY_BODY_MAX, handler: postApprove },
];
