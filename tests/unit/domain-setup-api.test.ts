import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConsole } from "../../src/admin/console-router.js";
import { realFs } from "../../src/admin/console-deps.js";
import type { ConsoleDeps, SetupActionInput } from "../../src/admin/console-deps.js";
import { SelfApprovalError } from "../../src/approval/approval-gate.js";
import { isPrivateAddress, setHostResolver } from "../../src/admin/domain-setup-api.js";

let root: string;
let calls: SetupActionInput[];
let addresses: string[] | Error;

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
async function get(path: string) {
  return createConsole(deps()).handle({ method: "GET", path, query: {}, headers: { host: headers.host }, body: null });
}

const START = { host: "new-site.example", retypedHost: "https://New-Site.example/", reviewer: "S. Nair" };
const CONFIG = JSON.stringify({ approvedDomain: "example.test", baseUrl: "https://example.test", domain: "example-test", limits: { pages: 3 } });
const SEED = JSON.stringify({ maxUrls: 10, approvedUrls: ["https://example.test/"] });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "awg-dom-"));
  calls = [];
  addresses = ["93.184.216.34"];
  setHostResolver(async () => {
    if (addresses instanceof Error) throw addresses;
    return addresses;
  });
  put("config/app.config.json", CONFIG);
  put("config/page-seed.json", SEED);
  put("baselines/example-test/baseline.v1.md", "x");
});
afterEach(() => {
  setHostResolver();
  rmSync(root, { recursive: true, force: true });
});

describe("domain setup draft api", () => {
  it("reports no draft before start", async () => {
    const r = await get("/api/domain/setup");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ draft: null, currentDomain: "example.test", canConfirm: false });
  });

  it("starts a draft without touching current config, and logs previous and new host", async () => {
    const r = await post("/api/domain/setup/start", START);
    expect(r.status).toBe(200);
    expect(read("config/app.config.json")).toBe(CONFIG);
    expect(read("config/page-seed.json")).toBe(SEED);
    const draft = JSON.parse(read("artifacts/admin/new-domain-draft.json"));
    expect(draft).toMatchObject({ host: "new-site.example", baseUrl: "https://new-site.example", slug: "new-site-example", createdAt: "2025-01-02T03:04:05.000Z", reviewer: "S. Nair", urls: [] });
    expect(calls[0]).toMatchObject({ action: "domain-draft-start", reviewer: "S. Nair" });
    const entry = JSON.parse(read("artifacts/admin/setup-activity.jsonl").trim());
    expect(entry).toMatchObject({ action: "domain-draft-started", detail: { previousHost: "example.test", newHost: "new-site.example" } });
    const st = (await get("/api/domain/setup")).json as { draft: { host: string }; canConfirm: boolean; reasons: string[] };
    expect(st.draft.host).toBe("new-site.example");
    expect(st.canConfirm).toBe(false);
    expect(st.reasons.join(" ")).toContain("at least one page");
  });

  it("rejects invalid, mismatched, same-as-current, private, and unresolvable hosts without storing anything", async () => {
    const draftFile = join(root, "artifacts/admin/new-domain-draft.json");
    expect((await post("/api/domain/setup/start", { ...START, host: "http://x.example" })).status).toBe(400);
    expect((await post("/api/domain/setup/start", { ...START, retypedHost: "other.example" })).status).toBe(400);
    expect((await post("/api/domain/setup/start", { ...START, host: "example.test", retypedHost: "example.test" })).status).toBe(400);
    addresses = ["10.0.0.5"];
    const priv = await post("/api/domain/setup/start", START);
    expect(priv.status).toBe(400);
    expect(JSON.stringify(priv.json)).toContain("private address");
    addresses = new Error("ENOTFOUND");
    expect((await post("/api/domain/setup/start", START)).status).toBe(400);
    expect(existsSync(draftFile)).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("requires a Reviewer and rejects agents", async () => {
    expect((await post("/api/domain/setup/start", { ...START, reviewer: " " })).status).toBe(400);
    expect((await post("/api/domain/setup/start", { ...START, reviewer: "Agent X" })).status).toBe(403);
    expect(existsSync(join(root, "artifacts/admin/new-domain-draft.json"))).toBe(false);
  });

  it("refuses a second draft until the first is cancelled, and cancel clears staging only", async () => {
    expect((await post("/api/domain/setup/start", START)).status).toBe(200);
    expect((await post("/api/domain/setup/start", START)).status).toBe(409);
    put("artifacts/admin/new-domain/baselines/a/baseline.v1.md", "staged");
    expect((await post("/api/domain/setup/cancel", { reviewer: "" })).status).toBe(400);
    expect((await post("/api/domain/setup/cancel", { reviewer: "Agent X" })).status).toBe(403);
    expect(existsSync(join(root, "artifacts/admin/new-domain-draft.json"))).toBe(true);
    const c = await post("/api/domain/setup/cancel", { reviewer: "S. Nair" });
    expect(c.status).toBe(200);
    expect(existsSync(join(root, "artifacts/admin/new-domain-draft.json"))).toBe(false);
    expect(existsSync(join(root, "artifacts/admin/new-domain"))).toBe(false);
    expect(read("config/app.config.json")).toBe(CONFIG);
    expect(existsSync(join(root, "baselines/example-test/baseline.v1.md"))).toBe(true);
    const lines = read("artifacts/admin/setup-activity.jsonl").trim().split("\n").map((l) => JSON.parse(l));
    expect(lines[1]).toMatchObject({ action: "domain-draft-cancelled", detail: { previousHost: "example.test", newHost: "new-site.example" } });
    expect((await post("/api/domain/setup/cancel", { reviewer: "S. Nair" })).status).toBe(409);
    expect((await post("/api/domain/setup/start", START)).status).toBe(200);
  });

  it("reports step readiness from the draft urls and staged baselines", async () => {
    await post("/api/domain/setup/start", START);
    const draft = JSON.parse(read("artifacts/admin/new-domain-draft.json"));
    draft.urls = ["https://new-site.example/"];
    put("artifacts/admin/new-domain-draft.json", JSON.stringify(draft));
    let st = (await get("/api/domain/setup")).json as { canConfirm: boolean; reasons: string[] };
    expect(st.canConfirm).toBe(false);
    expect(st.reasons.join(" ")).toContain("baselines");
    put("artifacts/admin/new-domain/baselines/new-site-example/baseline.v1.md", "x");
    put("artifacts/admin/new-domain/baselines-visual/new-site-example/desktop.png", "p");
    put("artifacts/admin/new-domain/baselines-visual/new-site-example/mobile.png", "p");
    st = (await get("/api/domain/setup")).json as { canConfirm: boolean; reasons: string[] };
    expect(st.reasons).toEqual([]);
    expect(st.canConfirm).toBe(true);
  });

  it("classifies private addresses", () => {
    for (const a of ["127.0.0.1", "10.1.2.3", "192.168.0.1", "172.16.0.1", "169.254.1.1", "::1", "fe80::1", "fd00::1", "::ffff:10.0.0.1"]) {
      expect(isPrivateAddress(a)).toBe(true);
    }
    for (const a of ["93.184.216.34", "2606:2800:220:1::1"]) expect(isPrivateAddress(a)).toBe(false);
  });
});
