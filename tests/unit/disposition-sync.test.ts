import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { entryId, serializeLog } from "../../src/core/dispositions.js";
import type { DispositionEntry } from "../../src/core/dispositions.js";
import { readLog, readSyncState } from "../../src/core/disposition-store.js";
import { realGit } from "../../src/admin/git-port.js";
import type { GitPort } from "../../src/admin/git-port.js";
import { pullDispositions, pushDispositions } from "../../src/admin/disposition-sync.js";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

// Real git processes are slow on Windows; these tests spawn many.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

let gitOk = true;
try {
  git(tmpdir(), "--version");
} catch {
  gitOk = false;
}

function makeEntry(rule: string, at: string): DispositionEntry {
  const body: Omit<DispositionEntry, "id"> = {
    decision: "ignore",
    scope: "site-rule",
    matcher: { pageUrl: "", viewport: "", ruleId: rule, cssTarget: "" },
    reason: "test",
    reviewer: "Tester",
    at,
    undoes: null,
    source: "cli",
  };
  return { id: entryId(body), ...body };
}

describe.skipIf(!gitOk)("disposition-sync (local bare repos)", () => {
  let base: string;
  let bare: string;
  let work: string;
  let art: string;
  let tmpRoot: string;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "awg-dsptest-"));
    bare = join(base, "remote.git");
    work = join(base, "work");
    art = join(base, "art");
    tmpRoot = join(base, "tmproot");
    mkdirSync(work);
    mkdirSync(art);
    mkdirSync(tmpRoot);
    git(base, "init", "--bare", "-b", "main", bare);
    git(work, "init", "-b", "main");
    git(work, "config", "user.name", "T");
    git(work, "config", "user.email", "t@example.invalid");
    writeFileSync(join(work, "README.md"), "hello\n");
    git(work, "add", "README.md");
    git(work, "commit", "-m", "init");
    git(work, "remote", "add", "origin", bare);
    git(work, "push", "origin", "main");
    git(work, "checkout", "-b", "runs-data");
    mkdirSync(join(work, "artifacts"));
    writeFileSync(join(work, "artifacts", "run.txt"), "run\n");
    git(work, "add", "artifacts/run.txt");
    git(work, "commit", "-m", "run data");
    git(work, "push", "origin", "runs-data");
    git(work, "checkout", "main");
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });

  function writeLocal(entries: DispositionEntry[]): void {
    writeFileSync(join(art, "dispositions.json"), serializeLog({ schemaVersion: 1, entries }));
  }

  it("pushes one additive commit on the runs-data tip without touching the checkout", async () => {
    const e1 = makeEntry("color-contrast", "2025-01-01T00:00:00.000Z");
    writeLocal([e1]);
    const oldTip = git(work, "rev-parse", "origin/runs-data");
    const headBefore = git(work, "rev-parse", "HEAD");
    const calls: string[][] = [];
    const real = realGit(work);
    const spy: GitPort = { run: (a, o) => (calls.push(a), real.run(a, o)) };

    const res = await pushDispositions({ git: spy, root: work, artifactsDir: art, tmpRoot });
    expect(res.state).toBe("synced");

    const tip = git(bare, "rev-parse", "runs-data");
    expect(git(bare, "rev-parse", `${tip}^`)).toBe(oldTip);
    expect(git(bare, "log", "-1", "--format=%s", "runs-data")).toBe("dispositions: add 1 entry");
    expect(git(bare, "show", "runs-data:artifacts/dispositions.json")).toContain(e1.id);
    expect(git(bare, "show", "runs-data:artifacts/run.txt")).toBe("run");

    expect(git(work, "rev-parse", "HEAD")).toBe(headBefore);
    expect(git(work, "status", "--short")).toBe("");
    expect(readdirSync(tmpRoot)).toEqual([]);
    expect(readSyncState(join(art, "dispositions.sync.json")).syncedIds).toEqual([e1.id]);
    expect(calls.flat().some((a) => a.startsWith("--force") || a === "-f" || a.startsWith("+"))).toBe(false);

    // Second push: nothing new, no new commit.
    const again = await pushDispositions({ git: spy, root: work, artifactsDir: art, tmpRoot });
    expect(again.state).toBe("synced");
    expect(git(bare, "rev-parse", "runs-data")).toBe(tip);
  });

  it("refetches and unions after a competing commit, with no force", async () => {
    const mine = makeEntry("rule-a", "2025-01-01T00:00:00.000Z");
    const theirs = makeEntry("rule-b", "2025-01-02T00:00:00.000Z");
    writeLocal([mine]);

    const other = join(base, "other");
    git(base, "clone", "-b", "runs-data", bare, other);
    git(other, "config", "user.name", "O");
    git(other, "config", "user.email", "o@example.invalid");
    mkdirSync(join(other, "artifacts"), { recursive: true });
    writeFileSync(join(other, "artifacts", "dispositions.json"), serializeLog({ schemaVersion: 1, entries: [theirs] }));
    git(other, "add", "artifacts/dispositions.json");
    git(other, "commit", "-m", "competing");

    const calls: string[][] = [];
    let pushes = 0;
    const real = realGit(work);
    const spy: GitPort = {
      run: (a, o) => {
        calls.push(a);
        if (a[0] === "push") {
          pushes += 1;
          if (pushes === 1) git(other, "push", "origin", "runs-data");
        }
        return real.run(a, o);
      },
    };

    const res = await pushDispositions({ git: spy, root: work, artifactsDir: art, tmpRoot });
    expect(res.state).toBe("synced");
    expect(pushes).toBe(2);
    const remoteText = git(bare, "show", "runs-data:artifacts/dispositions.json");
    expect(remoteText).toContain(mine.id);
    expect(remoteText).toContain(theirs.id);
    expect(calls.flat().some((a) => a.startsWith("--force") || a === "-f")).toBe(false);
    expect(readLog(join(art, "dispositions.json")).log.entries.map((e) => e.id).sort()).toEqual(
      [mine.id, theirs.id].sort(),
    );
    expect(readdirSync(tmpRoot)).toEqual([]);
  });

  it("reports Not yet synced and keeps the local log when the remote is unreachable", async () => {
    const e1 = makeEntry("rule-a", "2025-01-01T00:00:00.000Z");
    writeLocal([e1]);
    git(work, "remote", "set-url", "origin", join(base, "missing.git"));
    const res = await pushDispositions({ git: realGit(work), root: work, artifactsDir: art, tmpRoot });
    expect(res.state).toBe("not-yet-synced");
    if (res.state === "not-yet-synced") {
      expect(res.reason.length).toBeGreaterThan(0);
      expect(res.pendingIds).toEqual([e1.id]);
    }
    expect(readLog(join(art, "dispositions.json")).log.entries).toHaveLength(1);
    expect(readdirSync(tmpRoot)).toEqual([]);
  });

  it("pull merges the remote log into the local log as a union", async () => {
    const mine = makeEntry("rule-a", "2025-01-01T00:00:00.000Z");
    const theirs = makeEntry("rule-b", "2025-01-02T00:00:00.000Z");
    writeLocal([mine]);
    await pushDispositions({ git: realGit(work), root: work, artifactsDir: art, tmpRoot });

    const other = join(base, "other2");
    git(base, "clone", "-b", "runs-data", bare, other);
    git(other, "config", "user.name", "O");
    git(other, "config", "user.email", "o@example.invalid");
    writeFileSync(
      join(other, "artifacts", "dispositions.json"),
      serializeLog({ schemaVersion: 1, entries: [mine, theirs] }),
    );
    git(other, "add", "artifacts/dispositions.json");
    git(other, "commit", "-m", "more");
    git(other, "push", "origin", "runs-data");

    const res = await pullDispositions({ git: realGit(work), root: work, artifactsDir: art });
    expect(res).toEqual({ ok: true, added: 1 });
    expect(readLog(join(art, "dispositions.json")).log.entries).toHaveLength(2);
    expect(readFileSync(join(art, "dispositions.json"), "utf8")).toContain(theirs.id);
  });
});
