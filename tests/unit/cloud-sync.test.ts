import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cloudSync, gitChildEnv, readBlobs } from "../../src/admin/cloud-sync.js";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], {
    cwd,
    encoding: "utf8",
    env: gitChildEnv(),
  });
}

let base: string;
let clone: string;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0a, 0x00, 0xff, 0x0a, 0x0a]);

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "awg-cs-"));
  const origin = join(base, "origin");
  clone = join(base, "clone");
  mkdirSync(origin);
  git(origin, "init", "-q", "-b", "runs-data");
  for (const id of ["run_a", "run_b"]) {
    mkdirSync(join(origin, "artifacts", "runs", id, "evidence"), { recursive: true });
    writeFileSync(join(origin, "artifacts", "runs", id, "results.json"), `{"id":"${id}"}`);
    writeFileSync(join(origin, "artifacts", "runs", id, "evidence", "shot.png"), PNG);
  }
  git(origin, "add", "-A");
  git(origin, "commit", "-q", "-m", "runs");
  mkdirSync(clone);
  git(clone, "init", "-q");
  git(clone, "remote", "add", "origin", origin);
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("cloudSync", () => {
  it("copies new runs byte for byte, skips existing ones and reports progress", async () => {
    const runsRoot = join(clone, "artifacts", "runs");
    mkdirSync(join(runsRoot, "run_a"), { recursive: true });
    writeFileSync(join(runsRoot, "run_a", "keep.txt"), "mine");
    const progress: string[] = [];
    const r = await cloudSync({ repoDir: clone, branch: "runs-data", runsRoot, onProgress: (d, t) => progress.push(`${d}/${t}`) });
    expect(r).toEqual({ ok: true, added: ["run_b"], skipped: ["run_a"] });
    expect(progress).toEqual(["1/1"]);
    expect(readFileSync(join(runsRoot, "run_b", "evidence", "shot.png")).equals(PNG)).toBe(true);
    expect(readFileSync(join(runsRoot, "run_b", "origin"), "utf8")).toBe("cloud");
    expect(readdirSync(join(runsRoot, "run_a"))).toEqual(["keep.txt"]);
  });

  it("reports a readable failure when the fetch fails", async () => {
    git(clone, "remote", "set-url", "origin", join(base, "missing"));
    const r = await cloudSync({ repoDir: clone, branch: "runs-data", runsRoot: join(clone, "runs") });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/git fetch failed/);
  });
});

describe("git child process settings", () => {
  it("never allows a credential prompt", () => {
    const env = gitChildEnv({ GIT_TERMINAL_PROMPT: "1" });
    expect(env.GIT_TERMINAL_PROMPT).toBe("0");
    expect(env.GCM_INTERACTIVE).toBe("never");
  });

  it("readBlobs rejects an unknown object", async () => {
    await expect(readBlobs(clone, ["0".repeat(40)])).rejects.toThrow();
  });
});
