import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConsole } from "../../src/admin/console-router.js";
import { realFs } from "../../src/admin/console-deps.js";
import type { ConsoleDeps, SetupActionInput } from "../../src/admin/console-deps.js";
import { SelfApprovalError } from "../../src/approval/approval-gate.js";
import { SCOPE_OVERRIDE_TEXT } from "../../src/admin/urls-api.js";

let root: string;
let calls: SetupActionInput[];
let denyAgents: boolean;

const SEED_URLS = ["https://example.test/", "https://example.test/a/"];

function put(rel: string, text: string): void {
  const p = join(root, rel);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, text, "utf8");
}
function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function deps(): ConsoleDeps {
  return {
    port: 7787,
    fs: realFs(root),
    git: { run: async () => ({ code: 0, stdout: "", stderr: "" }) },
    jobs: { current: () => null, start: () => ({ ok: false, reason: "no" }) },
    approval: {
      authorizeSetupAction: (i) => {
        if (denyAgents && /agent/i.test(i.reviewer)) throw new SelfApprovalError("agent identity rejected");
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

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "awg-urls-"));
  calls = [];
  denyAgents = true;
  put(
    "config/app.config.json",
    JSON.stringify({ approvedDomain: "example.test", baseUrl: "https://example.test", domain: "example-test", limits: { pages: 3 } }),
  );
  put("config/page-seed.json", JSON.stringify({ maxUrls: 10, extra: { keep: 1 }, approvedUrls: SEED_URLS }, null, 2) + "\r\n");
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("urls api", () => {
  it("lists URLs with readiness and a fixed maximum (min of seed and limits)", async () => {
    put("baselines/example-test-a/baseline.v1.md", "x");
    const r = await get("/api/urls");
    const j = r.json as { urls: { url: string; status: string }[]; max: number; usedText: string; editsDisabled: boolean };
    expect(r.status).toBe(200);
    expect(j.max).toBe(3);
    expect(j.usedText).toBe("2 of 3 used");
    expect(j.urls.map((u) => u.status)).toEqual(["needs-spec-baseline", "needs-visual-baseline"]);
    expect(j.editsDisabled).toBe(false);
  });

  it("stages adds without touching the seed, is idempotent, and enforces the cap", async () => {
    const before = read("config/page-seed.json");
    const ok = await post("/api/urls/add", { url: "https://example.test/b", reviewer: "S. Nair" });
    expect(ok.status).toBe(200);
    expect(read("config/page-seed.json")).toBe(before);
    expect((await get("/api/project/pending")).json).toMatchObject({ count: 1 });
    const again = await post("/api/urls/add", { url: "https://example.test/b/", reviewer: "S. Nair" });
    expect(again.status).toBe(200);
    expect((await get("/api/project/pending")).json).toMatchObject({ count: 1 });
    const full = await post("/api/urls/add", { url: "https://example.test/c/", reviewer: "S. Nair" });
    expect(full.status).toBe(400);
    expect(JSON.stringify(full.json)).toContain("limit of 3");
    const out = await post("/api/urls/add", { url: "https://other.test/", reviewer: "S. Nair" });
    expect(out.status).toBe(400);
    const log = read("artifacts/admin/setup-activity.jsonl").trim().split("\n");
    expect(log).toHaveLength(1);
    expect(JSON.parse(log[0] as string)).toMatchObject({ action: "urls-added", reviewer: "S. Nair", counts: { added: 1 } });
  });

  it("requires a Reviewer name and rejects agent identities before staging", async () => {
    const noName = await post("/api/urls/remove", { url: SEED_URLS[1], reviewer: "   " });
    expect(noName.status).toBe(400);
    const agent = await post("/api/urls/remove", { url: SEED_URLS[1], reviewer: "Agent Smith" });
    expect(agent.status).toBe(403);
    expect(existsSync(join(root, "artifacts/admin/pending-changes.json"))).toBe(false);
    expect(existsSync(join(root, "artifacts/admin/setup-activity.jsonl"))).toBe(false);
  });

  it("stages remove and edit through the gate and shows pending badges", async () => {
    expect((await post("/api/urls/remove", { url: SEED_URLS[1], reviewer: "S. Nair" })).status).toBe(200);
    expect(calls[0]).toMatchObject({ action: "url-remove", reviewer: "S. Nair" });
    const ed = await post("/api/urls/edit", { from: SEED_URLS[0], to: "https://example.test/new", reviewer: "S. Nair" });
    expect(ed.status).toBe(200);
    expect(calls[1]).toMatchObject({ action: "url-edit", detail: { removed: SEED_URLS[0], added: "https://example.test/new/" } });
    const list = (await get("/api/urls")).json as { urls: { url: string; pending: string | null; requiresReapproval: boolean }[]; usedText: string };
    expect(list.urls.map((u) => [u.url, u.pending])).toEqual([
      [SEED_URLS[0], "remove"],
      [SEED_URLS[1], "remove"],
      ["https://example.test/new/", "add"],
    ]);
    expect(list.urls[2]?.requiresReapproval).toBe(true);
    expect(list.usedText).toBe("1 of 3 used");
    expect((await post("/api/urls/remove", { url: "https://example.test/zzz/", reviewer: "S. Nair" })).status).toBe(404);
  });

  it("Update project applies staged ops to the seed only, preserving fields, maxUrls, and EOL", async () => {
    put("baselines/example-test-a/baseline.v1.md", "keep");
    await post("/api/urls/remove", { url: SEED_URLS[1], reviewer: "S. Nair" });
    await post("/api/urls/add", { url: "https://example.test/b", reviewer: "S. Nair" });
    const r = await post("/api/project/update", { reviewer: "S. Nair" });
    expect(r.status).toBe(200);
    const raw = read("config/page-seed.json");
    expect(raw).toContain("\r\n");
    const seed = JSON.parse(raw) as { maxUrls: number; extra: unknown; approvedUrls: string[] };
    expect(seed.maxUrls).toBe(10);
    expect(seed.extra).toEqual({ keep: 1 });
    expect(seed.approvedUrls).toEqual(["https://example.test/", "https://example.test/b/"]);
    expect((await get("/api/project/pending")).json).toMatchObject({ count: 0 });
    expect(read("baselines/example-test-a/baseline.v1.md")).toBe("keep");
    expect(calls.at(-1)).toMatchObject({ action: "project-update" });
    const last = JSON.parse(read("artifacts/admin/setup-activity.jsonl").trim().split("\n").at(-1) as string);
    expect(last).toMatchObject({ action: "project-updated", counts: { added: 1, removed: 1, total: 2 } });
    expect((await post("/api/project/update", { reviewer: "" })).status).toBe(400);
  });

  it("disables edits with an explanation when an approved-scope file is in use", async () => {
    put("config/scope/example-test.approved.json", JSON.stringify({ domain: "example-test", pages: ["https://example.test/"] }));
    const j = (await get("/api/urls")).json as { editsDisabled: boolean; disabledReason: string };
    expect(j.editsDisabled).toBe(true);
    expect(j.disabledReason).toBe(SCOPE_OVERRIDE_TEXT);
    expect((await post("/api/urls/add", { url: "https://example.test/b", reviewer: "S. Nair" })).status).toBe(409);
    expect((await post("/api/project/update", { reviewer: "S. Nair" })).status).toBe(409);
  });

  it("refuses writes when the pending file is unreadable and never overwrites it", async () => {
    put("artifacts/admin/pending-changes.json", "{not json");
    const r = await post("/api/urls/add", { url: "https://example.test/b", reviewer: "S. Nair" });
    expect(r.status).toBe(409);
    expect(read("artifacts/admin/pending-changes.json")).toBe("{not json");
  });

  it("draft scope writes directly to draft.urls and leaves the project untouched", async () => {
    put("artifacts/admin/new-domain-draft.json", JSON.stringify({ host: "new.test", urls: ["https://new.test/"] }));
    const seedBefore = read("config/page-seed.json");
    const r = await post("/api/urls/add", { scope: "draft", url: "https://new.test/x", reviewer: "S. Nair" });
    expect(r.status).toBe(200);
    expect(JSON.parse(read("artifacts/admin/new-domain-draft.json")).urls).toEqual(["https://new.test/", "https://new.test/x/"]);
    expect(read("config/page-seed.json")).toBe(seedBefore);
    expect(existsSync(join(root, "artifacts/admin/pending-changes.json"))).toBe(false);
  });
});
