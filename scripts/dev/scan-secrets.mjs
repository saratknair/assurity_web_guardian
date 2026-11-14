// Dependency-free secret and personal-data scan over tracked files.
// Prints "path:line: [kind] redacted-match" and exits 1 when any finding is
// not covered by scripts/dev/secret-scan.allow.json. Matches are truncated so
// a full secret is never printed. Usage: node scripts/dev/scan-secrets.mjs

import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const PATTERNS = [
  { kind: "github-token", re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { kind: "github-token", re: /\bgithub_pat_[A-Za-z0-9_]{50,}\b/ },
  { kind: "aws-key-id", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { kind: "private-key", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY/ },
  { kind: "slack-token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
  { kind: "jwt", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  {
    kind: "generic-assignment",
    re: /(api[_-]?key|secret|token|passwd|password)\s*[:=]\s*["'][^"']{12,}["']/i,
  },
  { kind: "personal-path", re: /C:\\Users\\/ },
  { kind: "personal-path", re: /\/Users\/[a-z]/ },
  { kind: "personal-path", re: /\/home\/[a-z]/ },
  // The domain must end in a letters-only TLD, so "name@4.4.6" package specifiers do not match.
  { kind: "email", re: /[\w.+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/ },
  { kind: "name", re: /assu[r]ity|sarat[k]nair|nai[r]s/i, productOnly: true },
];

// Never scanned: dependencies, vendored libraries, lock files, binary assets.
const SKIP_PREFIXES = ["node_modules/", ".git/", "dashboard/vendor/", "office/vendor/"];
// Transient planning specs are excluded from the export; only the consolidated
// spec ships and is scanned.
const SPEC_PREFIX = ".kiro/specs/";
const KEEP_SPEC_PREFIX = ".kiro/specs/web-guardian/";
const SKIP_NAMES = new Set(["package-lock.json", "yarn.lock", "pnpm-lock.yaml"]);
const BINARY_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".woff", ".woff2",
  ".ttf", ".zip", ".gz", ".mp4", ".bin",
]);

// Site-specific data legitimately names the monitored site, so the name rule
// does not apply there. Every other rule still does.
const INSTANCE_PREFIXES = ["baselines/", "baselines-visual/", "tests/generated/", "tests/instance/"];

export function shouldScan(file) {
  const p = file.replace(/\\/g, "/");
  if (SKIP_PREFIXES.some((s) => p.startsWith(s) || p.includes("/" + s))) return false;
  if (p.startsWith(SPEC_PREFIX) && !p.startsWith(KEEP_SPEC_PREFIX)) return false;
  const base = p.slice(p.lastIndexOf("/") + 1);
  if (SKIP_NAMES.has(base)) return false;
  if (BINARY_EXT.has(path.extname(base).toLowerCase())) return false;
  return true;
}

export function isInstancePath(file) {
  const p = file.replace(/\\/g, "/");
  if (p.startsWith("config/") && !p.includes(".example.")) return true;
  return INSTANCE_PREFIXES.some((s) => p.startsWith(s));
}

// Keeps a short prefix and the length so a finding is identifiable but never
// reproduced in full.
export function redact(match) {
  const s = match.trim();
  if (s.length <= 6) return s.slice(0, 2) + "...(" + s.length + ")";
  return s.slice(0, 4) + "...(" + s.length + ")";
}

// Allowlist entry: { path, kind?, contains?, reason }. A path ending in "/"
// matches a directory prefix; otherwise it must equal the file path.
export function entryMatches(entry, finding, lineText) {
  const p = finding.path.replace(/\\/g, "/");
  const pathOk = entry.path.endsWith("/") ? p.startsWith(entry.path) : p === entry.path;
  if (!pathOk) return false;
  if (entry.kind && entry.kind !== finding.kind) return false;
  if (entry.contains && !lineText.includes(entry.contains)) return false;
  return true;
}

export function loadAllowlist(file) {
  if (!existsSync(file)) return [];
  const data = JSON.parse(readFileSync(file, "utf8"));
  const entries = Array.isArray(data) ? data : data.entries;
  for (const e of entries) {
    if (!e.path || !e.reason) throw new Error("allowlist entry needs path and reason: " + JSON.stringify(e));
  }
  return entries;
}

// Pure matcher: returns [{ path, line, kind, match }] for one file's text.
// `allow` entries suppress findings; `used` (optional Set) records which
// entries matched.
export function scanText(file, text, allow = [], used = null) {
  const out = [];
  const instance = isInstancePath(file);
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    for (const { kind, re, productOnly } of PATTERNS) {
      if (productOnly && instance) continue;
      const m = re.exec(lines[i]);
      if (!m) continue;
      const finding = { path: file, line: i + 1, kind, match: redact(m[0]) };
      const hit = allow.find((e) => entryMatches(e, finding, lines[i]));
      if (hit) {
        used?.add(hit);
        continue;
      }
      out.push(finding);
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
  const here = path.dirname(fileURLToPath(import.meta.url));
  const allow = loadAllowlist(path.join(here, "secret-scan.allow.json"));
  const used = new Set();
  const findings = [];
  for (const file of listTrackedFiles()) {
    if (!shouldScan(file)) continue;
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (text.includes("\0")) continue;
    findings.push(...scanText(file, text, allow, used));
  }
  for (const f of findings) console.log(`${f.path}:${f.line}: [${f.kind}] ${f.match}`);
  const stale = allow.filter((e) => !used.has(e));
  for (const e of stale) console.log(`stale allowlist entry: ${e.path} (${e.reason})`);
  console.log(`${findings.length} finding(s), ${stale.length} stale allowlist entr${stale.length === 1 ? "y" : "ies"}`);
  process.exit(findings.length > 0 || stale.length > 0 ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
