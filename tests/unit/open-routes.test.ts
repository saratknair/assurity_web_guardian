import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConsole } from "../../src/admin/console-router.js";
import type { ConsoleDeps } from "../../src/admin/console-deps.js";
import {
  DASHBOARD_ENTRY,
  DASHBOARD_MISSING_TEXT,
  OFFICE_ENTRY,
  openInBrowser,
  resetBrowserLauncher,
  setBrowserLauncher,
  spawnBrowser,
} from "../../src/admin/open-routes.js";
import { readLocalDashboardFile, safeRelative } from "../../src/admin/local-dashboard.js";
import { startAdminServer } from "../../src/admin/admin-server.js";

const PORT = 7787;
const HEADERS = { host: `127.0.0.1:${PORT}`, contentType: "application/json" };

function deps(built: boolean, entry: string = DASHBOARD_ENTRY): ConsoleDeps {
  return {
    port: PORT,
    fs: {
      root: "C:/proj",
      exists: (r) => built && r === entry,
      readText: () => "",
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

const open = (built: boolean, path: string) =>
  createConsole(deps(built)).handle({ method: "POST", path, query: {}, headers: HEADERS, body: "{}" });

const officeOpen = (built: boolean) =>
  createConsole(deps(built, OFFICE_ENTRY)).handle({
    method: "POST",
    path: "/api/open/office",
    query: {},
    headers: HEADERS,
    body: "{}",
  });

describe("browser launcher", () => {
  const urls: string[] = [];
  beforeAll(() => setBrowserLauncher((u) => (urls.push(u), true)));
  afterAll(() => resetBrowserLauncher());
  afterEach(() => (urls.length = 0));

  it("does not call the launcher without a request, and the real launcher is blocked under test", () => {
    expect(urls).toEqual([]);
    resetBrowserLauncher();
    try {
      expect(process.env["VITEST"]).toBeTruthy();
      expect(openInBrowser("http://127.0.0.1:1/")).toBe(false);
      expect(typeof spawnBrowser).toBe("function");
    } finally {
      setBrowserLauncher((u) => (urls.push(u), true));
    }
    expect(urls).toEqual([]);
  });

  it("calls the stub exactly once with the Dashboard URL when the Dashboard is built", async () => {
    const r = await open(true, "/api/open/dashboard");
    expect(r.status).toBe(200);
    expect(urls).toEqual([`http://127.0.0.1:${PORT}/local-dashboard/`]);
    expect(r.json).toMatchObject({ launched: true, built: true, url: `http://127.0.0.1:${PORT}/local-dashboard/` });
  });

  it("launches nothing and explains how to build when the Dashboard is missing", async () => {
    const r = await open(false, "/api/open/dashboard");
    expect(urls).toEqual([]);
    expect(r.json).toMatchObject({ launched: false, built: false, message: DASHBOARD_MISSING_TEXT });
    expect(DASHBOARD_MISSING_TEXT).toContain("node dist/index.js run");
    expect(DASHBOARD_MISSING_TEXT).not.toContain("dashboard.html");
  });

  it("opens the published Virtual Office through the stub exactly once when built", async () => {
    const r = await officeOpen(true);
    expect(urls).toEqual([`http://127.0.0.1:${PORT}/local-dashboard/office/`]);
    expect(r.json).toMatchObject({ launched: true, built: true });
  });

  it("launches nothing with the run-once message when the Virtual Office is not published", async () => {
    const r = await officeOpen(false);
    expect(urls).toEqual([]);
    expect(r.json).toMatchObject({ launched: false, built: false, message: DASHBOARD_MISSING_TEXT });
  });
});

describe("local dashboard static route", () => {
  it("accepts only plain whitelisted paths", () => {
    expect(safeRelative("/local-dashboard/")).toBe("index.html");
    expect(safeRelative("/local-dashboard/views/a.js")).toBe("views/a.js");
    for (const bad of [
      "/local-dashboard/../secret.json",
      "/local-dashboard/%2e%2e/secret.json",
      "/local-dashboard/..%2fsecret.json",
      "/local-dashboard/a%5c..%5cb.js",
      "/local-dashboard/views//a.js",
      "/local-dashboard/views/",
      "/local-dashboard/.env",
      "/local-dashboard/a.exe",
      "/local-dashboard/noext",
      "/local-dashboard/%zz.js",
    ]) {
      expect(safeRelative(bad), bad).toBeNull();
    }
  });

  let dir = "";
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "awg-ld-"));
    mkdirSync(join(dir, "data"));
    writeFileSync(join(dir, "index.html"), '<html><script type="module">1</script><script src="./app.js"></script></html>');
    writeFileSync(join(dir, "app.js"), "export {};");
    writeFileSync(join(dir, "data", "index.json"), "{}");
    writeFileSync(join(dir, "secret.txt"), "no");
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("reads built files with content types, hashes inline scripts, and 404s everything else", () => {
    const html = readLocalDashboardFile("/local-dashboard/", dir);
    expect(html.status).toBe(200);
    expect(html.contentType).toContain("text/html");
    expect(html.csp).toMatch(/script-src 'self' 'sha256-[A-Za-z0-9+/=]+'/);
    expect(readLocalDashboardFile("/local-dashboard/app.js", dir).contentType).toContain("text/javascript");
    expect(readLocalDashboardFile("/local-dashboard/data/index.json", dir).contentType).toContain("application/json");
    expect(readLocalDashboardFile("/local-dashboard/secret.txt", dir).status).toBe(404);
    expect(readLocalDashboardFile("/local-dashboard/data", dir).status).toBe(404);
    expect(readLocalDashboardFile("/local-dashboard/missing.js", dir).status).toBe(404);
    expect(readLocalDashboardFile("/local-dashboard/", join(dir, "nope")).status).toBe(404);
  });

  it("serves over real HTTP on an ephemeral port, with the Host check, and rejects traversal", async () => {
    const port = await new Promise<number>((res, rej) => {
      const s = createNetServer();
      s.once("error", rej);
      s.listen(0, "127.0.0.1", () => {
        const p = (s.address() as { port: number }).port;
        s.close(() => res(p));
      });
    });
    expect(port).not.toBe(PORT);
    const logSpy = console.log;
    console.log = () => undefined;
    const server = startAdminServer({ port, deps: { ...deps(true), port }, localDashboardRoot: dir });
    const get = (path: string, host: string) =>
      new Promise<{ status: number; csp?: string; nosniff?: string }>((res, rej) => {
        const q = request({ host: "127.0.0.1", port, path, method: "GET", headers: { host } }, (r) => {
          r.resume();
          r.on("end", () =>
            res({
              status: r.statusCode ?? 0,
              csp: r.headers["content-security-policy"] as string | undefined,
              nosniff: r.headers["x-content-type-options"] as string | undefined,
            }),
          );
        });
        q.on("error", rej);
        q.end();
      });
    try {
      await new Promise<void>((res) => (server.listening ? res() : server.once("listening", () => res())));
      const ok = await get("/local-dashboard/", `127.0.0.1:${port}`);
      expect(ok.status).toBe(200);
      expect(ok.nosniff).toBe("nosniff");
      expect(ok.csp).toContain("frame-ancestors 'none'");
      expect((await get("/local-dashboard/app.js", `127.0.0.1:${port}`)).status).toBe(200);
      expect((await get("/local-dashboard/%2e%2e/secret.txt", `127.0.0.1:${port}`)).status).toBe(404);
      expect((await get("/local-dashboard/secret.txt", `127.0.0.1:${port}`)).status).toBe(404);
      expect((await get("/local-dashboard/", "evil.example.com")).status).toBe(403);
    } finally {
      console.log = logSpy;
      await new Promise<void>((res) => server.close(() => res()));
    }
  });
});
