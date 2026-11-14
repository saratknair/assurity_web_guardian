// Cache-busting stamp for the assembled static site.
//
// Usage: node scripts/stamp-build-id.mjs <siteDir>
//   Reads the build id from the GITHUB_SHA environment variable (first 7 chars).
//   Without a valid id the site is left unchanged.
//
// Rewrites relative <script src> and <link rel="stylesheet" href> URLs in
// <site>/index.html and <site>/office/index.html to end in ?v=<buildId>, so a
// new deploy is fetched even while browsers hold the previous files in cache.
// Modules imported by those entry scripts keep their plain URLs.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const BUILD_ID_PATTERN = /^[0-9a-f]{7,40}$/;

/** Short build id from a commit SHA, or null when the value is not a hex SHA. */
export function toBuildId(sha) {
  if (typeof sha !== "string") return null;
  const value = sha.trim().toLowerCase();
  if (!BUILD_ID_PATTERN.test(value)) return null;
  return value.slice(0, 7);
}

function isStampable(url) {
  if (!url || url.startsWith("#")) return false;
  if (url.startsWith("/")) return false; // absolute path or protocol-relative
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return false; // http:, data:, etc.
  if (/[?#]/.test(url)) return false; // already carries a query or fragment
  return true;
}

/** Append ?v=<buildId> to relative script and stylesheet URLs in HTML text. */
export function stampHtml(html, buildId) {
  if (typeof html !== "string" || !BUILD_ID_PATTERN.test(String(buildId))) return html;
  const stamp = (attr) => (match, before, url, after) =>
    isStampable(url) ? `${before}${url}?v=${buildId}${after}` : match;
  const scripts = /(<script\b[^>]*?\bsrc=")([^"]*)("[^>]*>)/gi;
  const links = /(<link\b(?=[^>]*\brel="stylesheet")[^>]*?\bhref=")([^"]*)("[^>]*>)/gi;
  return html.replace(scripts, stamp("src")).replace(links, stamp("href"));
}

/** Stamp the dashboard and office entry pages inside an assembled site folder. */
export function stampSite(siteDir, sha) {
  const buildId = toBuildId(sha);
  if (!buildId) return { stamped: [], buildId: null };
  const stamped = [];
  for (const rel of ["index.html", join("office", "index.html")]) {
    const file = join(siteDir, rel);
    if (!existsSync(file)) continue;
    const before = readFileSync(file, "utf8");
    const after = stampHtml(before, buildId);
    if (after !== before) {
      writeFileSync(file, after);
      stamped.push(rel.replace(/\\/g, "/"));
    }
  }
  return { stamped, buildId };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const siteDir = process.argv[2];
  if (!siteDir) {
    console.error("Usage: node scripts/stamp-build-id.mjs <siteDir>");
    process.exit(1);
  }
  const { stamped, buildId } = stampSite(siteDir, process.env.GITHUB_SHA);
  if (!buildId) console.log("No valid build id; site left unchanged.");
  else console.log(`Stamped build ${buildId} in: ${stamped.join(", ") || "(nothing to change)"}`);
}
