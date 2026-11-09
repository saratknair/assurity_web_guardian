// Feature: dashboard-usability-overhaul, Property 61: Oversized bodies are rejected without side effects
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fc from "fast-check";
import { setBrowserLauncher, resetBrowserLauncher } from "../../src/admin/open-routes.js";
import { request } from "node:http";
import { createServer as createNetServer } from "node:net";
import { createConsole } from "../../src/admin/console-router.js";
import { allRoutes } from "../../src/admin/console-routes.js";
import type { RouteDef } from "../../src/admin/console-routes.js";
import type { ConsoleDeps } from "../../src/admin/console-deps.js";
import { startAdminServer } from "../../src/admin/admin-server.js";

const PORT = 7787;
const RUNS = { numRuns: 150 };

/** Fake ports: every method call on fs/git/jobs/approval/clock is counted. */
function makeSpies(port = PORT) {
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
    port,
    fs: spy("fs", { root: "/fake-root" }),
    git: spy("git"),
    jobs: spy("jobs"),
    approval: spy("approval"),
    clock: spy("clock"),
  } as unknown as ConsoleDeps;
  return { deps, calls };
}

const HEADERS = { host: `127.0.0.1:${PORT}`, contentType: "application/json" };
const mutating = allRoutes().filter((r) => r.mutating);
const concretePath = (pattern: string) => pattern.replace(/:[A-Za-z0-9_]+/g, "x");

const routeArb = fc.constantFrom(...mutating);
// [character, utf8 byte length]
const unitArb = fc.constantFrom<[string, number]>(["a", 1], ["\u00e9", 2], ["\u20ac", 3], ["\u{1F600}", 4]);

/** A string of exactly `bytes` UTF-8 bytes built from the given unit, padded with ASCII. */
function filler(unit: [string, number], bytes: number): string {
  const n = Math.floor(bytes / unit[1]);
  return unit[0].repeat(n) + "a".repeat(bytes - n * unit[1]);
}

// Valid POSTs reach /api/open/*; a stub launcher guarantees no real browser ever opens.
beforeAll(() => setBrowserLauncher(() => false));
afterAll(() => resetBrowserLauncher());

describe("Property 61: Oversized bodies are rejected without side effects", () => {
  it("has mutating routes to test", () => {
    expect(mutating.length).toBeGreaterThan(10);
  });

  // **Validates: Requirements 30.5, 30.6**
  it("a body over the ceiling by byte length gets 413 and records nothing", async () => {
    await fc.assert(
      fc.asyncProperty(routeArb, unitArb, fc.integer({ min: 1, max: 64 }), async (route, unit, extra) => {
        const { deps, calls } = makeSpies();
        const raw = filler(unit, route.maxBodyBytes + extra);
        expect(Buffer.byteLength(raw, "utf8")).toBeGreaterThan(route.maxBodyBytes);
        const res = await createConsole(deps).handle({
          method: "POST",
          path: concretePath(route.pattern),
          query: {},
          headers: HEADERS,
          body: raw,
        });
        expect(res.status).toBe(413);
        expect(calls).toEqual([]);
      }),
      RUNS,
    );
  });

  // **Validates: Requirements 30.5, 30.6**
  it("multi-byte text with fewer characters than the ceiling but more bytes gets 413", async () => {
    await fc.assert(
      fc.asyncProperty(routeArb, fc.constantFrom<[string, number]>(["\u20ac", 3], ["\u{1F600}", 4]), async (route, unit) => {
        const { deps, calls } = makeSpies();
        const chars = Math.floor(route.maxBodyBytes / unit[1]) + 1;
        const raw = unit[0].repeat(chars);
        expect([...raw].length).toBeLessThanOrEqual(route.maxBodyBytes);
        expect(Buffer.byteLength(raw, "utf8")).toBeGreaterThan(route.maxBodyBytes);
        const res = await createConsole(deps).handle({
          method: "POST",
          path: concretePath(route.pattern),
          query: {},
          headers: HEADERS,
          body: raw,
        });
        expect(res.status).toBe(413);
        expect(calls).toEqual([]);
      }),
      RUNS,
    );
  });

  // **Validates: Requirements 30.5, 30.6**
  it("a valid JSON body at exactly the ceiling (or below) is processed, never 413", async () => {
    await fc.assert(
      fc.asyncProperty(routeArb, unitArb, fc.integer({ min: 0, max: 40 }), async (route, unit, slack) => {
        const { deps } = makeSpies();
        const overhead = Buffer.byteLength('{"p":""}', "utf8");
        const target = Math.max(overhead, route.maxBodyBytes - slack);
        const raw = `{"p":"${filler(unit, target - overhead)}"}`;
        expect(Buffer.byteLength(raw, "utf8")).toBeLessThanOrEqual(route.maxBodyBytes);
        const res = await createConsole(deps).handle({
          method: "POST",
          path: concretePath(route.pattern),
          query: {},
          headers: HEADERS,
          body: raw,
        });
        expect(res.status).not.toBe(413);
        expect(res.status).not.toBe(403);
        // Handlers may answer 400 for field validation; the router's JSON parse error must not appear.
        expect(JSON.stringify(res.json ?? {})).not.toContain("not valid JSON");
      }),
      RUNS,
    );
    // Exactly at the ceiling for every route.
    for (const route of mutating) {
      const { deps } = makeSpies();
      const raw = `{"p":"${"a".repeat(route.maxBodyBytes - 8)}"}`;
      expect(Buffer.byteLength(raw, "utf8")).toBe(route.maxBodyBytes);
      const res = await createConsole(deps).handle({
        method: "POST",
        path: concretePath(route.pattern),
        query: {},
        headers: HEADERS,
        body: raw,
      });
      expect(res.status, route.pattern).not.toBe(413);
      expect(JSON.stringify(res.json ?? {}), route.pattern).not.toContain("not valid JSON");
    }
  });

  // **Validates: Requirements 30.5, 30.6**
  it("preflight rejects a declared content-length above the ceiling and records nothing", async () => {
    await fc.assert(
      fc.asyncProperty(routeArb, fc.integer({ min: 1, max: 1_000_000 }), async (route, extra) => {
        const { deps, calls } = makeSpies();
        const c = createConsole(deps);
        const path = concretePath(route.pattern);
        const over = c.preflight("POST", path, { ...HEADERS, contentLength: route.maxBodyBytes + extra });
        expect(over?.status).toBe(413);
        const at = c.preflight("POST", path, { ...HEADERS, contentLength: route.maxBodyBytes });
        expect(at).toBeNull();
        expect(calls).toEqual([]);
      }),
      RUNS,
    );
  });

  // **Validates: Requirements 30.5, 30.6**
  it("malformed JSON within the ceiling gets 400 and records nothing", async () => {
    await fc.assert(
      fc.asyncProperty(routeArb, fc.string({ maxLength: 200 }), async (route, tail) => {
        const { deps, calls } = makeSpies();
        let raw = `{not json ${tail}`;
        raw = Buffer.from(raw, "utf8").subarray(0, route.maxBodyBytes).toString("utf8");
        raw = raw.replace(/\uFFFD$/u, "");
        expect(Buffer.byteLength(raw, "utf8")).toBeLessThanOrEqual(route.maxBodyBytes);
        const res = await createConsole(deps).handle({
          method: "POST",
          path: concretePath(route.pattern),
          query: {},
          headers: HEADERS,
          body: raw,
        });
        expect(res.status).toBe(400);
        expect(calls).toEqual([]);
      }),
      RUNS,
    );
  });
});

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createNetServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => resolve(p));
    });
  });
}

function post(port: number, path: string, body: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode ?? 0));
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

describe("Property 61: real HTTP example", () => {
  it("answers 413 for an oversized body without running the handler, and 200 for one at the ceiling", async () => {
    const port = await freePort();
    expect(port).not.toBe(7787);
    const { deps, calls } = makeSpies(port);
    let handled = 0;
    const routes: RouteDef[] = [
      {
        method: "POST",
        pattern: "/api/test-body",
        mutating: true,
        maxBodyBytes: 64,
        handler: async () => {
          handled += 1;
          return { status: 200, json: { ok: true } };
        },
      },
    ];
    const logSpy = console.log;
    console.log = () => undefined;
    const server = startAdminServer({ port, deps, routes });
    try {
      await new Promise<void>((resolve) => {
        if (server.listening) resolve();
        else server.once("listening", () => resolve());
      });
      const atCeiling = `{"p":"${"a".repeat(64 - 8)}"}`;
      expect(Buffer.byteLength(atCeiling)).toBe(64);
      expect(await post(port, "/api/test-body", atCeiling)).toBe(200);
      expect(handled).toBe(1);

      // 30 euro signs: 30 characters but 90 bytes.
      const multi = "\u20ac".repeat(30);
      expect(await post(port, "/api/test-body", multi)).toBe(413);
      expect(await post(port, "/api/test-body", "x".repeat(500))).toBe(413);
      expect(handled).toBe(1);
      expect(calls).toEqual([]);
    } finally {
      console.log = logSpy;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
