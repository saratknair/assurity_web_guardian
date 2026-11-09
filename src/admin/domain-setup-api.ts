/**
 * New_Domain_Setup wizard, DRAFT part (design J.3, Requirement 21). Handlers use ports only.
 *
 * - GET  /api/domain/setup         draft state and the status of each wizard step.
 * - POST /api/domain/setup/start   {host, retypedHost, reviewer}: create the draft.
 * - POST /api/domain/setup/cancel  {reviewer}: discard the draft and its staging folder.
 *
 * Draft isolation: nothing here writes config/, baselines/, or baselines-visual/. The draft
 * file (artifacts/admin/new-domain-draft.json) and the staging folder
 * (artifacts/admin/new-domain/) are the only things created or removed. The confirm
 * transaction is a separate task. The new host is checked for syntax only (never against an
 * allow-list); the host-resolution check is an injectable port. No AI.
 */
import { lookup } from "node:dns";
import { isIP } from "node:net";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { validateReviewerName, resolveInside } from "./atomic-file.js";
import type { ConsoleDeps } from "./console-deps.js";
import type { ConsoleResponse, HandlerContext, RouteDef } from "./console-routes.js";
import { validateNewHost } from "./host-validate.js";
import { scrubForDisplay } from "./scrub.js";
import { urlSlug } from "./url-set.js";
import { authorize, fail, logSetup, wsFor } from "./urls-api.js";

export const DOMAIN_SETUP_BODY_MAX = 16 * 1024;
export const DRAFT_REL = "artifacts/admin/new-domain-draft.json";
export const STAGING_REL = "artifacts/admin/new-domain";
export const RESOLVE_TIMEOUT_MS = 5000;
export const PRIVATE_ADDRESS_TEXT = "This name points to a private address";

/** Resolves a host to its addresses. Tests fake it; the default uses dns.lookup. */
export type HostResolver = (host: string) => Promise<string[]>;

export function dnsResolver(timeoutMs: number = RESOLVE_TIMEOUT_MS): HostResolver {
  return (host) =>
    new Promise<string[]>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
      lookup(host, { all: true }, (err, addrs) => {
        clearTimeout(timer);
        if (err) reject(err);
        else resolve(addrs.map((a) => a.address));
      });
    });
}

let resolver: HostResolver = dnsResolver();

/** Replace the resolver (tests); call with no argument to restore the default. */
export function setHostResolver(r?: HostResolver): void {
  resolver = r ?? dnsResolver();
}

/** True for loopback, private, link-local, unspecified, and unique-local addresses. */
export function isPrivateAddress(addr: string): boolean {
  const a = addr.trim().toLowerCase();
  const kind = isIP(a);
  if (kind === 4) {
    const [p, q] = a.split(".").map(Number) as [number, number];
    return (
      p === 0 || p === 10 || p === 127 || (p === 169 && q === 254) || (p === 172 && q >= 16 && q <= 31) ||
      (p === 192 && q === 168) || (p === 100 && q >= 64 && q <= 127)
    );
  }
  if (kind === 6) {
    if (a === "::" || a === "::1") return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a);
    if (mapped) return isPrivateAddress(mapped[1] as string);
    return /^f[cd]/.test(a) || /^fe[89ab]/.test(a);
  }
  return true; // not an address at all: refuse
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function readObj(deps: ConsoleDeps, path: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(deps.fs.readText(path));
    return isObj(v) ? v : null;
  } catch {
    return null;
  }
}

function currentHost(deps: ConsoleDeps): string | null {
  const cfg = readObj(deps, "config/app.config.json");
  return cfg && typeof cfg.approvedDomain === "string" ? cfg.approvedDomain : null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** The maximum number of URLs, as the project computes it (min of seed maxUrls and limits.pages). */
function maxUrls(deps: ConsoleDeps): number {
  const cfg = readObj(deps, "config/app.config.json");
  const seed = readObj(deps, "config/page-seed.json");
  const limits = cfg && isObj(cfg.limits) ? cfg.limits : {};
  const a = seed && typeof seed.maxUrls === "number" ? seed.maxUrls : 10;
  const b = typeof limits.pages === "number" ? limits.pages : 10;
  return Math.min(a, b);
}

// ---------------------------------------------------------------------------
// GET /api/domain/setup
// ---------------------------------------------------------------------------

interface Evaluation {
  urls: string[];
  max: number;
  missing: string[];
  steps: Array<{ id: string; label: string; complete: boolean; reasons: string[]; count?: number; max?: number; missing?: string[] }>;
  reasons: string[];
  canConfirm: boolean;
}

function evaluate(deps: ConsoleDeps, draft: Record<string, unknown>): Evaluation {
  const urls = Array.isArray(draft.urls) ? draft.urls.filter((u): u is string => typeof u === "string") : [];
  const max = maxUrls(deps);
  const ws = wsFor("draft");

  const missing: string[] = [];
  for (const u of urls) {
    const slug = urlSlug(u);
    const spec = deps.fs.listDir(`${ws.baselinesRoot}/${slug}`).some((n) => /^baseline\.v\d+\.md$/.test(n));
    const vis = ["desktop", "mobile"].every((vp) => deps.fs.exists(`${ws.visualRoot}/${slug}/${vp}.png`));
    if (!spec || !vis) missing.push(u);
  }

  const urlReasons: string[] = [];
  if (urls.length < 1) urlReasons.push("Add at least one page for the new site");
  if (urls.length > max) urlReasons.push(`The list is over the limit of ${max}`);
  const baselineReasons: string[] = [];
  if (urls.length >= 1 && missing.length > 0) {
    baselineReasons.push(`${missing.length} page(s) still need approved specification and visual baselines`);
  }
  if (urls.length < 1) baselineReasons.push("Add pages first, then approve their baselines");

  const steps = [
    { id: "domain", label: "Enter the new domain", complete: true, reasons: [] as string[] },
    { id: "urls", label: "Build the approved page list", complete: urlReasons.length === 0, reasons: urlReasons, count: urls.length, max },
    { id: "baselines", label: "Produce baselines", complete: baselineReasons.length === 0, reasons: baselineReasons, missing },
  ];
  const reasons = steps.flatMap((s) => s.reasons);
  return { urls, max, missing, steps, reasons, canConfirm: reasons.length === 0 };
}

export const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function removeDraftFiles(deps: ConsoleDeps): void {
  rmSync(resolveInside(deps.fs.root, ...STAGING_REL.split("/")), { recursive: true, force: true });
  rmSync(resolveInside(deps.fs.root, ...DRAFT_REL.split("/")), { force: true });
}

async function getSetup(ctx: HandlerContext): Promise<ConsoleResponse> {
  const { deps } = ctx;
  const current = currentHost(deps);
  if (!deps.fs.exists(DRAFT_REL)) {
    return { status: 200, json: { draft: null, currentDomain: current, steps: [], canConfirm: false, reasons: [] } };
  }
  const draft = readObj(deps, DRAFT_REL);
  if (!draft || typeof draft.host !== "string") {
    return fail(500, "The new-domain draft cannot be read. Cancel it to start again.", { draft: null });
  }

  // Auto-discard of an abandoned draft (older than 7 days).
  const created = Date.parse(str(draft.createdAt));
  if (Number.isFinite(created) && deps.clock.now().getTime() - created > DRAFT_MAX_AGE_MS) {
    try {
      removeDraftFiles(deps);
    } catch (err) {
      return fail(500, "The old draft could not be removed: " + scrubForDisplay(err instanceof Error ? err.message : "error"));
    }
    const logged = logSetup(
      deps,
      str(draft.reviewer) || "system",
      "domain-draft-discarded",
      `Discarded the unfinished setup for ${draft.host} (older than 7 days)`,
      {},
      { previousHost: current ?? "", newHost: draft.host },
    );
    if (logged) return logged;
    return {
      status: 200,
      json: {
        draft: null,
        currentDomain: current,
        steps: [],
        canConfirm: false,
        reasons: [],
        discarded: true,
        message: `The unfinished setup for ${draft.host} was older than 7 days, so it was discarded. Nothing about the current site changed.`,
      },
    };
  }

  const ev = evaluate(deps, draft);
  const { urls, steps, reasons } = ev;
  return {
    status: 200,
    json: {
      draft: {
        host: draft.host,
        baseUrl: str(draft.baseUrl),
        slug: str(draft.slug),
        createdAt: str(draft.createdAt),
        reviewer: str(draft.reviewer),
        urlCount: urls.length,
      },
      currentDomain: current,
      steps,
      canConfirm: ev.canConfirm,
      reasons,
    },
  };
}

// ---------------------------------------------------------------------------
// POST /api/domain/setup/start
// ---------------------------------------------------------------------------

async function postStart(ctx: HandlerContext): Promise<ConsoleResponse> {
  const { deps } = ctx;
  const body = isObj(ctx.body) ? ctx.body : {};
  const rv = validateReviewerName(body.reviewer);
  if (!rv.ok) return fail(400, rv.reason);
  const v = validateNewHost(str(body.host));
  if (!v.ok) return fail(400, v.reason);
  const retyped = validateNewHost(str(body.retypedHost));
  if (!retyped.ok || retyped.host !== v.host) return fail(400, "The retyped site name does not match");
  const current = currentHost(deps);
  if (current !== null && current.toLowerCase() === v.host) return fail(400, "That is already the monitored site");
  if (deps.fs.exists(DRAFT_REL)) {
    return fail(409, "A new-domain setup is already in progress. Cancel it before starting another.");
  }

  let addrs: string[];
  try {
    addrs = await resolver(v.host);
  } catch {
    return fail(400, "That site name could not be looked up");
  }
  if (addrs.length === 0 || addrs.some(isPrivateAddress)) return fail(400, PRIVATE_ADDRESS_TEXT);

  const denied = authorize(deps, rv.name, "domain-draft-start", { host: v.host, previous: current ?? "" });
  if (denied) return denied;

  const createdAt = deps.clock.now().toISOString();
  try {
    deps.fs.writeText(
      DRAFT_REL,
      JSON.stringify(
        { schemaVersion: 1, host: v.host, baseUrl: v.baseUrl, slug: v.slug, createdAt, reviewer: rv.name, urls: [] },
        null,
        2,
      ) + "\n",
    );
  } catch {
    return fail(500, "The draft could not be saved.");
  }
  const logged = logSetup(
    deps,
    rv.name,
    "domain-draft-started",
    `Started setting up ${v.host} (current: ${current ?? "unknown"})`,
    {},
    { previousHost: current ?? "", newHost: v.host },
  );
  if (logged) return logged;
  return { status: 200, json: { draft: { host: v.host, baseUrl: v.baseUrl, slug: v.slug, createdAt, reviewer: rv.name, urlCount: 0 } } };
}

// ---------------------------------------------------------------------------
// POST /api/domain/setup/cancel
// ---------------------------------------------------------------------------

async function postCancel(ctx: HandlerContext): Promise<ConsoleResponse> {
  const { deps } = ctx;
  const body = isObj(ctx.body) ? ctx.body : {};
  const rv = validateReviewerName(body.reviewer);
  if (!rv.ok) return fail(400, rv.reason);
  if (!deps.fs.exists(DRAFT_REL)) return fail(409, "There is no new-domain setup to cancel.");
  const draft = readObj(deps, DRAFT_REL);
  const draftHost = draft && typeof draft.host === "string" ? draft.host : "";

  const denied = authorize(deps, rv.name, "domain-draft-cancel", { host: draftHost });
  if (denied) return denied;

  try {
    rmSync(resolveInside(deps.fs.root, ...STAGING_REL.split("/")), { recursive: true, force: true });
    rmSync(resolveInside(deps.fs.root, ...DRAFT_REL.split("/")), { force: true });
  } catch (err) {
    return fail(500, "The draft could not be removed: " + scrubForDisplay(err instanceof Error ? err.message : "error"));
  }
  const current = currentHost(deps);
  const logged = logSetup(
    deps,
    rv.name,
    "domain-draft-cancelled",
    `Cancelled setting up ${draftHost || "a new site"} (current: ${current ?? "unknown"})`,
    {},
    { previousHost: current ?? "", newHost: draftHost },
  );
  if (logged) return logged;
  return { status: 200, json: { cancelled: true } };
}

// ---------------------------------------------------------------------------
// POST /api/domain/setup/confirm  (the all-or-nothing switch)
// ---------------------------------------------------------------------------

export const JOURNAL_REL = "artifacts/admin/domain-confirm-journal.json";
const BACKUP_ROOT_REL = "artifacts/admin/backup";
const PUBLISH_NOTE = "The change takes effect on GitHub only after you publish it.";

let faultHook: ((step: string) => void) | null = null;

/** Test hook: called before every transaction step; throw to inject a failure. */
export function setConfirmFaultHook(h?: (step: string) => void): void {
  faultHook = h ?? null;
}

function abs(deps: ConsoleDeps, rel: string): string {
  return resolveInside(deps.fs.root, ...rel.split("/"));
}

/** Write bytes via temp file then rename (no EOL or BOM changes). */
function writeBytesAtomic(path: string, bytes: Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  try {
    writeFileSync(tmp, bytes);
    renameSync(tmp, path);
  } catch (err) {
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* ignore */
    }
    throw err;
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && Buffer.from(a).equals(Buffer.from(b));
}

function detectIndent(text: string): string {
  const m = /^[ \t]+(?=")/m.exec(text);
  return m ? m[0] : "  ";
}

/** Re-serialise a parsed config with its original indentation, EOL style, and final newline. */
function reserialise(original: string, doc: Record<string, unknown>): string {
  let out = JSON.stringify(doc, null, detectIndent(original));
  if (/\n$/.test(original)) out += "\n";
  if (original.includes("\r\n")) out = out.replace(/\n/g, "\r\n");
  return out;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Replace the values of the given top-level string fields in the original text, keeping every
 * other byte (layout, key order, EOL). Falls back to a full re-serialise when the targeted edit
 * does not parse to exactly the expected document.
 */
function replaceStringFields(original: string, doc: Record<string, unknown>, fields: Record<string, string>): string {
  let out = original;
  for (const [k, v] of Object.entries(fields)) {
    const re = new RegExp(`("${k}"\\s*:\\s*)"(?:[^"\\\\]|\\\\.)*"`);
    if (!re.test(out)) return reserialise(original, { ...doc, ...fields });
    out = out.replace(re, (_m, p: string) => p + JSON.stringify(v));
  }
  const expected = { ...doc, ...fields };
  try {
    if (deepEqual(JSON.parse(out), expected)) return out;
  } catch {
    /* fall through */
  }
  return reserialise(original, expected);
}

interface Journal {
  schemaVersion: 1;
  state: "applying" | "committed" | "rolled-back" | "rollback-incomplete";
  startedAt: string;
  previousHost: string;
  newHost: string;
  backupDir: string;
  created: string[];
  step: string;
  failure?: string;
}

/**
 * If the journal says an earlier confirm never finished ("applying" or "rollback-incomplete"),
 * undo it from the journal and its backups. Returns a refusal response when that is not
 * possible, or null when the way is clear.
 */
function recoverLeftoverJournal(deps: ConsoleDeps): ConsoleResponse | null {
  if (!deps.fs.exists(JOURNAL_REL)) return null;
  const j = readObj(deps, JOURNAL_REL);
  const refuse = (why: string): ConsoleResponse =>
    fail(409, `An earlier switch did not finish and could not be undone automatically (${why}). Nothing was changed. Check ${JOURNAL_REL} and the backup folder.`);
  if (!j) return refuse("the journal cannot be read");
  if (j.state !== "applying" && j.state !== "rollback-incomplete") return null;
  const backupDir = str(j.backupDir);
  if (!backupDir.startsWith(BACKUP_ROOT_REL + "/") || backupDir.includes("..")) return refuse("the backup location is not valid");
  try {
    const appB = new Uint8Array(deps.fs.readBytes(`${backupDir}/app.config.json`));
    const seedB = new Uint8Array(deps.fs.readBytes(`${backupDir}/page-seed.json`));
    const created = Array.isArray(j.created) ? j.created.filter((c): c is string => typeof c === "string") : [];
    for (const c of created) {
      if (!/^(baselines|baselines-visual|config\/domains)\//.test(c) || c.includes("..")) throw new Error("unexpected path in the journal");
    }
    writeBytesAtomic(abs(deps, "config/app.config.json"), appB);
    writeBytesAtomic(abs(deps, "config/page-seed.json"), seedB);
    for (const c of created.filter((x) => !x.endsWith("/"))) rmSync(abs(deps, c), { force: true });
    for (const c of created.filter((x) => x.endsWith("/")).reverse()) rmSync(abs(deps, c.slice(0, -1)), { recursive: true, force: true });
    deps.fs.writeText(JOURNAL_REL, JSON.stringify({ ...j, state: "rolled-back", created: [], recoveredAt: deps.clock.now().toISOString() }, null, 2) + "\n");
  } catch (err) {
    return refuse(scrubForDisplay(err instanceof Error ? err.message : "error"));
  }
  return null;
}

async function postConfirm(ctx: HandlerContext): Promise<ConsoleResponse> {
  const { deps } = ctx;
  const body = isObj(ctx.body) ? ctx.body : {};
  const rv = validateReviewerName(body.reviewer);
  if (!rv.ok) return fail(400, rv.reason);
  if (body.confirm !== true) return fail(400, "Confirmation is required to switch the monitored site");
  if (!deps.fs.exists(DRAFT_REL)) return fail(409, "There is no new-domain setup to confirm.");
  const draft = readObj(deps, DRAFT_REL);
  if (!draft || typeof draft.host !== "string" || !draft.host) {
    return fail(500, "The new-domain draft cannot be read. Cancel it to start again.");
  }
  const host = draft.host;
  const retyped = validateNewHost(str(body.retypedHost));
  if (!retyped.ok || retyped.host !== host.toLowerCase()) return fail(400, "The retyped site name does not match");

  const ev = evaluate(deps, draft);
  if (!ev.canConfirm) return fail(409, "The setup is not ready to confirm: " + ev.reasons.join("; "), { reasons: ev.reasons });

  // Pending URL changes for the current site must be dealt with first.
  const pendingPath = wsFor("project").pendingPath;
  if (pendingPath && deps.fs.exists(pendingPath)) {
    const pend = readObj(deps, pendingPath);
    if (pend && Array.isArray(pend.ops) && pend.ops.length > 0) {
      return fail(409, "Apply or discard your pending URL changes first");
    }
  }

  let appText = safeRead(deps, "config/app.config.json");
  let seedText = safeRead(deps, "config/page-seed.json");
  let appDoc = appText === null ? null : parseObj(appText);
  let seedDoc = seedText === null ? null : parseObj(seedText);
  if (appText === null || seedText === null || !appDoc || !seedDoc) {
    return fail(500, "The current configuration cannot be read, so nothing was changed.");
  }
  const previousHost = str(appDoc.approvedDomain);
  const oldSlug = str(appDoc.domain);
  const newSlug = str(draft.slug);
  const newBase = str(draft.baseUrl);
  if (!/^[a-z0-9][a-z0-9-]{0,119}$/.test(newSlug) || !newBase) return fail(500, "The draft is incomplete. Cancel it to start again.");
  if (previousHost.toLowerCase() === host.toLowerCase()) return fail(400, "That is already the monitored site");

  // Approval before any file is written.
  const denied = authorize(deps, rv.name, "domain-change", { previous: previousHost, new: host });
  if (denied) return denied;

  // A journal left by a crashed earlier attempt is rolled back first, or the confirm is refused.
  const recovery = recoverLeftoverJournal(deps);
  if (recovery) return recovery;
  appText = safeRead(deps, "config/app.config.json");
  seedText = safeRead(deps, "config/page-seed.json");
  appDoc = appText === null ? null : parseObj(appText);
  seedDoc = seedText === null ? null : parseObj(seedText);
  if (appText === null || seedText === null || !appDoc || !seedDoc) return fail(500, "The current configuration cannot be read, so nothing was changed.");

  const stamp = deps.clock.now().toISOString().replace(/[:.]/g, "-");
  const backupDir = `${BACKUP_ROOT_REL}/${stamp}`;
  const journal: Journal = {
    schemaVersion: 1,
    state: "applying",
    startedAt: deps.clock.now().toISOString(),
    previousHost,
    newHost: host,
    backupDir,
    created: [],
    step: "start",
  };
  const createdFiles: string[] = [];
  const createdDirs: string[] = [];
  const oldAppBytes = new Uint8Array(deps.fs.readBytes("config/app.config.json"));
  const oldSeedBytes = new Uint8Array(deps.fs.readBytes("config/page-seed.json"));

  const saveJournal = (step: string): void => {
    journal.step = step;
    journal.created = [...createdFiles, ...createdDirs.map((d) => d + "/")];
    deps.fs.writeText(JOURNAL_REL, JSON.stringify(journal, null, 2) + "\n");
  };
  const stepStart = (step: string): void => {
    saveJournal(step);
    if (faultHook) faultHook(step);
  };
  const track = (rel: string): void => {
    createdFiles.push(rel);
  };

  let failedStep = "start";
  try {
    // 0. Journal first, then backups.
    failedStep = "journal";
    stepStart("journal");
    failedStep = "backup";
    stepStart("backup");
    writeBytesAtomic(abs(deps, `${backupDir}/app.config.json`), oldAppBytes);
    writeBytesAtomic(abs(deps, `${backupDir}/page-seed.json`), oldSeedBytes);

    // 1. Promote staged baselines (new files only; identical files are skipped).
    const dws = wsFor("draft");
    const pws = wsFor("project");
    for (const u of ev.urls) {
      const slug = urlSlug(u);
      const pairs: Array<[string, string, string[]]> = [
        [`${dws.baselinesRoot}/${slug}`, `${pws.baselinesRoot}/${slug}`, deps.fs.listDir(`${dws.baselinesRoot}/${slug}`).filter((n) => /^baseline\.v\d+\.md$/.test(n))],
        [`${dws.visualRoot}/${slug}`, `${pws.visualRoot}/${slug}`, ["desktop.png", "mobile.png"]],
      ];
      for (const [fromDir, toDir, names] of pairs) {
        if (!deps.fs.exists(toDir)) {
          failedStep = `baselines:${toDir}`;
          stepStart(failedStep);
          mkdirSync(abs(deps, toDir), { recursive: true });
          createdDirs.push(toDir);
        }
        for (const n of names) {
          failedStep = `baselines:${toDir}/${n}`;
          stepStart(failedStep);
          const src = new Uint8Array(deps.fs.readBytes(`${fromDir}/${n}`));
          const dest = `${toDir}/${n}`;
          if (deps.fs.exists(dest)) {
            if (sameBytes(new Uint8Array(deps.fs.readBytes(dest)), src)) continue;
            throw new Error(`A different approved baseline already exists at ${dest}`);
          }
          track(dest);
          saveJournal(failedStep);
          writeBytesAtomic(abs(deps, dest), src);
        }
      }
    }

    // 2. New domain config file (never replace an existing one).
    failedStep = "domain-file";
    stepStart("domain-file");
    const domainRel = `config/domains/${newSlug}.json`;
    if (!deps.fs.exists(domainRel)) {
      const old = oldSlug ? readObj(deps, `config/domains/${oldSlug}.json`) : null;
      const num = (k: string, d: number): number => (old && typeof old[k] === "number" ? (old[k] as number) : d);
      const dom = {
        domain: host.toLowerCase(),
        baseUrl: newBase,
        approvedSchemes: ["https"],
        maxDiscoveryCount: num("maxDiscoveryCount", 500),
        largeScopeThreshold: num("largeScopeThreshold", 25),
        requestSpacingMs: Math.max(1000, num("requestSpacingMs", 1000)),
        scopeFile: `config/scope/${newSlug}.approved.json`,
        probePaths: ["/"],
      };
      track(domainRel);
      saveJournal("domain-file");
      writeBytesAtomic(abs(deps, domainRel), Buffer.from(JSON.stringify(dom, null, 2) + "\n", "utf8"));
    }

    // 3. Page seed: approvedUrls replaced, everything else preserved.
    failedStep = "page-seed";
    stepStart("page-seed");
    const newSeed: Record<string, unknown> = { ...seedDoc, approvedUrls: [...ev.urls] };
    writeBytesAtomic(abs(deps, "config/page-seed.json"), Buffer.from(reserialise(seedText, newSeed), "utf8"));

    // 4. App config last: this is the switch.
    failedStep = "app-config";
    stepStart("app-config");
    const newAppText = replaceStringFields(appText, appDoc, { approvedDomain: host.toLowerCase(), baseUrl: newBase, domain: newSlug });
    writeBytesAtomic(abs(deps, "config/app.config.json"), Buffer.from(newAppText, "utf8"));

    // 5. Commit point.
    failedStep = "commit";
    stepStart("commit");
    journal.state = "committed";
    saveJournal("committed");
  } catch (err) {
    const reason = scrubForDisplay(err instanceof Error ? err.message : "error");
    const problems: string[] = [];
    const attempt = (what: string, fn: () => void): void => {
      try {
        fn();
      } catch (e) {
        problems.push(`${what}: ${scrubForDisplay(e instanceof Error ? e.message : "error")}`);
      }
    };
    attempt("restore app.config.json", () => writeBytesAtomic(abs(deps, "config/app.config.json"), oldAppBytes));
    attempt("restore page-seed.json", () => writeBytesAtomic(abs(deps, "config/page-seed.json"), oldSeedBytes));
    for (const f of [...createdFiles].reverse()) attempt(`remove ${f}`, () => rmSync(abs(deps, f), { force: true }));
    for (const d of [...createdDirs].reverse()) attempt(`remove ${d}`, () => rmSync(abs(deps, d), { recursive: true, force: true }));
    journal.state = problems.length === 0 ? "rolled-back" : "rollback-incomplete";
    journal.failure = `${failedStep}: ${reason}`;
    try {
      journal.created = [];
      journal.step = failedStep;
      deps.fs.writeText(JOURNAL_REL, JSON.stringify(journal, null, 2) + "\n");
    } catch {
      /* the journal is advisory once rollback has run */
    }
    const message =
      problems.length === 0
        ? `The switch to ${host} failed at step "${failedStep}" (${reason}). Everything already applied was undone, so ${previousHost} is still the monitored site and your draft is kept.`
        : `The switch to ${host} failed at step "${failedStep}" (${reason}), and some changes could not be undone (${problems.join("; ")}). Check ${JOURNAL_REL}.`;
    return fail(500, message, { rolledBack: problems.length === 0, failedStep, draftKept: true });
  }

  // Success: only now is the draft removed.
  let cleanupNote = "";
  try {
    removeDraftFiles(deps);
  } catch (err) {
    cleanupNote = " The draft files could not be removed: " + scrubForDisplay(err instanceof Error ? err.message : "error");
  }
  const logged = logSetup(
    deps,
    rv.name,
    "domain-changed",
    `Changed the monitored site from ${previousHost} to ${host}`,
    {},
    { previousHost, newHost: host },
  );
  if (logged) return logged;
  return {
    status: 200,
    json: {
      changed: true,
      previousHost,
      newHost: host,
      message: `The monitored site is now ${host}. The old site's baselines and settings were kept. ${PUBLISH_NOTE}${cleanupNote}`,
    },
  };
}

function safeRead(deps: ConsoleDeps, rel: string): string | null {
  try {
    return deps.fs.readText(rel);
  } catch {
    return null;
  }
}

function parseObj(text: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(text);
    return isObj(v) ? v : null;
  } catch {
    return null;
  }
}

export const DOMAIN_SETUP_GROUP: RouteDef[] = [
  { method: "GET", pattern: "/api/domain/setup", mutating: false, maxBodyBytes: 0, handler: getSetup },
  { method: "POST", pattern: "/api/domain/setup/start", mutating: true, maxBodyBytes: DOMAIN_SETUP_BODY_MAX, handler: postStart },
  { method: "POST", pattern: "/api/domain/setup/cancel", mutating: true, maxBodyBytes: DOMAIN_SETUP_BODY_MAX, handler: postCancel },
  { method: "POST", pattern: "/api/domain/setup/confirm", mutating: true, maxBodyBytes: DOMAIN_SETUP_BODY_MAX, handler: postConfirm },
];
