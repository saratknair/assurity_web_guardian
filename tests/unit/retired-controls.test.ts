import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConsole } from "../../src/admin/console-router.js";
import { allRoutes } from "../../src/admin/console-routes.js";
import { realFs } from "../../src/admin/console-deps.js";
import type { ConsoleDeps } from "../../src/admin/console-deps.js";

let root: string;
let started: number;
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
    jobs: {
      current: () => null,
      start: () => {
        started += 1;
        return { ok: false, reason: "no" };
      },
    },
    approval: { authorizeSetupAction: () => undefined, approveVisualBaseline: () => undefined },
    clock: { now: () => new Date("2025-01-02T03:04:05.000Z") },
  } as ConsoleDeps;
}

const good = { host: "127.0.0.1:7787", contentType: "application/json" };
const send = (path: string, headers: Record<string, string>, body: unknown) =>
  createConsole(deps()).handle({ method: "POST", path, query: {}, headers, body: JSON.stringify(body) });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "awg-retired-"));
  mkdirSync(join(root, "config"), { recursive: true });
  started = 0;
  gitCalls = [];
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("retired controls", () => {
  it("POST /api/run returns 410 for a guarded request and starts nothing", async () => {
    const r = await send("/api/run", good, {});
    expect(r.status).toBe(410);
    const j = r.json as Record<string, unknown>;
    expect(j.error).toBe("retired");
    expect(String(j.message)).toContain("when you publish");
    expect(started).toBe(0);
  });

  it("POST /api/run is still behind the guard (wrong Host and cross-origin give 403)", async () => {
    const badHost = await send("/api/run", { host: "evil.example", contentType: "application/json" }, {});
    expect(badHost.status).toBe(403);
    const badOrigin = await send("/api/run", { ...good, origin: "http://evil.example" }, {});
    expect(badOrigin.status).toBe(403);
    expect(started).toBe(0);
  });

  it("the retired route is registered as mutating", () => {
    const r = allRoutes().find((x) => x.method === "POST" && x.pattern === "/api/run");
    expect(r?.mutating).toBe(true);
  });

  it("the old schedule body shape is rejected and config/schedule.json is never written", async () => {
    const old = { enabled: true, intervalHours: 6, dailyAt: "09:00" };
    // The only schedule route is the workflow-cron edit, and it rejects the old shape.
    expect(allRoutes().filter((x) => /schedule/i.test(x.pattern)).map((x) => x.pattern)).toEqual([
      "/api/schedule",
      "/api/schedule",
    ]);
    const sched = await send("/api/schedule", good, { ...old, reviewer: "Pat Reviewer" });
    expect(sched.status).toBe(400);
    const bare = await send("/api/schedule", good, old);
    expect(bare.status).toBe(400);
    expect(existsSync(join(root, "config", "schedule.json"))).toBe(false);
    expect(gitCalls.some((c) => c[0] === "push")).toBe(false);
  });
});
