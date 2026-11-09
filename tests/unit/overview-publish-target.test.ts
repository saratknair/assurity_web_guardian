import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConsoleDeps } from "../../src/admin/console-deps.js";
import { realGit } from "../../src/admin/git-port.js";
import type { GitPort, GitResult } from "../../src/admin/git-port.js";
import { publishOverview } from "../../src/admin/publish-api.js";
import { createConsole } from "../../src/admin/console-router.js";

const TIP = "a".repeat(40);

function depsWith(git: GitPort, root: string, present: string[] = []): ConsoleDeps {
  return {
    port: 7787,
    fs: {
      root,
      exists: (rel) => present.includes(rel),
      readText: () => {
        throw new Error("missing");
      },
      readBytes: () => new Uint8Array(4),
      writeText: () => undefined,
      listDir: () => [],
    },
    git,
    jobs: { current: () => null, start: () => ({ ok: false, reason: "idle" }) },
    approval: { authorizeSetupAction: () => undefined, approveVisualBaseline: () => undefined },
    clock: { now: () => new Date(0) },
  };
}

/** Fake git: origin URL fixed; local and remote file maps (path -> blob id). */
function fakeGit(url: string, local: Record<string, string>, remote: Record<string, string>, hasTip = true): GitPort {
  const ok = (stdout = ""): GitResult => ({ code: 0, stdout, stderr: "" });
  return {
    run: async (args, opts) => {
      const [sub, a1] = args;
      if (sub === "remote") return ok(url + "\n");
      if (sub === "rev-parse" && a1 === "--abbrev-ref") return ok("main\n");
      if (sub === "rev-parse") return hasTip ? ok(TIP + "\n") : { code: 128, stdout: "", stderr: "unknown revision" };
      if (sub === "ls-files") return ok(Object.keys(local).map((p) => p + "\0").join(""));
      if (sub === "hash-object") {
        const paths = (opts?.stdin ?? "").split("\n").filter((l) => l !== "");
        return ok(paths.map((p) => local[p] + "\n").join(""));
      }
      if (sub === "ls-tree") return ok(Object.entries(remote).map(([p, id]) => `100644 blob ${id}\t${p}\0`).join(""));
      return ok();
    },
  };
}

const id = (c: string): string => c.repeat(40);

describe("Overview publish target (no-fetch path)", () => {
  it("reads origin from a real temp repository and strips credentials", async () => {
    const dir = mkdtempSync(join(tmpdir(), "p404-"));
    try {
      execFileSync("git", ["init", "-q"], { cwd: dir });
      execFileSync("git", ["remote", "add", "origin", "https://user:tok@github.com/saratknair/assurity_web_guardian.git"], { cwd: dir });
      const o = await publishOverview(depsWith(realGit(dir), dir));
      expect(o.target.remote).toBe("saratknair/assurity_web_guardian");
      expect(JSON.stringify(o)).not.toMatch(/tok|user:/);
      expect(o.unpublishedChanges).toBeNull();
      expect(o.unpublishedFiles).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns the display name from a fake git port whose get-url carries credentials", async () => {
    const o = await publishOverview(depsWith(fakeGit("https://me:secret@github.com/saratknair/assurity_web_guardian.git", {}, {}), "C:/x"));
    expect(o.target.remote).toBe("saratknair/assurity_web_guardian");
  });
});

describe("GET /api/status unpublishedFiles", () => {
  const get = { method: "GET", path: "/api/status", query: {}, headers: { host: "127.0.0.1:7787" }, body: null };

  it("lists Added, Changed and Deleted files from the same delta as the count", async () => {
    const local = { "config/domains/a.json": id("1"), "config/domains/b.json": id("2"), "config/domains/new.json": id("3") };
    const remote = { "config/domains/a.json": id("1"), "config/domains/b.json": id("9"), "config/domains/gone.json": id("4") };
    const d = depsWith(fakeGit("https://github.com/o/r.git", local, remote), "C:/x", Object.keys(local));
    const j = (await createConsole(d).handle(get)).json as {
      unpublishedChanges: number;
      unpublishedFiles: Array<{ path: string; change: string }>;
      publishTarget: { remote: string | null };
    };
    expect(j.publishTarget.remote).toBe("o/r");
    expect(j.unpublishedFiles).toEqual([
      { path: "config/domains/new.json", change: "Added" },
      { path: "config/domains/b.json", change: "Changed" },
      { path: "config/domains/gone.json", change: "Deleted" },
    ]);
    expect(j.unpublishedFiles.length).toBe(j.unpublishedChanges);
  });

  it("is an empty array when nothing is unpublished and null when unknown", async () => {
    const same = { "config/domains/a.json": id("1") };
    const none = depsWith(fakeGit("https://github.com/o/r.git", same, same), "C:/x", Object.keys(same));
    expect(((await createConsole(none).handle(get)).json as { unpublishedFiles: unknown }).unpublishedFiles).toEqual([]);
    const unknown = depsWith(fakeGit("https://github.com/o/r.git", same, same, false), "C:/x", Object.keys(same));
    expect(((await createConsole(unknown).handle(get)).json as { unpublishedFiles: unknown }).unpublishedFiles).toBeNull();
  });
});

