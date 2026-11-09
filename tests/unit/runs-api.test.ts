import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConsole } from "../../src/admin/console-router.js";
import { readLogPage, resetRunsSync, runsApiHooks, waitForRunsSync, LOG_MAX_BYTES } from "../../src/admin/runs-api.js";
import type { ConsoleDeps, GitPort, GitResult } from "../../src/admin/console-deps.js";

let root: string;
const A = "run_aaaaaa111111";
const B = "run_bbbbbb222222";
const SHA = "c".repeat(40);
const ok = (stdout = ""): GitResult => ({ code: 0, stdout, stderr: "" });
const realHooks = { ...runsApiHooks };

function deps(git: GitPort): ConsoleDeps {
  return {
    port: 7787,
    fs: {
      root,
      exists: () => false,
      readText: () => "",
      readBytes: () => new Uint8Array(),
      writeText: () => undefined,
      listDir: () => [],
    },
    git,
    jobs: { current: () => null, start: () => ({ ok: false, reason: "no" }) },
    approval: { authorizeSetupAction: () => undefined, approveVisualBaseline: () => undefined },
    clock: { now: () => new Date("2030-01-01T00:00:00.000Z") },
  };
}

const fakeGit: GitPort = {
  run: async (args) => (args[0] === "remote" ? ok("https://user:pw@github.com/acme/site.git\n") : ok()),
};

const hdr = { host: "127.0.0.1:7787" };
const get = (c: ReturnType<typeof createConsole>, path: string, query: Record<string, string> = {}) =>
  c.handle({ method: "GET", path, query, headers: hdr, body: null });
type J = Record<string, any>;

function mkRun(id: string, finishedAt: string, files: Record<string, string> = {}): void {
  const dir = join(root, "artifacts", "runs", id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "findings.json"), JSON.stringify({ runId: id, pages: [{}, {}] }));
  writeFileSync(
    join(dir, "events.jsonl"),
    JSON.stringify({ kind: "run.record", data: { finishedAt, result: "pass" } }) + "\n",
  );
  for (const [n, t] of Object.entries(files)) writeFileSync(join(dir, n), t);
}

beforeEach(() => {
  resetRunsSync();
  root = mkdtempSync(join(tmpdir(), "runs-api-"));
  mkdirSync(join(root, "artifacts", "runs"), { recursive: true });
});
afterEach(() => {
  Object.assign(runsApiHooks, realHooks);
  rmSync(root, { recursive: true, force: true });
});

describe("GET /api/runs", () => {
  it("lists runs newest first, flags latest, maps the GitHub run", async () => {
    mkRun(A, "2030-01-01T00:00:00.000Z");
    mkRun(B, "2030-02-01T00:00:00.000Z", {
      "run-source.json": JSON.stringify({ trigger: "push", githubRunId: "12345", sha: SHA }),
    });
    const r = await get(createConsole(deps(fakeGit)), "/api/runs");
    const j = r.json as J;
    expect(r.status).toBe(200);
    expect(j.runs.map((x: J) => x.runId)).toEqual([B, A]);
    expect(j.runs[0].latest).toBe(true);
    expect(j.runs[1].latest).toBe(false);
    expect(j.runs[0].trigger).toBe("push");
    expect(j.runs[0].githubRunUrl).toBe("https://github.com/acme/site/actions/runs/12345");
    expect(j.runs[1].githubRunUrl).toBeNull();
    expect(j.runs[0].hasLogs).toBe(true);
  });

  it("returns an empty list when there are no runs (nothing fabricated)", async () => {
    const j = (await get(createConsole(deps(fakeGit)), "/api/runs")).json as J;
    expect(j.runs).toEqual([]);
    expect(j.latestRunId).toBeNull();
  });
});

describe("GET /api/runs/:id", () => {
  it("returns sections and logs; a corrupt source does not break the rest", async () => {
    mkRun(A, "2030-01-01T00:00:00.000Z", { "run-source.json": "{not json", "results.json": "{\"pages\":[{}]}" });
    const r = await get(createConsole(deps(fakeGit)), `/api/runs/${A}`);
    const j = r.json as J;
    expect(r.status).toBe(200);
    expect(j.ok).toBe(true);
    expect(j.source.ok).toBe(false);
    expect(j.results).toMatchObject({ ok: true, pages: 1 });
    expect(j.findings.ok).toBe(true);
    expect(j.logs.map((l: J) => l.name)).toEqual(["events"]);
    expect(j.audit.ok).toBe(false);
    expect(j.unreadable).toContain("run-source");
  });

  it("rejects bad ids and 404s unknown runs", async () => {
    const c = createConsole(deps(fakeGit));
    expect((await get(c, "/api/runs/..")).status).toBe(400);
    expect((await get(c, "/api/runs/run_UPPER1")).status).toBe(400);
    expect((await get(c, "/api/runs/run_zzzzzz999999")).status).toBe(404);
  });
});

describe("GET /api/runs/:id/log", () => {
  it("scrubs secrets and absolute paths, as plain text", async () => {
    const line = JSON.stringify({
      time: "t1",
      kind: "note",
      message: `ghp_abcdefghijklmnop at ${join(root, "x", "y.txt")}`,
    });
    mkRun(A, "2030-01-01T00:00:00.000Z", { "audit.jsonl": line + "\nraw <b>text</b>\n" });
    const c = createConsole(deps(fakeGit));
    for (const r of [await get(c, `/api/runs/${A}/log`, { file: "audit" }), await get(c, `/api/runs/${A}/log/audit`)]) {
      const j = r.json as J;
      expect(r.status).toBe(200);
      const all = j.lines.join("\n");
      expect(all).not.toContain("ghp_");
      expect(all).not.toContain(root);
      expect(all).toContain("t1 note");
      expect(all).toContain("raw <b>text</b>");
      expect(j.truncated).toBe(false);
    }
  });

  it("rejects names outside the whitelist and bad offsets", async () => {
    mkRun(A, "2030-01-01T00:00:00.000Z");
    const c = createConsole(deps(fakeGit));
    for (const f of ["findings.json", "../x", "events.jsonl", "", "constructor"]) {
      expect((await get(c, `/api/runs/${A}/log`, { file: f })).status).toBe(400);
    }
    expect((await get(c, `/api/runs/${A}/log`, { file: "events", before: "-1" })).status).toBe(400);
    expect((await get(c, `/api/runs/${A}/log/audit`)).status).toBe(404);
  });

  it("truncates to 128 KB and pages backwards without gaps or repeats", () => {
    const lines: string[] = [];
    for (let i = 0; i < 6000; i++) lines.push(`line-${String(i).padStart(5, "0")}-${"x".repeat(40)}`);
    const p = join(root, "big.log");
    writeFileSync(p, lines.join("\n") + "\n");
    const got: string[] = [];
    let before: number | undefined;
    let pages = 0;
    for (;;) {
      const pg = readLogPage(p, before);
      expect(pg.lines.join("\n").length).toBeLessThanOrEqual(LOG_MAX_BYTES);
      got.unshift(...pg.lines);
      pages++;
      if (!pg.truncated) break;
      before = pg.startOffset;
    }
    expect(pages).toBeGreaterThan(1);
    expect(got).toEqual(lines);
  });
});

describe("POST /api/sync", () => {
  it("pulls runs then decisions, single-flight, no real remote", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const calls: string[] = [];
    runsApiHooks.cloudSync = async (o) => {
      calls.push(`cloud:${o.branch}`);
      await gate;
      return { added: ["run_new111111"], skipped: [], ok: true };
    };
    runsApiHooks.pullDispositions = async () => {
      calls.push("pull");
      return { ok: true, added: 2 };
    };
    const c = createConsole(deps(fakeGit));
    const post = () =>
      c.handle({ method: "POST", path: "/api/sync", query: {}, headers: { ...hdr, contentType: "application/json" }, body: "{}" });
    expect((await post()).status).toBe(202);
    expect((await post()).status).toBe(409);
    release();
    await waitForRunsSync(root);
    const s = (await get(c, "/api/sync/status")).json as J;
    expect(s.state).toBe("done");
    expect(s.runs).toMatchObject({ ok: true, added: 1 });
    expect(s.decisions).toMatchObject({ ok: true, added: 2 });
    expect(calls).toEqual(["cloud:runs-data", "pull"]);
  });

  it("reports a failed pull with a scrubbed reason and still pulls decisions", async () => {
    runsApiHooks.cloudSync = async () => ({ added: [], skipped: [], ok: false, reason: `offline at ${root}` });
    runsApiHooks.pullDispositions = async () => ({ ok: false, reason: "no remote" });
    const c = createConsole(deps(fakeGit));
    await c.handle({ method: "POST", path: "/api/sync", query: {}, headers: { ...hdr, contentType: "application/json" }, body: "{}" });
    await waitForRunsSync(root);
    const s = (await get(c, "/api/sync/status")).json as J;
    expect(s.runs.ok).toBe(false);
    expect(s.runs.reason).not.toContain(root);
    expect(s.decisions.ok).toBe(false);
  });
});
