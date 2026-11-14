import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readApprovedScope } from "../agents/scope-store.js";

export interface Viewport {
  width: number;
  height: number;
}

export interface AppLimits {
  pages: number;
  crawlDepth: number;
  concurrency: number;
  requestSpacingMs: number;
  retries: number;
  navTimeoutMs: number;
  runTimeoutMs: number;
  /**
   * Upper bound on how many approved pages the Observation_Runner may
   * scan. Defaults
   * to DEFAULT_MAX_APPROVED_PAGES when absent; capped at MAX_APPROVED_PAGES_HARD_CAP.
   */
  maxApprovedPages?: number;
  /**
   * Upper bound on BFS discovery (default 500). Mirrors the
   * per-domain Domain_Config value; present here for app-level overrides.
   */
  maxDiscoveryCount?: number;
  /**
   * Above this many discovered pages, Scope_Approval presentation groups
   * by path segment (default 25).
   */
  largeScopeThreshold?: number;
}

/** Default approved-page cap when `limits.maxApprovedPages` is not set. */
export const DEFAULT_MAX_APPROVED_PAGES = 500;
/** Sane hard upper bound on the approved-page cap. */
export const MAX_APPROVED_PAGES_HARD_CAP = 500;
/** Default Large_Scope_Threshold for grouped Scope_Approval. */
export const DEFAULT_LARGE_SCOPE_THRESHOLD = 25;

export interface RetentionPolicy {
  maxRuns: number;
  maxAgeDays: number;
}

export interface AppConfig {
  approvedDomain: string;
  baseUrl: string;
  seedFilePath: string;
  limits: AppLimits;
  retention: RetentionPolicy;
  viewports: { desktop: Viewport; mobile: Viewport };
  /**
   * Slug of the active Domain_Config under `config/domains/<slug>.json`
   * (e.g. "assurity-nz"), loadable via `loadDomainConfig(domain)`. Optional for
   * configs that predate domain configs.
   */
  domain?: string;
  /** Optional product title shown in the UIs (1 to 80 chars once trimmed). */
  displayTitle?: string;
}

export const DEFAULT_DISPLAY_TITLE = "Web Guardian";
export const MAX_DISPLAY_TITLE_LENGTH = 80;

/** Trimmed displayTitle, or "Web Guardian" when unset, empty or whitespace-only. */
export function resolveDisplayTitle(cfg: { displayTitle?: string }): string {
  const t = typeof cfg.displayTitle === "string" ? cfg.displayTitle.trim() : "";
  return t === "" ? DEFAULT_DISPLAY_TITLE : t;
}

export interface PageSeedFile {
  maxUrls: number;
  approvedUrls: string[];
}

export function loadConfig(path = "config/app.config.json"): AppConfig {
  const raw = readFileSync(resolve(path), "utf8");
  const cfg = JSON.parse(raw) as AppConfig;
  validateConfig(cfg);
  return cfg;
}

export function loadSeed(cfg: AppConfig): PageSeedFile {
  const raw = readFileSync(resolve(cfg.seedFilePath), "utf8");
  const seed = JSON.parse(raw) as PageSeedFile;
  if (seed.approvedUrls.length > seed.maxUrls) {
    throw new Error(`Page seed exceeds maxUrls (${seed.maxUrls})`);
  }
  if (seed.approvedUrls.length > cfg.limits.pages) {
    throw new Error(`Page seed exceeds configured page limit (${cfg.limits.pages})`);
  }
  return seed;
}

/**
 * Resolve the effective approved-page cap: the configured
 * `limits.maxApprovedPages`, or DEFAULT_MAX_APPROVED_PAGES when absent.
 */
export function maxApprovedPages(cfg: AppConfig): number {
  return cfg.limits.maxApprovedPages ?? DEFAULT_MAX_APPROVED_PAGES;
}

/** Where the effective observation URL list came from. */
export type ScopeSource = "approved-scope" | "seed";

/** The effective page list the Observation_Runner will scan, with provenance. */
export interface ResolvedScope {
  urls: string[];
  source: ScopeSource;
}

/**
 * Resolve the effective URL list the Observation_Runner scans.
 *
 * Human-in-control resolution:
 *  1. WHEN a configured `cfg.domain` slug has a human-approved Full_Site_Scope at
 *     `config/scope/<slug>.approved.json` (read via `readApprovedScope`) with at
 *     least one page, scan that APPROVED scope - never the proposed one - capped
 *     at `maxApprovedPages(cfg)`.
 *  2. OTHERWISE fall back to the legacy `page-seed.json` (`loadSeed().approvedUrls`),
 *     preserving the existing single-page / 10-page behavior exactly.
 *
 * The scope file is keyed by the Domain_Config slug (`cfg.domain`, e.g.
 * "assurity-nz"), matching the `scopeFile` declared in `config/domains/<slug>.json`
 * and the file written by `approveScope`. Conservative pacing
 * (`requestSpacingMs >= 1000`) is enforced by `validateConfig` and applied by the
 * runner regardless of source, so it is unchanged here.
 */
export function resolveApprovedUrls(cfg: AppConfig): ResolvedScope {
  if (cfg.domain) {
    const approved = readApprovedScope(cfg.domain);
    if (approved && approved.pages.length > 0) {
      return {
        urls: approved.pages.slice(0, maxApprovedPages(cfg)),
        source: "approved-scope",
      };
    }
  }
  return { urls: loadSeed(cfg).approvedUrls, source: "seed" };
}

function validateConfig(cfg: AppConfig): void {
  const l = cfg.limits;
  for (const [k, v] of Object.entries(l)) {
    if (v === undefined) {
      // Optional limits may be omitted; they fall back to defaults.
      continue;
    }
    if (typeof v !== "number" || v < 0) {
      throw new Error(`Invalid limit ${k}: ${String(v)}`);
    }
  }
  // Conservative_Request_Rate: 1 req/s/host minimum - preserved.
  if (l.requestSpacingMs < 1000) {
    throw new Error("requestSpacingMs must be >= 1000 (1 req/s/host)");
  }
  if (cfg.displayTitle !== undefined) {
    if (typeof cfg.displayTitle !== "string") {
      throw new Error("displayTitle must be a string");
    }
    if (cfg.displayTitle.trim().length > MAX_DISPLAY_TITLE_LENGTH) {
      throw new Error(
        `displayTitle must be at most ${MAX_DISPLAY_TITLE_LENGTH} characters`,
      );
    }
  }
  // The approved-page cap is configurable with a sane upper bound.
  const cap = l.maxApprovedPages ?? DEFAULT_MAX_APPROVED_PAGES;
  if (cap > MAX_APPROVED_PAGES_HARD_CAP) {
    throw new Error(
      `maxApprovedPages must not exceed ${MAX_APPROVED_PAGES_HARD_CAP}`,
    );
  }
}
