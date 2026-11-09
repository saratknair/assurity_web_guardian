import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConsole } from "../../src/admin/console-router.js";
import { createDisposition } from "../../src/admin/dispositions-api.js";
import { resetSyncState, waitForSync } from "../../src/admin/sync-routes.js";
import type { ConsoleDeps, GitPort, GitResult } from "../../src/admin/console-deps.js";

let root: string;
const SHA = "a".repeat(40);
const ok = (stdout = ""): GitResult => ({ code: 0, stdout, stderr: "" });

/** Fake git: no remote file; push waits on `release` when set, or fails with `pushFail`. */
function fakeGit(state: { release: Promise<void> | null; pushFail: string | null; calls: string[][] }): GitPort {
  return {
    run: async (args) => {
      state.calls.push(args);
      const c = args[0];
      if (c === "rev-parse" || c === "hash-object" || c === "write-tree" || c === "commit-tree") return ok(SHA + "\n");
      if (c === "push") {
        if (state.release) await state.release;
        if (state.pushFail) return { code: 1, stdout: "", stderr: state.pushFail };
      }
      return ok();
    },
  };
}

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

const headers = { host: "127.0.0.1:7787", contentType: "application/json" };
const post = (c: ReturnType<typeof createConsole>) =>
  c.handle({ method: "POST", path: "/api/dispositions/sync", query: {}, headers, body: "{}" });
const status = (c: ReturnType<typeof createConsole>) =>
  c.handle({
    method: "GET",
    path: "/api/dispositions/sync/status",
    query: {},
    headers: { host: "127.0.0.1:7787" },
    body: null,
  });

beforeEach(() => {
  resetSyncState();
  root = mkdtempSync(join(tmpdir(), "sync-routes-"));
  mkdirSync(join(root, "artifacts"), { recursive: true });
  const r = createDisposition(
    {
      artifactsDir: join(root, "artifacts"),
      gate: { recordDispositionDecision: () => "rev" },
      audit: { append: () => undefined },
      now: () => new Date("2030-01-01T00:00:00.000Z"),
    },
    { decision: "ignore", scope: "site-rule", ruleId: "color-contrast", reason: "Known", reviewer: "Sam" },
  );
  expect(r.status).toBe(201);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("decision sync routes", () => {
  it("reports Not yet synced before a sync and Synced after a successful one", async () => {
    const st = { release: null, pushFail: null, calls: [] as string[][] };
    const c = createConsole(deps(fakeGit(st)));
    const before = (await status(c)).json as { state: string; notYetSynced: number };
    expect(before.state).toBe("not-yet-synced");
    expect(before.notYetSynced).toBe(1);

    expect((await post(c)).status).toBe(202);
    await waitForSync(root);
    const after = (await status(c)).json as { state: string; notYetSynced: number };
    expect(after.state).toBe("synced");
    expect(after.notYetSynced).toBe(0);
    const push = st.calls.find((a) => a[0] === "push") as string[];
    expect(push).toContain("origin");
    expect(push.join(" ")).not.toMatch(/force|-f\b/);
  });

  it("answers 409 while a sync is running (single flight)", async () => {
    let open!: () => void;
    const st = { release: new Promise<void>((r) => (open = r)), pushFail: null, calls: [] as string[][] };
    const c = createConsole(deps(fakeGit(st)));
    expect((await post(c)).status).toBe(202);
    expect((await post(c)).status).toBe(409);
    expect(((await status(c)).json as { state: string }).state).toBe("running");
    open();
    await waitForSync(root);
    expect(((await status(c)).json as { state: string }).state).toBe("synced");
  });

  it("keeps Not yet synced with a reason when the push fails, and allows a retry", async () => {
    const st = { release: null, pushFail: "fatal: Authentication failed", calls: [] as string[][] };
    const c = createConsole(deps(fakeGit(st)));
    expect((await post(c)).status).toBe(202);
    await waitForSync(root);
    const s = (await status(c)).json as { state: string; reason: string; notYetSynced: number };
    expect(s.state).toBe("not-yet-synced");
    expect(s.reason).toContain("push failed");
    expect(s.notYetSynced).toBe(1);

    st.pushFail = null;
    expect((await post(c)).status).toBe(202);
    await waitForSync(root);
    expect(((await status(c)).json as { state: string }).state).toBe("synced");
  });
});
