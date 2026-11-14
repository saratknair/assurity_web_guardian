import { describe, it, expect } from "vitest";
import { applyUrlOps, normaliseApprovedUrl, projectUrls } from "../../src/admin/url-set.js";
import { validateNewHost } from "../../src/admin/host-validate.js";
import { draftWorkspace, projectWorkspace } from "../../src/admin/workspace.js";

const ctx = { approvedDomain: "example.com", max: 3 };

describe("normaliseApprovedUrl", () => {
  it("normalises and rejects out-of-domain", () => {
    expect(normaliseApprovedUrl("https://Example.com/careers#x", "example.com")).toEqual({
      ok: true,
      url: "https://example.com/careers/",
    });
    const bad = normaliseApprovedUrl("https://other.test/", "example.com");
    expect(bad.ok).toBe(false);
  });
});

describe("applyUrlOps", () => {
  it("is idempotent, appends, names slug collisions, and enforces the cap", () => {
    const r = applyUrlOps(
      ["https://example.com/a-b/"],
      [
        { op: "add", url: "https://example.com/a-b/" },
        { op: "add", url: "https://example.com/a/b/" },
        { op: "add", url: "https://example.com/c/" },
        { op: "add", url: "https://example.com/d/" },
        { op: "add", url: "https://example.com/e/" },
      ],
      ctx,
    );
    expect(r.urls).toEqual(["https://example.com/a-b/", "https://example.com/c/", "https://example.com/d/"]);
    expect(r.outcomes[0].status).toBe("already-approved");
    expect(r.outcomes[1].reason).toContain("https://example.com/a-b/");
    expect(r.outcomes[4].status).toBe("rejected");
    expect(r.usedText).toBe("3 of 3 used");
  });

  it("edit is atomic and flags re-approval", () => {
    const seed = ["https://example.com/a/"];
    const ok = applyUrlOps(seed, [{ op: "edit", from: "https://example.com/a/", to: "https://example.com/b/" }], ctx);
    expect(ok.urls).toEqual(["https://example.com/b/"]);
    expect(ok.requiresReapproval).toEqual(["https://example.com/b/"]);
    const bad = applyUrlOps(seed, [{ op: "edit", from: "https://example.com/a/", to: "https://evil.com/" }], ctx);
    expect(bad.urls).toEqual(seed);
  });

  it("projectUrls shows pending badges", () => {
    const p = projectUrls(
      ["https://example.com/a/"],
      [
        { op: "remove", url: "https://example.com/a/", editId: "e1" },
        { op: "add", url: "https://example.com/b/", editId: "e1" },
      ],
      10,
    );
    expect(p.urls).toEqual(["https://example.com/b/"]);
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
