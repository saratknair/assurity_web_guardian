/**
 * Route groups for the Management_Console. Each later task adds its group to
 * `ROUTE_GROUPS`; the router never needs to change. Handlers use ports only.
 */
import { runningJobOf } from "./console-deps.js";
import type { ConsoleDeps } from "./console-deps.js";
import { pagesUrlFromRemote } from "./git-feedback.js";
import { urlLimit, usedText } from "./url-set.js";
import { parseSetupLog, SETUP_LOG_REL } from "./setup-log.js";
import { OPEN_GROUP } from "./open-routes.js";
import { DISPOSITIONS_GROUP } from "./dispositions-api.js";
import { URLS_GROUP } from "./urls-api.js";
import { SYNC_GROUP } from "./sync-routes.js";
import { DISCOVERY_GROUP } from "./discovery-api.js";
import { BASELINES_GROUP } from "./baselines-api.js";
import { PUBLISH_GROUP, publishOverview } from "./publish-api.js";
import { SCHEDULE_GROUP } from "./schedule-api.js";
import { RUNS_GROUP } from "./runs-api.js";
import { DOMAIN_SETUP_GROUP } from "./domain-setup-api.js";

export interface ConsoleResponse {
  status: number;
  json?: unknown;
  text?: string;
  bytes?: Uint8Array;
  contentType?: string;
}

export interface ConsoleRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: {
    host?: string;
    origin?: string;
    contentType?: string;
    secFetchSite?: string;
    contentLength?: number;
  };
  body: string | null;
}

export interface HandlerContext {
  deps: ConsoleDeps;
  req: ConsoleRequest;
  /** Named segments of the matched pattern, e.g. `:id`. */
  params: Record<string, string>;
  query: Record<string, string>;
  /** Parsed JSON body; `{}` for GET and for an empty POST body. */
  body: unknown;
}

export interface RouteDef {
  method: "GET" | "POST";
  /** Exact path, or a pattern with `:name` segments. */
  pattern: string;
  /** True for every POST (a test enforces it). */
  mutating: boolean;
  /** 0 for GET. */
  maxBodyBytes: number;
  handler: (ctx: HandlerContext) => Promise<ConsoleResponse>;
}

export const SETUP_BODY_MAX = 16 * 1024;
export const DISPOSITION_BODY_MAX = 8 * 1024;

function readJsonFile(deps: ConsoleDeps, rel: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(deps.fs.readText(rel));
    return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function readDomain(deps: ConsoleDeps): { domain: string; baseUrl: string; slug: string } | null {
  const cfg = readJsonFile(deps, "config/app.config.json");
  if (!cfg) return null;
  const domain = str(cfg.approvedDomain);
  const baseUrl = str(cfg.baseUrl);
  const slug = str(cfg.domain);
  if (!domain || !baseUrl || !slug) return null;
  return { domain, baseUrl, slug };
}

async function getDomain(ctx: HandlerContext): Promise<ConsoleResponse> {
  const d = readDomain(ctx.deps);
  if (!d) return { status: 500, json: { error: "domain config unavailable" } };
  return { status: 200, json: { domain: d.domain, baseUrl: d.baseUrl, slug: d.slug } };
}

async function getStatus(ctx: HandlerContext): Promise<ConsoleResponse> {
  const { deps } = ctx;
  const d = readDomain(deps);
  const cfg = readJsonFile(deps, "config/app.config.json");
  const seed = readJsonFile(deps, "config/page-seed.json");
  let used: string | null = null;
  if (cfg && seed && Array.isArray(seed.approvedUrls)) {
    const limits = cfg.limits as { pages?: unknown } | undefined;
    const seedMax = typeof seed.maxUrls === "number" ? seed.maxUrls : 10;
    const pages = limits && typeof limits.pages === "number" ? limits.pages : 10;
    used = usedText(seed.approvedUrls.length, urlLimit(seedMax, pages));
  }
  const pub = await publishOverview(deps);
  let pagesUrl: string | null = null;
  try {
    const r = await deps.git.run(["remote", "get-url", "origin"]);
    if (r.code === 0) pagesUrl = pagesUrlFromRemote(r.stdout.trim());
  } catch {
    pagesUrl = null;
  }
  return {
    status: 200,
    json: {
      domain: d ? d.domain : null,
      baseUrl: d ? d.baseUrl : null,
      used,
      // Unpublished count comes from the delta against the last known origin/main (no fetch);
      // last publish comes from Git_Feedback. Both stay null when unknown.
      unpublishedChanges: pub.unpublishedChanges,
      unpublishedFiles: pub.unpublishedFiles,
      runningJob: runningJobOf(deps.jobs),
      lastPublish: pub.lastPublish,
      publishTarget: pub.target,
      latestRun: null,
      // Live GitHub Pages address derived from the origin remote; null when not a GitHub remote.
      pagesUrl,
    },
  };
}

const READ_GROUP: RouteDef[] = [
  { method: "GET", pattern: "/api/status", mutating: false, maxBodyBytes: 0, handler: getStatus },
  { method: "GET", pattern: "/api/domain", mutating: false, maxBodyBytes: 0, handler: getDomain },
];

async function getSetupLog(ctx: HandlerContext): Promise<ConsoleResponse> {
  const { deps, query } = ctx;
  let text = "";
  try {
    if (deps.fs.exists(SETUP_LOG_REL)) text = deps.fs.readText(SETUP_LOG_REL);
  } catch {
    return { status: 500, json: { error: "setup log unavailable" } };
  }
  const limit = query.limit !== undefined && /^\d+$/.test(query.limit) ? Number(query.limit) : undefined;
  return { status: 200, json: parseSetupLog(text, { limit, before: query.before }) };
}

const SETUP_LOG_GROUP: RouteDef[] = [
  { method: "GET", pattern: "/api/setup-log", mutating: false, maxBodyBytes: 0, handler: getSetupLog },
];

/** Retired controls: explicit 410 after the central guard; nothing is started or written. */
async function retiredRun(): Promise<ConsoleResponse> {
  return {
    status: 410,
    json: {
      error: "retired",
      use: "POST /api/publish",
      message: "A run on GitHub starts when you publish. This console no longer starts a local run.",
    },
  };
}

export const RETIRED_GROUP: RouteDef[] = [
  { method: "POST", pattern: "/api/run", mutating: true, maxBodyBytes: SETUP_BODY_MAX, handler: retiredRun },
];

/** Each later task appends its own group here. */
export const ROUTE_GROUPS: RouteDef[][] = [READ_GROUP, OPEN_GROUP, SETUP_LOG_GROUP, DISPOSITIONS_GROUP, SYNC_GROUP, URLS_GROUP, DISCOVERY_GROUP, BASELINES_GROUP, PUBLISH_GROUP, SCHEDULE_GROUP, RUNS_GROUP, DOMAIN_SETUP_GROUP, RETIRED_GROUP];

export function allRoutes(): RouteDef[] {
  return ROUTE_GROUPS.flat();
}
