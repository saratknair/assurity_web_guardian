import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { buildDashboardData } from "../reporting/dashboard-data.js";
import {
  hasResidualPath,
  listRunScreenshots,
  sanitizeJson,
  sanitizeRun,
  sanitizeScreenshotName,
} from "./sanitizer.js";
import { DEFAULT_CAPS } from "./evidence.js";
import {
  buildRunFindings,
  finalizeDecisions,
  loadFrozenDispositions,
  loadRawRunInputs,
  type BuiltRun,
  type Omission,
  type PublishedFinding,
} from "./run-findings.js";
import {
  applyDroppedImages,
  buildVisualItems,
  type RecordedVisual,
} from "./visual.js";
import { buildGuidance } from "./guidance.js";
import {
  imageRetentionRuns,
  runsWithImages,
  selectWithinBudget,
  type Candidate,
} from "./size-budget.js";
import {
  buildDashboardAggregates,
  buildLatestPages,
  buildPageHistory,
} from "./pages.js";

/**
 * Published-data contract builder (Phase 2, Req 6.6, 6.7, 7.7, 11.8).
 *
 * Converts the local raw run store (`artifacts/runs/*`) into the static
 * `Published_Data` tree the GitHub Pages site serves, matching design.md →
 * Data Models (`RunsIndex`, `RunSummary` with `origin`, `Published_Data`
 * layout):
 *
 *   data/
 *     index.json                 # RunsIndex (runs newest-first, with origin)
 *     dashboard.json             # DashboardData contract (reused builder)
 *     runs/<id>/
 *       summary.json             # RunSummary (pages, failedChecks, health, origin)
 *       events.json              # sanitized event list (office replay)
 *       findings.json            # sanitized findings (pages[] shape, unchanged)
 *       screenshots/*.png        # sanitized screenshots
 *
 * Sanitization is delegated to `./sanitizer.ts` (fail-closed, Req 8): each run's
 * publishable JSON/JSONL is written through `sanitizeRun`, and screenshots are
 * copied only after that metadata pass. When a run withholds critical files the
 * builder still publishes whatever is clean (fail-closed semantics) and records
 * the withheld names so callers/`summary.json` can note them.
 *
 * The published tree carries NO absolute/internal paths: the sanitizer strips
 * them from the JSON it writes, and this builder only ever emits run-relative
 * references (run-id directory names, bare screenshot file names) into
 * `index.json`/`summary.json`.
 */

/** One run's health datapoint, mirrors dashboard-data's health vocabulary. */
export type RunHealth = "healthy" | "attention" | "failing";

/** Entry in the published runs index (design → RunsIndex.runs[]). */
export interface PublishedRunSummary {
  runId: string;
  finishedAt?: string;
  status: string;
  health: RunHealth;
  pages: number;
  failedChecks: number;
  pendingReview: boolean;
  /** Where the run executed (Req 7.7); defaults "local". */
  origin: "local" | "cloud";
  /** Additive (schema v2) fields; absent on older published data. */
  detailLevel?: "rule" | "legacy";
  hasRunData?: boolean;
  trigger?: string | null;
  hasImages?: boolean;
  /** Additive optional: recorded domain, else the single host shared by the run's page URLs; omitted when unknown. */
  domain?: string;
}

/** RunsIndex, newest-first (design → Data Models → RunsIndex). */
export interface RunsIndex {
  schemaVersion?: 2;
  generatedAt: string;
  domain: string;
  imageRetentionRuns?: number;
  runs: PublishedRunSummary[];
}

/** Per-run summary.json (design → Data Models → RunSummary). */
export interface RunSummary extends PublishedRunSummary {
  schemaVersion?: 2;
  historyStatus?: string;
  /** Output-relative names of files the sanitizer withheld (fail-closed). */
  withheld: string[];
  omissions?: Omission[];
  totals?: unknown;
}

function readJson<T>(p: string): T | null {
  try {
    return JSON.parse(readFileSync(p, "utf8")) as T;
  } catch {
    return null;
  }
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** Normalize a free-form run result string into a stable `health` bucket. */
function healthFromFailedChecks(failedChecks: number): RunHealth {
  return failedChecks > 0 ? "attention" : "healthy";
}

/**
 * The publishable facts for a single run. This is the shared source of truth
 * for per-run origin/status/summary derivation: the published `RunsIndex` and
 * the loopback Admin API (`src/admin/admin-server.ts` → `GET /api/runs`) both
 * read run facts through `readRunFacts` so they never drift.
 */
export interface RunFacts {
  runId: string;
  finishedAt?: string;
  status: string;
  health: RunHealth;
  pages: number;
  failedChecks: number;
  pendingReview: boolean;
  origin: "local" | "cloud";
}

/** Value of the persisted `origin` marker written at run time: "cloud" only for exactly "cloud". */
export function runOriginMarker(envOrigin?: string): "cloud" | "local" {
  return (envOrigin ?? "").trim() === "cloud" ? "cloud" : "local";
}

/**
 * Derive a run's origin. Precedence (kept simple and documented):
 *   1. A persisted marker file `artifacts/runs/<id>/origin` whose trimmed
 *      content is exactly "cloud" or "local" (how a synced/stored run records
 *      its provenance).
 *   2. The `AWG_RUN_ORIGIN` env marker ("cloud" set by the Cloud_Runner in CI).
 *   3. Default "local".
 * Only the exact token "cloud" yields "cloud"; anything else is "local".
 */
function originForRun(runDir: string, envOrigin?: string): "local" | "cloud" {
  const markerPath = join(runDir, "origin");
  if (existsSync(markerPath)) {
    const marker = (readJson<string>(markerPath) ?? "").toString().trim();
    const raw = marker.length > 0 ? marker : readFileSync(markerPath, "utf8").trim();
    return raw === "cloud" ? "cloud" : "local";
  }
  return (envOrigin ?? "").trim() === "cloud" ? "cloud" : "local";
}

/**
 * Collect the publishable facts for one run from its raw artifacts. Reads the
 * `run.finished` event (health/failedChecks/pages) and `run.record` event
 * (finishedAt/result) from `events.jsonl`, plus `findings.json` for the
 * `pendingReview` flag and the authoritative run id.
 */
export function readRunFacts(runDir: string, dirName: string, envOrigin?: string): RunFacts {
  const findings = readJson<{ runId?: string; awaitingReview?: boolean; pages?: unknown[] }>(
    join(runDir, "findings.json"),
  );
  const runId = findings?.runId ?? dirName;

  let finishedAt: string | undefined;
  let status = "unknown";
  let pages = Array.isArray(findings?.pages) ? findings!.pages!.length : 0;
  let failedChecks = 0;
  let health: RunHealth | undefined;

  const eventsPath = join(runDir, "events.jsonl");
  if (existsSync(eventsPath)) {
    const lines = readFileSync(eventsPath, "utf8")
      .split(/\r?\n/)
      .filter((l) => l.trim().length > 0);
    for (const line of lines) {
      let ev: { kind?: string; data?: Record<string, unknown> };
      try {
        ev = JSON.parse(line);
      } catch {
        continue; // skip malformed/partial lines
      }
      if (ev.kind === "run.record" && ev.data) {
        if (typeof ev.data.finishedAt === "string") finishedAt = ev.data.finishedAt;
        if (typeof ev.data.result === "string") status = ev.data.result;
      }
      if (ev.kind === "run.finished" && ev.data) {
        if (typeof ev.data.failedChecks === "number") failedChecks = ev.data.failedChecks;
        if (typeof ev.data.pages === "number") pages = ev.data.pages;
        if (typeof ev.data.health === "string") health = ev.data.health as RunHealth;
      }
    }
  }

  return {
    runId,
    finishedAt,
    status,
    health: health ?? healthFromFailedChecks(failedChecks),
    pages,
    failedChecks,
    pendingReview: findings?.awaitingReview === true,
    origin: originForRun(runDir, envOrigin),
  };
}

/** List run-id directories under a runs root (unordered). */
export function listRunDirs(runsRoot: string): string[] {
  const root = resolve(runsRoot);
  if (!existsSync(root)) return [];
  return readdirSync(root).filter((n) => {
    try {
      return statSync(join(root, n)).isDirectory();
    } catch {
      return false;
    }
  });
}

/**
 * Read every run's facts from a runs root and return them newest-first.
 *
 * Ordering matches the published `RunsIndex` exactly: by `finishedAt`
 * descending when present, otherwise by raw run-dir mtime descending. This is
 * the shared helper the Admin API (`GET /api/runs`) reuses so the admin view
 * and the published index agree on order and per-run facts (Req 4.3, 7.7).
 */
export function readRunsNewestFirst(runsRoot: string, envOrigin?: string): RunFacts[] {
  const root = resolve(runsRoot);
  const dirNames = listRunDirs(runsRoot);
  const facts = dirNames.map((dirName) => readRunFacts(join(root, dirName), dirName, envOrigin));

  const mtimeOf = (runId: string): number => {
    try {
      const dirName = dirNames.find(
        (n) => (readJson<{ runId?: string }>(join(root, n, "findings.json"))?.runId ?? n) === runId,
      );
      if (dirName) return statSync(join(root, dirName)).mtimeMs;
    } catch {
      /* ignore */
    }
    return 0;
  };

  return [...facts].sort((a, b) => {
    if (a.finishedAt && b.finishedAt) return b.finishedAt.localeCompare(a.finishedAt);
    if (a.finishedAt) return -1;
    if (b.finishedAt) return 1;
    return mtimeOf(b.runId) - mtimeOf(a.runId);
  });
}


function hostOfUrl(u: string): string | null {
  try {
    const h = new URL(u).hostname.toLowerCase();
    return h.length > 0 ? h : null;
  } catch {
    return null;
  }
}

/**
 * Derived domain of a run: the domain recorded in run-source.json when it is a
 * plausible host, else the single host shared by all its page URLs, else null.
 */
export function deriveRunDomain(runDir: string, pageUrls: string[]): string | null {
  const src = readJson<{ domain?: unknown }>(join(runDir, "run-source.json"));
  if (src && typeof src.domain === "string") {
    const d = src.domain.trim().toLowerCase();
    if (/^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/.test(d)) return d;
  }
  const hosts = new Set<string>();
  for (const u of pageUrls) {
    const h = hostOfUrl(u);
    if (!h) return null;
    hosts.add(h);
  }
  return hosts.size === 1 ? [...hosts][0] : null;
}

/** Read the optional one-line `trigger` marker (schedule, workflow_dispatch, manual, local). */
function readTrigger(runDir: string): string | null {
  const p = join(runDir, "trigger");
  if (!existsSync(p)) return null;
  try {
    const raw = readFileSync(p, "utf8").trim();
    return /^[A-Za-z0-9_-]{1,40}$/.test(raw) ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Serialize a published structure: sanitize, then re-scan for residual paths.
 * Returns null when the structure cannot be confirmed clean (fail closed).
 */
function serializeSafe(value: unknown): { text: string } | { reason: "residual-path" | "sanitize-error" } {
  try {
    const clean = sanitizeJson(value);
    if (hasResidualPath(clean)) return { reason: "residual-path" };
    return { text: JSON.stringify(clean, null, 2) };
  } catch {
    return { reason: "sanitize-error" };
  }
}

function writeText(path: string, text: string): void {
  ensureDir(dirname(path));
  writeFileSync(path, text, "utf8");
}

/** Bytes of the files directly inside `dir` (the legacy sanitized JSON a run already carries). */
function topLevelFileBytes(dir: string): number {
  let total = 0;
  try {
    for (const n of readdirSync(dir)) {
      const st = statSync(join(dir, n));
      if (st.isFile()) total += st.size;
    }
  } catch {
    /* ignore */
  }
  return total;
}

const SEV_PRIORITY: Record<string, number> = {
  critical: 0,
  serious: 1,
  moderate: 2,
  minor: 3,
  unrated: 4,
  "not-recorded": 5,
};

const SLUG_OK = /^[A-Za-z0-9._-]+$/;

interface PendingImage {
  src: string;
  dest: string;
  role: "baseline" | "current" | "diff";
  bytes: number;
}

interface RunOutcome {
  facts: RunFacts;
  trigger: string | null;
  runDomain: string | null;
  built: BuiltRun;
  summary: RunSummary;
  hasImages: boolean;
}

/**
 * Per-run rich publish: findings, evidence, visual, guidance, budgeted images.
 * Every JSON object passes sanitizeJson and a residual-path re-scan; anything
 * that cannot be confirmed clean is omitted and the reason recorded.
 */
function publishRunDetail(args: {
  runDir: string;
  outRunDir: string;
  facts: RunFacts;
  retained: boolean;
  legacyBytes: number;
  built: BuiltRun;
  withheld: string[];
}): void {
  const { runDir, outRunDir, facts, retained, built } = args;
  const caps = DEFAULT_CAPS;
  const rf = built.runFindings;
  const omissions: Omission[] = rf.omissions;

  // ---- visual items ----
  const findingsDoc = readJson<{ pages?: unknown[] }>(join(runDir, "findings.json"));
  const findingsVisual: Record<string, Record<string, RecordedVisual>> = {};
  for (const p of Array.isArray(findingsDoc?.pages) ? findingsDoc!.pages! : []) {
    const pg = p as { slug?: unknown; visual?: unknown };
    if (typeof pg.slug === "string" && pg.visual && typeof pg.visual === "object") {
      findingsVisual[pg.slug] = pg.visual as Record<string, RecordedVisual>;
    }
  }
  const suppressedBy: Record<string, string[]> = {};
  for (const f of rf.findings as PublishedFinding[]) {
    if (f.kind === "visual" && Array.isArray(f.suppressedBy) && f.suppressedBy.length > 0) {
      suppressedBy[`${f.slug}.${f.viewport}`] = f.suppressedBy as string[];
    }
  }
  const vis = buildVisualItems({ runDir, runId: facts.runId, findingsVisual, suppressedBy, images: retained });
  const guidance = buildGuidance(built, vis.items, caps);

  // ---- image candidates (visual copies + remaining screenshots) ----
  const images: PendingImage[] = vis.copies.map((c) => ({
    src: c.src,
    dest: c.dest,
    role: c.role,
    bytes: c.bytes,
  }));
  const taken = new Set(images.map((i) => i.dest));
  const slugsWithFindings = new Set((rf.findings as PublishedFinding[]).map((f) => f.slug));
  const priorityOf = new Map<string, number>();
  for (const i of images) priorityOf.set(i.dest, i.role === "diff" ? 0 : i.role === "baseline" ? 1 : 2);
  const srcDir = join(runDir, "screenshots");
  for (const name of listRunScreenshots(runDir)) {
    const safe = sanitizeScreenshotName(name);
    if (!safe) continue;
    const dest = `screenshots/${safe}`;
    if (taken.has(dest)) continue;
    taken.add(dest);
    let bytes = 0;
    try {
      bytes = statSync(join(srcDir, name)).size;
    } catch {
      continue;
    }
    const isDiff = /\.diff\.png$/i.test(safe);
    const slug = safe.replace(/\.(desktop|mobile)(\.diff)?\.[A-Za-z0-9]+$/, "");
    images.push({ src: join(srcDir, name), dest, role: isDiff ? "diff" : "current", bytes });
    priorityOf.set(dest, isDiff ? 0 : slugsWithFindings.has(slug) ? 3 : 4);
  }

  // ---- JSON serialization (fail closed) ----
  interface JsonOut {
    rel: string;
    role: "json" | "evidence";
    priority: number;
    text: string;
    force: boolean;
  }
  const outs: JsonOut[] = [];
  const addJson = (rel: string, role: "json" | "evidence", priority: number, value: unknown, force: boolean): void => {
    const r = serializeSafe(value);
    if ("text" in r) outs.push({ rel, role, priority, text: r.text, force });
    else {
      omissions.push({ path: rel, role, reason: r.reason });
      if (force) args.withheld.push(`${facts.runId}/${rel}`);
    }
  };
  // run-findings is serialized again after omissions are known; this is a size estimate.
  addJson("run-findings.json", "json", 0, rf, true);
  addJson("visual.json", "json", 0, { schemaVersion: 2, runId: facts.runId, items: vis.items }, true);
  addJson(
    "guidance.json",
    "json",
    0,
    { schemaVersion: 2, runId: facts.runId, omitted: guidance.omitted, items: guidance.items },
    true,
  );
  for (const rel of Object.keys(built.evidence).sort()) {
    const ev = built.evidence[rel];
    const worst = Math.min(...ev.violations.map((v) => SEV_PRIORITY[v.severity] ?? 5), 5);
    addJson(rel, "evidence", worst, ev, false);
  }

  // ---- retention, then budget ----
  const cands: Candidate[] = [];
  for (const o of outs) cands.push({ path: o.rel, bytes: Buffer.byteLength(o.text, "utf8"), role: o.role, priority: o.priority });
  for (const i of images) {
    cands.push({
      path: i.dest,
      bytes: i.bytes,
      role: i.role,
      priority: priorityOf.get(i.dest) ?? 4,
      retained,
    });
  }
  const { keep, dropped } = selectWithinBudget(cands, {
    maxRunBytes: Math.max(0, caps.maxRunBytes - args.legacyBytes),
    maxImageBytes: caps.maxImageBytes,
  });
  const keepPaths = new Set(keep.map((k) => k.path));
  const forced = new Set(outs.filter((o) => o.force).map((o) => o.rel));
  const imageDrops: { dest: string; reason: "image-cap" | "run-cap" | "image-retention" }[] = [];
  for (const d of dropped) {
    if (forced.has(d.path)) continue; // core JSON is never dropped
    omissions.push({ path: d.path, role: d.role, reason: d.reason });
    if (d.role === "diff" || d.role === "baseline" || d.role === "current") {
      imageDrops.push({ dest: d.path, reason: d.reason });
    }
  }

  // ---- final visual.json with dropped images nulled ----
  const finalItems = applyDroppedImages(vis.items, imageDrops);
  const writeFinal = (rel: string, value: unknown): void => {
    const r = serializeSafe(value);
    if ("text" in r) writeText(join(outRunDir, rel), r.text);
    else {
      omissions.push({ path: rel, role: "json", reason: r.reason });
      args.withheld.push(`${facts.runId}/${rel}`);
    }
  };
  writeFinal("visual.json", { schemaVersion: 2, runId: facts.runId, items: finalItems });
  writeFinal("guidance.json", {
    schemaVersion: 2,
    runId: facts.runId,
    omitted: guidance.omitted,
    items: guidance.items,
  });
  for (const o of outs) {
    if (o.role === "evidence" && keepPaths.has(o.rel)) writeText(join(outRunDir, o.rel), o.text);
  }
  writeFinal("run-findings.json", rf);

  // ---- copy kept images ----
  for (const i of images) {
    if (!keepPaths.has(i.dest)) continue;
    try {
      ensureDir(dirname(join(outRunDir, i.dest)));
      copyFileSync(i.src, join(outRunDir, i.dest));
    } catch {
      /* skip unreadable image; JSON sanitation already governs fail-closed */
    }
  }
}

/**
 * Build the static `Published_Data` tree from the raw run store.
 *
 * Writes `<outDir>/data/index.json`, `<outDir>/data/dashboard.json`,
 * `<outDir>/data/pages/<slug>.json`, and per run
 * `<outDir>/data/runs/<id>/{summary,events,findings,run-findings,visual,guidance}.json`,
 * `evidence/*.json` plus budgeted screenshots. Returns the published run ids
 * and a per-run map of any withheld file names (fail-closed: a withheld file
 * does not abort publishing).
 */
export async function buildPublishedData(opts: {
  runsRoot?: string;
  outDir: string;
  historyPath?: string;
  domain?: string;
}): Promise<{ runsPublished: string[]; withheld: Record<string, string[]> }> {
  const runsRoot = opts.runsRoot ?? "artifacts/runs";
  const historyPath = opts.historyPath ?? "artifacts/a11y-history.json";
  const envOrigin = process.env.AWG_RUN_ORIGIN;
  const retention = imageRetentionRuns();

  const dataDir = join(opts.outDir, "data");
  const runsOutDir = join(dataDir, "runs");
  ensureDir(runsOutDir);

  const root = resolve(runsRoot);
  const dirNames = listRunDirs(runsRoot);

  // ---- pass 1: facts and findings for every run (needed for image retention) ----
  const prepared = dirNames.map((dirName) => {
    const runDir = join(root, dirName);
    const facts = readRunFacts(runDir, dirName, envOrigin);
    const inputs = loadRawRunInputs(runDir);
    inputs.runId = facts.runId;
    inputs.finishedAt = facts.finishedAt ?? null;
    // Frozen applied set of this run only; the live Disposition_Log is never read here.
    inputs.dispositions = loadFrozenDispositions(runDir);
    const built = buildRunFindings(inputs, { caps: DEFAULT_CAPS });
    const runDomain = deriveRunDomain(
      runDir,
      built.runFindings.pages.map((p) => p.url),
    );
    return { runDir, facts, built, trigger: readTrigger(runDir), runDomain };
  });
  // Compare each run's applied set with the previous run's (by finishedAt) for decisions.
  for (const p of prepared) {
    const fin = p.facts.finishedAt;
    let prev: (typeof prepared)[number] | null = null;
    if (fin) {
      for (const q of prepared) {
        const qf = q.facts.finishedAt;
        if (q === p || !qf || qf >= fin) continue;
        if (prev === null || qf > (prev.facts.finishedAt as string)) prev = q;
      }
    }
    finalizeDecisions(p.built, prev ? prev.built : null);
  }
  const withImages = runsWithImages(
    prepared.map((p) => ({ runId: p.facts.runId, finishedAt: p.facts.finishedAt ?? null })),
    retention,
  );

  // ---- pass 2: write each run ----
  const outcomes: RunOutcome[] = [];
  const withheld: Record<string, string[]> = {};
  const runsPublished: string[] = [];

  for (const { runDir, facts, built, trigger, runDomain } of prepared) {
    const outRunDir = join(runsOutDir, facts.runId);
    ensureDir(outRunDir);

    // Sanitize publishable legacy JSON/JSONL (writes findings.json, events.json, ...).
    const report = sanitizeRun(runDir, outRunDir);
    const withheldNames = [...report.withheld];
    const extraWithheld: string[] = [];

    const retained = withImages.has(facts.runId);
    publishRunDetail({
      runDir,
      outRunDir,
      facts,
      retained,
      legacyBytes: topLevelFileBytes(outRunDir),
      built,
      withheld: extraWithheld,
    });
    for (const w of extraWithheld) withheldNames.push(w.slice(facts.runId.length + 1));
    if (withheldNames.length > 0) withheld[facts.runId] = withheldNames;

    const rf = built.runFindings;
    const summary: RunSummary = {
      schemaVersion: 2,
      runId: facts.runId,
      finishedAt: facts.finishedAt,
      status: facts.status,
      health: facts.health,
      pages: facts.pages,
      failedChecks: facts.failedChecks,
      pendingReview: facts.pendingReview,
      origin: facts.origin,
      detailLevel: rf.detailLevel,
      hasRunData: true,
      trigger,
      hasImages: retained,
      historyStatus: rf.historyStatus,
      withheld: withheldNames,
      omissions: rf.omissions,
      totals: rf.totals,
    };
    writeText(join(outRunDir, "summary.json"), JSON.stringify(summary, null, 2));

    outcomes.push({ facts, trigger, built, summary, hasImages: retained, runDomain });
    runsPublished.push(facts.runId);
  }

  // RunsIndex, newest-first: by finishedAt desc when present, else dir mtime desc.
  const mtimeOf = (runId: string): number => {
    try {
      const dirName = dirNames.find(
        (n) => (readJson<{ runId?: string }>(join(root, n, "findings.json"))?.runId ?? n) === runId,
      );
      if (dirName) return statSync(join(root, dirName)).mtimeMs;
    } catch {
      /* ignore */
    }
    return 0;
  };
  const indexRuns = [...outcomes].sort((a, b) => {
    const fa = a.summary.finishedAt;
    const fb = b.summary.finishedAt;
    if (fa && fb) return fb.localeCompare(fa);
    if (fa) return -1;
    if (fb) return 1;
    return mtimeOf(b.summary.runId) - mtimeOf(a.summary.runId);
  });

  const domainById = new Map(outcomes.map((o) => [o.summary.runId, o.runDomain]));
  // Domain label: explicit option wins; otherwise the latest run's derived domain (never a fixed host).
  const domain = opts.domain ?? (indexRuns[0] ? domainById.get(indexRuns[0].summary.runId) : null) ?? "";

  const index: RunsIndex = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    domain,
    imageRetentionRuns: retention,
    runs: indexRuns.map(({ summary: r }) => ({
      ...(domainById.get(r.runId) ? { domain: domainById.get(r.runId) as string } : {}),
      runId: r.runId,
      finishedAt: r.finishedAt,
      status: r.status,
      health: r.health,
      pages: r.pages,
      failedChecks: r.failedChecks,
      pendingReview: r.pendingReview,
      origin: r.origin,
      detailLevel: r.detailLevel,
      hasRunData: r.hasRunData,
      trigger: r.trigger,
      hasImages: r.hasImages,
    })),
  };
  const indexOut = serializeSafe(index);
  if (!("text" in indexOut)) throw new Error(`index.json failed the path safety check: ${indexOut.reason}`);
  writeText(join(dataDir, "index.json"), indexOut.text);

  // Per-page history.
  const allBuilt = outcomes.map((o) => o.built);
  const slugs = new Set<string>();
  for (const b of allBuilt) for (const p of b.runFindings.pages) slugs.add(p.slug);
  for (const slug of [...slugs].sort()) {
    if (!SLUG_OK.test(slug) || slug === "." || slug === "..") continue;
    const r = serializeSafe(buildPageHistory(slug, allBuilt));
    if ("text" in r) writeText(join(dataDir, "pages", `${slug}.json`), r.text);
  }

  // Dashboard contract: legacy fields (corrected from the latest run's Active_Findings) + runs[] + latest.
  const base = buildDashboardData(runsRoot, historyPath, domain);
  const byId = new Map(outcomes.map((o) => [o.summary.runId, o]));
  const aggregates = buildDashboardAggregates(allBuilt).map((a) => {
    const o = byId.get(a.runId);
    return {
      ...a,
      origin: o?.facts.origin ?? a.origin,
      trigger: o?.trigger ?? null,
      hasImages: o?.hasImages ?? false,
      ...(o?.runDomain ? { domain: o.runDomain } : {}),
    };
  });
  const latestOutcome = indexRuns[0] ? byId.get(indexRuns[0].summary.runId) : undefined;
  const dashboard: Record<string, unknown> = { ...base };
  dashboard.schemaVersion = 2;
  dashboard.aiItems = [];
  if (latestOutcome) {
    const t = latestOutcome.built.runFindings.totals;
    const latestPages = buildLatestPages(latestOutcome.built);
    dashboard.findingsBySeverity = {
      critical: t.bySeverity.critical,
      serious: t.bySeverity.serious,
      moderate: t.bySeverity.moderate,
      minor: t.bySeverity.minor,
      unrated: t.bySeverity.unrated,
      notRecorded: t.bySeverity.notRecorded,
    };
    dashboard.a11yNewVsRecurring = { new: t.byLifecycle.new, recurring: t.byLifecycle.recurring };
    dashboard.findingsByPage = latestPages.map((p) => ({ page: p.url, count: p.counts.total }));
    dashboard.latest = { runId: latestOutcome.summary.runId, pages: latestPages };
  } else {
    dashboard.latest = null;
  }
  dashboard.runs = aggregates;
  const dashOut = serializeSafe(dashboard);
  if (!("text" in dashOut)) throw new Error(`dashboard.json failed the path safety check: ${dashOut.reason}`);
  writeText(join(dataDir, "dashboard.json"), dashOut.text);

  return { runsPublished, withheld };
}
