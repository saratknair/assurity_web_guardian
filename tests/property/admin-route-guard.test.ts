// Feature: dashboard-usability-overhaul, Property 60: The local-request guard covers every state-changing route
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fc from "fast-check";
import { readFileSync } from "node:fs";
import { setBrowserLauncher, resetBrowserLauncher } from "../../src/admin/open-routes.js";
import { join } from "node:path";
import { createConsole } from "../../src/admin/console-router.js";
import { allRoutes } from "../../src/admin/console-routes.js";
import type { ConsoleRequest } from "../../src/admin/console-routes.js";
import type { ConsoleDeps } from "../../src/admin/console-deps.js";

const PORT = 7787;
const RUNS = { numRuns: 150 };

/** Fake ports: every method call on fs/git/jobs/approval/clock is counted. */
function makeSpies() {
  const calls: string[] = [];
  const spy = (name: string, extra: Record<string, unknown> = {}) =>
    new Proxy(extra, {
      get: (t, p) => {
        if (typeof p === "symbol") return undefined;
        if (p in t) return t[p];
        return (..._a: unknown[]) => {
          calls.push(`${name}.${p}`);
          return undefined;
        };
      },
    });
  const deps = {
    port: PORT,
    fs: spy("fs", { root: "/fake-root" }),
    git: spy("git"),
    jobs: spy("jobs"),
    approval: spy("approval"),
    clock: spy("clock"),
  } as unknown as ConsoleDeps;
  return { deps, calls };
}

const GOOD_HOST = `127.0.0.1:${PORT}`;

interface Hdrs {
  host?: string;
  origin?: string;
  contentType?: string;
  secFetchSite?: string;
}

const goodHeaders = (): Hdrs => ({ host: GOOD_HOST, contentType: "application/json" });

const badHost = fc.oneof(
  fc.constant(undefined),
  fc.constant(""),
  fc.constant("evil.example.com"),
  fc.constant("127.0.0.1"),
  fc.constant(`127.0.0.1:${PORT + 1}`),
  fc.constant(`localhost:${PORT + 1}`),
  fc.constant(`0.0.0.0:${PORT}`),
  fc.constant(`[::1]:${PORT}`),
  fc.constant(`127.0.0.1.evil.com:${PORT}`),
  fc.string({ maxLength: 20 }).filter((s) => !["127.0.0.1:" + PORT, "localhost:" + PORT].includes(s.toLowerCase())),
);
const badOrigin = fc.oneof(
  fc.constant("null"),
  fc.constant("https://evil.example.com"),
  fc.constant(`http://127.0.0.1:${PORT + 1}`),
  fc.constant(`https://127.0.0.1:${PORT}`),
  fc.constant(`http://127.0.0.1.evil.com:${PORT}`),
  fc.constant(""),
  fc.string({ minLength: 1, maxLength: 20 }).filter((s) => !/^http:\/\/(127\.0\.0\.1|localhost):7787$/i.test(s)),
);
const badSite = fc.constantFrom("cross-site", "same-site", "CROSS-SITE", " same-site ");
const badType = fc.oneof(
  fc.constant(undefined),
  fc.constant(""),
  fc.constantFrom("text/plain", "application/x-www-form-urlencoded", "multipart/form-data", "text/json", "application/jsonx"),
  fc.string({ maxLength: 20 }).filter((s) => (s.split(";")[0] ?? "").trim().toLowerCase() !== "application/json"),
);

/** Headers where at least one guard check fails (the others vary between good and absent). */
const failingHeaders: fc.Arbitrary<Hdrs> = fc
  .record({
    which: fc.integer({ min: 1, max: 15 }),
    host: badHost,
    origin: badOrigin,
    site: badSite,
    type: badType,
    okOrigin: fc.constantFrom(undefined, `http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`),
    okSite: fc.constantFrom(undefined, "same-origin", "none"),
    okHost: fc.constantFrom(GOOD_HOST, `localhost:${PORT}`, `LOCALHOST:${PORT}`),
  })
  .map((r) => {
    const h: Hdrs = {
      host: r.which & 1 ? r.host : r.okHost,
      origin: r.which & 2 ? r.origin : r.okOrigin,
      secFetchSite: r.which & 4 ? r.site : r.okSite,
      contentType: r.which & 8 ? r.type : "application/json; charset=utf-8",
    };
    return h;
  });

const goodVariants: fc.Arbitrary<Hdrs> = fc
  .record({
    host: fc.constantFrom(GOOD_HOST, `localhost:${PORT}`, `LocalHost:${PORT}`),
    origin: fc.constantFrom(undefined, `http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`),
    secFetchSite: fc.constantFrom(undefined, "same-origin", "none"),
    contentType: fc.constantFrom("application/json", "application/json; charset=utf-8", "Application/JSON"),
  })
  .map((r) => r as Hdrs);

const bodies = fc.oneof(fc.string({ maxLength: 200 }), fc.constant("{}"), fc.json());

function concretePath(pattern: string): string {
  return pattern
    .split("/")
    .map((s) => (s.startsWith(":") ? "x1" : s))
    .join("/");
}

function req(method: string, path: string, h: Hdrs, body?: string): ConsoleRequest {
  const headers: ConsoleRequest["headers"] = {};
  if (h.host !== undefined) headers.host = h.host;
  if (h.origin !== undefined) headers.origin = h.origin;
  if (h.contentType !== undefined) headers.contentType = h.contentType;
  if (h.secFetchSite !== undefined) headers.secFetchSite = h.secFetchSite;
  const r: ConsoleRequest = { method, path, query: {}, headers };
  if (body !== undefined) (r as { body?: string }).body = body;
  return r;
}

const routes = allRoutes();
const postRoutes = routes.filter((r) => r.method !== "GET");
const getRoutes = routes.filter((r) => r.method === "GET");

// Valid POSTs reach /api/open/*; a stub launcher guarantees no real browser ever opens.
beforeAll(() => setBrowserLauncher(() => false));
afterAll(() => resetBrowserLauncher());

describe("Property 60: The local-request guard covers every state-changing route", () => {
  it("route table has both POST and GET routes (sanity)", () => {
    expect(postRoutes.length).toBeGreaterThan(5);
    expect(getRoutes.length).toBeGreaterThan(3);
    expect(postRoutes.some((r) => r.pattern === "/api/run")).toBe(true);
  });

  it("every declared route is mutating if and only if its method is POST", () => {
    for (const r of routes) expect(r.mutating).toBe(r.method === "POST");
  });

  it("every POST route with any failing guard check gets 403 and records nothing", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...postRoutes),
        failingHeaders,
        bodies,
        async (route, h, body) => {
          const { deps, calls } = makeSpies();
          const c = createConsole(deps);
          const res = await c.handle(req(route.method, concretePath(route.pattern), h, body));
          expect(res.status).toBe(403);
          expect(calls).toEqual([]);
          const pre = c.preflight(route.method, concretePath(route.pattern), req("POST", "/", h).headers);
          expect(pre?.status).toBe(403);
        },
      ),
      RUNS,
    );
  });

  it("any non-GET method on any path (known or unknown) with a failing guard gets 403 and records nothing", async () => {
    const methods = fc.constantFrom("POST", "PUT", "DELETE", "PATCH", "OPTIONS", "TRACE", "post", "FOO");
    const paths = fc.oneof(
      fc.constantFrom(...routes.map((r) => concretePath(r.pattern))),
      fc.string({ maxLength: 30 }).map((s) => "/" + s),
    );
    await fc.assert(
      fc.asyncProperty(methods, paths, failingHeaders, bodies, async (m, p, h, body) => {
        const { deps, calls } = makeSpies();
        const res = await createConsole(deps).handle(req(m, p, h, body));
        expect(res.status).toBe(403);
        expect(calls).toEqual([]);
      }),
      RUNS,
    );
  });

  it("an unknown POST path gets 403 with a bad guard and 404 with a good guard, recording nothing", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.stringMatching(/^[a-z0-9]{1,12}$/),
        failingHeaders,
        goodVariants,
        bodies,
        async (seg, bad, good, body) => {
          const path = `/zz-unknown/${seg}`;
          const a = makeSpies();
          expect((await createConsole(a.deps).handle(req("POST", path, bad, body))).status).toBe(403);
          const b = makeSpies();
          expect((await createConsole(b.deps).handle(req("POST", path, good, body))).status).toBe(404);
          expect(a.calls).toEqual([]);
          expect(b.calls).toEqual([]);
        },
      ),
      RUNS,
    );
  });

  it("every GET route (and HEAD) with a wrong Host gets 403 and records nothing", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...getRoutes),
        fc.constantFrom("GET", "HEAD"),
        badHost,
        fc.option(badOrigin, { nil: undefined }),
        async (route, method, host, origin) => {
          const { deps, calls } = makeSpies();
          const h: Hdrs = { contentType: "application/json" };
          if (host !== undefined) h.host = host;
          if (origin !== undefined) h.origin = origin;
          const res = await createConsole(deps).handle(req(method, concretePath(route.pattern), h));
          expect(res.status).toBe(403);
          expect(calls).toEqual([]);
        },
      ),
      RUNS,
    );
  });

  it("source binds only to 127.0.0.1: no 0.0.0.0, no '::' host, no listen call without a host", () => {
    const files = ["src/admin/admin-server.ts", "src/reporting/event-server.ts", "src/reporting/review-server.ts"];
    for (const f of files) {
      const code = readFileSync(join(process.cwd(), f), "utf8")
        .split("\n")
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .map((l) => l.replace(/\/\/.*$/, ""))
        .join("\n");
      expect(code).not.toContain("0.0.0.0");
      expect(code).not.toMatch(/["'`]::["'`]/);
      const listens = [...code.matchAll(/\.listen\(([^)]*)\)?/g)];
      expect(listens.length).toBeGreaterThan(0);
      for (const m of listens) {
        const args = (m[1] ?? "").split(",").map((s) => s.trim());
        expect(args.length).toBeGreaterThanOrEqual(2);
        expect(args[1]).toMatch(/^HOST$|^"127\.0\.0\.1"$/);
      }
      expect(code).toMatch(/HOST\s*=\s*(process\.env\.\w+\s*\?\?\s*)?"127\.0\.0\.1"/);
    }
  });
});
