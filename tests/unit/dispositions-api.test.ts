import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createDisposition,
  listDispositions,
  listFindings,
  realDispositionPorts,
  type DispositionPorts,
} from "../../src/admin/dispositions-api.js";
import { createConsole } from "../../src/admin/console-router.js";
import type { ConsoleDeps } from "../../src/admin/console-deps.js";
import { SelfApprovalError } from "../../src/approval/approval-gate.js";

let root: string;
let artifacts: string;
const calls: { kind: string; id: string }[] = [];
const audits: Record<string, unknown>[] = [];
let reject: Error | null = null;
let clockMs = Date.parse("2030-01-01T00:00:00.000Z");

function ports(): DispositionPorts {
  return {
    artifactsDir: artifacts,
    gate: {
      recordDispositionDecision: (a) => {
        if (reject) throw reject;
        calls.push({ kind: a.kind, id: a.id });
        return "rev_1";
      },
    },
    audit: { append: (r) => void audits.push(r) },
    now: () => new Date(clockMs),
  };
}

function seedRun(): void {
  const dir = join(artifacts, "runs", "run_1");
  mkdirSync(join(dir, "accessibility"), { recursive: true });
  const nodes = Array.from({ length: 60 }, (_, i) => ({
    html: "<a>x</a>",
    target: [`#n${i}`],
    failureSummary: "fix",
  }));
  const axe = (url: string) => ({
    url,
    violations: [{ id: "color-contrast", impact: "serious", help: "Contrast", nodes }],
  });
  writeFileSync(join(dir, "accessibility", "home.desktop.json"), JSON.stringify(axe("https://example.test/")));
  writeFileSync(join(dir, "accessibility", "home.mobile.json"), JSON.stringify(axe("https://example.test/")));
  writeFileSync(
    join(dir, "events.jsonl"),
    JSON.stringify({ kind: "run.record", data: { finishedAt: "2029-12-31T00:00:00.000Z", result: "ok" } }) + "\n",
  );
}

const ignoreSite = {
  decision: "ignore",
  scope: "site-rule",
  ruleId: "color-contrast",
  reason: "Known",
  reviewer: "Sam",
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "disp-api-"));
  artifacts = join(root, "artifacts");
  mkdirSync(artifacts, { recursive: true });
  calls.length = 0;
  audits.length = 0;
  reject = null;
  clockMs = Date.parse("2030-01-01T00:00:00.000Z");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("createDisposition", () => {
  it("returns 201, calls the gate once, and writes the log", () => {
    const r = createDisposition(ports(), ignoreSite);
    expect(r.status).toBe(201);
    const body = r.json as { entry: { id: string; at: string; source: string }; effectiveFrom: string };
    expect(body.effectiveFrom).toBe("next-run");
    expect(body.entry.at).toBe("2030-01-01T00:00:00.000Z");
    expect(body.entry.source).toBe("admin-gui");
    expect(calls).toEqual([{ kind: "ignore", id: body.entry.id }]);
    const list = listDispositions(ports()).json as { entries: { id: string; syncState: string }[] };
    expect(list.entries).toHaveLength(1);
    expect(list.entries[0]?.syncState).toBe("not-yet-synced");
  });

  it("returns 200 for an exact duplicate without a second gate call or log entry", () => {
    expect(createDisposition(ports(), ignoreSite).status).toBe(201);
    const again = createDisposition(ports(), ignoreSite);
    expect(again.status).toBe(200);
    expect((again.json as { duplicate: boolean }).duplicate).toBe(true);
    expect(calls).toHaveLength(1);
    expect((listDispositions(ports()).json as { entries: unknown[] }).entries).toHaveLength(1);
  });

  it("returns 400 with per-field errors and touches nothing", () => {
    const r = createDisposition(ports(), { decision: "ignore", scope: "site-rule", reason: "", reviewer: "" });
    expect(r.status).toBe(400);
    const fields = (r.json as { errors: { field: string }[] }).errors.map((e) => e.field);
    expect(fields).toEqual(expect.arrayContaining(["reason", "reviewer", "matcher.ruleId"]));
    expect(calls).toHaveLength(0);
  });

  it("returns 403 on gate rejection and leaves the log untouched", () => {
    reject = new SelfApprovalError("agent names cannot approve");
    const r = createDisposition(ports(), ignoreSite);
    expect(r.status).toBe(403);
    expect((listDispositions(ports()).json as { entries: unknown[] }).entries).toHaveLength(0);
  });

  it("returns 409 when the log is unreadable and does not overwrite it", () => {
    writeFileSync(join(artifacts, "dispositions.json"), "{not json");
    const r = createDisposition(ports(), ignoreSite);
    expect(r.status).toBe(409);
    expect(readFileSync(join(artifacts, "dispositions.json"), "utf8")).toBe("{not json");
    expect(calls).toHaveLength(0);
  });

  it("returns 500 and an audit line when the gate fails unexpectedly", () => {
    reject = new Error("disk gone");
    const r = createDisposition(ports(), ignoreSite);
    expect(r.status).toBe(500);
    expect(audits.some((a) => a.type === "disposition-write-failed")).toBe(true);
  });

  it("marks an undone ignore and accepts an unignore", () => {
    const first = createDisposition(ports(), ignoreSite).json as { entry: { id: string } };
    clockMs += 1000;
    const u = createDisposition(ports(), {
      decision: "unignore",
      scope: "undo",
      undoes: first.entry.id,
      reason: "Fixed",
      reviewer: "Sam",
    });
    expect(u.status).toBe(201);
    const list = listDispositions(ports()).json as { entries: { id: string; undone: boolean }[] };
    expect(list.entries.find((e) => e.id === first.entry.id)?.undone).toBe(true);
  });
});

describe("listFindings", () => {
  it("returns 404 when there is no run", () => {
    expect(listFindings({ artifactsDir: artifacts }, "latest").status).toBe(404);
    expect(listFindings({ artifactsDir: artifacts }, "../x").status).toBe(404);
  });

  it("lists findings with capped targets, scope counts, and decision-pending status", () => {
    seedRun();
    const before = listFindings({ artifactsDir: artifacts }, "latest").json as {
      findings: { status: string; nodeTargets: string[]; matches: Record<string, number>; nodeCount: number }[];
    };
    expect(before.findings).toHaveLength(2);
    const f = before.findings[0]!;
    expect(f.status).toBe("active");
    expect(f.nodeTargets).toHaveLength(50);
    expect(f.nodeCount).toBe(60);
    expect(f.matches).toEqual({ element: 1, "page-rule": 2, "site-rule": 2 });
    expect(JSON.stringify(before)).not.toContain(root);

    createDisposition(ports(), ignoreSite);
    const after = listFindings({ artifactsDir: artifacts }, "run_1").json as { findings: { status: string }[] };
    expect(after.findings.every((x) => x.status === "decision-pending")).toBe(true);
  });
});

describe("routes", () => {
  function deps(): ConsoleDeps {
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
      git: { run: async () => ({ code: 0, stdout: "", stderr: "" }) },
      jobs: { current: () => null, start: () => ({ ok: false, reason: "no" }) },
      approval: {
        authorizeSetupAction: () => undefined,
        approveVisualBaseline: () => undefined,
        recordDispositionDecision: () => "rev",
      } as unknown as ConsoleDeps["approval"],
      clock: { now: () => new Date(clockMs) },
    };
  }
  const post = { host: "127.0.0.1:7787", contentType: "application/json" };

  it("serves GET and POST through the central guard with an 8 KB limit", async () => {
    const c = createConsole(deps());
    const get = (path: string) =>
      c.handle({ method: "GET", path, query: {}, headers: { host: "127.0.0.1:7787" }, body: null });
    expect((await get("/api/dispositions")).status).toBe(200);
    expect((await get("/api/findings")).status).toBe(404);
    const bad = await c.handle({
      method: "POST",
      path: "/api/dispositions",
      query: {},
      headers: { host: "evil.test", contentType: "application/json" },
      body: JSON.stringify(ignoreSite),
    });
    expect(bad.status).toBe(403);
    const big = await c.handle({
      method: "POST",
      path: "/api/dispositions",
      query: {},
      headers: post,
      body: JSON.stringify({ ...ignoreSite, reason: "x".repeat(9000) }),
    });
    expect(big.status).toBe(413);
    const ok = await c.handle({
      method: "POST",
      path: "/api/dispositions",
      query: {},
      headers: post,
      body: JSON.stringify(ignoreSite),
    });
    expect(ok.status).toBe(201);
  });

  it("builds real ports under the artifacts folder", () => {
    const p = realDispositionPorts(root);
    expect(p.artifactsDir).toBe(artifacts);
  });
});
