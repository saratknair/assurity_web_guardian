// Copies the product (code, docs, example config) out of an instance repo into a
// fresh directory, ready for `git init`. Only tracked files are considered, so
// untracked leftovers cannot leak. Instance data and real config never copy.
//
// Usage: node scripts/dev/export-product.mjs <target-dir> [--dry-run]
//   --dry-run   print the plan and the name-rule result; write nothing.
//
// Exit codes: 0 ok, 1 refused or failed a safety check, 2 bad usage.

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Files at the repository root that belong to the product.
const ROOT_FILES = new Set([
  ".gitattributes",
  ".gitignore",
  ".nvmrc",
  "CONTRIBUTING.md",
  "LICENSE",
  "README.md",
  "SECURITY.md",
  "package-lock.json",
  "package.json",
  "playwright.config.ts",
  "tsconfig.json",
  "vitest.config.ts",
]);

// Directories copied whole (prefix match on the posix-style relative path).
const ALLOWED_PREFIXES = [
  ".github/",
  ".kiro/specs/web-guardian/",
  "admin-ui/",
  "dashboard/",
  "docs/",
  "office/",
  "scripts/",
  "src/",
  "tests/fixtures/",
  "tests/helpers/",
  "tests/property/",
  "tests/unit/",
];

// Never exported, even when a path also matches the allowlist.
const DENIED_PREFIXES = [
  ".kiro/specs/project-consolidation/",
  "_site/",
  "artifacts/",
  "baselines-visual/",
  "baselines/",
  "checkpoints/",
  "config/scope/",
  "dist/",
  "node_modules/",
  "test-results/",
  "tests/generated/",
  "tests/instance/",
  "virtual-office-src/",
];

const DENIED_FILES = new Set(["config/app.config.json", "config/page-seed.json", "config/schedule.json"]);

// Gitignore written into the export in place of the instance one.
const PRODUCT_GITIGNORE = `# Web Guardian
#
# Keeps tokens, keys, credentials and local environment files out of the
# repository. Values the workflow needs are supplied as GitHub Actions
# encrypted secrets, never as committed files.
#
# Your own config/ files and baselines/ are meant to be committed: the
# workflow reads them from the repository.

# Secrets and environment
.env
.env.*
!.env.example
*.env
*.secret
secrets.*
*.secrets
credentials
credentials.*
*.credentials
auth.json
*.pem
*.key
*.p12
*.pfx
*.cert
*.crt
*.der
*.keystore
*.jks
id_rsa
id_rsa.*
id_ed25519
id_ed25519.*
.npmrc
.netrc
.aws/
.gcloud/
*.gpg
*.asc

# Dependencies and build output
node_modules/
dist/

# Raw run output (published to the runs-data branch by the workflow)
artifacts/

# Workflow staging and test output
_site/
test-results/
playwright-report/
.playwright/
playwright/.cache/
.vitest/
coverage/

# Logs
logs/
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*

# Editor and OS files
.vscode/*
!.vscode/extensions.json
.idea/
.DS_Store
Thumbs.db
*.sw?
*.local
`;

// Built from pieces so this file does not trip its own name rule.
const NAME_RULE = new RegExp([["assur", "ity"].join(""), ["sarat", "knair"].join(""), ["na", "irs"].join("")].join("|"), "i");

const GITIGNORE_PATH = ".gitignore";

function toPosix(p) {
  return p.split("\\").join("/");
}

/** True when a repo-relative path is a dispositions log, wherever it lives. */
function isDispositionsFile(rel) {
  return /^dispositions[^/]*$/i.test(rel.split("/").pop() ?? "");
}

/** True when the path matches a denylist rule. */
export function isDeniedPath(rel) {
  const p = toPosix(rel);
  if (DENIED_FILES.has(p)) return true;
  if (DENIED_PREFIXES.some((d) => p.startsWith(d))) return true;
  if (isDispositionsFile(p)) return true;
  // Any config/domains file that is not an example, and any other real config at config/ top level.
  if (p.startsWith("config/domains/")) return !/^config\/domains\/[^/]+\.example\.json$/.test(p);
  if (p.startsWith("config/")) return !/^config\/[^/]+\.example\.json$/.test(p);
  return false;
}

/** True when the path is on the allowlist and not denied. */
export function isAllowedPath(rel) {
  const p = toPosix(rel);
  if (p === "" || p.startsWith("/") || p.split("/").includes("..")) return false;
  if (isDeniedPath(p)) return false;
  if (ROOT_FILES.has(p)) return true;
  if (/^config\/(domains\/)?[^/]+\.example\.json$/.test(p)) return true;
  return ALLOWED_PREFIXES.some((a) => p.startsWith(a));
}

/** Splits a tracked-file list into files to copy, denied files and files simply not on the allowlist. */
export function planExport(files) {
  const copy = [];
  const denied = [];
  const unlisted = [];
  for (const f of files.map(toPosix)) {
    if (isAllowedPath(f)) copy.push(f);
    else if (isDeniedPath(f)) denied.push(f);
    else unlisted.push(f);
  }
  return { copy: copy.sort(), denied: denied.sort(), unlisted: unlisted.sort() };
}

function norm(p) {
  const r = path.resolve(p);
  return process.platform === "win32" ? r.toLowerCase() : r;
}

/** Validates the target directory. Returns { ok: true } or { ok: false, reason }. */
export function checkTarget(target, repoRoot) {
  if (!target) return { ok: false, reason: "No target directory given." };
  const t = path.resolve(target);
  if (path.parse(t).root === t) return { ok: false, reason: "Target is a filesystem root." };
  const rel = path.relative(norm(repoRoot), norm(t));
  if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
    return { ok: false, reason: "Target is inside the repository." };
  }
  if (existsSync(t)) {
    if (!statSync(t).isDirectory()) return { ok: false, reason: "Target exists and is not a directory." };
    if (readdirSync(t).length > 0) return { ok: false, reason: "Target is not empty." };
  }
  return { ok: true };
}

function walk(dir, base = dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git" && dir === base) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, base, out);
    else out.push(toPosix(path.relative(base, full)));
  }
  return out;
}

function isBinary(buf) {
  return buf.subarray(0, 8000).includes(0);
}

/** Returns the files (relative paths) in `dir` whose text matches the name rule. */
export function findNameHits(dir, relFiles) {
  const hits = [];
  for (const rel of relFiles) {
    const buf = readFileSync(path.join(dir, rel));
    if (isBinary(buf)) continue;
    if (NAME_RULE.test(buf.toString("utf8"))) hits.push(rel);
  }
  return hits.sort();
}

/** Checks a finished export: nothing outside the allowlist, nothing denied, no name-rule hits. */
export function verifyTarget(target) {
  const files = walk(target);
  const problems = [];
  for (const f of files) {
    if (isDeniedPath(f)) problems.push(`denied path present: ${f}`);
    else if (!isAllowedPath(f)) problems.push(`not on the allowlist: ${f}`);
  }
  for (const f of findNameHits(target, files)) problems.push(`name rule hit: ${f}`);
  return { files, problems: problems.sort() };
}

/** Lists tracked files with git. */
export function listTracked(repoRoot) {
  const out = execFileSync("git", ["ls-files", "-z"], { cwd: repoRoot, maxBuffer: 256 * 1024 * 1024 });
  return out.toString("utf8").split("\0").filter(Boolean);
}

function topLevelSummary(files) {
  const counts = new Map();
  for (const f of files) {
    const top = f.includes("/") ? `${f.split("/")[0]}/` : "(root files)";
    counts.set(top, (counts.get(top) ?? 0) + 1);
  }
  return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
}

/**
 * Runs the export. `files` is the tracked-file list. Returns { ok, plan, problems, written }.
 * With dryRun nothing is written; name hits are computed from the source files instead.
 */
export function runExport({ repoRoot, target, files, dryRun = false }) {
  const plan = planExport(files);
  if (dryRun) {
    const hits = findNameHits(repoRoot, plan.copy.filter((f) => f !== GITIGNORE_PATH));
    return { ok: hits.length === 0, plan, problems: hits.map((f) => `name rule hit: ${f}`), written: 0 };
  }

  const t = checkTarget(target, repoRoot);
  if (!t.ok) return { ok: false, plan, problems: [t.reason], written: 0 };

  mkdirSync(target, { recursive: true });
  for (const rel of plan.copy) {
    const dest = path.join(target, rel);
    mkdirSync(path.dirname(dest), { recursive: true });
    copyFileSync(path.join(repoRoot, rel), dest);
  }
  writeFileSync(path.join(target, GITIGNORE_PATH), PRODUCT_GITIGNORE);

  const { problems } = verifyTarget(target);
  return { ok: problems.length === 0, plan, problems, written: plan.copy.length };
}

function main(argv) {
  const args = argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const positional = args.filter((a) => !a.startsWith("--"));
  const unknown = args.filter((a) => a.startsWith("--") && a !== "--dry-run");
  if (unknown.length > 0 || positional.length > 1 || (!dryRun && positional.length !== 1)) {
    console.error("Usage: node scripts/dev/export-product.mjs <target-dir> [--dry-run]");
    return 2;
  }

  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const target = positional[0] ? path.resolve(positional[0]) : undefined;
  if (target) {
    const t = checkTarget(target, repoRoot);
    if (!t.ok) {
      console.error(`Refused: ${t.reason} (${target})`);
      return 1;
    }
  }

  const result = runExport({ repoRoot, target, files: listTracked(repoRoot), dryRun });
  console.log(`${dryRun ? "Plan" : "Exported"}: ${result.plan.copy.length} files to copy, ${result.plan.denied.length} denied, ${result.plan.unlisted.length} not on the allowlist.`);
  for (const [top, n] of topLevelSummary(result.plan.copy)) console.log(`  ${top} ${n}`);

  if (!result.ok) {
    console.error(dryRun ? "Name rule hits in the files to copy:" : `Export FAILED safety checks. The target was left in place for inspection: ${target}`);
    for (const p of result.problems) console.error(`  ${p}`);
    return 1;
  }
  console.log(dryRun ? "Dry run clean. Nothing written." : `Done: ${target}`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv);
}
