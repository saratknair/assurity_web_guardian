/**
 * scrubForDisplay: applied to every string that originates outside the console's own
 * code (child output, git output, run logs, error messages) before it is returned.
 * Pure and idempotent.
 */
import { redact } from "../safety/redactor.js";
import { stripPaths } from "../publish/sanitizer.js";

export interface ScrubContext {
  projectRoot?: string;
  home?: string;
}

const MAX_LINE = 2000;

const CREDENTIAL_URL = /(https?:\/\/)[^\s/@:]+(?::[^\s/@]*)?@/gi;
const TOKEN_SHAPES: RegExp[] = [
  /\bgithub_pat_[A-Za-z0-9_]+/g,
  /\bgh[pousr]_[A-Za-z0-9]+/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+\/=-]+/gi,
];
const SHA40 = /\b[0-9a-f]{40}\b/g;
// Other absolute POSIX paths under well-known roots (stripPaths covers /Users and /home).
const POSIX_ROOTS =
  /(?<![A-Za-z0-9_.\/:-])\/(?:etc|var|tmp|usr|opt|root|mnt|srv|proc|bin|sbin|dev|private|Library|Volumes|snap)(?:\/[^\s"']*)?/g;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceRoot(text: string, root: string | undefined, label: string): string {
  if (typeof root !== "string") return text;
  const trimmed = root.replace(/[\\/]+$/, "");
  if (trimmed.length < 2) return text;
  const pattern = trimmed
    .split(/[\\/]+/)
    .map(escapeRe)
    .join("[\\\\/]+");
  return text.replace(new RegExp(pattern + "(?![A-Za-z0-9_-])", "gi"), label);
}

export function scrubForDisplay(text: string, ctx: ScrubContext = {}): string {
  let s = typeof text === "string" ? text : "";

  // Drop control characters other than newline and tab (first, so markers below are safe).
  s = s.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "");

  // 1. Credential URLs.
  s = s.replace(CREDENTIAL_URL, "$1***@");
  // 2. Token shapes.
  for (const re of TOKEN_SHAPES) s = s.replace(re, "[secret removed]");

  // Protect 40-hex commit SHAs from the redactor.
  const shas: string[] = [];
  s = s.replace(SHA40, (m) => {
    shas.push(m);
    return `\u0001${shas.length - 1}\u0001`;
  });

  // 3. Project root, home, then any other absolute path.
  s = replaceRoot(s, ctx.projectRoot, "<project>");
  s = replaceRoot(s, ctx.home, "<home>");
  s = stripPaths(s) as string;
  s = s.replace(POSIX_ROOTS, "[path removed]");

  // 4. Existing redactor.
  s = redact(s);

  // Restore SHAs.
  s = s.replace(/\u0001(\d+)\u0001/g, (_m, i: string) => shas[Number(i)] ?? "");

  // 6. Cap each line.
  return s
    .split("\n")
    .map((line) => (line.length > MAX_LINE ? line.slice(0, MAX_LINE) : line))
    .join("\n");
}
