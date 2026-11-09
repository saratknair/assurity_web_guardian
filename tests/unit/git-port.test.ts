import { describe, it, expect } from "vitest";
import { checkGitArgs, realGit } from "../../src/admin/git-port.js";
import { buildFeedbackRecord, normalizeRemote, pagesUrlFromRemote } from "../../src/admin/git-feedback.js";

describe("pagesUrlFromRemote", () => {
  it("derives the GitHub Pages address from https and ssh remotes", () => {
    expect(pagesUrlFromRemote("https://github.com/saratknair/assurity_web_guardian.git")).toBe(
      "https://saratknair.github.io/assurity_web_guardian/",
    );
    expect(pagesUrlFromRemote("git@github.com:Owner/Repo.git")).toBe("https://owner.github.io/Repo/");
    expect(pagesUrlFromRemote("ssh://git@github.com/o/r")).toBe("https://o.github.io/r/");
  });
  it("uses the site root for a user pages repository", () => {
    expect(pagesUrlFromRemote("https://github.com/o/o.github.io.git")).toBe("https://o.github.io/");
  });
  it("returns null for non-GitHub or malformed remotes", () => {
    expect(pagesUrlFromRemote("https://gitlab.com/o/r.git")).toBeNull();
    expect(pagesUrlFromRemote("")).toBeNull();
    expect(pagesUrlFromRemote("https://github.com/only-owner")).toBeNull();
  });
  it("never includes credentials", () => {
    const out = pagesUrlFromRemote("https://user:secret@github.com/o/r.git") ?? "";
    expect(out).toBe("https://o.github.io/r/");
    expect(out).not.toMatch(/secret|user|@/);
  });
});

describe("checkGitArgs", () => {
  it("allows whitelisted commands", () => {
    expect(checkGitArgs(["fetch", "origin", "main"])).toBeNull();
    expect(checkGitArgs(["push", "--porcelain", "origin", "abc:refs/heads/main"])).toBeNull();
    expect(checkGitArgs(["reset", "-q", "HEAD", "--", "config/a.json"])).toBeNull();
    expect(checkGitArgs(["remote", "get-url", "origin"])).toBeNull();
    expect(checkGitArgs(["config", "--get", "user.name"])).toBeNull();
    expect(checkGitArgs(["cat-file", "-p", "abc:artifacts/dispositions.json"])).toBeNull();
    expect(checkGitArgs(["cat-file", "--batch"])).not.toBeNull();
  });
  it("rejects forbidden subcommands and options", () => {
    for (const sub of ["rebase", "merge", "pull", "checkout", "stash", "add", "commit"]) {
      expect(checkGitArgs([sub])).not.toBeNull();
    }
    expect(checkGitArgs(["reset", "--hard"])).not.toBeNull();
    expect(checkGitArgs(["push", "--force", "origin", "x"])).not.toBeNull();
    expect(checkGitArgs(["push", "-f", "origin", "x"])).not.toBeNull();
    expect(checkGitArgs(["push", "--force-with-lease", "origin", "x"])).not.toBeNull();
    expect(checkGitArgs(["push", "origin", "+abc:refs/heads/main"])).not.toBeNull();
    expect(checkGitArgs(["remote", "add", "x", "y"])).not.toBeNull();
  });
  it("rejects without spawning", async () => {
    await expect(realGit(process.cwd()).run(["pull"])).rejects.toThrow();
  });
});

describe("git feedback", () => {
  it("normalizes remotes", () => {
    expect(normalizeRemote("https://user:pw@github.com/o/r.git")).toBe("github.com/o/r");
    expect(normalizeRemote("git@github.com:o/r.git")).toBe("github.com/o/r");
  });
  it("scrubs lines and keeps full SHA", () => {
    const sha = "a".repeat(40);
    const r = buildFeedbackRecord(
      { op: "push", ok: false, branch: "main", remote: "https://x:tok@github.com/o/r.git", lines: ["https://u:p@github.com/x failed\nghp_abcdef123456"], commit: sha },
      new Date("2025-01-01T00:00:00.000Z"),
    );
    expect(r.lines.join(" ")).not.toContain("ghp_abcdef");
    expect(r.lines.join(" ")).not.toContain("u:p@");
    expect(r.remote).toBe("github.com/o/r");
    expect(r.commit).toBe(sha);
  });
});
