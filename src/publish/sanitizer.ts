import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join, dirname, basename } from "node:path";
import { redact } from "../safety/redactor.js";

/**
 * Publish-time sanitizer (Requirement 8). Produces Pages-safe copies of a run's
 * publishable JSON files with secrets/PII redacted and absolute/internal
 * filesystem paths stripped. Fail-closed: any file that cannot be confirmed
 * clean is withheld (never written) and recorded with a reason.
 *
 * - `sanitizeJson` / `stripPaths` are PURE and TOTAL (deep-clone, no mutation
 *   of input) so they are property-testable (Properties 15 and 16).
 * - Reuses `../safety/redactor.ts` for secret/token/PII removal (8.1).
 */

/** Outcome of sanitizing a run directory. */
export interface SanitizeReport {
  /** True iff every candidate file was confirmed clean and written. */
  ok: boolean;
  /** Output-relative names of files that could not be confirmed clean. */
  withheld: string[];
  /** Per-withheld-file reason, keyed by the same name used in `withheld`. */
  reasons: Record<string, string>;
}

const PATH_REMOVED = "[path removed]";

/**
 * Absolute / internal filesystem path patterns (Requirement 8.2).
 * Order matters: UNC before drive-letter, longest/most-specific first.
 * All are global so every occurrence in a string is scrubbed.
 */
const ABSOLUTE_PATH_PATTERNS: RegExp[] = [
  // UNC path: \\host\share\... (double backslash prefix)
  /\\\\[^\s"'\\/][^\s"']*/g,
  // Windows drive path with backslashes: C:\Users\... (one or more segments)
  /[A-Za-z]:\\[^\s"']*/g,
  // Windows drive path with forward slashes: C:/Users/...
  /[A-Za-z]:\/[^\s"']*/g,
  // POSIX internal home paths: /Users/... or /home/...
  /\/(?:Users|home)\/[^\s"']*/g,
];

function stripPathsFromString(s: string): string {
  let out = s;
  for (const re of ABSOLUTE_PATH_PATTERNS) {
    out = out.replace(re, PATH_REMOVED);
  }
  return out;
}

/**
 * Deep-clone `value`, replacing any absolute, UNC, or internal filesystem path
 * found inside string values/keys with `[path removed]`. Already-relative paths
 * (e.g. `tests/generated/x.spec.ts`, `screenshots/foo.png`) are left intact.
 *
 * Pure: never mutates the input. Total: defined for every JSON-shaped value.
 */
export function stripPaths(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return stripPathsFromString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((v) => stripPaths(v));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      // Keys can themselves embed absolute paths; scrub them too.
      out[stripPathsFromString(k)] = stripPaths(v);
    }
    return out;
  }
  return value;
}

/**
 * Deep-clone `value` with secrets/tokens/PII redacted (reusing the shared
 * redactor) AND absolute/internal filesystem paths stripped. Defense-in-depth:
 * the two scrubbers are composed so published JSON leaks neither secrets nor
 * host paths.
 *
 * Pure: never mutates the input. Total: defined for every JSON-shaped value.
 */
export function sanitizeJson(value: unknown): unknown {
  // `redact` deep-clones and returns a fresh structure; `stripPaths` clones
  // again, so the original input is never touched.
  return stripPaths(redact(value));
}

/** Residual absolute-path detector used for the fail-closed re-scan. */
const ABSOLUTE_PATH_SCAN = new RegExp(
  ABSOLUTE_PATH_PATTERNS.map((re) => re.source).join("|"),
);

/**
 * Re-scan a sanitized structure for any residual absolute/internal path. The
 * `[path removed]` and `[REDACTED]` placeholders contain no path pattern, so a
 * hit here means scrubbing was incomplete and the file must be withheld.
 */
function hasResidualPath(value: unknown): boolean {
  if (typeof value === "string") return ABSOLUTE_PATH_SCAN.test(value);
  if (Array.isArray(value)) return value.some((v) => hasResidualPath(v));
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (ABSOLUTE_PATH_SCAN.test(k)) return true;
      if (hasResidualPath(v)) return true;
    }
  }
  return false;
}

/** Candidate JSON files that may be published, relative to the run dir. */
const JSON_CANDIDATES = [
  "findings.json",
  "results.json",
  "test-manifest.json",
  "a11y-history-summary.json",
];

/** JSONL files published as a parsed `.json` array under the same base name. */
const JSONL_CANDIDATES = [{ src: "events.jsonl", out: "events.json" }];

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function writeSanitizedJson(outPath: string, data: unknown): void {
  ensureDir(dirname(outPath));
  writeFileSync(outPath, JSON.stringify(data, null, 2), "utf8");
}

/**
 * Sanitize a run's publishable files into `outDir`, mirroring structure.
 *
 * Published: parsed `events.jsonl` (line-by-line) plus `findings.json`,
 * `results.json`, `test-manifest.json`, and `a11y-history-summary.json` when
 * present. Each is run through `sanitizeJson`, then re-scanned; a clean result
 * is written to `outDir`.
 *
 * Excluded (never copied): `traces/`, raw console logs, and otel dumps
 * (Requirement 8.3). Screenshot images are copied by the publisher (task 9.7)
 * after their metadata passes; this function only sanitizes JSON/metadata and
 * exposes `sanitizeScreenshotName` for filename scrubbing.
 *
 * Fail-closed (Requirement 8.5): if a file's sanitization throws, or a
 * disallowed path pattern remains after scrubbing on the re-scan, that file is
 * WITHHELD (not written) and recorded in `withheld` with a `reasons[name]`
 * entry. Other files still publish. `ok` is true iff nothing was withheld.
 */
export function sanitizeRun(runDir: string, outDir: string): SanitizeReport {
  const report: SanitizeReport = { ok: true, withheld: [], reasons: {} };

  const withhold = (name: string, reason: string): void => {
    report.ok = false;
    if (!report.withheld.includes(name)) report.withheld.push(name);
    report.reasons[name] = reason;
  };

  ensureDir(outDir);

  // Plain JSON candidates.
  for (const name of JSON_CANDIDATES) {
    const src = join(runDir, name);
    if (!existsSync(src)) continue;
    try {
      const parsed = JSON.parse(readFileSync(src, "utf8"));
      const clean = sanitizeJson(parsed);
      if (hasResidualPath(clean)) {
        withhold(name, "residual absolute/internal path after scrubbing");
        continue;
      }
      writeSanitizedJson(join(outDir, name), clean);
    } catch (err) {
      withhold(name, `sanitize failed: ${(err as Error).message}`);
    }
  }

  // JSONL candidates -> parsed array published under the `.json` name.
  for (const { src: srcName, out: outName } of JSONL_CANDIDATES) {
    const src = join(runDir, srcName);
    if (!existsSync(src)) continue;
    try {
      const lines = readFileSync(src, "utf8")
        .split(/\r?\n/)
        .filter((l) => l.trim().length > 0);
      const events = lines.map((l, i) => {
        try {
          return JSON.parse(l);
        } catch (e) {
          throw new Error(`line ${i + 1}: ${(e as Error).message}`);
        }
      });
      const clean = sanitizeJson(events);
      if (hasResidualPath(clean)) {
        withhold(outName, "residual absolute/internal path after scrubbing");
        continue;
      }
      writeSanitizedJson(join(outDir, outName), clean);
    } catch (err) {
      withhold(outName, `sanitize failed: ${(err as Error).message}`);
    }
  }

  return report;
}

/**
 * Screenshot filename scrubber (Requirement 8.4). The publisher copies images
 * under this sanitized base name after metadata passes. Strips any directory
 * component (so an absolute source path never leaks into the published name)
 * and removes residual path patterns from the bare filename.
 */
export function sanitizeScreenshotName(fileName: string): string {
  const bare = basename(fileName);
  return stripPathsFromString(bare);
}

/**
 * List the screenshot files in a run directory (bare names). Image bytes are
 * copied by the publisher; this helper only surfaces the candidates so the
 * publisher can apply `sanitizeScreenshotName` per file.
 */
export function listRunScreenshots(runDir: string): string[] {
  const dir = join(runDir, "screenshots");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /\.(png|jpe?g|gif|webp)$/i.test(f));
}
