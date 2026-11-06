import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type Severity = "critical" | "serious" | "moderate" | "minor" | "unrated" | "not-recorded";
export type FindingKind = "a11y-rule" | "check" | "visual";
// "regression" is assigned only by the disposition overlay; the history state machine never produces it.
export type Lifecycle = "new" | "recurring" | "existing-unresolved" | "regression" | "not-recorded";

export interface RunFindingCore {
  kind: FindingKind;
  pageUrl: string;
  slug: string;
  viewport: "desktop" | "mobile";
  ruleId: string; // axe id | "check:<name>" | "visual-diff"
  severity: Severity;
}

/** Stable identity of a finding across runs: `${pageUrl}|${viewport}|${ruleId}`. */
export function findingKey(f: Pick<RunFindingCore, "pageUrl" | "viewport" | "ruleId">): string {
  return `${f.pageUrl}|${f.viewport}|${f.ruleId}`;
}

const ID_PREFIX: Record<FindingKind, string> = { "a11y-rule": "rf_", check: "cf_", visual: "vf_" };

/** Per-run finding id: prefix + first 12 hex of sha1(runId#key). Deterministic. */
export function findingId(runId: string, key: string, kind: FindingKind): string {
  return ID_PREFIX[kind] + createHash("sha1").update(`${runId}#${key}`).digest("hex").slice(0, 12);
}

function readJson(path: string): unknown | null {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function asViewport(v: unknown): "desktop" | "mobile" | null {
  return v === "desktop" || v === "mobile" ? v : null;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/**
 * Shared visual Finding rule: a page+viewport is a visual Finding when a
 * `.diff.png` exists OR findings.json records `visual[viewport].differs === true`
 * (for example a screenshot size change with no diff image). Only slugs present
 * in `knownSlugs` count. Returns Map<`${slug}.${viewport}`, {slug, viewport}>.
 */
export function collectVisualViews(
  knownSlugs: { has(slug: string): boolean },
  diffFiles: { slug: string; viewport: string }[],
  findingPages: unknown[],
): Map<string, { slug: string; viewport: "desktop" | "mobile" }> {
  const out = new Map<string, { slug: string; viewport: "desktop" | "mobile" }>();
  for (const f of diffFiles) {
    const vp = asViewport(f.viewport);
    if (vp && knownSlugs.has(f.slug)) out.set(`${f.slug}.${vp}`, { slug: f.slug, viewport: vp });
  }
  for (const p of findingPages) {
    if (!isObj(p) || typeof p.slug !== "string" || !p.slug || !knownSlugs.has(p.slug) || !isObj(p.visual)) continue;
    for (const vp of ["desktop", "mobile"] as const) {
      const v = (p.visual as Record<string, unknown>)[vp];
      if (isObj(v) && v.differs === true) out.set(`${p.slug}.${vp}`, { slug: p.slug, viewport: vp });
    }
  }
  return out;
}

/**
 * Light key set for a run, read from raw files only: axe violations
 * (accessibility/*.json), failed checks (results.json) and visual diff flags
 * (screenshots/*.diff.png). Returns Map<key, kind>. Unreadable inputs are skipped.
 */
export function buildRunFindingSet(runDir: string): Map<string, FindingKind> {
  const out = new Map<string, FindingKind>();
  const urlBySlug = new Map<string, string>();
  const axeCovered = new Set<string>(); // `${slug}.${viewport}` with a readable axe file

  const results = readJson(join(runDir, "results.json"));
  const pages = isObj(results) && Array.isArray(results.pages) ? results.pages : [];
  for (const p of pages) {
    if (isObj(p) && typeof p.slug === "string" && typeof p.page === "string") urlBySlug.set(p.slug, p.page);
  }

  const axeDir = join(runDir, "accessibility");
  if (existsSync(axeDir)) {
    for (const file of readdirSync(axeDir).filter((f) => f.endsWith(".json")).sort()) {
      const m = /^(.*)\.(desktop|mobile)\.json$/.exec(file);
      if (!m) continue;
      const raw = readJson(join(axeDir, file));
      if (!isObj(raw)) continue;
      const viewport = asViewport(m[2]);
      const pageUrl = typeof raw.url === "string" ? raw.url : urlBySlug.get(m[1]);
      if (!viewport || !pageUrl) continue;
      axeCovered.add(`${m[1]}.${viewport}`);
      for (const v of Array.isArray(raw.violations) ? raw.violations : []) {
        if (isObj(v) && typeof v.id === "string") out.set(findingKey({ pageUrl, viewport, ruleId: v.id }), "a11y-rule");
      }
    }
  }

  for (const p of pages) {
    if (!isObj(p) || typeof p.page !== "string" || !Array.isArray(p.checks)) continue;
    const slug = typeof p.slug === "string" ? p.slug : "";
    for (const c of p.checks) {
      if (!isObj(c) || c.passed !== false || typeof c.name !== "string") continue;
      const m = /^(desktop|mobile):(.+)$/.exec(c.name);
      if (!m) continue;
      const viewport = m[1] as "desktop" | "mobile";
      // The aggregate a11y check duplicates axe rules when raw axe is readable.
      if (m[2] === "a11y-critical-serious" && axeCovered.has(`${slug}.${viewport}`)) continue;
      out.set(findingKey({ pageUrl: p.page, viewport, ruleId: `check:${m[2]}` }), "check");
    }
  }

  const findingsDoc = readJson(join(runDir, "findings.json"));
  const findingPages = isObj(findingsDoc) && Array.isArray(findingsDoc.pages) ? findingsDoc.pages : [];
  for (const p of findingPages) {
    if (isObj(p) && typeof p.slug === "string" && p.slug && typeof p.page === "string" && p.page && !urlBySlug.has(p.slug)) {
      urlBySlug.set(p.slug, p.page);
    }
  }

  const diffFiles: { slug: string; viewport: string }[] = [];
  const shotDir = join(runDir, "screenshots");
  if (existsSync(shotDir)) {
    for (const file of readdirSync(shotDir).sort()) {
      const m = /^(.*)\.(desktop|mobile)\.diff\.png$/.exec(file);
      if (m) diffFiles.push({ slug: m[1], viewport: m[2] });
    }
  }
  for (const { slug, viewport } of collectVisualViews(urlBySlug, diffFiles, findingPages).values()) {
    out.set(findingKey({ pageUrl: urlBySlug.get(slug)!, viewport, ruleId: "visual-diff" }), "visual");
  }
  return out;
}