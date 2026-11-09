import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConsole } from "../../src/admin/console-router.js";
import { realFs } from "../../src/admin/console-deps.js";
import type { ConsoleDeps, SetupActionInput } from "../../src/admin/console-deps.js";
import { SelfApprovalError } from "../../src/approval/approval-gate.js";
import { discoveryChecks } from "../../src/admin/discovery-api.js";
import { JOB_SCRIPTS } from "../../src/admin/job-runner.js";
import type { JobSpec, JobStatus } from "../../src/admin/job-runner.js";

let root: string;
let calls: SetupActionInput[];
let started: JobSpec[];
let status: JobStatus;
let chromium: boolean;
let dnsOk: boolean;
const realChecks = { ...discoveryChecks };

const CAND_REL = "artifacts/admin/candidates.json";

function put(rel: string, text: string): void {
  const p = join(root, rel);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, text, "utf8");
}
function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}
function idle(): JobStatus {
  return {
    state: "idle", kind: null, scope: null, startedAt: null, finishedAt: null,
    elapsedMs: 0, exitCode: null, progress: null, tail: [],
  };
}

function deps(): ConsoleDeps {
  const jobs = {
    status: () => status,
    start: (spec: JobSpec) => {
      if (status.state === "running") return { ok: false, reason: "busy", detail: "Another job is already running" };
      started.push(spec);
      status = { ...idle(), state: "running", kind: spec.kind, scope: spec.scope ?? null, startedAt: "2025-01-02T03:04:05.000Z" };
      return { ok: true };
    },
  };
  return {
    port: 7787,
    fs: realFs(root),
    git: { run: async () => ({ code: 0, stdout: "", stderr: "" }) },
    jobs: jobs as unknown as ConsoleDeps["jobs"],
    approval: {
      authorizeSetupAction: (i) => {
        if (/agent/i.test(i.reviewer)) throw new SelfApprovalError("agent identity rejected");
        calls.push(i);
      },
      approveVisualBaseline: () => undefined,
    },
    clock: { now: () => new Date("2025-01-02T03:04:05.000Z") },
  };
}

const headers = { host: "127.0.0.1:7787", contentType: "application/json" };
async function post(path: string, body: unknown) {
  return createConsole(deps()).handle({ method: "POST", path, query: {}, headers, body: JSON.stringify(body) });
}
async function get(path: string, query: Record<string, string> = {}) {
  return createConsole(deps()).handle({ method: "GET", path, query, headers: { host: headers.host }, body: null });
}

function candidates(domain: string, list: Record<string, unknown>[]): string {
  return JSON.stringify({ generatedAt: "2025-01-01T00:00:00.000Z", approvedDomain: domain, candidates: list });
}
const ok = (url: string) => ({ url, httpStatus: 200, title: "T", h1: "H", concern: "", extra: "dropped" });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "awg-disc-"));
  calls = [];
  started = [];
  status = idle();
  chromium = true;
  dnsOk = true;
  discoveryChecks.chromiumInstalled = async () => chromium;
  discoveryChecks.hostResolves = async () => dnsOk;
  put(
    "config/app.config.json",
    JSON.stringify({ approvedDomain: "example.test", baseUrl: "https://example.test", domain: "example-test", limits: { pages: 4 } }),
  );
  put("config/page-seed.json", JSON.stringify({ maxUrls: 10, approvedUrls: ["https://example.test/"] }, null, 2) + "\n");
});
afterEach(() => {
  Object.assign(discoveryChecks, realChecks);
  rmSync(root, { recursive: true, force: true });
});

describe("job whitelist", () => {
  it("maps visual-capture to the script that exists", () => {
    expect(JOB_SCRIPTS["visual-capture"]).toBe("scripts/capture-baselines.mjs");
    expect(existsSync(join(process.cwd(), JOB_SCRIPTS["visual-capture"]))).toBe(true);
  });
});

describe("discovery run", () => {
  it("starts the local job with a fixed kind, returns 202, and changes nothing", async () => {
    const seed = read("config/page-seed.json");
    const r = await post("/api/discovery/run", { scope: "current" });
    expect(r.status).toBe(202);
    expect(started).toHaveLength(1);
    expect(started[0].kind).toBe("discovery");
    expect(started[0].env?.AWG_DISCOVERY_OUT).toBe(CAND_REL);
    expect(read("config/page-seed.json")).toBe(seed);
    expect(existsSync(join(root, "artifacts/admin/pending-changes.json"))).toBe(false);
  });

  it("returns 409 when a job is running and when Chromium is missing", async () => {
    chromium = false;
    const a = await post("/api/discovery/run", {});
    expect(a.status).toBe(409);
    expect(started).toHaveLength(0);
    chromium = true;
    status = { ...idle(), state: "running", kind: "spec-drafts" };
    const b = await post("/api/discovery/run", {});
    expect(b.status).toBe(409);
    expect(started).toHaveLength(0);
  });

  it("checks DNS for a draft host and passes the draft domain to the job", async () => {
    put("artifacts/admin/new-domain-draft.json", JSON.stringify({ host: "new.example", urls: [] }));
    dnsOk = false;
    expect((await post("/api/discovery/run", { scope: "draft" })).status).toBe(409);
    dnsOk = true;
    const r = await post("/api/discovery/run", { scope: "draft" });
    expect(r.status).toBe(202);
    expect(started[0].env?.AWG_DISCOVERY_DOMAIN).toBe("new.example");
    expect(started[0].env?.AWG_DISCOVERY_BASE_URL).toBe("https://new.example");
    expect(started[0].env?.AWG_DISCOVERY_OUT).toBe("artifacts/admin/new-domain/candidates.json");
  });

  it("reports job status", async () => {
    const r = await get("/api/jobs/status");
    expect(r.status).toBe(200);
    expect((r.json as { state: string }).state).toBe("idle");
  });
});

describe("candidates", () => {
  it("marks approved and approvable, drops unknown fields", async () => {
    put(
      CAND_REL,
      candidates("example.test", [
        ok("https://example.test/"),
        ok("https://example.test/a/"),
        { ...ok("https://example.test/b/"), httpStatus: 404 },
        { ...ok("https://example.test/c/"), concern: "redirected outside the guarded domain" },
      ]),
    );
    const r = await get("/api/discovery/candidates");
    const j = r.json as { state: string; candidates: Record<string, unknown>[] };
    expect(j.state).toBe("ready");
    expect(j.candidates.map((c) => [c.alreadyApproved, c.approvable])).toEqual([
      [true, false],
      [false, true],
      [false, false],
      [false, false],
    ]);
    expect(j.candidates[0]).not.toHaveProperty("extra");
  });

  it("disables approval for another domain, a failed crawl, and an empty crawl", async () => {
    put(CAND_REL, candidates("other.test", [ok("https://other.test/a/")]));
    let j = (await get("/api/discovery/candidates")).json as { state: string; outcome: string; approvalDisabled: boolean };
    expect(j.state).toBe("mismatch");
    expect(j.outcome).toContain("other.test");
    expect(j.approvalDisabled).toBe(true);

    put(CAND_REL, candidates("example.test", []));
    j = (await get("/api/discovery/candidates")).json as typeof j;
    expect(j.state).toBe("empty");

    put(CAND_REL, candidates("example.test", [ok("https://example.test/a/")]));
    status = { ...idle(), state: "failed", kind: "discovery", exitCode: 1 };
    j = (await get("/api/discovery/candidates")).json as typeof j;
    expect(j.state).toBe("failed");
    const r = await post("/api/discovery/approve", { urls: ["https://example.test/a/"], reviewer: "S. Nair" });
    expect(r.status).toBe(409);
  });
});

describe("approve", () => {
  beforeEach(() => {
    put(
      CAND_REL,
      candidates("example.test", [
        ok("https://example.test/a/"),
        ok("https://example.test/b"),
        { ...ok("https://example.test/bad/"), httpStatus: 500 },
      ]),
    );
  });

  it("stages approved candidates, logs one entry with counts, leaves the seed alone", async () => {
    const seed = read("config/page-seed.json");
    const r = await post("/api/discovery/approve", {
      urls: ["https://example.test/a/", "https://example.test/b"],
      reviewer: "S. Nair",
    });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ approved: 2, discovered: 3 });
    expect(read("config/page-seed.json")).toBe(seed);
    const pending = JSON.parse(read("artifacts/admin/pending-changes.json")) as { ops: { url: string }[] };
    expect(pending.ops.map((o) => o.url)).toEqual(["https://example.test/a/", "https://example.test/b/"]);
    const lines = read("artifacts/admin/setup-activity.jsonl").trim().split("\n");
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]) as { action: string; reviewer: string; counts: Record<string, number> };
    expect(entry.action).toBe("candidates-approved");
    expect(entry.reviewer).toBe("S. Nair");
    expect(entry.counts).toEqual({ discovered: 3, approved: 2 });
    expect(calls).toHaveLength(1);
  });

  it("rejects the whole request for unknown, failing, or over-cap URLs and stages nothing", async () => {
    const unknown = await post("/api/discovery/approve", {
      urls: ["https://example.test/a/", "https://example.test/nope/"],
      reviewer: "S. Nair",
    });
    expect(unknown.status).toBe(400);
    const bad = await post("/api/discovery/approve", { urls: ["https://example.test/bad/"], reviewer: "S. Nair" });
    expect(bad.status).toBe(400);
    expect(existsSync(join(root, "artifacts/admin/pending-changes.json"))).toBe(false);
    expect(existsSync(join(root, "artifacts/admin/setup-activity.jsonl"))).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("enforces the cap and the reviewer name and rejects agents", async () => {
    put("config/page-seed.json", JSON.stringify({ maxUrls: 10, approvedUrls: ["https://example.test/", "https://example.test/x/", "https://example.test/y/"] }));
    const cap = await post("/api/discovery/approve", {
      urls: ["https://example.test/a/", "https://example.test/b"],
      reviewer: "S. Nair",
    });
    expect(cap.status).toBe(400);
    expect(JSON.stringify(cap.json)).toContain("limit of 4");
    expect((await post("/api/discovery/approve", { urls: ["https://example.test/a/"], reviewer: "  " })).status).toBe(400);
    expect((await post("/api/discovery/approve", { urls: ["https://example.test/a/"], reviewer: "agent-bot" })).status).toBe(403);
    expect(existsSync(join(root, "artifacts/admin/pending-changes.json"))).toBe(false);
  });
});
