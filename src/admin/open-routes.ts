/**
 * `POST /api/open/office` and `POST /api/open/dashboard` as route-table entries, so they
 * take the central guard (design J.1). Best-effort launch of the default browser.
 *
 * Local Dashboard choice (task 40.3 c): the NEW Dashboard is the static site the local publish
 * step already builds into artifacts/published (index.html, app.js, views/, data/ ...). The
 * route does not build anything. If artifacts/published/index.html exists it opens
 * http://127.0.0.1:<port>/local-dashboard/ (served read-only by the console, see
 * local-dashboard.ts), NOT a file:// URL: the Dashboard uses ES modules and fetch() for its
 * JSON, which browsers block over file://. If the file is missing it launches nothing and
 * tells the user how to build it. The legacy artifacts/dashboard.html is no longer opened.
 */
import { spawn } from "node:child_process";
import type { ConsoleResponse, HandlerContext, RouteDef } from "./console-routes.js";
import { LOCAL_DASHBOARD_PREFIX, LOCAL_DASHBOARD_REL } from "./local-dashboard.js";

/** Entry file of the locally published Virtual Office replay, relative to the project root. */
export const OFFICE_ENTRY = `${LOCAL_DASHBOARD_REL}/office/index.html`;
/** Entry file of the locally published Dashboard, relative to the project root. */
export const DASHBOARD_ENTRY = `${LOCAL_DASHBOARD_REL}/index.html`;
/** Shown when the Dashboard has not been built yet. */
export const DASHBOARD_MISSING_TEXT =
  "The local Dashboard has not been built yet, so nothing was opened. Run the checks once with " +
  "`node dist/index.js run` (npm run run). That step builds the Dashboard into artifacts/published " +
  "(`node dist/publish/build-published-data.js artifacts/published` rebuilds only its data). Then press this button again.";

export type BrowserLauncher = (url: string) => boolean;

/** The real launcher: spawn the default browser. Never throws. */
export function spawnBrowser(url: string): boolean {
  try {
    const child =
      process.platform === "win32"
        ? spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore", windowsHide: true })
        : spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], { detached: true, stdio: "ignore" });
    child.on("error", (err) => {
      console.warn(`open: failed to launch browser: ${err.message}`);
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

let launcher: BrowserLauncher = spawnBrowser;

/** Replace the launcher (tests install a stub so no browser can ever open). */
export function setBrowserLauncher(fn: BrowserLauncher): void {
  launcher = fn;
}

/** Restore the real launcher. */
export function resetBrowserLauncher(): void {
  launcher = spawnBrowser;
}

export function openInBrowser(url: string): boolean {
  // Second safety net: the real launcher never runs from tests or when explicitly disabled.
  // An installed stub (not the real launcher) is always allowed, so tests can count calls.
  if (launcher === spawnBrowser && (process.env["AWG_NO_BROWSER"] === "1" || process.env["VITEST"])) return false;
  return launcher(url);
}

async function openOffice(ctx: HandlerContext): Promise<ConsoleResponse> {
  let built = false;
  try {
    built = ctx.deps.fs.exists(OFFICE_ENTRY) === true;
  } catch {
    built = false;
  }
  if (!built) {
    return { status: 200, json: { url: "", launched: false, built: false, message: DASHBOARD_MISSING_TEXT } };
  }
  const url = `http://127.0.0.1:${ctx.deps.port}${LOCAL_DASHBOARD_PREFIX}office/`;
  return { status: 200, json: { url, launched: openInBrowser(url), built: true } };
}

async function openDashboard(ctx: HandlerContext): Promise<ConsoleResponse> {
  let built = false;
  try {
    built = ctx.deps.fs.exists(DASHBOARD_ENTRY) === true;
  } catch {
    built = false;
  }
  if (!built) {
    return { status: 200, json: { url: "", launched: false, built: false, message: DASHBOARD_MISSING_TEXT } };
  }
  const url = `http://127.0.0.1:${ctx.deps.port}${LOCAL_DASHBOARD_PREFIX}`;
  return { status: 200, json: { url, launched: openInBrowser(url), built: true } };
}

export const OPEN_GROUP: RouteDef[] = [
  { method: "POST", pattern: "/api/open/office", mutating: true, maxBodyBytes: 1024, handler: openOffice },
  { method: "POST", pattern: "/api/open/dashboard", mutating: true, maxBodyBytes: 1024, handler: openDashboard },
];
