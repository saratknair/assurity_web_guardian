import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConsole } from "../../src/admin/console-router.js";
import { realFs } from "../../src/admin/console-deps.js";
import type { ConsoleDeps, SetupActionInput } from "../../src/admin/console-deps.js";
import { SelfApprovalError } from "../../src/approval/approval-gate.js";
import { setConfirmFaultHook } from "../../src/admin/domain-setup-api.js";
import { urlSlug } from "../../src/admin/url-set.js";

let root: string;
let calls: SetupActionInput[];
let now: Date;

function put(rel: string, text: string | Buffer): void {
  const p = join(root, rel);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, text);
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
        if (/agent/i.test(i.reviewer)) throw new SelfApprovalError("agent identity rejected");
        calls.push(i);
      },
      approveVisualBaseline: () => undefined,
    },
    clock: { now: () => now },
  };
}
const headers = { host: "127.0.0.1:7787", contentType: "application/json" };
async function post(path: string, body: unknown) {
  return createConsole(deps()).handle({ method: "POST", path, query: {}, headers, body: JSON.stringify(body) });
}
async function get(path: string) {
  return createConsole(deps()).handle({ method: "GET", path, query: {}, headers: { host: headers.host }, body: null });
}

const CONFIG = '{\r\n    "approvedDomain": "example.test",\r\n    "baseUrl": "https://example.test",\r\n    "domain": "example-test",\r\n    "limits": { "pages": 3 },\r\n    "z": 1\r\n}\r\n';
const SEED = '{\n  "maxUrls": 10,\n  "approvedUrls": ["https://example.test/"],\n  "note": "keep"\n}\n';
const OLD_DOMAIN = '{"domain":"example.test","baseUrl":"https://example.test","approvedSchemes":["https"],"maxDiscoveryCount":77,"largeScopeThreshold":9,"requestSpacingMs":1500,"scopeFile":"config/scope/example-test.approved.json"}\n';
const NEW_URLS = ["https://new-site.example/", "https://new-site.example/about/"];
const GOOD = { reviewer: "S. Nair", retypedHost: "new-site.example", confirm: true };

function snapshot(dir: string, base = dir): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(dir)) return out;
  for (const n of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, n.name);
    if (n.isDirectory()) Object.assign(out, snapshot(p, base));
    else out[p.slice(base.length)] = readFileSync(p).toString("base64");
  }
  return out;
}
function projectState(): Record<string, string> {
  return { ...snapshot(join(root, "config")), ...snapshot(join(root, "baselines")), ...snapshot(join(root, "baselines-visual")) };
}

function stageDraft(createdAt = "2025-01-02T03:04:05.000Z", withBaselines = true): void {
  put("artifacts/admin/new-domain-draft.json", JSON.stringify({ schemaVersion: 1, host: "new-site.example", baseUrl: "https://new-site.example", slug: "new-site-example", createdAt, reviewer: "S. Nair", urls: NEW_URLS }));
  if (!withBaselines) return;
  for (const u of NEW_URLS) {
    const s = urlSlug(u);
    put(`artifacts/admin/new-domain/baselines/${s}/baseline.v1.md`, "spec " + s);
    put(`artifacts/admin/new-domain/baselines-visual/${s}/desktop.png`, Buffer.from([1, 2, 3, 4]));
    put(`artifacts/admin/new-domain/baselines-visual/${s}/mobile.png`, Buffer.from([5, 6, 7]));
  }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "awg-conf-"));
  calls = [];
  now = new Date("2025-01-03T00:00:00.000Z");
  put("config/app.config.json", CONFIG);
  put("config/page-seed.json", SEED);
  put("config/domains/example-test.json", OLD_DOMAIN);
  put("baselines/example-test/baseline.v1.md", "old");
  put("baselines-visual/example-test/desktop.png", Buffer.from([9]));
});
afterEach(() => {
  setConfirmFaultHook();
  rmSync(root, { recursive: true, force: true });
});

describe("domain confirm transaction", () => {
  it("switches the site, keeps the old files, and removes the draft only after success", async () => {
    stageDraft();
    const r = await post("/api/domain/setup/confirm", GOOD);
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.json)).toContain("publish");
    expect(calls[0]).toMatchObject({ action: "domain-change", detail: { previous: "example.test", new: "new-site.example" } });
    // app config: three fields changed, order, indent, CRLF, other fields preserved.
    expect(read("config/app.config.json")).toBe(
      CONFIG.replace('"example.test"', '"new-site.example"').replace("https://example.test", "https://new-site.example").replace("example-test", "new-site-example"),
    );
    expect(read("config/page-seed.json")).toBe(
      '{\n  "maxUrls": 10,\n  "approvedUrls": [\n    "https://new-site.example/",\n    "https://new-site.example/about/"\n  ],\n  "note": "keep"\n}\n',
    );
    const dom = JSON.parse(read("config/domains/new-site-example.json"));
    expect(dom).toMatchObject({ domain: "new-site.example", probePaths: ["/"], maxDiscoveryCount: 77, largeScopeThreshold: 9, requestSpacingMs: 1500, approvedSchemes: ["https"] });
    expect(read("config/domains/example-test.json")).toBe(OLD_DOMAIN);
    expect(read("baselines/example-test/baseline.v1.md")).toBe("old");
    for (const u of NEW_URLS) {
      const s = urlSlug(u);
      expect(read(`baselines/${s}/baseline.v1.md`)).toBe("spec " + s);
      expect([...readFileSync(join(root, `baselines-visual/${s}/mobile.png`))]).toEqual([5, 6, 7]);
    }
    expect(existsSync(join(root, "artifacts/admin/new-domain-draft.json"))).toBe(false);
    expect(existsSync(join(root, "artifacts/admin/new-domain"))).toBe(false);
    const log = read("artifacts/admin/setup-activity.jsonl");
    expect(JSON.parse(log.trim().split("\n").pop() as string)).toMatchObject({ action: "domain-changed", detail: { previousHost: "example.test", newHost: "new-site.example" } });
  });

  it("rolls back fully when a failure is injected at any step", async () => {
    stageDraft();
    // First a clean run records the step names; then a failure is injected at each step in turn.
    const steps: string[] = [];
    const probeRoot = root;
    setConfirmFaultHook((s) => void steps.push(s));
    const ok = await post("/api/domain/setup/confirm", GOOD);
    expect(ok.status).toBe(200);
    expect(steps.length).toBeGreaterThan(6);
    expect(steps[steps.length - 1]).toBe("commit");
    rmSync(probeRoot, { recursive: true, force: true });

    for (let n = 0; n < steps.length; n++) {
      root = mkdtempSync(join(tmpdir(), "awg-conf-"));
      put("config/app.config.json", CONFIG);
      put("config/page-seed.json", SEED);
      put("config/domains/example-test.json", OLD_DOMAIN);
      put("baselines/example-test/baseline.v1.md", "old");
      stageDraft();
      const before = projectState();
      const draftBefore = read("artifacts/admin/new-domain-draft.json");
      let i = 0;
      setConfirmFaultHook(() => {
        if (i++ === n) throw new Error("boom at " + n);
      });
      const r = await post("/api/domain/setup/confirm", GOOD);
      expect(r.status).toBe(500);
      expect(JSON.stringify(r.json)).toContain("still the monitored site");
      expect(projectState()).toEqual(before);
      expect(read("config/app.config.json")).toBe(CONFIG);
      expect(read("artifacts/admin/new-domain-draft.json")).toBe(draftBefore);
      expect(existsSync(join(root, "artifacts/admin/new-domain/baselines"))).toBe(true);
      expect(JSON.parse(read("artifacts/admin/domain-confirm-journal.json")).state).toBe("rolled-back");
      rmSync(root, { recursive: true, force: true });
    }
    root = mkdtempSync(join(tmpdir(), "awg-conf-"));
  });

  it("refuses when not ready, mismatched, unconfirmed, or by an agent, changing nothing", async () => {
    stageDraft("2025-01-02T03:04:05.000Z", false);
    const before = projectState();
    expect((await post("/api/domain/setup/confirm", GOOD)).status).toBe(409);
    stageDraft();
    expect((await post("/api/domain/setup/confirm", { ...GOOD, retypedHost: "other.example" })).status).toBe(400);
    expect((await post("/api/domain/setup/confirm", { ...GOOD, confirm: false })).status).toBe(400);
    expect((await post("/api/domain/setup/confirm", { ...GOOD, reviewer: " " })).status).toBe(400);
    expect((await post("/api/domain/setup/confirm", { ...GOOD, reviewer: "Agent X" })).status).toBe(403);
    expect(projectState()).toEqual(before);
    expect(existsSync(join(root, "artifacts/admin/new-domain-draft.json"))).toBe(true);
  });

  it("discards a draft older than 7 days when the setup is read", async () => {
    stageDraft("2024-12-20T00:00:00.000Z");
    const r = await get("/api/domain/setup");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ draft: null, discarded: true });
    expect(existsSync(join(root, "artifacts/admin/new-domain-draft.json"))).toBe(false);
    expect(existsSync(join(root, "artifacts/admin/new-domain"))).toBe(false);
    const entry = JSON.parse(read("artifacts/admin/setup-activity.jsonl").trim());
    expect(entry.action).toBe("domain-draft-discarded");
    expect(read("config/app.config.json")).toBe(CONFIG);
  });

  it("rolls back a leftover journal from a crashed attempt, then succeeds", async () => {
    stageDraft();
    // Simulate a crash after the first file was created and the config was half switched.
    put("artifacts/admin/backup/crash/app.config.json", CONFIG);
    put("artifacts/admin/backup/crash/page-seed.json", SEED);
    put("config/page-seed.json", '{"maxUrls":10,"approvedUrls":["https://new-site.example/"]}');
    put("baselines/stray/baseline.v1.md", "stray");
    put("artifacts/admin/domain-confirm-journal.json", JSON.stringify({ schemaVersion: 1, state: "applying", backupDir: "artifacts/admin/backup/crash", created: ["baselines/stray/"], step: "page-seed" }));
    const r = await post("/api/domain/setup/confirm", GOOD);
    expect(r.status).toBe(200);
    expect(existsSync(join(root, "baselines/stray"))).toBe(false);
    expect(read("config/app.config.json")).toContain("new-site-example");
  });

  it("refuses when a leftover journal cannot be undone", async () => {
    stageDraft();
    put("artifacts/admin/domain-confirm-journal.json", JSON.stringify({ state: "applying", backupDir: "artifacts/admin/backup/missing", created: [] }));
    const before = projectState();
    const r = await post("/api/domain/setup/confirm", GOOD);
    expect(r.status).toBe(409);
    expect(JSON.stringify(r.json)).toContain("did not finish");
    expect(projectState()).toEqual(before);
  });

  it("keeps a recent draft", async () => {
    stageDraft("2024-12-30T00:00:00.000Z");
    const r = await get("/api/domain/setup");
    expect((r.json as { draft: unknown }).draft).not.toBeNull();
  });
});
