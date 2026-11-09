import { describe, it, expect } from "vitest";
import { remoteDisplayName } from "../../src/admin/git-feedback.js";

describe("remoteDisplayName", () => {
  it("shows owner/repo for GitHub https and ssh remotes", () => {
    expect(remoteDisplayName("https://github.com/saratknair/assurity_web_guardian.git")).toBe("saratknair/assurity_web_guardian");
    expect(remoteDisplayName("git@github.com:saratknair/assurity_web_guardian.git")).toBe("saratknair/assurity_web_guardian");
    expect(remoteDisplayName("ssh://git@github.com/o/r")).toBe("o/r");
  });

  it("strips credentials, including a password with an at sign", () => {
    const a = remoteDisplayName("https://user:s3cret@github.com/o/r.git") as string;
    expect(a).toBe("o/r");
    const b = remoteDisplayName("https://user:p@ss@gitlab.example.com/grp/proj.git") as string;
    expect(b).toBe("gitlab.example.com/grp/proj");
    expect(b).not.toContain("ss@");
    expect(b).not.toContain("user");
  });

  it("shows host/path for non-GitHub remotes and null when empty", () => {
    expect(remoteDisplayName("git@gitlab.com:grp/proj.git")).toBe("gitlab.com/grp/proj");
    expect(remoteDisplayName("")).toBeNull();
    expect(remoteDisplayName(null)).toBeNull();
    expect(remoteDisplayName(undefined)).toBeNull();
  });
});
