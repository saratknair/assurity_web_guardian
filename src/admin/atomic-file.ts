/**
 * Atomic file writes, path safety, id patterns, and Reviewer name validation for the
 * Management_Console. No clock, no randomness (temp name uses the process id).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,119}$/;
export const CAPTURE_ID_PATTERN = /^cap_[0-9a-f]{12}$/;
export const RUN_ID_PATTERN = /^run_[a-z0-9]{6,40}$/;

/**
 * Write `text` to `path` via `path.tmp-<pid>` then rename. If the file already exists
 * its EOL style (CRLF or LF) and final-newline state are preserved; a BOM is never
 * written.
 */
export function atomicWriteText(path: string, text: string): void {
  let out = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (existsSync(path)) {
    const prev = readFileSync(path, "utf8");
    const crlf = prev.includes("\r\n");
    const finalNl = /\n$/.test(prev);
    out = out.replace(/\r\n/g, "\n");
    if (finalNl) {
      if (!out.endsWith("\n")) out += "\n";
    } else {
      out = out.replace(/\n+$/, "");
    }
    if (crlf) out = out.replace(/\n/g, "\r\n");
  }
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  try {
    writeFileSync(tmp, out, "utf8");
    renameSync(tmp, path);
  } catch (err) {
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      /* ignore cleanup failure */
    }
    throw err;
  }
}

/**
 * Join segments under `root`; throws if any segment is absolute, contains `..`, or the
 * resolved path leaves `root`.
 */
export function resolveInside(root: string, ...segments: string[]): string {
  const base = resolve(root);
  for (const seg of segments) {
    if (typeof seg !== "string" || seg.includes("\0")) throw new Error("Invalid path segment");
    if (isAbsolute(seg) || /^[A-Za-z]:/.test(seg) || /^[\\/]/.test(seg)) {
      throw new Error("Absolute path segment rejected");
    }
    if (seg.split(/[\\/]+/).includes("..")) throw new Error("Path traversal rejected");
  }
  const full = resolve(base, ...segments);
  const rel = relative(base, full);
  if (rel === ".." || rel.startsWith(".." + "\\") || rel.startsWith("../") || isAbsolute(rel)) {
    throw new Error("Path escapes root");
  }
  return full;
}

export type ReviewerNameResult = { ok: true; name: string } | { ok: false; reason: string };

/** Trim, 1..80 characters, no control characters, none of / \ : < > | */
export function validateReviewerName(input: unknown): ReviewerNameResult {
  const name = typeof input === "string" ? input.trim() : "";
  if (name.length === 0) return { ok: false, reason: "Reviewer name is missing" };
  if (name.length > 80) return { ok: false, reason: "Reviewer name must be 80 characters or fewer" };
  if (/[\u0000-\u001F\u007F]/.test(name) || /[\/\\:<>|]/.test(name)) {
    return { ok: false, reason: "Reviewer name contains characters that are not allowed" };
  }
  return { ok: true, name };
}
