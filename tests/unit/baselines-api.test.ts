import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConsole } from "../../src/admin/console-router.js";
import { realFs } from "../../src/admin/console-deps.js";
import type { ConsoleDeps, SetupActionInput, VisualBaselineInput } from "../../src/admin/console-deps.js";
import { SelfApprovalError } from "../../src/approval/approval-gate.js";
import type { JobSpec, JobStatus } from "../../src/admin/job-runner.js";

let root: string;
let authCalls: SetupActionInput[];
let visualCalls: VisualBaselineInput[];
let specCalls: { reviewer: string; slug: string }[];
let started: JobSpec[];
let status: JobStatus;

const CAP = "cap_0123456789ab";
const SLUG = "example-test";
const PNG_A = Buffer.from([137, 80, 78, 71, 1, 2, 3, 4]);
const PNG_B = Buffer.from([137, 80, 78, 71, 9, 9, 9, 9]);
const h16 = (b: Buffer) => createHash("sha256").update(b).digest("hex").slice(0, 16);

function put(rel: string, data: string | Buffer): void {
  const p = join(root, rel);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, data);
}
function idle(): JobStatus {
  return { state: "idle", kind: null, scope: null, startedAt: null, finishedAt: null, elapsedMs: 0, exitCode: null, progress: null, tail: [] };
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
        authCalls.push(i);
      },
      approveVisualBaseline: (i) => {
        // Audit must come after the file was renamed into place.
        expect(existsSync(join(root, "baselines-visual", i.slug, `${i.viewport}.png`))).toBe(true);
        visualCalls.push(i);
      },
      approveSpecification: (i) => {
        specCalls.push({ reviewer: i.reviewer, slug: i.slug });
        return { baselinePath: "x", version: 1 };
      },
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
function capture(png: Buffer = PNG_A, sha = h16(PNG_A)): void {
  put(`artifacts/admin/captures/${CAP}/${SLUG}/desktop.png`, png);
  put(
    `artifacts/admin/captures/${CAP}/manifest.json`,
    JSON.stringify({
      captureId: CAP, domain: "example.test", createdAt: "2025-01-01T00:00:00.000Z", isMonitoringRun: false,
      entries: [{ slug: SLUG, url: "https://example.test/", viewport: "desktop", sha16: sha, size: png.length, capturedAt: "2025-01-01T00:00:00.000Z" }],
      failures: [],
    }),
  );
}
const approveBody = (extra: Record<string, unknown> = {}) => ({
  scope: "current", reviewer: "Pat Reviewer", visuals: [{ captureId: CAP, slug: SLUG, viewport: "desktop" }], ...extra,
});

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "awg-base-"));
  authCalls = [];
  visualCalls = [];
  specCalls = [];
  started = [];
  status = idle();
  put("config/app.config.json", JSON.stringify({ approvedDomain: "example.test", baseUrl: "https://example.test", domain: "example-test", limits: { pages: 4 } }));
  put("config/page-seed.json", JSON.stringify({ maxUrls: 10, approvedUrls: ["https://example.test/"] }, null, 2) + "\n");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("baselines readiness and jobs", () => {
  it("reports readiness, proposals, and the size of baselines-visual", async () => {
    capture();
    put(`baselines-visual/${SLUG}/mobile.png`, PNG_A);
    const r = await get("/api/baselines");
    expect(r.status).toBe(200);
    const j = r.json as { urls: { specBaseline: boolean; visualBaseline: { desktop: boolean; mobile: boolean }; proposals: { visual: { desktop: boolean } } }[]; visualBaselinesBytes: number };
    expect(j.urls[0].specBaseline).toBe(false);
    expect(j.urls[0].visualBaseline).toEqual({ desktop: false, mobile: true });
    expect(j.urls[0].proposals.visual.desktop).toBe(true);
    expect(j.visualBaselinesBytes).toBe(PNG_A.length);
  });

  it("starts the capture and draft jobs with fixed kinds and refuses when busy", async () => {
    const a = await post("/api/baselines/visual/capture", { scope: "current" });
    expect(a.status).toBe(202);
    expect(started[0].kind).toBe("visual-capture");
    expect(started[0].env?.AWG_CAPTURE_ID).toMatch(/^cap_[0-9a-f]{12}$/);
    expect((await post("/api/baselines/spec/draft", {})).status).toBe(409);
    status = idle();
    expect((await post("/api/baselines/spec/draft", {})).status).toBe(202);
    expect(started[1].kind).toBe("spec-drafts");
    expect(existsSync(join(root, "baselines-visual"))).toBe(false);
  });
});

describe("image route", () => {
  it("serves a manifest-listed PNG and rejects unknown or traversal ids", async () => {
    capture();
    const ok = await get("/api/baselines/image", { kind: "proposal", id: CAP, slug: SLUG, viewport: "desktop" });
    expect(ok.status).toBe(200);
    expect(Buffer.from(ok.bytes ?? new Uint8Array()).equals(PNG_A)).toBe(true);
    for (const id of ["../x", "cap_ffffffffffff", "C:\\x"]) {
      const r = await get("/api/baselines/image", { kind: "proposal", id, slug: SLUG, viewport: "desktop" });
      expect([400, 404]).toContain(r.status);
    }
    expect((await get("/api/baselines/image", { kind: "proposal", id: CAP, slug: "../a", viewport: "desktop" })).status).toBe(400);
  });
});

describe("approve", () => {
  it("promotes byte-for-byte, audits after the rename, and writes one setup log entry", async () => {
    capture();
    const r = await post("/api/baselines/approve", approveBody());
    expect(r.status).toBe(200);
    const dest = join(root, "baselines-visual", SLUG, "desktop.png");
    expect(readFileSync(dest).equals(PNG_A)).toBe(true);
    expect(visualCalls).toHaveLength(1);
    expect(visualCalls[0]).toMatchObject({ reviewer: "Pat Reviewer", slug: SLUG, viewport: "desktop", sha16: h16(PNG_A), updated: false });
    const log = readFileSync(join(root, "artifacts/admin/setup-activity.jsonl"), "utf8").trim().split("\n");
    expect(log).toHaveLength(1);
    const entry = JSON.parse(log[0]) as { action: string; reviewer: string; counts: Record<string, number> };
    expect(entry.action).toBe("baselines-approved");
    expect(entry.reviewer).toBe("Pat Reviewer");
    expect(entry.counts).toMatchObject({ pages: 1, viewports: 1 });
    expect(existsSync(join(root, "artifacts/runs"))).toBe(false);

    // Same bytes again: skipped, no new audit entry, no new setup log entry.
    const again = await post("/api/baselines/approve", approveBody());
    expect((again.json as { unchanged: number }).unchanged).toBe(1);
    expect(visualCalls).toHaveLength(1);
    expect(readFileSync(join(root, "artifacts/admin/setup-activity.jsonl"), "utf8").trim().split("\n")).toHaveLength(1);
  });

  it("refuses an item whose file no longer matches the manifest sha16", async () => {
    capture(PNG_B, h16(PNG_A));
    const r = await post("/api/baselines/approve", approveBody());
    expect(r.status).toBe(200);
    expect((r.json as { refused: number }).refused).toBe(1);
    expect(existsSync(join(root, "baselines-visual", SLUG, "desktop.png"))).toBe(false);
    expect(visualCalls).toHaveLength(0);
  });

  it("requires a Reviewer name and rejects agents without promoting", async () => {
    capture();
    expect((await post("/api/baselines/approve", approveBody({ reviewer: "  " }))).status).toBe(400);
    expect((await post("/api/baselines/approve", approveBody({ reviewer: "agent-bot" }))).status).toBe(403);
    expect(existsSync(join(root, "baselines-visual"))).toBe(false);
    expect(existsSync(join(root, "artifacts/admin/setup-activity.jsonl"))).toBe(false);
  });

  it("rejects invalid ids and promotes a spec draft through the gate port", async () => {
    capture();
    const bad = await post("/api/baselines/approve", approveBody({ visuals: [{ captureId: "../x", slug: SLUG, viewport: "desktop" }] }));
    expect(bad.status).toBe(400);
    put(`artifacts/pending-review/spec-drafts/${SLUG}.draft.md`, "# Draft\n- **State:** draft\n");
    const r = await post("/api/baselines/approve", { scope: "current", reviewer: "Pat Reviewer", specs: [SLUG] });
    expect(r.status).toBe(200);
    expect(specCalls).toEqual([{ reviewer: "Pat Reviewer", slug: SLUG }]);
  });
});
