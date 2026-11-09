/**
 * Approved URLs API (design J.4, Requirement 22). Handlers use ports only (ConsoleDeps).
 *
 * - scope "current": add / remove / edit are validated against the projected set (seed plus
 *   staged operations) and staged in artifacts/admin/pending-changes.json. Only
 *   "Update project" writes config/page-seed.json (no git operation).
 * - scope "draft": the draft file is the staging area, so changes write to draft.urls.
 * - The maximum is fixed (urlLimit); no route accepts a new maximum.
 * - Removal keeps baseline files and run history (nothing outside the seed or pending file
 *   is touched).
 * - If an approved-scope file with pages exists, edits are disabled (409) with an explanation.
 * No AI, no network.
 */
import { createHash } from "node:crypto";
import { ApprovalError, SelfApprovalError } from "../approval/approval-gate.js";
import { validateReviewerName } from "./atomic-file.js";
import type { ConsoleDeps } from "./console-deps.js";
import type { ConsoleResponse, HandlerContext, RouteDef } from "./console-routes.js";
import { scrubForDisplay } from "./scrub.js";
import { appendSetupEntry } from "./setup-log.js";
import type { SetupAction } from "./setup-log.js";
import { applyUrlOps, projectUrls, urlLimit, urlSlug } from "./url-set.js";
import type { PendingOp, UrlOp } from "./url-set.js";
import { workspaceFor } from "./workspace.js";
import type { Workspace, WorkspaceScope } from "./workspace.js";

export const URLS_BODY_MAX = 16 * 1024;
export const SCOPE_OVERRIDE_TEXT =
  "A separate approved-scope file is in use for this site, so changes here would not change what is scanned";
export const PENDING_UNREADABLE_TEXT = "Staged changes could not be read";
const VIEWPORTS = ["desktop", "mobile"] as const;

export interface StagedOp {
  opId: string;
  editId: string | null;
  op: "add" | "remove";
  url: string;
  reviewer: string;
  at: string;
}

interface PendingFile {
  schemaVersion: 1;
  ops: StagedOp[];
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function rel(p: string): string {
  return p.replace(/^\.\//, "");
}

export function wsFor(scope: WorkspaceScope): Workspace {
  const ws = workspaceFor(scope, ".");
  return {
    ...ws,
    baselinesRoot: rel(ws.baselinesRoot),
    visualRoot: rel(ws.visualRoot),
    seedPath: rel(ws.seedPath),
    pendingPath: ws.pendingPath === null ? null : rel(ws.pendingPath),
  };
}

function readJson(deps: ConsoleDeps, path: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(deps.fs.readText(path));
    return isObj(v) ? v : null;
  } catch {
    return null;
  }
}

export function fail(status: number, error: string, extra: Record<string, unknown> = {}): ConsoleResponse {
  return { status, json: { error, ...extra } };
}

export interface Env {
  scope: WorkspaceScope;
  ws: Workspace;
  /** The seed document (project) or draft document (draft), parsed. */
  doc: Record<string, unknown>;
  urls: string[];
  max: number;
  approvedDomain: string;
  approvedSchemes: string[];
  slug: string;
  scopeOverride: boolean;
}

export function parseScope(raw: unknown): WorkspaceScope | null {
  if (raw === undefined || raw === null || raw === "" || raw === "current" || raw === "project") return "project";
  if (raw === "draft") return "draft";
  return null;
}

export function loadEnv(deps: ConsoleDeps, scope: WorkspaceScope): Env | ConsoleResponse {
  const cfg = readJson(deps, "config/app.config.json");
  if (!cfg || typeof cfg.approvedDomain !== "string") return fail(500, "domain config unavailable");
  const projectSeed = readJson(deps, "config/page-seed.json");
  if (!projectSeed) return fail(500, "The page list cannot be read.");
  const limits = isObj(cfg.limits) ? cfg.limits : {};
  const seedMax = typeof projectSeed.maxUrls === "number" ? projectSeed.maxUrls : 10;
  const pages = typeof limits.pages === "number" ? limits.pages : 10;
  const max = urlLimit(seedMax, pages);
  const slug = typeof cfg.domain === "string" ? cfg.domain : "";
  const ws = wsFor(scope);

  let doc: Record<string, unknown>;
  let urls: string[];
  let approvedDomain = cfg.approvedDomain;
  if (scope === "draft") {
    const draft = deps.fs.exists(ws.seedPath) ? readJson(deps, ws.seedPath) : null;
    if (!draft) return fail(409, "There is no new-domain draft.");
    doc = draft;
    urls = Array.isArray(draft.urls) ? draft.urls.filter((u): u is string => typeof u === "string") : [];
    if (typeof draft.host === "string" && draft.host) approvedDomain = draft.host;
  } else {
    doc = projectSeed;
    urls = Array.isArray(projectSeed.approvedUrls)
      ? projectSeed.approvedUrls.filter((u): u is string => typeof u === "string")
      : [];
  }

  let approvedSchemes = ["https"];
  const domainFile = slug ? readJson(deps, `config/domains/${slug}.json`) : null;
  if (scope === "project" && domainFile && Array.isArray(domainFile.approvedSchemes)) {
    const s = domainFile.approvedSchemes.filter((x): x is string => typeof x === "string");
    if (s.length) approvedSchemes = s;
  }

  let scopeOverride = false;
  if (scope === "project" && slug) {
    const p = `config/scope/${slug}.approved.json`;
    if (deps.fs.exists(p)) {
      const sc = readJson(deps, p);
      scopeOverride = !!sc && Array.isArray(sc.pages) && sc.pages.length > 0;
    }
  }
  return { scope, ws, doc, urls, max, approvedDomain, approvedSchemes, slug, scopeOverride };
}

export function isEnv(v: Env | ConsoleResponse): v is Env {
  return (v as Env).ws !== undefined;
}

function validOp(v: unknown): v is StagedOp {
  return (
    isObj(v) &&
    (v.op === "add" || v.op === "remove") &&
    typeof v.url === "string" &&
    typeof v.opId === "string" &&
    (v.editId === null || typeof v.editId === "string") &&
    typeof v.reviewer === "string" &&
    typeof v.at === "string"
  );
}

/** Staged operations; `null` when the file exists but cannot be read as a valid pending file. */
export function readPending(deps: ConsoleDeps, ws: Workspace): StagedOp[] | null {
  if (ws.pendingPath === null) return [];
  if (!deps.fs.exists(ws.pendingPath)) return [];
  const doc = readJson(deps, ws.pendingPath);
  if (!doc || doc.schemaVersion !== 1 || !Array.isArray(doc.ops) || !doc.ops.every(validOp)) return null;
  return doc.ops as StagedOp[];
}

function writePending(deps: ConsoleDeps, ws: Workspace, ops: StagedOp[]): void {
  if (ws.pendingPath === null) return;
  const file: PendingFile = { schemaVersion: 1, ops };
  deps.fs.writeText(ws.pendingPath, JSON.stringify(file, null, 2) + "\n");
}

function toPendingOps(ops: StagedOp[]): PendingOp[] {
  return ops.map((o) => ({ opId: o.opId, editId: o.editId, op: o.op, url: o.url }));
}

function newId(prefix: string, ...parts: string[]): string {
  return prefix + createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 12);
}

function hasSpecBaseline(deps: ConsoleDeps, ws: Workspace, slug: string): boolean {
  return deps.fs.listDir(`${ws.baselinesRoot}/${slug}`).some((n) => /^baseline\.v\d+\.md$/.test(n));
}

function hasVisual(deps: ConsoleDeps, ws: Workspace, slug: string, vp: string): boolean {
  return deps.fs.exists(`${ws.visualRoot}/${slug}/${vp}.png`);
}

const STATUS_TEXT: Record<string, string> = {
  ready: "Ready to scan",
  "needs-spec-baseline": "Will be skipped by the next run until a specification baseline is approved",
  "needs-visual-baseline":
    "Will be scanned, but visual changes cannot be detected until a visual baseline is approved",
};

// ---------------------------------------------------------------------------
// GET /api/urls
// ---------------------------------------------------------------------------

async function getUrls(ctx: HandlerContext): Promise<ConsoleResponse> {
  const { deps } = ctx;
  const scope = parseScope(ctx.query.scope);
  if (!scope) return fail(400, "Unknown scope");
  const env = loadEnv(deps, scope);
  if (!isEnv(env)) return env;

  const staged = readPending(deps, env.ws);
  const pendingError = staged === null;
  const proj = projectUrls(env.urls, toPendingOps(staged ?? []), env.max);
  const urls = proj.entries.map((e) => {
    const slug = urlSlug(e.url);
    const specBaseline = hasSpecBaseline(deps, env.ws, slug);
    const visualBaseline = {
      desktop: hasVisual(deps, env.ws, slug, "desktop"),
      mobile: hasVisual(deps, env.ws, slug, "mobile"),
    };
    const status = !specBaseline
      ? "needs-spec-baseline"
      : VIEWPORTS.every((v) => visualBaseline[v])
        ? "ready"
        : "needs-visual-baseline";
    return {
      url: e.url,
      slug,
      pending: e.pending,
      requiresReapproval: e.requiresReapproval,
      specBaseline,
      visualBaseline,
      status,
      statusText: STATUS_TEXT[status],
    };
  });
  return {
    status: 200,
    json: {
      scope: env.scope === "draft" ? "draft" : "current",
      urls,
      used: proj.used,
      max: proj.max,
      usedText: proj.usedText,
      pendingCount: staged ? staged.length : 0,
      pendingError: pendingError ? PENDING_UNREADABLE_TEXT : null,
      editsDisabled: env.scopeOverride || pendingError,
      disabledReason: env.scopeOverride ? SCOPE_OVERRIDE_TEXT : pendingError ? PENDING_UNREADABLE_TEXT : null,
    },
  };
}

// ---------------------------------------------------------------------------
// POST add / remove / edit
// ---------------------------------------------------------------------------

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export function authorize(
  deps: ConsoleDeps,
  reviewer: string,
  action: string,
  detail: Record<string, unknown>,
): ConsoleResponse | null {
  try {
    deps.approval.authorizeSetupAction({ reviewer, action, detail });
    return null;
  } catch (err) {
    if (err instanceof SelfApprovalError || err instanceof ApprovalError) {
      return fail(403, scrubForDisplay(err.message));
    }
    return fail(500, "The action could not be authorised.");
  }
}

export function logSetup(
  deps: ConsoleDeps,
  reviewer: string,
  action: SetupAction,
  summary: string,
  counts: Record<string, number>,
  detail: Record<string, string>,
): ConsoleResponse | null {
  try {
    appendSetupEntry(deps.fs.root, { at: deps.clock.now().toISOString(), reviewer, action, summary, counts, detail });
    return null;
  } catch {
    return fail(500, "The change was saved but the activity log could not be written.");
  }
}

export interface Prepared {
  env: Env;
  reviewer: string;
  body: Record<string, unknown>;
  staged: StagedOp[];
  projected: string[];
}

/** Common checks: scope, Reviewer name, override, readable pending file, projected set. */
export function prepare(ctx: HandlerContext): Prepared | ConsoleResponse {
  const body = isObj(ctx.body) ? ctx.body : {};
  const scope = parseScope(body.scope);
  if (!scope) return fail(400, "Unknown scope");
  const rv = validateReviewerName(body.reviewer);
  if (!rv.ok) return fail(400, rv.reason);
  const env = loadEnv(ctx.deps, scope);
  if (!isEnv(env)) return env;
  if (env.scopeOverride) return fail(409, SCOPE_OVERRIDE_TEXT);
  const staged = readPending(ctx.deps, env.ws);
  if (staged === null) return fail(409, PENDING_UNREADABLE_TEXT);
  const projected = projectUrls(env.urls, toPendingOps(staged), env.max).urls;
  return { env, reviewer: rv.name, body, staged, projected };
}

export function isPrepared(v: Prepared | ConsoleResponse): v is Prepared {
  return (v as Prepared).env !== undefined;
}

/** Store accepted operations: staged file (project) or the draft's urls (draft). */
export function commit(deps: ConsoleDeps, p: Prepared, newOps: StagedOp[], resultingUrls: string[]): void {
  if (p.env.scope === "draft") {
    deps.fs.writeText(p.env.ws.seedPath, JSON.stringify({ ...p.env.doc, urls: resultingUrls }, null, 2) + "\n");
  } else {
    writePending(deps, p.env.ws, [...p.staged, ...newOps]);
  }
}

export function stagedOp(
  deps: ConsoleDeps,
  p: Prepared,
  op: "add" | "remove",
  url: string,
  editId: string | null,
  index: number,
): StagedOp {
  const at = deps.clock.now().toISOString();
  return {
    opId: newId("op_", at, op, url, String(p.staged.length + index)),
    editId,
    op,
    url,
    reviewer: p.reviewer,
    at,
  };
}

function projectedSummary(p: Prepared, resulting: string[]): Record<string, unknown> {
  const text = `${resulting.length} of ${p.env.max} used`;
  return { used: resulting.length, max: p.env.max, usedText: text };
}

async function postAdd(ctx: HandlerContext): Promise<ConsoleResponse> {
  const p = prepare(ctx);
  if (!isPrepared(p)) return p;
  const list = Array.isArray(p.body.urls) ? p.body.urls : p.body.url !== undefined ? [p.body.url] : [];
  if (list.length === 0 || list.length > p.env.max) return fail(400, "Enter a web address");
  const ops: UrlOp[] = list.map((u) => ({ op: "add", url: str(u) }));
  const res = applyUrlOps(p.projected, ops, {
    approvedDomain: p.env.approvedDomain,
    approvedSchemes: p.env.approvedSchemes,
    max: p.env.max,
  });
  const added = res.outcomes.filter((o) => o.status === "added");
  const results = res.outcomes.map((o) => ({
    input: o.op.op === "add" ? o.op.url : "",
    status: o.status,
    url: o.added ?? null,
    reason: o.reason ?? null,
  }));
  if (added.length === 0) {
    const rejected = res.outcomes.some((o) => o.status === "rejected");
    return {
      status: rejected ? 400 : 200,
      json: { results, ...projectedSummary(p, res.urls), error: rejected ? res.outcomes.find((o) => o.reason)?.reason : undefined },
    };
  }
  const denied = authorize(ctx.deps, p.reviewer, "url-add", { added: added.map((o) => o.added ?? "") });
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
    "urls-added",
    `Added ${added.length} approved URL(s)`,
    { added: added.length },
    { scope: p.env.scope },
  );
  if (logged) return logged;
  return { status: 200, json: { results, ...projectedSummary(p, res.urls), staged: p.env.scope === "project" } };
}

async function postRemove(ctx: HandlerContext): Promise<ConsoleResponse> {
  const p = prepare(ctx);
  if (!isPrepared(p)) return p;
  const res = applyUrlOps(p.projected, [{ op: "remove", url: str(p.body.url) }], {
    approvedDomain: p.env.approvedDomain,
    approvedSchemes: p.env.approvedSchemes,
    max: p.env.max,
  });
  const out = res.outcomes[0];
  if (!out || out.status !== "removed" || !out.removed) {
    return fail(404, out?.reason ?? "That address is not in the list");
  }
  const denied = authorize(ctx.deps, p.reviewer, "url-remove", { removed: out.removed, added: "" });
  if (denied) return denied;
  try {
    commit(ctx.deps, p, [stagedOp(ctx.deps, p, "remove", out.removed, null, 0)], res.urls);
  } catch {
    return fail(500, "The change could not be saved.");
  }
  const logged = logSetup(
    ctx.deps,
    p.reviewer,
    "url-removed",
    `Removed ${out.removed}`,
    { removed: 1 },
    { removed: out.removed, scope: p.env.scope },
  );
  if (logged) return logged;
  return { status: 200, json: { removed: out.removed, ...projectedSummary(p, res.urls), staged: p.env.scope === "project" } };
}

async function postEdit(ctx: HandlerContext): Promise<ConsoleResponse> {
  const p = prepare(ctx);
  if (!isPrepared(p)) return p;
  const res = applyUrlOps(p.projected, [{ op: "edit", from: str(p.body.from), to: str(p.body.to) }], {
    approvedDomain: p.env.approvedDomain,
    approvedSchemes: p.env.approvedSchemes,
    max: p.env.max,
  });
  const out = res.outcomes[0];
  if (!out || out.status === "not-found") return fail(404, out?.reason ?? "That address is not in the list");
  if (out.status !== "edited" || !out.removed || !out.added) {
    return fail(400, out?.reason ?? "That change could not be applied");
  }
  const denied = authorize(ctx.deps, p.reviewer, "url-edit", { removed: out.removed, added: out.added });
  if (denied) return denied;
  const editId = newId("ed_", out.removed, out.added, String(p.staged.length), ctx.deps.clock.now().toISOString());
  const newOps = [
    stagedOp(ctx.deps, p, "remove", out.removed, editId, 0),
    stagedOp(ctx.deps, p, "add", out.added, editId, 1),
  ];
  try {
    commit(ctx.deps, p, newOps, res.urls);
  } catch {
    return fail(500, "The change could not be saved.");
  }
  const logged = logSetup(
    ctx.deps,
    p.reviewer,
    "url-edited",
    `Replaced ${out.removed} with ${out.added}`,
    { removed: 1, added: 1 },
    { removed: out.removed, added: out.added, scope: p.env.scope },
  );
  if (logged) return logged;
  return {
    status: 200,
    json: {
      removed: out.removed,
      added: out.added,
      requiresReapproval: true,
      ...projectedSummary(p, res.urls),
      staged: p.env.scope === "project",
    },
  };
}

// ---------------------------------------------------------------------------
// GET /api/project/pending, POST /api/project/update
// ---------------------------------------------------------------------------

async function getPending(ctx: HandlerContext): Promise<ConsoleResponse> {
  const ws = wsFor("project");
  const staged = readPending(ctx.deps, ws);
  if (staged === null) return fail(409, PENDING_UNREADABLE_TEXT, { ops: [], count: 0 });
  return { status: 200, json: { ops: staged, count: staged.length } };
}

async function postUpdate(ctx: HandlerContext): Promise<ConsoleResponse> {
  const body = isObj(ctx.body) ? ctx.body : {};
  const rv = validateReviewerName(body.reviewer);
  if (!rv.ok) return fail(400, rv.reason);
  const env = loadEnv(ctx.deps, "project");
  if (!isEnv(env)) return env;
  if (env.scopeOverride) return fail(409, SCOPE_OVERRIDE_TEXT);
  const staged = readPending(ctx.deps, env.ws);
  if (staged === null) return fail(409, PENDING_UNREADABLE_TEXT);
  if (staged.length === 0) return { status: 200, json: { applied: 0, added: 0, removed: 0, message: "No staged changes" } };

  const ops: UrlOp[] = staged.map((o) => ({ op: o.op, url: o.url }));
  const res = applyUrlOps(env.urls, ops, {
    approvedDomain: env.approvedDomain,
    approvedSchemes: env.approvedSchemes,
    max: env.max,
  });
  const added = res.outcomes.filter((o) => o.status === "added").length;
  const removed = res.outcomes.filter((o) => o.status === "removed").length;

  const denied = authorize(ctx.deps, rv.name, "project-update", { opIds: staged.map((o) => o.opId), added, removed });
  if (denied) return denied;
  try {
    // Only approvedUrls changes: maxUrls, unknown fields, and key order are preserved.
    const next = { ...env.doc, approvedUrls: res.urls };
    ctx.deps.fs.writeText(env.ws.seedPath, JSON.stringify(next, null, 2) + "\n");
    writePending(ctx.deps, env.ws, []);
  } catch {
    return fail(500, "The project files could not be updated.");
  }
  const logged = logSetup(
    ctx.deps,
    rv.name,
    "project-updated",
    `Updated project: ${added} added, ${removed} removed`,
    { added, removed, total: res.urls.length },
    { opIds: staged.map((o) => o.opId).join(",") },
  );
  if (logged) return logged;
  return {
    status: 200,
    json: { applied: staged.length, added, removed, urls: res.urls, usedText: res.usedText },
  };
}

export const URLS_GROUP: RouteDef[] = [
  { method: "GET", pattern: "/api/urls", mutating: false, maxBodyBytes: 0, handler: getUrls },
  { method: "POST", pattern: "/api/urls/add", mutating: true, maxBodyBytes: URLS_BODY_MAX, handler: postAdd },
  { method: "POST", pattern: "/api/urls/remove", mutating: true, maxBodyBytes: URLS_BODY_MAX, handler: postRemove },
  { method: "POST", pattern: "/api/urls/edit", mutating: true, maxBodyBytes: URLS_BODY_MAX, handler: postEdit },
  { method: "GET", pattern: "/api/project/pending", mutating: false, maxBodyBytes: 0, handler: getPending },
  {
    method: "POST",
    pattern: "/api/project/update",
    mutating: true,
    maxBodyBytes: URLS_BODY_MAX,
    handler: postUpdate,
  },
];
