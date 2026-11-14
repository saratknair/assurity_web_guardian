/**
 * Lock-in tests for the code-pattern security review.
 * They fail if a dangerous construct appears in own code, if a file-serving or file-writing
 * path stops rejecting traversal, if the console stops binding to loopback only, or if a
 * state-changing route stops refusing a foreign Host or Origin.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { startAdminServer } from "../../src/admin/admin-server.js";
import { resolveInside } from "../../src/admin/atomic-file.js";
import { isSafeBranchName, isSafeRelativePath, isSafeRunId } from "../../src/admin/cloud-sync.js";
import type { RouteDef } from "../../src/admin/console-routes.js";
import { readLocalDashboardFile, safeRelative } from "../../src/admin/local-dashboard.js";
import { browserCommand } from "../../src/admin/open-routes.js";
import { renderReportHtml, type ReportModel } from "../../src/reporting/report.js";

// ---------------------------------------------------------------------------
// Source scan: no code-execution or HTML-injection APIs in own code
// ---------------------------------------------------------------------------

const OWN_DIRS = ["src", "scripts", "admin-ui", "dashboard", "office"];
const SOURCE_EXT = /\.(ts|js|mjs|cjs)$/;

function ownSourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      if (name === "vendor" || name === "node_modules") continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (SOURCE_EXT.test(name)) out.push(full);
    }
  };
  for (const d of OWN_DIRS) walk(join(process.cwd(), d));
  return out;
}

/** Lines matching `re`, as "file:line". Comment-only lines are skipped. */
function scan(re: RegExp): string[] {
  const hits: string[] = [];
  for (const file of ownSourceFiles()) {
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      if (re.test(line)) hits.push(`${relative(process.cwd(), file)}:${i + 1}`);
    });
  }
  return hits;
}

describe("own-code source scan", () => {
  it("finds source files to scan", () => {
    expect(ownSourceFiles().length).toBeGreaterThan(50);
  });

  it("has no eval or Function constructor (Playwright $eval/$$eval are allowed)", () => {
    expect(scan(/(?<![\w$.])eval\s*\(/)).toEqual([]);
    expect(scan(/\bnew\s+Function\s*\(|(?<![\w$.])Function\s*\(\s*["'`]/)).toEqual([]);
  });

  it("has no string-argument timers", () => {
    expect(scan(/\bset(Timeout|Interval)\s*\(\s*["'`]/)).toEqual([]);
  });

  it("has no HTML-injection APIs", () => {
    expect(scan(/\.\s*(innerHTML|outerHTML)\b|insertAdjacentHTML\s*\(|document\s*\.\s*write(ln)?\s*\(/)).toEqual([]);
  });

  it("has no shell-mode child processes", () => {
    expect(scan(/\bshell\s*:\s*true\b/)).toEqual([]);
    // Bare exec()/execSync() run a shell string; a regex `.exec(` is preceded by "." and is fine.
    expect(scan(/(?<![\w$.])(exec|execSync)\s*\(/)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Path traversal: helper and file-serving routes
// ---------------------------------------------------------------------------

describe("resolveInside rejects traversal", () => {
  const root = join(tmpdir(), "awg-sec-root");
  const bad = ["..", "../x", "a/../../x", "a\\..\\..\\x", "/abs", "\\abs", "C:\\x", "C:x", "a\0b"];
  for (const seg of bad) {
    it(`rejects ${JSON.stringify(seg)}`, () => {
      expect(() => resolveInside(root, seg)).toThrow();
    });
  }

  it("accepts a plain nested path and stays inside the root", () => {
    expect(resolveInside(root, "a", "b.json").startsWith(join(tmpdir(), "awg-sec-root"))).toBe(true);
  });
});

describe("local dashboard static route rejects traversal", () => {
  const prefix = "/local-dashboard/";
  const bad = [
    "../package.json",
    "%2e%2e/package.json",
    "%2E%2E%2Fpackage.json",
    "..%2fpackage.json",
    "..%5cpackage.json",
    "a/..%2f..%2fpackage.json",
    "a\\b.json",
    "%00.json",
    "index.html%00.png",
    "%252e%252e/package.json",
    "/etc/passwd.json",
    "C:/x.json",
    "data/.hidden.json",
    "noext",
    "secret.txt",
  ];
  for (const p of bad) {
    it(`refuses ${p}`, () => {
      expect(safeRelative(prefix + p)).toBeNull();
    });
  }

  it("never reads a file outside the published folder, even if one exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "awg-sec-dash-"));
    try {
      const root = join(dir, "published");
      mkdirSync(root);
      writeFileSync(join(root, "index.html"), "<p>ok</p>");
      writeFileSync(join(dir, "outside.json"), "{}");
      expect(readLocalDashboardFile(prefix + "index.html", root).status).toBe(200);
      expect(readLocalDashboardFile(prefix + "..%2foutside.json", root).status).toBe(404);
      expect(readLocalDashboardFile(prefix + "../outside.json", root).status).toBe(404);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("cloud sync guards for remote-supplied names", () => {
  it("accepts plain branch names and refuses option-like or revision-like ones", () => {
    expect(isSafeBranchName("runs-data")).toBe(true);
    expect(isSafeBranchName("release/1.0")).toBe(true);
    for (const b of ["", "-x", "--upload-pack=x", "a..b", "a b", "a;b", "a$(x)", "a/", "x.lock", "a:b", "\0"]) {
      expect(isSafeBranchName(b)).toBe(false);
    }
  });

  it("accepts plain run ids and refuses separators and dot segments", () => {
    expect(isSafeRunId("run_abc123")).toBe(true);
    for (const id of ["", ".", "..", "../x", "a/b", "a\\b", "-x", "a..b"]) expect(isSafeRunId(id)).toBe(false);
  });

  it("refuses relative paths that could leave the staging folder", () => {
    expect(isSafeRelativePath("axe/home.json")).toBe(true);
    for (const p of ["", "../x", "a/../x", "a//b", "./a", "a\\b", "C:/x", "a/\0b"]) expect(isSafeRelativePath(p)).toBe(false);
  });
});

describe("browser launcher", () => {
  it("opens only plain loopback http URLs and passes them as a single argument", () => {
    expect(browserCommand("linux", "http://127.0.0.1:7787/local-dashboard/")?.args).toEqual(["http://127.0.0.1:7787/local-dashboard/"]);
    for (const u of [
      "https://127.0.0.1:7787/",
      "http://evil.example/",
      "http://127.0.0.1:7787/&calc",
      "http://127.0.0.1:7787/ x",
      "file:///c:/windows/system32/calc.exe",
      "javascript:alert(1)",
    ]) {
      expect(browserCommand("win32", u)).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// Report HTML: values are escaped in text and in attributes
// ---------------------------------------------------------------------------

describe("report HTML escaping", () => {
  it("escapes quotes so an evidence path cannot break out of the href attribute", () => {
    const m = {
      runId: "run_x",
      correlationId: "c",
      generatedAt: "t",
      pages: [
        {
          page: "<b>p</b>",
          slug: "p",
          baselineVersion: "1",
          checks: [],
          outcomes: [],
          aiItems: [],
          visual: {},
          evidence: [{ kind: "screenshot", path: 'shots/a" onmouseover="alert(1).png' }],
        },
      ],
      agentStatuses: [],
      websiteHealth: "healthy",
      totalFailedChecks: 0,
      pendingReview: false,
    } as unknown as ReportModel;
    const html = renderReportHtml(m);
    expect(html).not.toContain('" onmouseover="');
    expect(html).toContain("&quot; onmouseover=&quot;");
    expect(html).not.toContain("<b>p</b>");
  });
});

// ---------------------------------------------------------------------------
// Console server: loopback bind, Host/Origin rejection, traversal over HTTP
// ---------------------------------------------------------------------------

let server: Server;
let port = 0;
let seenBody: unknown;

const probe: RouteDef = {
  method: "POST",
  pattern: "/api/probe",
  mutating: true,
  maxBodyBytes: 64,
  handler: async (ctx) => {
    seenBody = ctx.body;
    return { status: 200, json: { ok: true } };
  },
};

/** Send a request with a verbatim path (no client-side normalisation) and chosen headers. */
function send(
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: string,
): Promise<{ status: number; text: string }> {
  return new Promise((res, rej) => {
    const req = request({ host: "127.0.0.1", port, method, path, headers: { host: `127.0.0.1:${port}`, ...headers } }, (r) => {
      let text = "";
      r.on("data", (c) => (text += c));
      r.on("end", () => res({ status: r.statusCode ?? 0, text }));
    });
    req.on("error", rej);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

describe("console server", () => {
  let staticRoot = "";

  beforeAll(async () => {
    staticRoot = mkdtempSync(join(tmpdir(), "awg-sec-srv-"));
    server = startAdminServer({ port: 0, routes: [probe], localDashboardRoot: staticRoot });
    await new Promise((r) => server.once("listening", r));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise((r) => server.close(() => r(null)));
    rmSync(staticRoot, { recursive: true, force: true });
  });

  it("binds to 127.0.0.1 only, never a wildcard address", () => {
    const addr = server.address() as AddressInfo;
    expect(addr.address).toBe("127.0.0.1");
    expect(["0.0.0.0", "::", "::1"]).not.toContain(addr.address);
  });

  it("hard-codes the loopback host in the server source", () => {
    const src = readFileSync(join(process.cwd(), "src/admin/admin-server.ts"), "utf8");
    expect(src).toMatch(/const HOST = "127\.0\.0\.1";/);
    expect(src).toMatch(/server\.listen\(port, HOST,/);
    // Comments may mention the wildcard address; code must not use it or omit the host.
    const code = src.split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    expect(code).not.toMatch(/0\.0\.0\.0|listen\(\s*port\s*\)/);
  });

  const json = { "content-type": "application/json" };

  it("accepts a same-origin loopback POST (control)", async () => {
    seenBody = undefined;
    const r = await send("POST", "/api/probe", { ...json, origin: `http://127.0.0.1:${port}` }, "{}");
    expect(r.status).toBe(200);
    expect(seenBody).toEqual({});
  });

  it("rejects a POST with a foreign Host (DNS rebinding) without running the handler", async () => {
    seenBody = undefined;
    for (const host of ["evil.example", `evil.example:${port}`, `127.0.0.1.evil.example:${port}`, "127.0.0.1:1"]) {
      const r = await send("POST", "/api/probe", { ...json, host }, "{}");
      expect(r.status).toBe(403);
    }
    expect(seenBody).toBeUndefined();
  });

  it("rejects a POST with a foreign Origin (CSRF) without running the handler", async () => {
    seenBody = undefined;
    for (const origin of ["http://evil.example", "null", `http://127.0.0.1.evil.example:${port}`, `https://127.0.0.1:${port}`]) {
      const r = await send("POST", "/api/probe", { ...json, origin }, "{}");
      expect(r.status).toBe(403);
    }
    expect(seenBody).toBeUndefined();
  });

  it("rejects cross-site fetch metadata and non-JSON bodies on a POST", async () => {
    const cross = await send("POST", "/api/probe", { ...json, "sec-fetch-site": "cross-site" }, "{}");
    expect(cross.status).toBe(403);
    const form = await send("POST", "/api/probe", { "content-type": "application/x-www-form-urlencoded" }, "a=1");
    expect(form.status).toBe(403);
    expect(seenBody).toBeUndefined();
  });

  it("rejects foreign Host on static asset and local-dashboard reads", async () => {
    expect((await send("GET", "/assets/console.js", { host: "evil.example" })).status).toBe(403);
    expect((await send("GET", "/local-dashboard/", { host: "evil.example" })).status).toBe(403);
  });

  it("answers 404 for encoded traversal on /assets and /local-dashboard", async () => {
    writeFileSync(join(staticRoot, "index.html"), "<p>ok</p>");
    writeFileSync(join(staticRoot, "..", "awg-sec-outside.json"), "{}");
    try {
      const paths = [
        "/assets/%2e%2e/package.json",
        "/assets/..%2fpackage.json",
        "/assets/sections/..%2f..%2fpackage.json",
        "/assets/lib/%2e%2e%2fconsole.js",
        "/assets/sections/%00.js",
        "/local-dashboard/%2e%2e/awg-sec-outside.json",
        "/local-dashboard/..%2fawg-sec-outside.json",
        "/local-dashboard/..%5cawg-sec-outside.json",
        "/local-dashboard/%252e%252e/awg-sec-outside.json",
        "/local-dashboard/%00.json",
      ];
      for (const p of paths) {
        const r = await send("GET", p);
        expect(r.status, p).toBe(404);
        expect(r.text, p).not.toContain("{}");
      }
      expect((await send("GET", "/local-dashboard/")).status).toBe(200);
    } finally {
      rmSync(join(staticRoot, "..", "awg-sec-outside.json"), { force: true });
    }
  });
});

describe("run routes reject traversal in :id and :name", () => {
  let runServer: Server;
  let runPort = 0;

  beforeAll(async () => {
    runServer = startAdminServer({ port: 0 });
    await new Promise((r) => runServer.once("listening", r));
    runPort = (runServer.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise((r) => runServer.close(() => r(null)));
  });

  function get(path: string): Promise<number> {
    return new Promise((res, rej) => {
      const req = request({ host: "127.0.0.1", port: runPort, method: "GET", path, headers: { host: `127.0.0.1:${runPort}` } }, (r) => {
        r.resume();
        r.on("end", () => res(r.statusCode ?? 0));
      });
      req.on("error", rej);
      req.end();
    });
  }

  it("answers 400 or 404 and never serves a file", async () => {
    const paths = [
      "/api/runs/..%2f..%2fpackage.json",
      "/api/runs/%2e%2e%2f%2e%2e%2fpackage.json",
      "/api/runs/run_abcdef%2f..%2f..%2fpackage.json",
      "/api/runs/run_abcdef/log/..%2f..%2fpackage.json",
      "/api/runs/run_abcdef/log?file=..%2f..%2fpackage.json",
      "/api/runs/..%5c..%5cpackage.json/log/events",
    ];
    for (const p of paths) {
      const status = await get(p);
      expect([400, 404], p).toContain(status);
    }
  });
});
