import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SelfApprovalError } from "../../src/approval/approval-gate.js";
import { idleJobs, realFs } from "../../src/admin/console-deps.js";
import type { ConsoleDeps } from "../../src/admin/console-deps.js";
import { realGit } from "../../src/admin/git-port.js";
import type { GitPort } from "../../src/admin/git-port.js";
import { PUBLISH_GROUP, resetPublishLock } from "../../src/admin/publish-api.js";
import type { ConsoleResponse } from "../../src/admin/console-routes.js";

// Only LOCAL bare repositories in a temp directory are used; the project remote is never touched.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

let gitOk = true;
try {
  git(tmpdir(), "--version");
} catch {
  gitOk = false;
}

describe.skipIf(!gitOk)("publish-api (local bare repos)", () => {
  let base: string;
  let bare: string;
  let work: string;
  let calls: string[][];
  let deps: ConsoleDeps;

  async function call(method: "GET" | "POST", pattern: string, body: unknown = {}): Promise<ConsoleResponse> {
    const route = PUBLISH_GROUP.find((r) => r.method === method && r.pattern === pattern);
    if (!route) throw new Error("no route");
    return route.handler({ deps, req: {} as never, params: {}, query: {}, body });
  }

  beforeEach(() => {
    resetPublishLock();
    base = mkdtempSync(join(tmpdir(), "awg-pubtest-"));
    bare = join(base, "remote.git");
    work = join(base, "work");
    mkdirSync(work);
    git(base, "init", "--bare", "-b", "main", bare);
    git(work, "init", "-b", "main");
    git(work, "config", "user.name", "T");
    git(work, "config", "user.email", "t@example.invalid");
    mkdirSync(join(work, "config"));
    writeFileSync(join(work, "config", "app.config.json"), JSON.stringify({ approvedDomain: "example.test" }) + "\n");
    writeFileSync(join(work, "config", "page-seed.json"), JSON.stringify({ approvedUrls: ["https://example.test/"] }) + "\n");
    writeFileSync(join(work, "notes.txt"), "one\n");
    git(work, "add", ".");
    git(work, "commit", "-m", "init");
    git(work, "remote", "add", "origin", bare);
    git(work, "push", "origin", "main");
    calls = [];
    const real = realGit(work);
    const spy: GitPort = {
      run: (args, opts) => {
        calls.push([...args]);
        return real.run(args, opts);
      },
    };
    deps = {
      port: 7787,
      fs: realFs(work),
      git: spy,
      jobs: idleJobs(),
      approval: {
        authorizeSetupAction: (i) => {
          if (/agent/i.test(i.reviewer)) throw new SelfApprovalError("An agent cannot approve");
        },
        approveVisualBaseline: () => undefined,
      },
      clock: { now: () => new Date("2025-01-02T03:04:05.000Z") },
    };
  });

  afterEach(() => {
    try {
      rmSync(base, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  it("refuses an empty delta without any git write", async () => {
    const st = await call("GET", "/api/publish/status");
    expect((st.json as { canPublish: boolean; reason: string }).canPublish).toBe(false);
    expect((st.json as { reason: string }).reason).toBe("nothing-to-publish");
    const r = await call("POST", "/api/publish", { reviewer: "Sam", confirm: true });
    expect(r.status).toBe(409);
    expect(calls.some((c) => c[0] === "push" || c[0] === "commit-tree")).toBe(false);
  });

  it("status exposes the target and a placeholder commit message without credentials", async () => {
    writeFileSync(join(work, "config", "page-seed.json"), JSON.stringify({ approvedUrls: ["https://example.test/b"] }) + "\n");
    const st = await call("GET", "/api/publish/status");
    const j = st.json as {
      target: { remote: string | null; branch: string; remoteName: string };
      commitMessage: string;
      delta: { modified: string[] };
    };
    expect(typeof j.target.remote).toBe("string");
    expect(j.target.branch).toBe("main");
    expect(j.target.remoteName).toBe("origin");
    expect(j.commitMessage).toContain("Reviewer: <your name>");
    expect(/^[\x00-\x7f]*$/.test(j.commitMessage)).toBe(true);
    expect(j.delta.modified).toEqual(["config/page-seed.json"]);
    expect(calls.some((c) => c[0] === "push" || c[0] === "commit-tree")).toBe(false);
  });

  it("requires a reviewer name and rejects an agent", async () => {
    writeFileSync(join(work, "config", "page-seed.json"), JSON.stringify({ approvedUrls: [] }) + "\n");
    expect((await call("POST", "/api/publish", { confirm: true })).status).toBe(400);
    expect((await call("POST", "/api/publish", { reviewer: "Agent", confirm: true })).status).toBe(403);
    expect(calls.some((c) => c[0] === "push")).toBe(false);
  });

  it("publishes only the configuration delta as one child commit and leaves the rest alone", async () => {
    const before = git(work, "rev-parse", "origin/main");
    writeFileSync(join(work, "config", "page-seed.json"), JSON.stringify({ approvedUrls: ["https://example.test/a"] }) + "\n");
    writeFileSync(join(work, "notes.txt"), "two\n");
    mkdirSync(join(work, "baselines", "x"), { recursive: true });
    writeFileSync(join(work, "baselines", "x", "baseline.v1.md"), "# b\n");
    const r = await call("POST", "/api/publish", { reviewer: "Sam", confirm: true });
    expect(r.status).toBe(200);
    const j = r.json as { commit: string; pushedAt: string; branch: string; remote: string };
    expect(j.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(j.pushedAt).toBe("2025-01-02T03:04:05.000Z");
    expect(j.branch).toBe("main");
    expect(j.remote).toBe("origin");
    expect(git(bare, "rev-parse", "main")).toBe(j.commit);
    expect(git(bare, "rev-list", "--parents", "-n", "1", j.commit)).toBe(`${j.commit} ${before}`);
    expect(git(bare, "diff", "--name-only", before, j.commit).split("\n").sort()).toEqual([
      "baselines/x/baseline.v1.md",
      "config/page-seed.json",
    ]);
    // Unrelated edit is still an unstaged working-tree change.
    expect(readFileSync(join(work, "notes.txt"), "utf8")).toBe("two\n");
    expect(git(work, "status", "--short", "--", "notes.txt")).toBe("M notes.txt");
    // Forbidden commands and arguments never ran.
    for (const c of calls) {
      expect(["rebase", "merge", "pull", "checkout", "add", "commit", "stash"]).not.toContain(c[0]);
      expect(c.some((a) => /^--force|^-f$|^\+/.test(a))).toBe(false);
    }
    // Status and feedback reflect the publish.
    const st = await call("GET", "/api/publish/status");
    expect((st.json as { count: number }).count).toBe(0);
    const fb = await call("GET", "/api/git/feedback");
    expect((fb.json as { lastPublished: { sha: string } }).lastPublished.sha).toBe(j.commit);
    expect(existsSync(join(work, "artifacts", "admin", "setup-activity.jsonl"))).toBe(true);
    expect(readFileSync(join(work, "artifacts", "admin", "setup-activity.jsonl"), "utf8")).toContain('"action":"publish"');
  });
});
