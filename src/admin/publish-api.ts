/**
 * Config_Publish API (design J.8, Requirements 26, 27, 30). "Publish to GitHub" builds ONE
 * commit as a child of origin/main that contains only the configuration delta (CONFIG_PATHSPECS),
 * using git plumbing and a temporary index file. It pushes additively to main: no force, no
 * rebase, no merge, no checkout. Unrelated working-tree changes are never staged.
 * Handlers use ports only (ConsoleDeps). Git output shown to the user goes through scrubForDisplay.
 * No AI, no network of its own (the Reviewer's git credentials are used by git itself).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { validateReviewerName } from "./atomic-file.js";
import type { ConsoleDeps } from "./console-deps.js";
import type { ConsoleResponse, HandlerContext, RouteDef } from "./console-routes.js";
import type { GitResult } from "./git-port.js";
import { appendFeedback, normalizeRemote, readFeedback, remoteDisplayName } from "./git-feedback.js";
import type { GitFeedbackInput, GitFeedbackRecord, LastPublished } from "./git-feedback.js";
import { canPublish, computeDelta } from "./publish-delta.js";
import type { PublishDelta } from "./publish-delta.js";
import { CONFIG_PATHSPECS, isConfigPath } from "./publish-paths.js";
import { asciiEscape } from "./setup-log.js";
import { scrubForDisplay } from "./scrub.js";
import { authorize, fail, logSetup, readPending, wsFor } from "./urls-api.js";

export const PUBLISH_BODY_MAX = 4 * 1024;
export const PUBLISH_BRANCH = "main";
export const PUBLISH_REMOTE = "origin";
export const ATTEMPT_REF = "refs/awg/last-publish-attempt";
export const SIZE_WARN_BYTES = 25 * 1024 * 1024;
export const FILE_BLOCK_BYTES = 50 * 1024 * 1024;
export const MAX_PUBLISH_ATTEMPTS = 3;
const MB = 1024 * 1024;
const ZERO_SHA = "0000000000000000000000000000000000000000";
const SHA_RE = /^[0-9a-f]{40}$/;

export const NOTHING_TO_PUBLISH_TEXT = "Nothing to publish";

const REASON_TEXT: Record<string, string> = {
  "nothing-to-publish": NOTHING_TO_PUBLISH_TEXT,
  "no-origin": "There is no GitHub remote named origin with a main branch to publish to",
  "publish-running": "A publish is already running",
  "staged-changes": "You have staged changes. Choose Update project first so they are included.",
};

let publishRunning = false;

/** Test hook: clears the single-flight lock. */
export function resetPublishLock(): void {
  publishRunning = false;
}

// ---------------------------------------------------------------------------
// git helpers
// ---------------------------------------------------------------------------

async function g(deps: ConsoleDeps, args: string[], opts?: { stdin?: string; env?: Record<string, string> }): Promise<GitResult> {
  try {
    return await deps.git.run(args, opts);
  } catch (err) {
    return { code: 127, stdout: "", stderr: err instanceof Error ? err.message : String(err) };
  }
}

function scrubCtx(deps: ConsoleDeps): { projectRoot: string; home: string } {
  return { projectRoot: deps.fs.root, home: homedir() };
}

function scrubText(deps: ConsoleDeps, text: string): string {
  return scrubForDisplay(text, scrubCtx(deps)).replace(/[ \t]+/g, " ").trim();
}

function firstLine(r: GitResult): string {
  const t = (r.stderr.trim() || r.stdout.trim() || `git exited with code ${r.code}`).split(/\r?\n/)[0] ?? "";
  return t;
}

function outLines(r: GitResult): string[] {
  return `${r.stdout}\n${r.stderr}`
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "")
    .slice(0, 20);
}

function record(deps: ConsoleDeps, input: GitFeedbackInput): GitFeedbackRecord | null {
  try {
    return appendFeedback(deps.fs, input, deps.clock.now(), scrubCtx(deps));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Delta gathering (design J.8.2)
// ---------------------------------------------------------------------------

interface Gathered {
  originExists: boolean;
  remoteDisplay: string;
  branch: string;
  fetchAttempted: boolean;
  fetchOk: boolean;
  fetchNote: string | null;
  fetchLines: string[];
  tip: string | null;
  local: Map<string, string>;
  delta: PublishDelta;
  error: string | null;
}

function emptyDelta(): PublishDelta {
  return { added: [], modified: [], deleted: [] };
}

async function currentBranch(deps: ConsoleDeps): Promise<string> {
  const r = await g(deps, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return r.code === 0 ? r.stdout.trim() : "";
}

async function localConfigMap(deps: ConsoleDeps): Promise<Map<string, string> | string> {
  const ls = await g(deps, ["ls-files", "-co", "--exclude-standard", "-z", "--", ...CONFIG_PATHSPECS]);
  if (ls.code !== 0) return `cannot list files: ${firstLine(ls)}`;
  const seen = new Set<string>();
  const present: string[] = [];
  for (const p of ls.stdout.split("\0")) {
    if (p === "" || seen.has(p) || p.includes("\n") || !isConfigPath(p)) continue;
    seen.add(p);
    let there = false;
    try {
      there = deps.fs.exists(p);
    } catch {
      there = false;
    }
    if (there) present.push(p);
  }
  const map = new Map<string, string>();
  if (present.length === 0) return map;
  const h = await g(deps, ["hash-object", "--stdin-paths"], { stdin: present.join("\n") + "\n" });
  const ids = h.stdout.split(/\r?\n/).filter((l) => l !== "");
  if (h.code !== 0 || ids.length !== present.length || !ids.every((i) => SHA_RE.test(i))) {
    return `cannot read the configuration files: ${firstLine(h)}`;
  }
  present.forEach((p, i) => map.set(p, ids[i] as string));
  return map;
}

async function remoteConfigMap(deps: ConsoleDeps, tip: string): Promise<Map<string, string> | string> {
  const lt = await g(deps, ["ls-tree", "-r", "-z", tip, "--", ...CONFIG_PATHSPECS]);
  if (lt.code !== 0) return `cannot read GitHub's files: ${firstLine(lt)}`;
  const map = new Map<string, string>();
  for (const entry of lt.stdout.split("\0")) {
    const m = /^(\d+) blob ([0-9a-f]{40})\t(.+)$/.exec(entry);
    if (m) map.set(m[3] as string, m[2] as string);
  }
  return map;
}

async function resolveTip(deps: ConsoleDeps): Promise<string | null> {
  const r = await g(deps, ["rev-parse", "--verify", `${PUBLISH_REMOTE}/${PUBLISH_BRANCH}^{commit}`]);
  const sha = r.stdout.trim();
  return r.code === 0 && SHA_RE.test(sha) ? sha : null;
}

async function gather(deps: ConsoleDeps, doFetch: boolean): Promise<Gathered> {
  const url = await g(deps, ["remote", "get-url", PUBLISH_REMOTE]);
  const originExists = url.code === 0 && url.stdout.trim() !== "";
  const out: Gathered = {
    originExists,
    remoteDisplay: originExists ? scrubText(deps, normalizeRemote(url.stdout.trim())) : "",
    branch: await currentBranch(deps),
    fetchAttempted: false,
    fetchOk: false,
    fetchNote: null,
    fetchLines: [],
    tip: null,
    local: new Map(),
    delta: emptyDelta(),
    error: null,
  };
  if (!originExists) return out;
  if (doFetch) {
    out.fetchAttempted = true;
    const f = await g(deps, ["fetch", PUBLISH_REMOTE, PUBLISH_BRANCH]);
    out.fetchOk = f.code === 0;
    out.fetchLines = outLines(f);
    if (!out.fetchOk) out.fetchNote = `Could not check GitHub: ${scrubText(deps, firstLine(f))}`;
  }
  out.tip = await resolveTip(deps);
  if (out.tip === null) return out;
  const local = await localConfigMap(deps);
  if (typeof local === "string") {
    out.error = local;
    return out;
  }
  const remote = await remoteConfigMap(deps, out.tip);
  if (typeof remote === "string") {
    out.error = remote;
    return out;
  }
  out.local = local;
  out.delta = computeDelta(local, remote);
  return out;
}

function stagedCount(deps: ConsoleDeps): number {
  try {
    const ops = readPending(deps, wsFor("project"));
    return ops === null ? 1 : ops.length;
  } catch {
    return 0;
  }
}

interface Sizes {
  totalBytes: number;
  pngBytes: number;
  largestBytes: number;
  largestPath: string | null;
  tooLarge: string[];
}

function measure(deps: ConsoleDeps, delta: PublishDelta): Sizes {
  const s: Sizes = { totalBytes: 0, pngBytes: 0, largestBytes: 0, largestPath: null, tooLarge: [] };
  for (const p of [...delta.added, ...delta.modified]) {
    let n = 0;
    try {
      n = deps.fs.readBytes(p).length;
    } catch {
      n = 0;
    }
    s.totalBytes += n;
    if (p.startsWith("baselines-visual/") && p.toLowerCase().endsWith(".png")) s.pngBytes += n;
    if (n > s.largestBytes) {
      s.largestBytes = n;
      s.largestPath = p;
    }
    if (n > FILE_BLOCK_BYTES) s.tooLarge.push(p);
  }
  return s;
}

function mbText(bytes: number): string {
  return (bytes / MB).toFixed(1);
}

// ---------------------------------------------------------------------------
// Last published (from Git_Feedback)
// ---------------------------------------------------------------------------

export function lastPublishedOf(deps: ConsoleDeps): LastPublished | null {
  const recs = readFeedback(deps.fs);
  for (let i = recs.length - 1; i >= 0; i--) {
    const r = recs[i] as GitFeedbackRecord;
    if (r.op === "push" && r.ok && typeof r.commit === "string" && typeof r.pushedAt === "string") {
      return { sha: r.commit, pushedAt: r.pushedAt, branch: r.branch, remote: r.remote, purpose: "publish" };
    }
  }
  return null;
}

/** For GET /api/status: unpublished count (null when unknown) and the last published commit. */
export async function publishOverview(
  deps: ConsoleDeps,
): Promise<{
  unpublishedChanges: number | null;
  lastPublish: { sha: string; at: string } | null;
  unpublishedFiles: Array<{ path: string; change: "Added" | "Changed" | "Deleted" }> | null;
  target: { remote: string | null; branch: string; remoteName: string };
}> {
  let count: number | null = null;
  let files: Array<{ path: string; change: "Added" | "Changed" | "Deleted" }> | null = null;
  let remote: string | null = null;
  // The target is read straight from `git remote get-url origin`, independent of the fetch path.
  try {
    const u = await g(deps, ["remote", "get-url", PUBLISH_REMOTE]);
    remote = u.code === 0 ? remoteDisplayName(u.stdout.trim()) : null;
  } catch {
    remote = null;
  }
  try {
    const gt = await gather(deps, false);
    if (gt.originExists && gt.tip !== null && gt.error === null) {
      count = gt.delta.added.length + gt.delta.modified.length + gt.delta.deleted.length;
      files = [
        ...gt.delta.added.map((path) => ({ path, change: "Added" as const })),
        ...gt.delta.modified.map((path) => ({ path, change: "Changed" as const })),
        ...gt.delta.deleted.map((path) => ({ path, change: "Deleted" as const })),
      ];
    }
  } catch {
    count = null;
    files = null;
  }
  let last: { sha: string; at: string } | null = null;
  try {
    const lp = lastPublishedOf(deps);
    if (lp) last = { sha: lp.sha, at: lp.pushedAt };
  } catch {
    last = null;
  }
  return {
    unpublishedChanges: count,
    unpublishedFiles: files,
    lastPublish: last,
    target: { remote, branch: PUBLISH_BRANCH, remoteName: PUBLISH_REMOTE },
  };
}

// ---------------------------------------------------------------------------
// Commit message (design J.8.5): pure, ASCII, no paths
// ---------------------------------------------------------------------------

export interface CommitMessageInput {
  reviewer: string;
  domain: string;
  urlCount: number;
  delta: PublishDelta;
}

export function buildCommitMessage(input: CommitMessageInput): string {
  const d = input.delta;
  const total = d.added.length + d.modified.length + d.deleted.length;
  const baselineFiles = [...d.added, ...d.modified, ...d.deleted].filter(
    (p) => p.startsWith("baselines/") || p.startsWith("baselines-visual/"),
  ).length;
  const domain = asciiEscape(input.domain.replace(/[\r\n]+/g, " "));
  const subject = `Publish configuration: domain ${domain}, ${input.urlCount} URLs, ${baselineFiles} baseline files`.slice(0, 72);
  const lines: string[] = [];
  const all: Array<[string, string]> = [
    ...d.added.map((p): [string, string] => ["+", p]),
    ...d.modified.map((p): [string, string] => ["~", p]),
    ...d.deleted.map((p): [string, string] => ["-", p]),
  ];
  for (const [mark, p] of all.slice(0, 40)) lines.push(`  ${mark} ${asciiEscape(p)}`);
  if (all.length > 40) lines.push(`  ... and ${all.length - 40} more files`);
  return [
    subject,
    "",
    `Reviewer: ${asciiEscape(input.reviewer.replace(/[\r\n]+/g, " "))}`,
    `Domain: ${domain}`,
    `Approved URLs: ${input.urlCount}`,
    `Files: ${total} (${d.added.length} added, ${d.modified.length} changed, ${d.deleted.length} deleted)`,
    ...lines,
    "Published-by: awg-admin-console",
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Failure classification
// ---------------------------------------------------------------------------

type PushFailure = "non-fast-forward" | "workflow-permission" | "protected-branch" | "sign-in" | "network" | "no-origin" | "other";

export function classifyPush(text: string): PushFailure {
  const t = text.toLowerCase();
  if (/protected branch|gh006|gh013|hook declined/.test(t)) return "protected-branch";
  if (/workflow/.test(t) && /scope|permission/.test(t)) return "workflow-permission";
  if (/non-fast-forward|fetch first/.test(t) || (/\[rejected\]/.test(t) && !/remote rejected/.test(t))) return "non-fast-forward";
  if (/could not read username|authentication failed|terminal prompts disabled|permission denied|invalid credentials|returned error: 403|the requested url returned error: 40[13]/.test(t)) {
    return "sign-in";
  }
  if (/could not resolve host|unable to access|connection (refused|timed out|reset)|failed to connect|network is unreachable/.test(t)) return "network";
  if (/does not appear to be a git repository|no such remote/.test(t)) return "no-origin";
  return "other";
}

const FAILURE_TEXT: Record<PushFailure, string> = {
  "non-fast-forward": "GitHub changed again while publishing. Nothing was lost. Try again.",
  "workflow-permission": "Your GitHub sign-in is not allowed to change workflow files. Update its permissions, then try again.",
  "protected-branch": "GitHub does not allow a direct push to main (branch protection). Ask a repository admin.",
  "sign-in": "Run git push once in a terminal to sign in, then retry.",
  network: "Could not reach GitHub. Check the network, then retry.",
  "no-origin": "There is no GitHub remote named origin.",
  other: "GitHub did not accept the push.",
};

// ---------------------------------------------------------------------------
// GET /api/publish/status
// ---------------------------------------------------------------------------

async function getPublishStatus(ctx: HandlerContext): Promise<ConsoleResponse> {
  const { deps } = ctx;
  let gt: Gathered;
  try {
    gt = await gather(deps, true);
  } catch {
    return fail(500, "The publish status could not be read.");
  }
  const sizes = measure(deps, gt.delta);
  const staged = stagedCount(deps);
  const can = canPublish({
    delta: gt.delta,
    originExists: gt.originExists && gt.tip !== null,
    publishRunning,
    stagedOperations: staged,
  });
  let reason: string | undefined = can.reason;
  let canDo = can.canPublish;
  if (gt.error !== null) {
    canDo = false;
    reason = "git-error";
  } else if (canDo && sizes.tooLarge.length > 0) {
    canDo = false;
    reason = "file-too-large";
  }
  const warnings: string[] = [];
  if (gt.branch !== "" && gt.branch !== PUBLISH_BRANCH) {
    warnings.push(`You are on branch ${scrubText(deps, gt.branch)}. The configuration files in this folder will be published to ${PUBLISH_BRANCH}.`);
  }
  if (gt.fetchNote) warnings.push(gt.fetchNote);
  if (sizes.pngBytes > SIZE_WARN_BYTES) {
    warnings.push(`This adds ${mbText(sizes.pngBytes)} MB of baseline images to the repository permanently.`);
  }
  if (sizes.tooLarge.length > 0) warnings.push("A file is larger than 50 MB and cannot be published.");
  const message =
    reason === undefined
      ? "Ready to publish"
      : reason === "git-error"
        ? scrubText(deps, gt.error ?? "git error")
        : reason === "file-too-large"
          ? "A file is larger than 50 MB and cannot be published"
          : (REASON_TEXT[reason] ?? reason);
  return {
    status: 200,
    json: {
      delta: gt.delta,
      count: gt.delta.added.length + gt.delta.modified.length + gt.delta.deleted.length,
      sizes: {
        totalBytes: sizes.totalBytes,
        pngBytes: sizes.pngBytes,
        largestBytes: sizes.largestBytes,
        largestPath: sizes.largestPath,
      },
      needsSizeAck: sizes.pngBytes > SIZE_WARN_BYTES,
      needsDeleteAck: gt.delta.deleted.length > 0,
      tooLarge: sizes.tooLarge,
      stagedOperations: staged,
      canPublish: canDo,
      reason: reason ?? null,
      message,
      warnings,
      branch: gt.branch,
      targetBranch: PUBLISH_BRANCH,
      remote: PUBLISH_REMOTE,
      remoteDisplay: gt.remoteDisplay,
      target: { remote: remoteDisplayName(gt.remoteDisplay), branch: PUBLISH_BRANCH, remoteName: PUBLISH_REMOTE },
      commitMessage: buildCommitMessage(messageInput(deps, "<your name>", gt.delta)),
      fetchOk: gt.fetchOk,
      lastPublished: lastPublishedOf(deps),
    },
  };
}

// ---------------------------------------------------------------------------
// POST /api/publish
// ---------------------------------------------------------------------------

interface BuildOk {
  ok: true;
  commit: string;
}
interface BuildFail {
  ok: false;
  reason: string;
}

async function buildCommit(deps: ConsoleDeps, base: string, gt: Gathered, message: string): Promise<BuildOk | BuildFail> {
  let dir: string | null = null;
  try {
    dir = mkdtempSync(join(tmpdir(), "awg-pub-"));
    const env = { GIT_INDEX_FILE: join(dir, "index") };
    const rt = await g(deps, ["read-tree", base], { env });
    if (rt.code !== 0) return { ok: false, reason: `read-tree failed: ${firstLine(rt)}` };

    const changed = [...gt.delta.added, ...gt.delta.modified];
    const lines: string[] = [];
    if (changed.length > 0) {
      const ho = await g(deps, ["hash-object", "-w", "--stdin-paths"], { stdin: changed.join("\n") + "\n", env });
      const ids = ho.stdout.split(/\r?\n/).filter((l) => l !== "");
      if (ho.code !== 0 || ids.length !== changed.length || !ids.every((i) => SHA_RE.test(i))) {
        return { ok: false, reason: `hash-object failed: ${firstLine(ho)}` };
      }
      changed.forEach((p, i) => lines.push(`100644 ${ids[i] as string}\t${p}`));
    }
    for (const p of gt.delta.deleted) lines.push(`0 ${ZERO_SHA}\t${p}`);
    const ui = await g(deps, ["update-index", "--index-info"], { stdin: lines.join("\n") + "\n", env });
    if (ui.code !== 0) return { ok: false, reason: `update-index failed: ${firstLine(ui)}` };

    const wt = await g(deps, ["write-tree"], { env });
    const tree = wt.stdout.trim();
    if (wt.code !== 0 || !SHA_RE.test(tree)) return { ok: false, reason: `write-tree failed: ${firstLine(wt)}` };
    const ct = await g(deps, ["commit-tree", tree, "-p", base], { stdin: message, env });
    const commit = ct.stdout.trim();
    if (ct.code !== 0 || !SHA_RE.test(commit)) return { ok: false, reason: `commit failed: ${firstLine(ct)}` };
    return { ok: true, commit };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  } finally {
    if (dir !== null) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
  }
}

function readJson(deps: ConsoleDeps, rel: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(deps.fs.readText(rel));
    return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function messageInput(deps: ConsoleDeps, reviewer: string, delta: PublishDelta): CommitMessageInput {
  const cfg = readJson(deps, "config/app.config.json");
  const seed = readJson(deps, "config/page-seed.json");
  const domain = cfg && typeof cfg.approvedDomain === "string" ? cfg.approvedDomain : "unknown";
  const urlCount = seed && Array.isArray(seed.approvedUrls) ? seed.approvedUrls.length : 0;
  return { reviewer, domain, urlCount, delta };
}

/** Local branch alignment (J.8.4): only when on main and HEAD equals the base used. */
async function alignLocal(deps: ConsoleDeps, base: string, commit: string, remote: string): Promise<string> {
  const branch = await currentBranch(deps);
  const head = await g(deps, ["rev-parse", "--verify", "HEAD"]);
  if (branch === PUBLISH_BRANCH && head.code === 0 && head.stdout.trim() === base) {
    const ur = await g(deps, ["update-ref", `refs/heads/${PUBLISH_BRANCH}`, commit, base]);
    if (ur.code === 0) {
      const rs = await g(deps, ["reset", "-q", "HEAD", "--", ...CONFIG_PATHSPECS]);
      if (rs.code === 0) {
        record(deps, { op: "align-local", ok: true, branch, remote, lines: ["Local main moved to the published commit"] });
        return "aligned";
      }
    }
    record(deps, { op: "align-local", ok: false, branch, remote, lines: [scrubText(deps, firstLine(ur))] });
    return "not-aligned";
  }
  const note = "Your local branch was not moved because it has other commits. Run git pull when convenient.";
  record(deps, { op: "align-local", ok: true, branch, remote, lines: [note] });
  return "skipped";
}

async function failPublish(
  deps: ConsoleDeps,
  reviewer: string,
  purpose: string,
  status: number,
  reason: string,
  message: string,
  extra: Record<string, unknown> = {},
): Promise<ConsoleResponse> {
  const safe = scrubText(deps, message);
  const logged = logSetup(deps, reviewer, "publish-failed", `Publish failed: ${safe}`.slice(0, 280), {}, { reason, purpose });
  void logged;
  return { status, json: { error: safe, reason, retry: true, ...extra } };
}

async function postPublish(ctx: HandlerContext): Promise<ConsoleResponse> {
  const { deps } = ctx;
  const body = typeof ctx.body === "object" && ctx.body !== null && !Array.isArray(ctx.body) ? (ctx.body as Record<string, unknown>) : {};
  const purpose = body.purpose === undefined ? "publish" : body.purpose;
  if (purpose !== "publish" && purpose !== "trigger") return fail(400, "Unknown purpose");
  const rv = validateReviewerName(body.reviewer);
  if (!rv.ok) return fail(400, rv.reason);
  const reviewer = rv.name;
  if (body.confirm !== true) return fail(400, "Confirm to publish", { reason: "confirm-required" });
  if (publishRunning) return fail(409, REASON_TEXT["publish-running"] as string, { reason: "publish-running" });

  publishRunning = true;
  try {
    // Fresh fetch and delta.
    const gt = await gather(deps, true);
    if (gt.originExists && !gt.fetchOk) {
      record(deps, { op: "fetch", ok: false, branch: gt.branch, remote: gt.remoteDisplay, lines: [`$ git fetch ${PUBLISH_REMOTE} ${PUBLISH_BRANCH}`, ...gt.fetchLines] });
      return failPublish(deps, reviewer, purpose, 409, "fetch-failed", gt.fetchNote ?? "Could not check GitHub");
    }
    if (gt.error !== null) return failPublish(deps, reviewer, purpose, 500, "git-error", gt.error);
    const staged = stagedCount(deps);
    const can = canPublish({
      delta: gt.delta,
      originExists: gt.originExists && gt.tip !== null,
      publishRunning: false,
      stagedOperations: staged,
    });
    if (!can.canPublish) {
      const r = can.reason as string;
      return fail(409, REASON_TEXT[r] ?? r, { reason: r });
    }
    const sizes = measure(deps, gt.delta);
    if (sizes.tooLarge.length > 0) {
      return fail(409, "A file is larger than 50 MB and cannot be published", { reason: "file-too-large", files: sizes.tooLarge });
    }
    if (gt.delta.deleted.length > 0 && body.acknowledgeDeletes !== true) {
      return fail(400, "Confirm the deletions to publish", { reason: "delete-ack-required", deleted: gt.delta.deleted });
    }
    if (sizes.pngBytes > SIZE_WARN_BYTES && body.acknowledgeSize !== true) {
      return fail(400, `I understand this adds ${mbText(sizes.pngBytes)} MB to the repository permanently`, { reason: "size-ack-required" });
    }

    // Git identity of the Reviewer.
    const nm = await g(deps, ["config", "--get", "user.name"]);
    const em = await g(deps, ["config", "--get", "user.email"]);
    if (nm.stdout.trim() === "" || em.stdout.trim() === "") {
      return fail(409, "Set your git name and email first", { reason: "no-identity" });
    }

    const files = [...gt.delta.added, ...gt.delta.modified, ...gt.delta.deleted];
    const denied = authorize(deps, reviewer, "publish", { files: files.length, purpose });
    if (denied) return denied;

    const message = buildCommitMessage(messageInput(deps, reviewer, gt.delta));
    let base = gt.tip as string;
    let lastFail: { kind: PushFailure; text: string } = { kind: "other", text: "" };
    let lastCommit: string | null = null;

    for (let attempt = 1; attempt <= MAX_PUBLISH_ATTEMPTS; attempt++) {
      const built = await buildCommit(deps, base, gt, message);
      if (!built.ok) {
        record(deps, { op: "commit", ok: false, branch: PUBLISH_BRANCH, remote: gt.remoteDisplay, lines: [built.reason] });
        return failPublish(deps, reviewer, purpose, 500, "build-failed", built.reason);
      }
      lastCommit = built.commit;
      record(deps, { op: "commit", ok: true, branch: PUBLISH_BRANCH, remote: gt.remoteDisplay, files, commit: built.commit, lines: [`Built one commit from ${base.slice(0, 12)} with ${files.length} file(s)`] });
      await g(deps, ["update-ref", ATTEMPT_REF, built.commit]);

      const push = await g(deps, ["push", "--porcelain", PUBLISH_REMOTE, `${built.commit}:refs/heads/${PUBLISH_BRANCH}`]);
      const pushedAt = deps.clock.now().toISOString();
      const text = `${push.stderr}\n${push.stdout}`;
      if (push.code === 0) {
        record(deps, { op: "push", ok: true, branch: PUBLISH_BRANCH, remote: gt.remoteDisplay, commit: built.commit, pushedAt, files, lines: [`$ git push ${PUBLISH_REMOTE} ${PUBLISH_BRANCH}`, ...outLines(push)] });
        const fe = await g(deps, ["fetch", PUBLISH_REMOTE, PUBLISH_BRANCH]);
        record(deps, { op: "fetch", ok: fe.code === 0, branch: PUBLISH_BRANCH, remote: gt.remoteDisplay, lines: [`$ git fetch ${PUBLISH_REMOTE} ${PUBLISH_BRANCH}`, ...outLines(fe)] });
        const aligned = await alignLocal(deps, base, built.commit, gt.remoteDisplay);
        const counts = { added: gt.delta.added.length, modified: gt.delta.modified.length, deleted: gt.delta.deleted.length, files: files.length };
        const logged = logSetup(
          deps,
          reviewer,
          "publish",
          `Published ${files.length} configuration file(s) as ${built.commit.slice(0, 12)}`,
          counts,
          { commit: built.commit.slice(0, 12), purpose, branch: PUBLISH_BRANCH, remote: gt.remoteDisplay },
        );
        return {
          status: 200,
          json: {
            ok: true,
            commit: built.commit,
            pushedAt,
            branch: PUBLISH_BRANCH,
            remote: PUBLISH_REMOTE,
            remoteDisplay: gt.remoteDisplay,
            purpose,
            attempts: attempt,
            aligned,
            counts,
            runNote:
              "A run starts only when real changes are published. A stored token is not used; your own git sign-in was used.",
            warning: logged ? "The activity log could not be written." : undefined,
          },
        };
      }

      const kind = classifyPush(text);
      lastFail = { kind, text };
      record(deps, { op: "push", ok: false, branch: PUBLISH_BRANCH, remote: gt.remoteDisplay, commit: built.commit, lines: [`$ git push ${PUBLISH_REMOTE} ${PUBLISH_BRANCH}`, ...outLines(push)] });
      if (kind !== "non-fast-forward") break;

      // Remote advanced: fetch and look at configuration paths only.
      const fe = await g(deps, ["fetch", PUBLISH_REMOTE, PUBLISH_BRANCH]);
      const newTip = fe.code === 0 ? await resolveTip(deps) : null;
      if (newTip === null || newTip === base) break;
      const df = await g(deps, ["diff", "--name-only", base, newTip, "--", ...CONFIG_PATHSPECS]);
      const changedRemote = df.stdout.split(/\r?\n/).map((s) => s.trim()).filter((s) => s !== "");
      if (df.code !== 0) break;
      if (changedRemote.length > 0) {
        const safeFiles = changedRemote.slice(0, 40).map((f) => scrubText(deps, f));
        return failPublish(
          deps,
          reviewer,
          purpose,
          409,
          "remote-config-changed",
          "GitHub has newer changes to these configuration files. Review them with git pull, then publish again.",
          { files: safeFiles, commit: lastCommit, attemptRef: ATTEMPT_REF },
        );
      }
      base = newTip;
    }

    const msg = `${FAILURE_TEXT[lastFail.kind]}${lastFail.kind === "other" ? " " + scrubText(deps, lastFail.text.trim().split(/\r?\n/)[0] ?? "") : ""}`;
    return failPublish(deps, reviewer, purpose, 502, lastFail.kind, msg.trim(), { commit: lastCommit, attemptRef: ATTEMPT_REF });
  } catch (err) {
    return failPublish(deps, reviewer, purpose, 500, "publish-error", err instanceof Error ? err.message : "Publish failed");
  } finally {
    publishRunning = false;
  }
}

// ---------------------------------------------------------------------------
// GET /api/git/feedback
// ---------------------------------------------------------------------------

async function getGitFeedback(ctx: HandlerContext): Promise<ConsoleResponse> {
  const { deps } = ctx;
  const records = readFeedback(deps.fs);
  return { status: 200, json: { records, lastPublished: lastPublishedOf(deps) } };
}

export const PUBLISH_GROUP: RouteDef[] = [
  { method: "GET", pattern: "/api/publish/status", mutating: false, maxBodyBytes: 0, handler: getPublishStatus },
  { method: "POST", pattern: "/api/publish", mutating: true, maxBodyBytes: PUBLISH_BODY_MAX, handler: postPublish },
  { method: "GET", pattern: "/api/git/feedback", mutating: false, maxBodyBytes: 0, handler: getGitFeedback },
];
