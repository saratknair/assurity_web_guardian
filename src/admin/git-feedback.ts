/**
 * Git_Feedback records (design J.8.6, Requirements 26.10, 30.1, 30.2, 30.9). Keeps the
 * last 50 records in artifacts/admin/git-feedback.json, written atomically. Every text
 * line passes through scrubForDisplay, so no secret and no local absolute path is kept.
 */
import type { ProjectFs } from "./console-deps.js";
import { scrubForDisplay } from "./scrub.js";

export const GIT_FEEDBACK_PATH = "artifacts/admin/git-feedback.json";
export const MAX_FEEDBACK_RECORDS = 50;
export const MAX_FEEDBACK_LINES = 40;
const MAX_FILES = 40;

export type GitFeedbackOp = "status" | "fetch" | "commit" | "push" | "align-local";

export interface GitFeedbackRecord {
  id: string;
  at: string;
  op: GitFeedbackOp;
  ok: boolean;
  branch: string;
  remote: string;
  lines: string[];
  files?: string[];
  commit?: string;
  pushedAt?: string;
}

export interface LastPublished {
  sha: string;
  pushedAt: string;
  branch: string;
  remote: string;
  purpose: "publish" | "trigger";
}

export interface GitFeedbackInput {
  op: GitFeedbackOp;
  ok: boolean;
  branch: string;
  remote: string;
  lines: string[];
  files?: string[];
  commit?: string;
  pushedAt?: string;
}

export interface FeedbackScrubContext {
  projectRoot?: string;
  home?: string;
}

/** "https://user:pw@github.com/owner/repo.git" or "git@github.com:owner/repo.git" -> "github.com/owner/repo". */
export function normalizeRemote(url: string): string {
  let s = typeof url === "string" ? url.trim() : "";
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  s = s.replace(/^[^\/]*@/, "");
  s = s.replace(/^([^\/:]+):(?!\d+\/)/, "$1/");
  s = s.replace(/\.git\/?$/i, "").replace(/\/+$/, "");
  return s;
}

/**
 * Short display name for a remote: "owner/repo" for GitHub, otherwise "host/path".
 * Credentials never appear. Null when there is no usable remote.
 */
export function remoteDisplayName(url: string | null | undefined): string | null {
  const n = normalizeRemote(typeof url === "string" ? url : "");
  if (n === "") return null;
  return n.replace(/^github\.com\//i, "");
}

/**
 * GitHub Pages address for an origin remote: github.com/<owner>/<repo> -> https://<owner>.github.io/<repo>/.
 * Null when the remote is not a GitHub remote. Credentials never appear in the result.
 */
export function pagesUrlFromRemote(url: string): string | null {
  const m = /^github\.com\/([A-Za-z0-9_.-]{1,100})\/([A-Za-z0-9_.-]{1,100})$/i.exec(normalizeRemote(url));
  if (!m) return null;
  const owner = m[1].toLowerCase();
  const repo = m[2];
  if (repo.toLowerCase() === owner + ".github.io") return `https://${owner}.github.io/`;
  return `https://${owner}.github.io/${repo}/`;
}

function cleanLines(lines: string[], ctx: FeedbackScrubContext): string[] {
  const out: string[] = [];
  for (const raw of lines) {
    for (const part of String(raw).split(/\r?\n/)) {
      out.push(scrubForDisplay(part, ctx));
    }
  }
  return out.slice(0, MAX_FEEDBACK_LINES);
}

/** Pure: builds one scrubbed record. `seq` makes the id unique within a millisecond. */
export function buildFeedbackRecord(
  input: GitFeedbackInput,
  now: Date,
  seq = 0,
  ctx: FeedbackScrubContext = {},
): GitFeedbackRecord {
  const at = now.toISOString();
  const rec: GitFeedbackRecord = {
    id: `gf_${at.replace(/[^0-9]/g, "")}_${seq}`,
    at,
    op: input.op,
    ok: input.ok === true,
    branch: scrubForDisplay(input.branch ?? "", ctx),
    remote: scrubForDisplay(normalizeRemote(input.remote ?? ""), ctx),
    lines: cleanLines(input.lines ?? [], ctx),
  };
  if (Array.isArray(input.files)) {
    rec.files = input.files.slice(0, MAX_FILES).map((f) => scrubForDisplay(String(f), ctx));
  }
  if (typeof input.commit === "string" && /^[0-9a-f]{40}$/.test(input.commit)) rec.commit = input.commit;
  if (typeof input.pushedAt === "string") rec.pushedAt = input.pushedAt;
  return rec;
}

/** Reads the stored records; a missing or damaged file yields an empty list. */
export function readFeedback(fs: ProjectFs): GitFeedbackRecord[] {
  try {
    if (!fs.exists(GIT_FEEDBACK_PATH)) return [];
    const parsed: unknown = JSON.parse(fs.readText(GIT_FEEDBACK_PATH));
    const list = Array.isArray(parsed) ? parsed : (parsed as { records?: unknown })?.records;
    if (!Array.isArray(list)) return [];
    return list.filter((r): r is GitFeedbackRecord => !!r && typeof r === "object" && typeof (r as GitFeedbackRecord).id === "string");
  } catch {
    return [];
  }
}

/** Appends a scrubbed record, keeps the last 50, writes atomically, returns the record. */
export function appendFeedback(
  fs: ProjectFs,
  input: GitFeedbackInput,
  now: Date,
  ctx: FeedbackScrubContext = {},
): GitFeedbackRecord {
  const existing = readFeedback(fs);
  const rec = buildFeedbackRecord(input, now, existing.length, ctx);
  const next = [...existing, rec].slice(-MAX_FEEDBACK_RECORDS);
  fs.writeText(GIT_FEEDBACK_PATH, JSON.stringify(next, null, 2) + "\n");
  return rec;
}
