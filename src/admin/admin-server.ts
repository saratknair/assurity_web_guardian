import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createConsole, type ConsoleRequest, type ConsoleResponse } from "./console-router.js";
import { realDeps, type ConsoleDeps } from "./console-deps.js";
import { allRoutes, type RouteDef } from "./console-routes.js";
import { isLocalDashboardPath, readLocalDashboardFile, LOCAL_DASHBOARD_REL } from "./local-dashboard.js";

/**
 * Management_Console HTTP adapter (design J.1.2). No business logic: it builds a
 * `ConsoleRequest`, calls `preflight`, streams the body with the route ceiling, calls
 * `handle`, and writes the response with the security headers.
 *
 * SAFETY - LOOPBACK ONLY: binds exclusively to 127.0.0.1 (Req 30.5). No CORS headers are
 * ever written, so cross-origin JSON posts fail their preflight.
 */

const DEFAULT_PORT = 7787;
const HOST = "127.0.0.1";
const UI_DIR = "admin-ui";
/** Known section scripts served at /assets/sections/<name>.js. */
const SECTION_NAMES = [
  "overview",
  "domain",
  "urls",
  "discovery",
  "baselines",
  "findings",
  "publish",
  "schedule",
  "runs",
  "activity",
];

const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; " +
  "base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export interface StartAdminServerOptions {
  /** Port to bind on the loopback interface. Defaults to 7787. */
  port?: number;
  /** Override the console ports (tests). Defaults to `realDeps` for the working directory. */
  deps?: ConsoleDeps;
  /** Override the route table (tests). */
  routes?: RouteDef[];
  /** Folder served at /local-dashboard/ (tests). Defaults to artifacts/published. */
  localDashboardRoot?: string;
}

interface Asset {
  file: string;
  type: string;
}

/** Fixed whitelist: URL path to file under admin-ui/. Nothing else is ever read from disk. */
function resolveAsset(path: string): Asset | null {
  if (path === "/") return { file: "index.html", type: "text/html; charset=utf-8" };
  if (path === "/assets/console.js") return { file: "console.js", type: "text/javascript; charset=utf-8" };
  if (path === "/assets/console.css") return { file: "console.css", type: "text/css; charset=utf-8" };
  let m = /^\/assets\/lib\/([a-z][a-z0-9-]*)\.js$/.exec(path);
  if (m) return { file: `lib/${m[1]}.js`, type: "text/javascript; charset=utf-8" };
  m = /^\/assets\/sections\/([a-z][a-z0-9-]*)\.js$/.exec(path);
  if (m && SECTION_NAMES.includes(m[1] as string)) {
    return { file: `sections/${m[1]}.js`, type: "text/javascript; charset=utf-8" };
  }
  return null;
}

const FALLBACK_PAGE =
  '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8" /><title>Assurity Web Guardian - Console</title></head>' +
  "<body><h1>Assurity Web Guardian - Console</h1><p>The console UI files are not installed yet.</p></body></html>";

function baseHeaders(contentType: string): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  };
  if (contentType.startsWith("text/html")) h["Content-Security-Policy"] = CSP;
  return h;
}

function write(res: ServerResponse, r: ConsoleResponse, head: boolean): void {
  let body: string | Uint8Array;
  let type: string;
  if (r.bytes) {
    body = r.bytes;
    type = r.contentType ?? "application/octet-stream";
  } else if (r.text !== undefined) {
    body = r.text;
    type = r.contentType ?? "text/plain; charset=utf-8";
  } else {
    body = JSON.stringify(r.json ?? {});
    type = "application/json";
  }
  res.writeHead(r.status, baseHeaders(type));
  res.end(head ? undefined : body);
}

function serveAsset(res: ServerResponse, asset: Asset, head: boolean): void {
  const full = resolve(UI_DIR, asset.file);
  if (existsSync(full)) {
    try {
      const bytes = readFileSync(full);
      res.writeHead(200, baseHeaders(asset.type));
      res.end(head ? undefined : bytes);
      return;
    } catch {
      /* fall through to 404 / fallback */
    }
  }
  if (asset.file === "index.html") return write(res, { status: 200, text: FALLBACK_PAGE, contentType: asset.type }, head);
  write(res, { status: 404, json: { error: "not found" } }, head);
}

function single(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** Read the body up to `max` bytes. Resolves null on overflow (caller answers 413 and closes). */
function readBody(req: IncomingMessage, max: number): Promise<string | null> {
  return new Promise((done) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let finished = false;
    req.on("data", (c: Buffer) => {
      if (finished) return;
      size += c.length;
      if (size > max) {
        finished = true;
        done(null);
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!finished) {
        finished = true;
        done(Buffer.concat(chunks).toString("utf8"));
      }
    });
    req.on("error", () => {
      if (!finished) {
        finished = true;
        done(null);
      }
    });
  });
}

function buildRequest(req: IncomingMessage, body: string | null): ConsoleRequest {
  const url = new URL(req.url ?? "/", `http://${HOST}`);
  const query: Record<string, string> = {};
  url.searchParams.forEach((v, k) => {
    query[k] = v;
  });
  const len = single(req.headers["content-length"]);
  const parsedLen = len !== undefined && /^\d+$/.test(len) ? Number(len) : undefined;
  return {
    method: (req.method ?? "GET").toUpperCase(),
    path: url.pathname,
    query,
    headers: {
      host: single(req.headers.host),
      origin: single(req.headers.origin),
      contentType: single(req.headers["content-type"]),
      secFetchSite: single(req.headers["sec-fetch-site"]),
      ...(parsedLen !== undefined ? { contentLength: parsedLen } : {}),
    },
    body,
  };
}

/** Largest declared ceiling among routes matching the path, used to bound streaming. */
function ceilingFor(routes: RouteDef[], method: string, path: string): number {
  let max = 0;
  for (const r of routes) {
    if (r.method !== method) continue;
    const ps = r.pattern.split("/");
    const xs = path.split("/");
    if (ps.length !== xs.length) continue;
    if (ps.every((p, i) => p.startsWith(":") || p === xs[i])) max = Math.max(max, r.maxBodyBytes);
  }
  return max;
}

/**
 * Start the console server on the loopback interface only.
 *
 * @param opts.port Port to bind (default 7787).
 * @returns the listening `http.Server`.
 */
export function startAdminServer(opts: StartAdminServerOptions = {}): Server {
  const port = opts.port ?? DEFAULT_PORT;
  const deps = opts.deps ?? realDeps({ root: process.cwd(), port });
  const routes = opts.routes ?? allRoutes();
  const consoleApi = createConsole(deps, routes);
  const localRoot = opts.localDashboardRoot ?? resolve(LOCAL_DASHBOARD_REL);

  const server = createServer((req, res) => {
    const method = (req.method ?? "GET").toUpperCase();
    const head = method === "HEAD";
    const isRead = method === "GET" || head;
    const path = new URL(req.url ?? "/", `http://${HOST}`).pathname;

    void (async () => {
      try {
        const early = consoleApi.preflight(method, path, buildRequest(req, null).headers);
        if (isRead) {
          // Locally published Dashboard (read-only, whitelist-only; Host check applies).
          if (isLocalDashboardPath(path)) {
            const hostCheck = consoleApi.preflight(method, "/api/domain", buildRequest(req, null).headers);
            if (hostCheck && hostCheck.status === 403) return write(res, hostCheck, head);
            const f = readLocalDashboardFile(path, localRoot);
            if (f.status !== 200 || !f.bytes) return write(res, { status: 404, json: { error: "not found" } }, head);
            const h = baseHeaders(f.contentType ?? "application/octet-stream");
            if (f.csp) h["Content-Security-Policy"] = f.csp;
            res.writeHead(200, h);
            res.end(head ? undefined : f.bytes);
            return;
          }
          // Static UI paths are not API routes; they still take the Host-only check.
          const asset = resolveAsset(path);
          if (asset) {
            const hostCheck = consoleApi.preflight(method, "/api/domain", buildRequest(req, null).headers);
            if (hostCheck && hostCheck.status === 403) return write(res, hostCheck, head);
            return serveAsset(res, asset, head);
          }
          if (early) return write(res, early, head);
          const r = await consoleApi.handle(buildRequest(req, null));
          return write(res, r, head);
        }

        if (early) {
          // Refuse without reading the body; close the connection.
          res.shouldKeepAlive = false;
          write(res, early, false);
          res.once("finish", () => req.destroy());
          return;
        }
        const ceiling = ceilingFor(routes, method, path);
        const body = await readBody(req, ceiling);
        if (body === null) {
          res.shouldKeepAlive = false;
          write(res, { status: 413, json: { error: "body too large" } }, false);
          res.once("finish", () => req.destroy());
          return;
        }
        write(res, await consoleApi.handle(buildRequest(req, body)), false);
      } catch {
        if (!res.headersSent) write(res, { status: 500, json: { error: "internal error" } }, false);
        else res.end();
      }
    })();
  });
  // LOOPBACK ONLY - never bind 0.0.0.0 or a public interface (Req 30.5).
  server.listen(port, HOST, () => {
    const addr = server.address();
    // Ephemeral port (0): the guard must compare against the port actually bound.
    if (port === 0 && addr && typeof addr === "object") deps.port = addr.port;
    console.log(`Guardian admin console (local only) at http://${HOST}:${port}`);
  });
  return server;
}
