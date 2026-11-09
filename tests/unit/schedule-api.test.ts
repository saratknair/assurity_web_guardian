import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConsole } from "../../src/admin/console-router.js";
import { realFs } from "../../src/admin/console-deps.js";
import type { ConsoleDeps, SetupActionInput } from "../../src/admin/console-deps.js";
import { SelfApprovalError } from "../../src/approval/approval-gate.js";

const REAL_WORKFLOW = join(__dirname, "..", "..", ".github", "workflows", "guardian.yml");
const WF = ".github/workflows/guardian.yml";

let root: string;
let authCalls: SetupActionInput[];
let gitCalls: string[][];

function deps(): ConsoleDeps {
  return {
    port: 7787,
    fs: realFs(root),
    git: {
      run: async (args: string[]) => {
        gitCalls.push(args);
        return { code: 1, stdout: "", stderr: "" };
      },
    },
    jobs: { current: () => null, start: () => ({ ok: false, reason: "no" }) },
    approval: {
      authorizeSetupAction: (i) => {
        if (/agent/i.test(i.reviewer)) throw new SelfApprovalError("agent identity rejected");
        authCalls.push(i);
      },
      approveVisualBaseline: () => undefined,
    },
    clock: { now: () => new Date("2025-01-02T03:04:05.000Z") },
  };
}
const headers = { host: "127.0.0.1:7787", contentType: "application/json" };
const post = (body: unknown) =>
  createConsole(deps()).handle({ method: "POST", path: "/api/schedule", query: {}, headers, body: JSON.stringify(body) });
const get = () =>
  createConsole(deps()).handle({ method: "GET", path: "/api/schedule", query: {}, headers: { host: headers.host }, body: null });
const wfText = () => readFileSync(join(root, WF), "latin1");

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "awg-sched-"));
  mkdirSync(join(root, ".github", "workflows"), { recursive: true });
  copyFileSync(REAL_WORKFLOW, join(root, WF));
  authCalls = [];
  gitCalls = [];
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("schedule api", () => {
  it("GET returns cron, summary, UTC note, and GitHub note", async () => {
    const r = await get();
    expect(r.status).toBe(200);
    const j = r.json as Record<string, unknown>;
    expect(typeof j.cron).toBe("string");
    expect(typeof j.summary).toBe("string");
    expect(String(j.utcNote)).toContain("UTC");
    expect(String(j.note)).toContain("default branch");
    expect(Array.isArray(j.warnings)).toBe(true);
    expect(j.onGitHub).toBeNull();
  });

  it("POST edits one value, logs, does not push", async () => {
    const before = wfText();
    const r = await post({ cron: "30 4 * * 1", reviewer: "Pat Reviewer" });
    expect(r.status).toBe(200);
    const j = r.json as Record<string, unknown>;
    expect(j.cron).toBe("30 4 * * 1");
    expect(j.published).toBe(false);
    const after = wfText();
    const a = before.split(/\r?\n/);
    const b = after.split(/\r?\n/);
    expect(b.length).toBe(a.length);
    expect(b.filter((l, i) => l !== a[i]).length).toBe(1);
    expect(authCalls.length).toBe(1);
    expect(gitCalls.some((c) => c[0] === "push")).toBe(false);
    const log = readFileSync(join(root, "artifacts", "admin", "setup-activity.jsonl"), "utf8");
    expect(log).toContain("schedule-changed");
    expect(log).toContain("30 4 * * 1");
    expect((await get()).json).toMatchObject({ cron: "30 4 * * 1" });
  });

  it("rejects invalid cron with the reason and changes nothing", async () => {
    const before = wfText();
    const r = await post({ cron: "* * * * *", reviewer: "Pat Reviewer" });
    expect(r.status).toBe(400);
    expect(String((r.json as { error: string }).error).length).toBeGreaterThan(5);
    expect(wfText()).toBe(before);
    expect(authCalls.length).toBe(0);
  });

  it("requires a Reviewer and rejects an agent", async () => {
    const before = wfText();
    expect((await post({ cron: "0 3 * * *" })).status).toBe(400);
    expect((await post({ cron: "0 3 * * *", reviewer: "" })).status).toBe(400);
    expect((await post({ cron: "0 3 * * *", reviewer: "agent" })).status).toBe(403);
    expect(wfText()).toBe(before);
  });

  it("returns 409 when the workflow has several or no schedule entries", async () => {
    const text = wfText();
    const multi = text.replace(/^(\s+)- cron:.*$/m, (m) => `${m}\n${m.replace(/cron:.*/, 'cron: "0 1 * * *"')}`);
    expect(multi).not.toBe(text);
    writeFileSync(join(root, WF), multi, "latin1");
    expect((await post({ cron: "0 3 * * *", reviewer: "Pat Reviewer" })).status).toBe(409);
    expect((await get()).status).toBe(409);
    writeFileSync(join(root, WF), "name: x\non:\n  push:\n", "latin1");
    expect((await post({ cron: "0 3 * * *", reviewer: "Pat Reviewer" })).status).toBe(409);
    expect(authCalls.length).toBe(0);
  });

  it("rejects the old local schedule body", async () => {
    const r = await post({ enabled: true, intervalHours: 6, reviewer: "Pat Reviewer" });
    expect(r.status).toBe(400);
  });
});
