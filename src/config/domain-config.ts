import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Domain_Config — the guarded domain described as data.
 *
 * The system is multi-domain-ready: each guarded domain is a JSON file under
 * `config/domains/<slug>.json`. It operates against the single configured
 * domain today, but nothing hard-codes a specific host so future domains are a
 * matter of dropping in another file.
 */
export interface DomainConfig {
  /** The guarded host, e.g. "assurity.nz". Read as data, never hard-coded. */
  domain: string;
  /** Canonical entry point, e.g. "https://assurity.nz". */
  baseUrl: string;
  /** URL schemes permitted for this domain, e.g. ["https"]. */
  approvedSchemes: string[];
  /** Upper bound on BFS discovery (default 500). */
  maxDiscoveryCount: number;
  /** Above this many pages, approval presentation groups by path segment (default 25). */
  largeScopeThreshold: number;
  /** Conservative per-host pacing in ms (>= 1000 => 1 req/s/host). */
  requestSpacingMs: number;
  /** Path to the authoritative human-approved scope file for this domain. */
  scopeFile: string;
}

export interface ScheduleConfig {
  enabled: boolean;
  intervalHours: number;
  dailyAt: string;
}

const DOMAINS_DIR = "config/domains";

/**
 * List the configured domain slugs (file names without `.json`) under
 * `config/domains`, sorted for determinism.
 */
export function listDomains(): string[] {
  let entries: string[];
  try {
    entries = readdirSync(resolve(DOMAINS_DIR));
  } catch {
    return [];
  }
  return entries
    .filter((f) => f.toLowerCase().endsWith(".json"))
    .map((f) => f.slice(0, -".json".length))
    .sort();
}

/**
 * Load a Domain_Config. With no argument, resolve the single/default
 * configured domain (requires exactly one domain file). With an argument,
 * load `config/domains/<domain>.json`.
 */
export function loadDomainConfig(domain?: string): DomainConfig {
  const slug = domain ?? resolveDefaultDomain();
  const raw = readFileSync(resolve(DOMAINS_DIR, `${slug}.json`), "utf8");
  const cfg = JSON.parse(raw) as DomainConfig;
  validateDomainConfig(slug, cfg);
  return cfg;
}

function resolveDefaultDomain(): string {
  const domains = listDomains();
  if (domains.length === 0) {
    throw new Error(`No domain configs found under ${DOMAINS_DIR}`);
  }
  if (domains.length > 1) {
    throw new Error(
      `Multiple domain configs found (${domains.join(", ")}); specify one explicitly`,
    );
  }
  return domains[0];
}

function validateDomainConfig(slug: string, cfg: DomainConfig): void {
  const requiredStrings: (keyof DomainConfig)[] = ["domain", "baseUrl", "scopeFile"];
  for (const key of requiredStrings) {
    if (typeof cfg[key] !== "string" || (cfg[key] as string).length === 0) {
      throw new Error(`Domain config ${slug}: missing or invalid "${String(key)}"`);
    }
  }
  if (!Array.isArray(cfg.approvedSchemes) || cfg.approvedSchemes.length === 0) {
    throw new Error(`Domain config ${slug}: "approvedSchemes" must be a non-empty array`);
  }
  const requiredNumbers: (keyof DomainConfig)[] = [
    "maxDiscoveryCount",
    "largeScopeThreshold",
    "requestSpacingMs",
  ];
  for (const key of requiredNumbers) {
    const v = cfg[key];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
      throw new Error(`Domain config ${slug}: invalid "${String(key)}": ${String(v)}`);
    }
  }
  if (cfg.requestSpacingMs < 1000) {
    throw new Error(
      `Domain config ${slug}: requestSpacingMs must be >= 1000 (1 req/s/host)`,
    );
  }
}
