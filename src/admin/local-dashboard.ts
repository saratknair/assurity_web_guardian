/**
 * Read-only static route for the locally published Dashboard: GET /local-dashboard/*.
 *
 * Why this exists: the Dashboard (artifacts/published, written by the local publish step)
 * uses ES modules and fetch() for its JSON data, which browsers refuse over file://. So the
 * console serves that folder itself, on the same loopback server, and the "Open local
 * Dashboard" button opens http://127.0.0.1:<port>/local-dashboard/.
 *
 * Safety: whitelist only. Every path segment must be a plain name, only known extensions are
 * served, nothing outside the published folder is ever read, directories are never listed,
 * and the caller applies the Host check before calling this.
 */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { resolve, sep } from "node:path";

/** Same folder the orchestrator publishes to (LOCAL_PUBLISHED_DIR in core/orchestrator.ts). */
export const LOCAL_DASHBOARD_REL = "artifacts/published";
export const LOCAL_DASHBOARD_PREFIX = "/local-dashboard/";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".map": "application/json; charset=utf-8",
};

export interface LocalDashboardFile {
  status: 200 | 404;
  bytes?: Uint8Array;
  contentType?: string;
  /** CSP for HTML responses (hashes of the page's own inline scripts). */
  csp?: string;
}

/** True for paths this module is responsible for. */
export function isLocalDashboardPath(path: string): boolean {
  return path === LOCAL_DASHBOARD_PREFIX.slice(0, -1) || path.startsWith(LOCAL_DASHBOARD_PREFIX);
}

/** Map a URL path to a safe relative path, or null when it must be refused. */
export function safeRelative(urlPath: string): string | null {
  if (!urlPath.startsWith(LOCAL_DASHBOARD_PREFIX)) return null;
  let rest = urlPath.slice(LOCAL_DASHBOARD_PREFIX.length);
  if (rest === "") rest = "index.html";
  // The published Virtual Office lives at office/ and is opened as /local-dashboard/office/.
  if (rest === "office/") rest = "office/index.html";
  let decoded: string;
  try {
    decoded = decodeURIComponent(rest);
  } catch {
    return null;
  }
  const parts = decoded.split("/");
  for (const p of parts) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(p) || p.includes("..")) return null;
  }
  const dot = decoded.lastIndexOf(".");
  const ext = dot >= 0 ? decoded.slice(dot).toLowerCase() : "";
  if (!(ext in TYPES)) return null;
  return parts.join("/");
}

/** CSP for the Dashboard page: own files only, plus the hashes of its inline module scripts. */
function dashboardCsp(html: string): string {
  const hashes: string[] = [];
  const re = /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    hashes.push(`'sha256-${createHash("sha256").update(m[1] ?? "", "utf8").digest("base64")}'`);
  }
  return (
    `default-src 'none'; script-src 'self' ${hashes.join(" ")}; style-src 'self' 'unsafe-inline'; ` +
    "img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; " +
    "base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
  );
}

/** Read one whitelisted file from the published folder. `root` is an absolute directory. */
export function readLocalDashboardFile(urlPath: string, root: string): LocalDashboardFile {
  const rel = safeRelative(urlPath);
  if (rel === null) return { status: 404 };
  const base = resolve(root);
  const full = resolve(base, rel);
  if (!full.startsWith(base + sep)) return { status: 404 };
  try {
    if (!existsSync(full)) return { status: 404 };
    const st = lstatSync(full);
    if (!st.isFile() || st.isSymbolicLink()) return { status: 404 };
    const bytes = new Uint8Array(readFileSync(full));
    const dot = rel.lastIndexOf(".");
    const contentType = TYPES[rel.slice(dot).toLowerCase()] as string;
    const out: LocalDashboardFile = { status: 200, bytes, contentType };
    if (contentType.startsWith("text/html")) out.csp = dashboardCsp(Buffer.from(bytes).toString("utf8"));
    return out;
  } catch {
    return { status: 404 };
  }
}
