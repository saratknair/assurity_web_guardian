// Lists the SHA-256 of every vendored library file and, with --check,
// compares them with the table in docs/VENDORED.md.
//
//   node scripts/dev/hash-vendored.mjs           print a markdown table
//   node scripts/dev/hash-vendored.mjs --check   exit 1 on mismatch or missing entry
//
// Dependency-free (node:crypto, node:fs only).

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const VENDORED_DIRS = ["office/vendor", "dashboard/vendor"];
export const VENDORED_DOC = "docs/VENDORED.md";

const HEX64 = /^[0-9a-f]{64}$/;

/** SHA-256 (lowercase hex) of a file's bytes. */
export function hashFile(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Repo-relative, forward-slash paths of every file under the given dirs, sorted. */
export function listVendoredFiles(root, dirs = VENDORED_DIRS) {
  const out = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(relative(root, full).split(sep).join("/"));
    }
  };
  for (const d of dirs) walk(resolve(root, d));
  return out.sort();
}

/**
 * Parses markdown table rows of the form
 * `| name | version | licence | source | `path` | size | sha256 |`
 * into a Map of path -> sha256.
 */
export function parseVendoredTable(md) {
  const entries = new Map();
  for (const line of md.split(/\r?\n/)) {
    if (!line.trim().startsWith("|")) continue;
    const cells = line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
    const pathCell = cells.find((c) => /^`[^`]+`$/.test(c));
    const hash = cells[cells.length - 1].toLowerCase();
    if (!pathCell || !HEX64.test(hash)) continue;
    entries.set(pathCell.slice(1, -1), hash);
  }
  return entries;
}

/**
 * Compares actual hashes with the recorded table.
 * Returns a list of problem strings (empty when everything matches).
 */
export function checkVendored(root, md, dirs = VENDORED_DIRS) {
  const recorded = parseVendoredTable(md);
  const files = listVendoredFiles(root, dirs);
  const problems = [];
  for (const f of files) {
    const want = recorded.get(f);
    if (!want) {
      problems.push(`${f}: not recorded in ${VENDORED_DOC}`);
      continue;
    }
    const got = hashFile(resolve(root, f));
    if (got !== want) problems.push(`${f}: hash mismatch (recorded ${want}, actual ${got})`);
  }
  for (const f of recorded.keys()) {
    if (!files.includes(f)) problems.push(`${f}: recorded but file is missing`);
  }
  return problems;
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  if (process.argv.includes("--check")) {
    const docPath = resolve(root, VENDORED_DOC);
    if (!existsSync(docPath)) {
      console.error(`${VENDORED_DOC} not found`);
      process.exit(1);
    }
    const problems = checkVendored(root, readFileSync(docPath, "utf8"));
    if (problems.length > 0) {
      for (const p of problems) console.error(p);
      process.exit(1);
    }
    console.log(`vendored hashes OK (${listVendoredFiles(root).length} files)`);
    return;
  }
  console.log("| File | Size (bytes) | SHA-256 |");
  console.log("|---|---|---|");
  for (const f of listVendoredFiles(root)) {
    const full = resolve(root, f);
    console.log(`| \`${f}\` | ${statSync(full).size} | ${hashFile(full)} |`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
