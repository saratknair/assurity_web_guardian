// Site size gate (virtual-office-replay, task 13.1).
//
// Usage: node scripts/check-site-sizes.mjs <siteDir> [--office-dir <dir>]
//   (CI: ./_site)
//
// Checks the built static site:
//   - <site>/office total size must be <= 1,572,864 bytes (requirement 16.8);
//     the message names the largest file
//   - each <site>/data/runs/*/events.json must be <= 262,144 bytes
//     (requirements 17.6, 17.7)
// Prints every offending path (site-relative, forward slashes) and exits 1.
// A missing office/ directory fails (CI must ship the office). A missing
// data/runs directory is fine (no runs yet).
//
// --office-dir measures a different folder as the office (for example the
// repo's office/ folder) instead of <site>/office.

import { readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";

export const OFFICE_LIMIT_BYTES = 1572864;
export const EVENTS_LIMIT_BYTES = 262144;

function validEntries(list) {
  if (!Array.isArray(list)) return [];
  return list.filter(
    (f) => f && typeof f.path === "string" && typeof f.bytes === "number" && Number.isFinite(f.bytes) && f.bytes >= 0,
  );
}

/**
 * Pure. Never throws.
 * Returns { ok, office: { total, limit, largest: {path, bytes} | null, over },
 *           oversizeEvents: [{path, bytes, limit}],
 *           problems: [{path, bytes, limit}] }.
 * The office problem (when over) names the largest office file's path with
 * the office total as bytes.
 */
export function evaluateSizes(input) {
  const officeFiles = validEntries(input && input.officeFiles);
  const eventFiles = validEntries(input && input.eventFiles);
  let total = 0;
  let largest = null;
  for (const f of officeFiles) {
    total += f.bytes;
    if (largest === null || f.bytes > largest.bytes) largest = { path: f.path, bytes: f.bytes };
  }
  const over = total > OFFICE_LIMIT_BYTES;
  const oversizeEvents = eventFiles
    .filter((f) => f.bytes > EVENTS_LIMIT_BYTES)
    .map((f) => ({ path: f.path, bytes: f.bytes, limit: EVENTS_LIMIT_BYTES }));
  const problems = [];
  if (over && largest) problems.push({ path: largest.path, bytes: total, limit: OFFICE_LIMIT_BYTES });
  for (const e of oversizeEvents) problems.push(e);
  return {
    ok: problems.length === 0,
    office: { total, limit: OFFICE_LIMIT_BYTES, largest, over },
    oversizeEvents,
    problems,
  };
}

function toSitePath(root, file) {
  return relative(root, file).split(sep).join("/");
}

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (st.isFile()) out.push({ abs: p, bytes: st.size });
  }
}

/** Collects { officeFiles, eventFiles, officeMissing } from disk. */
export function collectSizes(siteDir, officeDirOverride) {
  const root = resolve(siteDir);
  const officeDir = officeDirOverride ? resolve(officeDirOverride) : join(root, "office");
  const officeMissing = !existsSync(officeDir) || !statSync(officeDir).isDirectory();
  const officeFiles = [];
  if (!officeMissing) {
    const found = [];
    walk(officeDir, found);
    for (const f of found) {
      const base = officeDirOverride ? officeDir : root;
      const rel = toSitePath(base, f.abs);
      officeFiles.push({ path: officeDirOverride ? "office/" + rel : rel, bytes: f.bytes });
    }
  }
  const eventFiles = [];
  const runsDir = join(root, "data", "runs");
  if (existsSync(runsDir) && statSync(runsDir).isDirectory()) {
    for (const id of readdirSync(runsDir)) {
      const p = join(runsDir, id, "events.json");
      if (existsSync(p) && statSync(p).isFile()) {
        eventFiles.push({ path: toSitePath(root, p), bytes: statSync(p).size });
      }
    }
  }
  return { officeFiles, eventFiles, officeMissing };
}

function main(argv) {
  const args = argv.slice();
  let officeDir = null;
  const i = args.indexOf("--office-dir");
  if (i >= 0) {
    officeDir = args[i + 1] || null;
    args.splice(i, 2);
  }
  const siteDir = args[0] || "_site";
  const { officeFiles, eventFiles, officeMissing } = collectSizes(siteDir, officeDir);
  if (officeMissing) {
    console.error("FAIL: office/ directory not found in " + siteDir + " (the site must ship the Virtual Office)");
    return 1;
  }
  const r = evaluateSizes({ officeFiles, eventFiles });
  console.log(
    "office total: " + r.office.total + " bytes (limit " + r.office.limit + "), files: " + officeFiles.length +
      (r.office.largest ? ", largest: " + r.office.largest.path + " (" + r.office.largest.bytes + " bytes)" : ""),
  );
  console.log("events files checked: " + eventFiles.length + " (limit " + EVENTS_LIMIT_BYTES + " bytes each)");
  if (r.ok) {
    console.log("OK: site sizes within limits");
    return 0;
  }
  if (r.office.over) {
    console.error(
      "FAIL: office total " + r.office.total + " bytes exceeds " + r.office.limit +
        " bytes; largest file: " + (r.office.largest ? r.office.largest.path : "n/a"),
    );
  }
  for (const e of r.oversizeEvents) {
    console.error("FAIL: " + e.path + " is " + e.bytes + " bytes, over the " + e.limit + " byte limit");
  }
  return 1;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  let code = 1;
  try {
    code = main(process.argv.slice(2));
  } catch (e) {
    console.error("FAIL: size check could not run (" + (e instanceof Error ? e.name : "error") + ")");
  }
  process.exit(code);
}
