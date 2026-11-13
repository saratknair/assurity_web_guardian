// Scans tracked files for text that narrates project history instead of
// describing current code. Prints "path:line: [kind] match" and exits 1 when
// anything matches. Usage: node scripts/dev/scan-history-comments.mjs

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const PATTERNS = [
  { kind: "requirement-number", re: /\b(?:Reqs?|Requirements?)\s?\d+(?:\.\d+)*\b/i },
  { kind: "requirement-number", re: /\bR\d+(?:\.\d+)*\b/ },
  { kind: "requirement-header", re: /^\s*(?:\/\/|#|\*)\s*(?:Validates|Requirements?):/i },
  { kind: "phase-narration", re: /\bPhase\s?\d+\b|phase-?\d/i },
  { kind: "task-number", re: /\btask\s?\d+(?:\.\d+)*\b|\(task \d+/i },
  {
    kind: "history-word",
    re: /\b(?:retired|previously|formerly|used to|no longer|legacy note|was removed|moved from|originally)\b/i,
  },
  { kind: "stage-name", re: /\b(?:PoC|proof of concept|stage \d|iteration \d|overhaul)\b/i },
  {
    kind: "design-narration",
    re: /\b(?:per the design|see design|spec says|as specified in)\b/i,
  },
  { kind: "non-ascii", re: /[^\x00-\x7F]/ },
];

// Paths that are never scanned: vendored libraries, lock files, binary assets,
// instance data, and this tool with its test (they contain sample matches).
const SKIP_PREFIXES = [
  "dashboard/vendor/",
  "office/vendor/",
  "baselines/",
  "baselines-visual/",
  "tests/generated/",
  ".kiro/specs/",
  "scripts/dev/scan-history-comments.mjs",
  "tests/unit/scan-history-comments.test.ts",
];
const KEEP_PREFIXES = [".kiro/specs/web-guardian/"];
const SKIP_NAMES = new Set(["package-lock.json", "yarn.lock", "pnpm-lock.yaml"]);
const BINARY_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".woff", ".woff2",
  ".ttf", ".zip", ".gz", ".mp4", ".bin",
]);

export function shouldScan(file) {
  const p = file.replace(/\\/g, "/");
  if (KEEP_PREFIXES.some((k) => p.startsWith(k))) return true;
  if (SKIP_PREFIXES.some((s) => p.startsWith(s))) return false;
  const base = p.slice(p.lastIndexOf("/") + 1);
  if (SKIP_NAMES.has(base)) return false;
  if (BINARY_EXT.has(path.extname(base).toLowerCase())) return false;
  return true;
}

// Pure matcher: returns [{ path, line, kind, match }] for one file's text.
export function scanText(file, text) {
  const out = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    for (const { kind, re } of PATTERNS) {
      const m = re.exec(lines[i]);
      if (m) out.push({ path: file, line: i + 1, kind, match: m[0].trim() });
    }
  }
  return out;
}

function listTrackedFiles() {
  const r = spawnSync("git", ["ls-files", "-z"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) {
    throw new Error("git ls-files failed: " + (r.stderr || r.error?.message || "unknown"));
  }
  return r.stdout.split("\0").filter(Boolean);
}

function main() {
  const matches = [];
  for (const file of listTrackedFiles()) {
    if (!shouldScan(file)) continue;
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (text.includes("\0")) continue;
    matches.push(...scanText(file, text));
  }
  for (const m of matches) {
    console.log(`${m.path}:${m.line}: [${m.kind}] ${m.match}`);
  }
  console.log(`${matches.length} match(es)`);
  process.exit(matches.length > 0 ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
