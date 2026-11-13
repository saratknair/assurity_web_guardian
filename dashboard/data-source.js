// Web Guardian dashboard data loaders.
//
// Plain browser ES module (no TypeScript, no build step). The dashboard/ app is
// static HTML + JS + CSS served same-origin, and it reads published JSON only.
//
// No-network guarantee: no request to 127.0.0.1 or any absolute URL is ever
// issued. Every fetch is a RELATIVE, same-origin URL under `./data/`.

/** Relative, same-origin published data. */
const STATIC_DATA_URL = "./data/dashboard.json";

/**
 * Load `DashboardData` from the published static JSON.
 *
 * Issues exactly one request, to the RELATIVE same-origin URL
 * `./data/dashboard.json`.
 *
 * @returns {Promise<object>} the parsed DashboardData.
 */
export async function loadStatic() {
  const res = await fetch(STATIC_DATA_URL, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`static dashboard data fetch failed: HTTP ${res.status}`);
  }
  return /** @type {object} */ (await res.json());
}

/**
 * Load one published JSON file by its path relative to the `./data/` folder
 * (for example "index.json" or "runs/<runId>/run-findings.json").
 *
 * RELATIVE URLs only: the URL is always "./data/" plus the encoded path. The
 * path must not start with "/", contain a backslash, empty, "." or ".."
 * segments. Each segment is URI-encoded, so callers pass raw ids and slugs.
 * Errors always name the failing file.
 *
 * @param {string} relPath
 * @returns {Promise<any>} the parsed JSON.
 */
export async function loadPublished(relPath) {
  const p = typeof relPath === "string" ? relPath : "";
  const segs = p.split("/");
  const bad =
    !p ||
    p.includes("\\") ||
    segs.some((s) => s === "" || s === "." || s === "..");
  if (bad) throw new Error(`Invalid published data path: ${p || "(empty)"}`);
  const url = "./data/" + segs.map(encodeURIComponent).join("/");
  let res;
  try {
    res = await fetch(url, { cache: "no-store" });
  } catch (err) {
    throw new Error(`Could not load ${p}: network error`);
  }
  if (!res.ok) throw new Error(`Could not load ${p}: HTTP ${res.status}`);
  try {
    return await res.json();
  } catch (err) {
    throw new Error(`Could not load ${p}: the file is not valid JSON`);
  }
}
