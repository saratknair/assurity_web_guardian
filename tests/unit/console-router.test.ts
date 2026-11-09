import { describe, expect, it } from "vitest";
import { createConsole } from "../../src/admin/console-router.js";
import { allRoutes, type RouteDef } from "../../src/admin/console-routes.js";
import type { ConsoleDeps } from "../../src/admin/console-deps.js";

const files: Record<string, string> = {
  "config/app.config.json": JSON.stringify({
    approvedDomain: "example.test",
    baseUrl: "https://example.test",
    domain: "example-test",
    limits: { pages: 10 },
  }),
  "config/page-seed.json": JSON.stringify({ maxUrls: 10, approvedUrls: ["https://example.test/", "https://example.test/a"] }),
};

function deps(): ConsoleDeps {
  return {
    port: 7787,
    fs: {
      root: "C:/proj",
      exists: (r) => r in files,
      readText: (r) => {
        const v = files[r];
        if (v === undefined) throw new Error("missing");
        return v;
      },
      readBytes: () => new Uint8Array(),
      writeText: () => undefined,
      listDir: () => [],
    },
    git: { run: async () => ({ code: 0, stdout: "", stderr: "" }) },
    jobs: { current: () => null, start: () => ({ ok: false, reason: "no" }) },
    approval: { authorizeSetupAction: () => undefined, approveVisualBaseline: () => undefined },
    clock: { now: () => new Date(0) },
  };
}

const goodGet = { host: "127.0.0.1:7787" };
const goodPost = { host: "127.0.0.1:7787", contentType: "application/json" };

describe("console router", () => {
  it("serves status and domain on loopback hosts", async () => {
    const c = createConsole(deps());
    const s = await c.handle({ method: "GET", path: "/api/status", query: {}, headers: goodGet, body: null });
    expect(s.status).toBe(200);
    expect((s.json as { used: string }).used).toBe("2 of 10 used");
    const d = await c.handle({ method: "GET", path: "/api/domain", query: {}, headers: goodGet, body: null });
    expect((d.json as { slug: string }).slug).toBe("example-test");
  });

  it("reports pagesUrl from the origin remote, or null when it is unknown", async () => {
    const get = { method: "GET", path: "/api/status", query: {}, headers: goodGet, body: null };
    const none = (await createConsole(deps()).handle(get)).json as { pagesUrl: string | null };
    expect(none.pagesUrl).toBeNull();
    const d = deps();
    d.git = { run: async () => ({ code: 0, stdout: "https://tok:x@github.com/SaratKNair/assurity_web_guardian.git\n", stderr: "" }) };
    const s = (await createConsole(d).handle(get)).json as { pagesUrl: string | null };
    expect(s.pagesUrl).toBe("https://saratknair.github.io/assurity_web_guardian/");
  });

  it("rejects a foreign Host on GET and any bad POST, even for unknown routes", async () => {
    const c = createConsole(deps());
    expect((await c.handle({ method: "GET", path: "/api/status", query: {}, headers: { host: "evil.test" }, body: null })).status).toBe(403);
    expect((await c.handle({ method: "POST", path: "/api/nope", query: {}, headers: { host: "127.0.0.1:7787" }, body: "{}" })).status).toBe(403);
  });

  it("returns 404, 405, 413 and 400 in order", async () => {
    const big: RouteDef = {
      method: "POST",
      pattern: "/api/x",
      mutating: true,
      maxBodyBytes: 4,
      handler: async () => ({ status: 200, json: {} }),
    };
    const c = createConsole(deps(), [...allRoutes(), big]);
    const h = (m: string, p: string, body: string | null, headers = m === "GET" ? goodGet : goodPost) =>
      c.handle({ method: m, path: p, query: {}, headers, body });
    expect((await h("GET", "/api/none", null)).status).toBe(404);
    expect((await h("POST", "/api/status", "{}")).status).toBe(405);
    expect((await h("POST", "/api/x", "\u00e9\u00e9\u00e9")).status).toBe(413);
    expect((await h("POST", "/api/x", "{x")).status).toBe(400);
    expect((await h("POST", "/api/x", "{}")).status).toBe(200);
  });

  it("marks every POST route as mutating", () => {
    for (const r of allRoutes()) if (r.method === "POST") expect(r.mutating).toBe(true);
  });
});
