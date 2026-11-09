import { describe, it, expect } from "vitest";
import { applyUrlOps, normaliseApprovedUrl, projectUrls } from "../../src/admin/url-set.js";
import { validateNewHost } from "../../src/admin/host-validate.js";
import { draftWorkspace, projectWorkspace } from "../../src/admin/workspace.js";

const ctx = { approvedDomain: "assurity.nz", max: 3 };

describe("normaliseApprovedUrl", () => {
  it("normalises and rejects out-of-domain", () => {
    expect(normaliseApprovedUrl("https://Assurity.nz/careers#x", "assurity.nz")).toEqual({
      ok: true,
      url: "https://assurity.nz/careers/",
    });
    const bad = normaliseApprovedUrl("https://example.com/", "assurity.nz");
    expect(bad.ok).toBe(false);
  });
});

describe("applyUrlOps", () => {
  it("is idempotent, appends, names slug collisions, and enforces the cap", () => {
    const r = applyUrlOps(
      ["https://assurity.nz/a-b/"],
      [
        { op: "add", url: "https://assurity.nz/a-b/" },
        { op: "add", url: "https://assurity.nz/a/b/" },
        { op: "add", url: "https://assurity.nz/c/" },
        { op: "add", url: "https://assurity.nz/d/" },
        { op: "add", url: "https://assurity.nz/e/" },
      ],
      ctx,
    );
    expect(r.urls).toEqual(["https://assurity.nz/a-b/", "https://assurity.nz/c/", "https://assurity.nz/d/"]);
    expect(r.outcomes[0].status).toBe("already-approved");
    expect(r.outcomes[1].reason).toContain("https://assurity.nz/a-b/");
    expect(r.outcomes[4].status).toBe("rejected");
    expect(r.usedText).toBe("3 of 3 used");
  });

  it("edit is atomic and flags re-approval", () => {
    const seed = ["https://assurity.nz/a/"];
    const ok = applyUrlOps(seed, [{ op: "edit", from: "https://assurity.nz/a/", to: "https://assurity.nz/b/" }], ctx);
    expect(ok.urls).toEqual(["https://assurity.nz/b/"]);
    expect(ok.requiresReapproval).toEqual(["https://assurity.nz/b/"]);
    const bad = applyUrlOps(seed, [{ op: "edit", from: "https://assurity.nz/a/", to: "https://evil.com/" }], ctx);
    expect(bad.urls).toEqual(seed);
  });

  it("projectUrls shows pending badges", () => {
    const p = projectUrls(
      ["https://assurity.nz/a/"],
      [
        { op: "remove", url: "https://assurity.nz/a/", editId: "e1" },
        { op: "add", url: "https://assurity.nz/b/", editId: "e1" },
      ],
      10,
    );
    expect(p.urls).toEqual(["https://assurity.nz/b/"]);
    expect(p.entries[1].requiresReapproval).toBe(true);
    expect(p.usedText).toBe("1 of 10 used");
  });
});

describe("validateNewHost", () => {
  it("accepts public hosts and normalises", () => {
    expect(validateNewHost(" https://Example.COM/ ")).toEqual({
      ok: true,
      host: "example.com",
      baseUrl: "https://example.com",
      slug: "example-com",
    });
  });
  it("rejects unsafe input", () => {
    for (const bad of [
      "",
      "localhost",
      "127.0.0.1",
      "[::1]",
      "http://example.com",
      "ftp://example.com",
      "user@example.com",
      "example.com:8080",
      "example.com/path",
      "foo.local",
      "-a.example.com",
      "single",
    ]) {
      expect(validateNewHost(bad).ok, bad).toBe(false);
    }
  });
});

describe("workspace", () => {
  it("project and draft roots differ", () => {
    expect(projectWorkspace("/r").baselinesRoot).toBe("/r/baselines");
    expect(draftWorkspace("/r").baselinesRoot).toBe("/r/artifacts/admin/new-domain/baselines");
    expect(draftWorkspace("/r").pendingPath).toBeNull();
  });
});
