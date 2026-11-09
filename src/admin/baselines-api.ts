/**
 * Baselines API (design J.6, Requirements 24 and 25). Handlers use ports only (ConsoleDeps).
 *
 * - GET  /api/baselines            per-URL readiness and the size of baselines-visual/.
 * - POST /api/baselines/spec/draft starts the draft-writing job (make-all-drafts).
 * - POST /api/baselines/visual/capture starts the local capture job (capture-baselines).
 * - GET  /api/baselines/proposals  spec drafts (text) and capture manifests.
 * - GET  /api/baselines/image      PNG bytes; ids are validated against manifests.
 * - POST /api/baselines/approve    human-only promotion through the Approval_Gate.
 *
 * Jobs only write proposals. Nothing reaches baselines/ or baselines-visual/ without an
 * explicit approval request that names a Reviewer. Setup work is recorded in the
 * Setup_Activity_Log only, never in a run record. No AI, no network.
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { ApprovalError, SelfApprovalError } from "../approval/approval-gate.js";
import { CAPTURE_ID_PATTERN, resolveInside, RUN_ID_PATTERN, SLUG_PATTERN, validateReviewerName } from "./atomic-file.js";
import { readRunFacts, readRunsNewestFirst } from "../publish/published-data.js";
import type { ConsoleDeps } from "./console-deps.js";
import type { ConsoleResponse, HandlerContext, RouteDef } from "./console-routes.js";
import type { JobPort as RunnerPort, JobSpec } from "./job-runner.js";
import { scrubForDisplay } from "./scrub.js";
import { urlSlug } from "./url-set.js";
import { authorize, fail, isEnv, loadEnv, logSetup, parseScope } from "./urls-api.js";
import type { Env } from "./urls-api.js";
import { workspaceFor } from "./workspace.js";
import type { WorkspaceScope } from "./workspace.js";

export const BASELINES_BODY_MAX = 16 * 1024;
export const DRAFT_TEXT_MAX = 20 * 1024;
export const MAX_SPEC_ITEMS = 100;
export const MAX_VISUAL_ITEMS = 200;
export const MAX_CAPTURES = 20;
export const MAX_PNG_BYTES = 25 * 1024 * 1024;
const MAX_DRAFTS = 100;
const MAX_MANIFEST_ENTRIES = 500;
const VIEWPORTS = ["desktop", "mobile"] as const;
type Viewport = (typeof VIEWPORTS)[number];

interface Roots {
  baselines: string;
  visual: string;
  captures: string;
  drafts: string;
}

function rel(p: string): string {
  return p.replace(/^\.\//, "");
}

function rootsFor(scope: WorkspaceScope): Roots {
  const ws = workspaceFor(scope, ".");
  const draft = scope === "draft";
  return {
    baselines: rel(ws.baselinesRoot),
    visual: rel(ws.visualRoot),
    captures: draft ? "artifacts/admin/new-domain/captures" : "artifacts/admin/captures",
    drafts: draft ? "artifacts/admin/new-domain/spec-drafts" : "artifacts/pending-review/spec-drafts",
  };
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isViewport(v: unknown): v is Viewport {
  return v === "desktop" || v === "mobile";
}

function abs(deps: ConsoleDeps, relPath: string): string {
  return resolveInside(deps.fs.root, ...relPath.split("/"));
}

function sha16(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 16);
}

// ---------------------------------------------------------------------------
// Manifests
// ---------------------------------------------------------------------------

export interface ManifestEntry {
  slug: string;
  url: string;
  viewport: Viewport;
  sha16: string;
  size: number;
  capturedAt: string;
}

export interface Manifest {
  captureId: string;
  domain: string;
  createdAt: string;
  entries: ManifestEntry[];
  failures: { slug: string; viewport: string; reason: string }[];
}

/** Validate a capture manifest; null when unusable. Invalid entries are dropped. */
export function parseManifest(text: string, captureId: string): Manifest | null {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObj(doc) || doc.captureId !== captureId || !Array.isArray(doc.entries)) return null;
  const entries: ManifestEntry[] = [];
  for (const e of doc.entries) {
    if (entries.length >= MAX_MANIFEST_ENTRIES) break;
    if (!isObj(e)) continue;
    if (typeof e.slug !== "string" || !SLUG_PATTERN.test(e.slug)) continue;
    if (!isViewport(e.viewport)) continue;
    if (typeof e.sha16 !== "string" || !/^[0-9a-f]{16}$/.test(e.sha16)) continue;
    entries.push({
      slug: e.slug,
      url: typeof e.url === "string" ? scrubForDisplay(e.url).slice(0, 2048) : "",
      viewport: e.viewport,
      sha16: e.sha16,
      size: typeof e.size === "number" && Number.isFinite(e.size) ? e.size : 0,
      capturedAt: typeof e.capturedAt === "string" ? scrubForDisplay(e.capturedAt).slice(0, 40) : "",
    });
  }
  const failures: Manifest["failures"] = [];
  if (Array.isArray(doc.failures)) {
    for (const f of doc.failures.slice(0, MAX_MANIFEST_ENTRIES)) {
      if (!isObj(f)) continue;
      failures.push({
        slug: typeof f.slug === "string" ? scrubForDisplay(f.slug).slice(0, 120) : "",
        viewport: typeof f.viewport === "string" ? scrubForDisplay(f.viewport).slice(0, 20) : "",
        reason: typeof f.reason === "string" ? scrubForDisplay(f.reason).slice(0, 200) : "",
      });
    }
  }
  return {
    captureId,
    domain: typeof doc.domain === "string" ? scrubForDisplay(doc.domain).slice(0, 253) : "",
    createdAt: typeof doc.createdAt === "string" ? scrubForDisplay(doc.createdAt).slice(0, 40) : "",
    entries,
    failures,
  };
}

function readManifest(deps: ConsoleDeps, roots: Roots, captureId: string): Manifest | null {
  if (!CAPTURE_ID_PATTERN.test(captureId)) return null;
  const p = `${roots.captures}/${captureId}/manifest.json`;
  try {
    if (!deps.fs.exists(p)) return null;
    return parseManifest(deps.fs.readText(p), captureId);
  } catch {
    return null;
  }
}

/** The newest valid manifests first (bounded). */
function listManifests(deps: ConsoleDeps, roots: Roots): Manifest[] {
  const out: Manifest[] = [];
  for (const name of deps.fs.listDir(roots.captures)) {
    if (!CAPTURE_ID_PATTERN.test(name)) continue;
    const m = readManifest(deps, roots, name);
    if (m) out.push(m);
  }
  out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.captureId < b.captureId ? 1 : -1));
  return out.slice(0, MAX_CAPTURES);
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

function specVersions(deps: ConsoleDeps, roots: Roots, slug: string): number[] {
  return deps.fs
    .listDir(`${roots.baselines}/${slug}`)
    .map((n) => /^baseline\.v(\d+)\.md$/.exec(n))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => Number(m[1]))
    .sort((a, b) => a - b);
}

function draftSlugs(deps: ConsoleDeps, roots: Roots): string[] {
  const out: string[] = [];
  for (const n of deps.fs.listDir(roots.drafts)) {
    const m = /^(.+)\.draft\.md$/.exec(n);
    if (m && SLUG_PATTERN.test(m[1])) out.push(m[1]);
    if (out.length >= MAX_DRAFTS) break;
  }
  return out;
}

/** Total bytes of regular files under a folder (bounded walk). */
function dirBytes(path: string, depth = 0): number {
  if (depth > 4) return 0;
  let total = 0;
  let names: string[];
  try {
    names = readdirSync(path);
  } catch {
    return 0;
  }
  for (const n of names.slice(0, 5000)) {
    const p = `${path}/${n}`;
    try {
      const st = statSync(p);
      if (st.isDirectory()) total += dirBytes(p, depth + 1);
      else if (st.isFile()) total += st.size;
    } catch {
      /* skip unreadable entries */
    }
  }
  return total;
}

function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readPng(path: string): Buffer | null {
  try {
    const st = statSync(path);
    if (!st.isFile() || st.size > MAX_PNG_BYTES) return null;
    return readFileSync(path);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// GET /api/baselines
// ---------------------------------------------------------------------------

async function getBaselines(ctx: HandlerContext): Promise<ConsoleResponse> {
  const { deps } = ctx;
  const scope = parseScope(ctx.query.scope);
  if (!scope) return fail(400, "Unknown scope");
  const env = loadEnv(deps, scope);
  if (!isEnv(env)) return env;
  const roots = rootsFor(scope);
  const drafts = new Set(draftSlugs(deps, roots));
  const proposals = new Set<string>();
  for (const m of listManifests(deps, roots)) for (const e of m.entries) proposals.add(`${e.slug}/${e.viewport}`);

  const urls = env.urls.map((url) => {
    const slug = urlSlug(url);
    const specBaseline = specVersions(deps, roots, slug).length > 0;
    const visualBaseline = {
      desktop: deps.fs.exists(`${roots.visual}/${slug}/desktop.png`),
      mobile: deps.fs.exists(`${roots.visual}/${slug}/mobile.png`),
    };
    return {
      url,
      slug,
      specBaseline,
      visualBaseline,
      proposals: {
        specDraft: drafts.has(slug),
        visual: { desktop: proposals.has(`${slug}/desktop`), mobile: proposals.has(`${slug}/mobile`) },
      },
      ready: specBaseline && visualBaseline.desktop && visualBaseline.mobile,
    };
  });
  const visualBytes = dirBytes(abs(deps, roots.visual));
  return {
    status: 200,
    json: {
      scope: scope === "draft" ? "draft" : "current",
      urls,
      visualBaselinesBytes: visualBytes,
      visualBaselinesSizeText: sizeText(visualBytes),
    },
  };
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

function runnerOf(deps: ConsoleDeps): RunnerPort | null {
  const j = deps.jobs as unknown as Partial<RunnerPort>;
  return typeof j.status === "function" && typeof j.start === "function" ? (j as RunnerPort) : null;
}

function startJob(deps: ConsoleDeps, spec: JobSpec): ConsoleResponse {
  const runner = runnerOf(deps);
  if (!runner) return fail(503, "Jobs are not available yet");
  if (runner.status().state === "running") return fail(409, "Another job is already running", { reason: "busy" });
  const res = runner.start(spec);
  if (!res.ok) return fail(409, scrubForDisplay(res.detail), { reason: res.reason });
  const s = runner.status();
  return { status: 202, json: { started: true, jobId: `${s.kind}-${s.startedAt}`, state: s.state } };
}

function bodyScope(ctx: HandlerContext): { scope: WorkspaceScope; env: Env } | ConsoleResponse {
  const body = isObj(ctx.body) ? ctx.body : {};
  const scope = parseScope(body.scope);
  if (!scope) return fail(400, "Unknown scope");
  const env = loadEnv(ctx.deps, scope);
  if (!isEnv(env)) return env;
  return { scope, env };
}

function isScoped(v: { scope: WorkspaceScope; env: Env } | ConsoleResponse): v is { scope: WorkspaceScope; env: Env } {
  return (v as ConsoleResponse).status === undefined;
}

function writeUrlsFile(deps: ConsoleDeps, path: string, urls: string[]): void {
  deps.fs.writeText(path, JSON.stringify(urls, null, 2) + "\n");
}

async function postSpecDraft(ctx: HandlerContext): Promise<ConsoleResponse> {
  const sc = bodyScope(ctx);
  if (!isScoped(sc)) return sc;
  const { scope, env } = sc;
  const roots = rootsFor(scope);
  const awg: Record<string, string> = { AWG_BASELINES_ROOT: roots.baselines };
  if (scope === "draft") {
    const urlsFile = "artifacts/admin/new-domain/draft-urls.json";
    try {
      writeUrlsFile(ctx.deps, urlsFile, env.urls);
    } catch {
      return fail(500, "The page list could not be prepared.");
    }
    awg.AWG_DRAFT_URLS_FILE = urlsFile;
    awg.AWG_DRAFT_DOMAIN = env.approvedDomain;
    awg.AWG_DRAFT_OUT = roots.drafts;
  }
  return startJob(ctx.deps, { kind: "spec-drafts", scope: scope === "draft" ? "draft" : "current", env: awg });
}

async function postVisualCapture(ctx: HandlerContext): Promise<ConsoleResponse> {
  const sc = bodyScope(ctx);
  if (!isScoped(sc)) return sc;
  const { scope, env } = sc;
  const roots = rootsFor(scope);
  const captureId = "cap_" + randomBytes(6).toString("hex");
  const awg: Record<string, string> = {
    AWG_CAPTURE_ID: captureId,
    AWG_CAPTURE_OUT_ROOT: roots.captures,
  };
  if (scope === "draft") {
    const urlsFile = "artifacts/admin/new-domain/capture-urls.json";
    try {
      writeUrlsFile(ctx.deps, urlsFile, env.urls);
    } catch {
      return fail(500, "The page list could not be prepared.");
    }
    awg.AWG_CAPTURE_URLS_FILE = urlsFile;
  }
  const res = startJob(ctx.deps, { kind: "visual-capture", scope: scope === "draft" ? "draft" : "current", env: awg });
  if (res.status === 202 && isObj(res.json)) return { status: 202, json: { ...res.json, captureId } };
  return res;
}

// ---------------------------------------------------------------------------
// GET proposals / image
// ---------------------------------------------------------------------------

async function getProposals(ctx: HandlerContext): Promise<ConsoleResponse> {
  const { deps } = ctx;
  const scope = parseScope(ctx.query.scope);
  if (!scope) return fail(400, "Unknown scope");
  const roots = rootsFor(scope);
  const drafts = draftSlugs(deps, roots).map((slug) => {
    let text = "";
    try {
      text = deps.fs.readText(`${roots.drafts}/${slug}.draft.md`);
    } catch {
      /* unreadable draft shows empty */
    }
    const scrubbed = scrubForDisplay(text);
    return {
      slug,
      text: scrubbed.slice(0, DRAFT_TEXT_MAX),
      truncated: scrubbed.length > DRAFT_TEXT_MAX,
      hasBaseline: specVersions(deps, roots, slug).length > 0,
    };
  });
  const captures = listManifests(deps, roots).map((m) => ({
    captureId: m.captureId,
    domain: m.domain,
    createdAt: m.createdAt,
    entries: m.entries.map((e) => ({
      ...e,
      hasBaseline: deps.fs.exists(`${roots.visual}/${e.slug}/${e.viewport}.png`),
    })),
    failures: m.failures,
  }));
  return { status: 200, json: { scope: scope === "draft" ? "draft" : "current", drafts, captures } };
}

async function getImage(ctx: HandlerContext): Promise<ConsoleResponse> {
  const { deps, query } = ctx;
  const scope = parseScope(query.scope);
  if (!scope) return fail(400, "Unknown scope");
  const slug = query.slug ?? "";
  const viewport = query.viewport ?? "";
  if (!SLUG_PATTERN.test(slug) || !isViewport(viewport)) return fail(400, "Unknown image");
  const roots = rootsFor(scope);
  let path: string;
  let expected: string | null = null;
  if (query.kind === "proposal") {
    const id = query.id ?? "";
    const m = readManifest(deps, roots, id);
    const entry = m ? m.entries.find((e) => e.slug === slug && e.viewport === viewport) : undefined;
    if (!m || !entry) return fail(404, "Image not found");
    path = abs(deps, `${roots.captures}/${id}/${slug}/${viewport}.png`);
    expected = entry.sha16;
  } else if (query.kind === "cloud") {
    const run = cloudRun(deps, query.id ?? "");
    if (!isRun(run)) return run;
    path = shotPath(run.dir, slug, viewport);
  } else if (query.kind === "baseline") {
    path = abs(deps, `${roots.visual}/${slug}/${viewport}.png`);
  } else {
    return fail(400, "Unknown image");
  }
  const bytes = readPng(path);
  if (!bytes) return fail(404, "Image not found");
  if (expected !== null && sha16(bytes) !== expected) {
    return fail(409, "This screenshot changed after it was captured. Capture again.");
  }
  return { status: 200, bytes: new Uint8Array(bytes), contentType: "image/png" };
}

// ---------------------------------------------------------------------------
// POST approve
// ---------------------------------------------------------------------------

export interface ApproveResult {
  kind: "spec" | "visual";
  slug: string;
  viewport?: string;
  captureId?: string;
  status: "promoted" | "unchanged" | "refused";
  reason?: string;
  version?: number;
}

function stripState(text: string): string {
  return text.replace(/^- \*\*State:\*\*.*$/m, "").replace(/\r\n/g, "\n");
}

function promoteVisual(
  deps: ConsoleDeps,
  roots: Roots,
  reviewer: string,
  item: { captureId: string; slug: string; viewport: Viewport },
  cache: Map<string, Manifest | null>,
): { result: ApproveResult; auditFailed: boolean } {
  const base: ApproveResult = { kind: "visual", slug: item.slug, viewport: item.viewport, captureId: item.captureId, status: "refused" };
  const refuse = (reason: string) => ({ result: { ...base, reason }, auditFailed: false });
  if (!cache.has(item.captureId)) cache.set(item.captureId, readManifest(deps, roots, item.captureId));
  const m = cache.get(item.captureId) ?? null;
  const entry = m ? m.entries.find((e) => e.slug === item.slug && e.viewport === item.viewport) : undefined;
  if (!m || !entry) return refuse("That screenshot is not in the capture");
  const src = readPng(abs(deps, `${roots.captures}/${item.captureId}/${item.slug}/${item.viewport}.png`));
  if (!src) return refuse("The captured screenshot file is missing");
  if (sha16(src) !== entry.sha16) return refuse("The screenshot changed after it was captured. Capture again.");

  const destRel = `${roots.visual}/${item.slug}/${item.viewport}.png`;
  const dest = abs(deps, destRel);
  const existed = existsSync(dest);
  if (existed) {
    const cur = readPng(dest);
    if (cur && Buffer.compare(cur, src) === 0) return { result: { ...base, status: "unchanged" }, auditFailed: false };
  }
  const tmp = `${dest}.tmp-${process.pid}`;
  try {
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(tmp, src);
    renameSync(tmp, dest);
  } catch {
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      /* ignore cleanup failure */
    }
    return refuse("The screenshot could not be saved");
  }
  // Audit only after the rename succeeded.
  try {
    deps.approval.approveVisualBaseline({
      reviewer,
      slug: item.slug,
      viewport: item.viewport,
      source: item.captureId,
      sha16: entry.sha16,
      updated: existed,
      baselinePath: dest,
      sourceRun: item.captureId,
    });
  } catch {
    return { result: { ...base, status: "promoted", reason: "Saved, but the audit entry could not be written" }, auditFailed: true };
  }
  return { result: { ...base, status: "promoted" }, auditFailed: false };
}

function promoteSpec(
  deps: ConsoleDeps,
  roots: Roots,
  reviewer: string,
  scope: WorkspaceScope,
  slug: string,
): { result: ApproveResult; auditFailed: boolean } {
  const base: ApproveResult = { kind: "spec", slug, status: "refused" };
  if (!draftSlugs(deps, roots).includes(slug)) {
    return { result: { ...base, reason: "There is no draft for that page" }, auditFailed: false };
  }
  const versions = specVersions(deps, roots, slug);
  if (versions.length > 0) {
    try {
      const latest = deps.fs.readText(`${roots.baselines}/${slug}/baseline.v${versions[versions.length - 1]}.md`);
      const draft = deps.fs.readText(`${roots.drafts}/${slug}.draft.md`);
      if (stripState(latest) === stripState(draft)) return { result: { ...base, status: "unchanged" }, auditFailed: false };
    } catch {
      /* compare failure: fall through to promotion */
    }
  }
  const approve = deps.approval.approveSpecification;
  if (typeof approve !== "function") {
    return { result: { ...base, reason: "Specification approval is not available" }, auditFailed: false };
  }
  try {
    const r = approve.call(deps.approval, { reviewer, slug, scope: scope === "draft" ? "draft" : "project" });
    return { result: { ...base, status: "promoted", version: r.version }, auditFailed: false };
  } catch (err) {
    const reason = err instanceof ApprovalError || err instanceof SelfApprovalError ? scrubForDisplay(err.message) : "The draft could not be approved";
    return { result: { ...base, reason }, auditFailed: false };
  }
}

async function postApprove(ctx: HandlerContext): Promise<ConsoleResponse> {
  const { deps } = ctx;
  const body = isObj(ctx.body) ? ctx.body : {};
  const scope = parseScope(body.scope);
  if (!scope) return fail(400, "Unknown scope");
  const rv = validateReviewerName(body.reviewer);
  if (!rv.ok) return fail(400, rv.reason);

  const specsIn = body.specs === undefined ? [] : body.specs;
  const visualsIn = body.visuals === undefined ? [] : body.visuals;
  if (!Array.isArray(specsIn) || !Array.isArray(visualsIn)) return fail(400, "The selection is not valid");
  if (specsIn.length > MAX_SPEC_ITEMS || visualsIn.length > MAX_VISUAL_ITEMS) return fail(400, "Too many items selected");
  if (specsIn.length + visualsIn.length === 0) return fail(400, "Select at least one item to approve");

  const specs: string[] = [];
  for (const s of specsIn) {
    if (typeof s !== "string" || !SLUG_PATTERN.test(s)) return fail(400, "The selection is not valid");
    if (!specs.includes(s)) specs.push(s);
  }
  const visuals: { captureId: string; slug: string; viewport: Viewport }[] = [];
  for (const v of visualsIn) {
    if (!isObj(v) || typeof v.captureId !== "string" || !CAPTURE_ID_PATTERN.test(v.captureId)) {
      return fail(400, "The selection is not valid");
    }
    if (typeof v.slug !== "string" || !SLUG_PATTERN.test(v.slug) || !isViewport(v.viewport)) {
      return fail(400, "The selection is not valid");
    }
    const key = `${v.captureId}/${v.slug}/${v.viewport}`;
    if (!visuals.some((x) => `${x.captureId}/${x.slug}/${x.viewport}` === key)) {
      visuals.push({ captureId: v.captureId, slug: v.slug, viewport: v.viewport });
    }
  }

  // Human-only: an agent identity is rejected here, before any file is touched.
  const denied = authorize(deps, rv.name, "baselines-approve", { specs: specs.length, visuals: visuals.length });
  if (denied) return denied;

  const roots = rootsFor(scope);
  const results: ApproveResult[] = [];
  let auditFailed = false;
  for (const slug of specs) {
    const r = promoteSpec(deps, roots, rv.name, scope, slug);
    results.push(r.result);
    auditFailed = auditFailed || r.auditFailed;
  }
  const cache = new Map<string, Manifest | null>();
  for (const v of visuals) {
    const r = promoteVisual(deps, roots, rv.name, v, cache);
    results.push(r.result);
    auditFailed = auditFailed || r.auditFailed;
  }

  const promoted = results.filter((r) => r.status === "promoted");
  const pageSet = new Set(promoted.map((r) => r.slug));
  const viewportCount = promoted.filter((r) => r.kind === "visual").length;
  const summary = {
    promoted: promoted.length,
    unchanged: results.filter((r) => r.status === "unchanged").length,
    refused: results.filter((r) => r.status === "refused").length,
  };
  if (promoted.length > 0) {
    const logged = logSetup(
      deps,
      rv.name,
      "baselines-approved",
      `Approved baselines for ${pageSet.size} page(s), ${viewportCount} viewport(s)`,
      { pages: pageSet.size, viewports: viewportCount, specifications: promoted.length - viewportCount },
      { scope: scope === "draft" ? "draft" : "current" },
    );
    if (logged) return logged;
  }
  if (auditFailed) {
    return fail(500, "A baseline was saved but its audit entry could not be written.", { results, ...summary });
  }
  return { status: 200, json: { results, ...summary, pages: pageSet.size, viewports: viewportCount } };
}

// ---------------------------------------------------------------------------
// Adopt a synced cloud run's screenshots as baselines (design J.6, Requirement 24.3)
// ---------------------------------------------------------------------------

const NOT_CLOUD_TEXT = "That run was not taken by the cloud runner. Only screenshots from a pulled cloud run can be used.";
const MAX_CLOUD_RUNS = 10;

/** The cloud run facts for a validated id, or a response explaining why not. */
function cloudRun(deps: ConsoleDeps, id: string): { dir: string } | ConsoleResponse {
  if (!RUN_ID_PATTERN.test(id)) return fail(400, "Unknown run");
  const dir = abs(deps, `artifacts/runs/${id}`);
  let isDir = false;
  try {
    isDir = statSync(dir).isDirectory();
  } catch {
    isDir = false;
  }
  if (!isDir) return fail(404, "That run was not found on this computer. Pull runs first.");
  let origin = "local";
  try {
    origin = readRunFacts(dir, id, "").origin;
  } catch {
    origin = "local";
  }
  if (origin !== "cloud") return fail(409, NOT_CLOUD_TEXT);
  return { dir };
}

function isRun(v: { dir: string } | ConsoleResponse): v is { dir: string } {
  return (v as ConsoleResponse).status === undefined;
}

function shotPath(dir: string, slug: string, viewport: Viewport): string {
  return resolveInside(dir, "screenshots", `${slug}.${viewport}.png`);
}

async function getCloudRuns(ctx: HandlerContext): Promise<ConsoleResponse> {
  const { deps } = ctx;
  const env = loadEnv(deps, "project");
  if (!isEnv(env)) return env;
  const roots = rootsFor("project");
  const slugs = env.urls.map((url) => ({ url, slug: urlSlug(url) }));
  let facts: ReturnType<typeof readRunsNewestFirst> = [];
  try {
    facts = readRunsNewestFirst(abs(deps, "artifacts/runs"), "");
  } catch {
    facts = [];
  }
  const runs: unknown[] = [];
  for (const f of facts) {
    if (runs.length >= MAX_CLOUD_RUNS) break;
    if (f.origin !== "cloud" || !RUN_ID_PATTERN.test(f.runId)) continue;
    const run = cloudRun(deps, f.runId);
    if (!isRun(run)) continue;
    const items: unknown[] = [];
    for (const s of slugs) {
      for (const viewport of VIEWPORTS) {
        const bytes = readPng(shotPath(run.dir, s.slug, viewport));
        if (!bytes) continue;
        items.push({
          slug: s.slug,
          url: scrubForDisplay(s.url).slice(0, 2048),
          viewport,
          sha16: sha16(bytes),
          size: bytes.length,
          hasBaseline: deps.fs.exists(`${roots.visual}/${s.slug}/${viewport}.png`),
        });
      }
    }
    runs.push({ runId: f.runId, finishedAt: f.finishedAt ?? null, items });
  }
  return { status: 200, json: { runs } };
}

async function postAdoptCloud(ctx: HandlerContext): Promise<ConsoleResponse> {
  const { deps } = ctx;
  const body = isObj(ctx.body) ? ctx.body : {};
  const rv = validateReviewerName(body.reviewer);
  if (!rv.ok) return fail(400, rv.reason);
  const runId = body.runId;
  if (typeof runId !== "string" || !RUN_ID_PATTERN.test(runId)) return fail(400, "Unknown run");
  const itemsIn = body.items;
  if (!Array.isArray(itemsIn) || itemsIn.length === 0) return fail(400, "Select at least one screenshot");
  if (itemsIn.length > MAX_VISUAL_ITEMS) return fail(400, "Too many items selected");
  const items: { slug: string; viewport: Viewport; sha16: string | null }[] = [];
  for (const it of itemsIn) {
    if (!isObj(it) || typeof it.slug !== "string" || !SLUG_PATTERN.test(it.slug) || !isViewport(it.viewport)) {
      return fail(400, "The selection is not valid");
    }
    let expected: string | null = null;
    if (it.sha16 !== undefined) {
      if (typeof it.sha16 !== "string" || !/^[0-9a-f]{16}$/.test(it.sha16)) return fail(400, "The selection is not valid");
      expected = it.sha16;
    }
    if (!items.some((x) => x.slug === it.slug && x.viewport === it.viewport)) {
      items.push({ slug: it.slug, viewport: it.viewport, sha16: expected });
    }
  }

  // Human-only: an agent identity is rejected before the run is even read.
  const denied = authorize(deps, rv.name, "baselines-adopt-cloud", { runId, items: items.length });
  if (denied) return denied;

  const run = cloudRun(deps, runId);
  if (!isRun(run)) return run;
  const env = loadEnv(deps, "project");
  if (!isEnv(env)) return env;
  const approved = new Set(env.urls.map((u) => urlSlug(u)));
  const roots = rootsFor("project");

  const results: ApproveResult[] = [];
  let auditFailed = false;
  for (const item of items) {
    const base: ApproveResult = { kind: "visual", slug: item.slug, viewport: item.viewport, captureId: runId, status: "refused" };
    const refuse = (reason: string) => results.push({ ...base, reason });
    if (!approved.has(item.slug)) {
      refuse("That page is not an approved web address");
      continue;
    }
    let src: Buffer | null = null;
    try {
      src = readPng(shotPath(run.dir, item.slug, item.viewport));
    } catch {
      src = null;
    }
    if (!src) {
      refuse("The cloud screenshot file is missing");
      continue;
    }
    const digest = sha16(src);
    if (item.sha16 !== null && item.sha16 !== digest) {
      refuse("The screenshot changed after it was listed. Reload and choose again.");
      continue;
    }
    const dest = abs(deps, `${roots.visual}/${item.slug}/${item.viewport}.png`);
    const existed = existsSync(dest);
    if (existed) {
      const cur = readPng(dest);
      if (cur && Buffer.compare(cur, src) === 0) {
        results.push({ ...base, status: "unchanged" });
        continue;
      }
    }
    const tmp = `${dest}.tmp-${process.pid}`;
    try {
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(tmp, src);
      renameSync(tmp, dest);
    } catch {
      try {
        if (existsSync(tmp)) unlinkSync(tmp);
      } catch {
        /* ignore cleanup failure */
      }
      refuse("The screenshot could not be saved");
      continue;
    }
    try {
      deps.approval.approveVisualBaseline({
        reviewer: rv.name,
        slug: item.slug,
        viewport: item.viewport,
        source: runId,
        sha16: digest,
        updated: existed,
        baselinePath: dest,
        sourceRun: runId,
      });
      results.push({ ...base, status: "promoted" });
    } catch {
      auditFailed = true;
      results.push({ ...base, status: "promoted", reason: "Saved, but the audit entry could not be written" });
    }
  }

  const promoted = results.filter((r) => r.status === "promoted");
  const pages = new Set(promoted.map((r) => r.slug)).size;
  const summary = {
    promoted: promoted.length,
    unchanged: results.filter((r) => r.status === "unchanged").length,
    refused: results.filter((r) => r.status === "refused").length,
  };
  if (promoted.length > 0) {
    const logged = logSetup(
      deps,
      rv.name,
      "baselines-adopted-from-cloud",
      `Adopted ${promoted.length} cloud screenshot(s) for ${pages} page(s) from ${runId}`,
      { pages, viewports: promoted.length },
      { runId },
    );
    if (logged) return logged;
  }
  if (auditFailed) return fail(500, "A baseline was saved but its audit entry could not be written.", { results, ...summary });
  return { status: 200, json: { results, ...summary, pages, viewports: promoted.length } };
}

export const BASELINES_GROUP: RouteDef[] = [
  { method: "GET", pattern: "/api/baselines/cloud-runs", mutating: false, maxBodyBytes: 0, handler: getCloudRuns },
  { method: "POST", pattern: "/api/baselines/adopt-cloud", mutating: true, maxBodyBytes: BASELINES_BODY_MAX, handler: postAdoptCloud },
  { method: "GET", pattern: "/api/baselines", mutating: false, maxBodyBytes: 0, handler: getBaselines },
  { method: "POST", pattern: "/api/baselines/spec/draft", mutating: true, maxBodyBytes: BASELINES_BODY_MAX, handler: postSpecDraft },
  { method: "POST", pattern: "/api/baselines/visual/capture", mutating: true, maxBodyBytes: BASELINES_BODY_MAX, handler: postVisualCapture },
  { method: "GET", pattern: "/api/baselines/proposals", mutating: false, maxBodyBytes: 0, handler: getProposals },
  { method: "GET", pattern: "/api/baselines/image", mutating: false, maxBodyBytes: 0, handler: getImage },
  { method: "POST", pattern: "/api/baselines/approve", mutating: true, maxBodyBytes: BASELINES_BODY_MAX, handler: postApprove },
];
