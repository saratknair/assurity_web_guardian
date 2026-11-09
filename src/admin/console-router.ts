/**
 * Management_Console router (design J.1.2). Pure: no sockets. Order inside `handle`:
 * guard (every non-GET incl. unknown routes; Host-only on GET), route lookup (404/405),
 * body ceiling (413 on byte length), JSON parse (400), handler under the project lock for
 * mutating routes.
 */
import { checkHostOnly, checkLocalRequest } from "./local-guard.js";
import { scrubForDisplay } from "./scrub.js";
import type { ConsoleDeps } from "./console-deps.js";
import {
  allRoutes,
  type ConsoleRequest,
  type ConsoleResponse,
  type RouteDef,
} from "./console-routes.js";

export type { ConsoleRequest, ConsoleResponse, RouteDef } from "./console-routes.js";

const FORBIDDEN: ConsoleResponse = { status: 403, json: { error: "forbidden" } };

function isRead(method: string): boolean {
  return method === "GET" || method === "HEAD";
}

function matchPattern(pattern: string, path: string): Record<string, string> | null {
  const ps = pattern.split("/");
  const xs = path.split("/");
  if (ps.length !== xs.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i] as string;
    const x = xs[i] as string;
    if (p.startsWith(":")) {
      if (x.length === 0) return null;
      params[p.slice(1)] = x;
    } else if (p !== x) {
      return null;
    }
  }
  return params;
}

/** In-process promise-chain mutex. */
export function createLock(): <T>(fn: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = tail.then(fn, fn);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}

type Lookup =
  | { kind: "found"; route: RouteDef; params: Record<string, string> }
  | { kind: "none"; status: 404 | 405 };

export function createConsole(deps: ConsoleDeps, routes: RouteDef[] = allRoutes()) {
  const projectLock = createLock();

  function guard(method: string, headers: ConsoleRequest["headers"]): ConsoleResponse | null {
    const r = isRead(method)
      ? checkHostOnly(headers.host, deps.port)
      : checkLocalRequest(
          {
            host: headers.host,
            origin: headers.origin,
            contentType: headers.contentType,
            secFetchSite: headers.secFetchSite,
          },
          deps.port,
        );
    return r.ok ? null : FORBIDDEN;
  }

  function lookup(method: string, path: string): Lookup {
    const effective = method === "HEAD" ? "GET" : method;
    let pathMatched = false;
    for (const route of routes) {
      const params = matchPattern(route.pattern, path);
      if (!params) continue;
      pathMatched = true;
      if (route.method === effective) return { kind: "found", route, params };
    }
    return { kind: "none", status: pathMatched ? 405 : 404 };
  }

  function preflight(
    method: string,
    path: string,
    headers: ConsoleRequest["headers"],
  ): ConsoleResponse | null {
    const denied = guard(method, headers);
    if (denied) return denied;
    const found = lookup(method, path);
    if (found.kind === "none") {
      return { status: found.status, json: { error: found.status === 404 ? "not found" : "method not allowed" } };
    }
    const declared = headers.contentLength;
    if (typeof declared === "number" && declared > found.route.maxBodyBytes && !isRead(method)) {
      return { status: 413, json: { error: "body too large" } };
    }
    return null;
  }

  async function handle(req: ConsoleRequest): Promise<ConsoleResponse> {
    const early = preflight(req.method, req.path, req.headers);
    if (early) return early;
    const found = lookup(req.method, req.path);
    if (found.kind !== "found") return { status: 404, json: { error: "not found" } };
    const { route, params } = found;

    let body: unknown = {};
    if (!isRead(req.method)) {
      const raw = req.body ?? "";
      if (Buffer.byteLength(raw, "utf8") > route.maxBodyBytes) {
        return { status: 413, json: { error: "body too large" } };
      }
      if (raw.trim().length > 0) {
        try {
          body = JSON.parse(raw);
        } catch {
          return { status: 400, json: { error: "Request body is not valid JSON" } };
        }
      }
    }

    const run = async (): Promise<ConsoleResponse> => {
      try {
        return await route.handler({ deps, req, params, query: req.query, body });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          status: 500,
          json: { error: "internal error", detail: scrubForDisplay(msg, { projectRoot: deps.fs.root }) },
        };
      }
    };
    return route.mutating ? projectLock(run) : run();
  }

  return { preflight, handle };
}
