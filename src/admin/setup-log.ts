/**
 * Setup_Activity_Log (design J.7, Requirement 25): an append-only, ASCII-only JSONL record of
 * setup actions at artifacts/admin/setup-activity.jsonl. Local only. It is never read by the
 * Publisher or the Virtual Office and never goes through TelemetryEmitter.
 * Exports append and read only: no edit, truncate, or delete exists. No AI, no network.
 */
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolveInside } from "./atomic-file.js";
import { scrubForDisplay } from "./scrub.js";

export const SETUP_LOG_REL = "artifacts/admin/setup-activity.jsonl";
export const SETUP_LOG_DEFAULT_LIMIT = 100;
export const SETUP_LOG_MAX_LIMIT = 500;
const SUMMARY_MAX = 300;

export type SetupAction =
  | "domain-draft-started" | "domain-draft-cancelled" | "domain-draft-discarded" | "domain-changed"
  | "urls-added" | "url-removed" | "url-edited" | "project-updated"
  | "discovery-run" | "candidates-approved"
  | "spec-drafts-produced" | "visual-captured" | "baselines-approved" | "baselines-adopted-from-cloud"
  | "schedule-changed" | "publish" | "publish-failed";

export interface SetupEntry {
  schemaVersion: 1;
  id: string;
  at: string;
  reviewer: string;
  action: SetupAction;
  summary: string;
  counts: { [k: string]: number };
  detail: { [k: string]: string };
}

export interface SetupEntryInput {
  /** ISO-8601 UTC from the server clock. */
  at: string;
  reviewer: string;
  action: SetupAction;
  summary: string;
  counts?: { [k: string]: number };
  detail?: { [k: string]: string };
}

/** Replace every control character and code unit above 0x7E with \uXXXX (surrogate halves included). */
export function asciiEscape(line: string): string {
  let out = "";
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    out += c < 0x20 || c > 0x7e ? "\\u" + c.toString(16).padStart(4, "0") : line[i];
  }
  return out;
}

export function setupEntryId(at: string, action: string, reviewer: string, summary: string): string {
  return "sal_" + createHash("sha256").update(at + action + reviewer + summary).digest("hex").slice(0, 12);
}

export function buildSetupEntry(input: SetupEntryInput): SetupEntry {
  const reviewer = scrubForDisplay(input.reviewer).trim();
  const summary = scrubForDisplay(input.summary).slice(0, SUMMARY_MAX);
  const counts: { [k: string]: number } = {};
  for (const [k, v] of Object.entries(input.counts ?? {})) {
    if (typeof v === "number" && Number.isFinite(v)) counts[k] = v;
  }
  const detail: { [k: string]: string } = {};
  for (const [k, v] of Object.entries(input.detail ?? {})) {
    if (typeof v === "string") detail[k] = scrubForDisplay(v);
  }
  return {
    schemaVersion: 1,
    id: setupEntryId(input.at, input.action, reviewer, summary),
    at: input.at,
    reviewer,
    action: input.action,
    summary,
    counts,
    detail,
  };
}

/** Append one entry as a single ASCII line. Earlier bytes are never touched. */
export function appendSetupEntry(root: string, input: SetupEntryInput): SetupEntry {
  const entry = buildSetupEntry(input);
  const file = resolveInside(root, ...SETUP_LOG_REL.split("/"));
  mkdirSync(resolveInside(root, "artifacts", "admin"), { recursive: true });
  appendFileSync(file, asciiEscape(JSON.stringify(entry)) + "\n", { flag: "a", encoding: "utf8" });
  return entry;
}

export interface SetupLogPage {
  entries: SetupEntry[];
  skippedLines: number;
}

function isEntry(v: unknown): v is SetupEntry {
  if (v === null || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.id === "string" && typeof o.at === "string" && typeof o.action === "string" &&
    typeof o.reviewer === "string" && typeof o.summary === "string";
}

/** Parse log text into entries newest first. `before` keeps only entries with `at` earlier than it. */
export function parseSetupLog(text: string, opts: { limit?: number; before?: string } = {}): SetupLogPage {
  const limit = Math.max(1, Math.min(SETUP_LOG_MAX_LIMIT, Math.floor(opts.limit ?? SETUP_LOG_DEFAULT_LIMIT) || SETUP_LOG_DEFAULT_LIMIT));
  const parsed: SetupEntry[] = [];
  let skippedLines = 0;
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const v: unknown = JSON.parse(line);
      if (isEntry(v)) parsed.push(v);
      else skippedLines++;
    } catch {
      skippedLines++;
    }
  }
  // Reverse file order (append order) so ties on `at` still show newest first.
  let entries = parsed.reverse();
  const before = opts.before;
  if (typeof before === "string" && before !== "") entries = entries.filter((e) => e.at < before);
  return { entries: entries.slice(0, limit), skippedLines };
}

export function readSetupEntries(root: string, opts: { limit?: number; before?: string } = {}): SetupLogPage {
  const file = resolveInside(root, ...SETUP_LOG_REL.split("/"));
  if (!existsSync(file)) return { entries: [], skippedLines: 0 };
  return parseSetupLog(readFileSync(file, "utf8"), opts);
}
