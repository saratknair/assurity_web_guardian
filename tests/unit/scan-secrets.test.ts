import { describe, expect, it } from "vitest";
// @ts-expect-error plain ES module without type declarations
import { scanText, shouldScan, redact, loadAllowlist } from "../../scripts/dev/scan-secrets.mjs";

// Samples are assembled at runtime so this file holds no scanner-matching literal.
const x = (n: number) => "x".repeat(n);
const samples: Record<string, string> = {
  "github-token": `v = "gh${"p"}_${x(36)}"`,
  "github-token-pat": `v = "github_${"pat"}_${x(60)}"`,
  "aws-key-id": `id ${"AK" + "IA"}${"A".repeat(16)}`,
  "private-key": `-----${"BEGIN"} RSA PRIVATE ${"KEY"}-----`,
  "slack-token": `t ${"xo" + "xb"}-${"1".repeat(12)}`,
  jwt: `eyJ${x(12)}.${x(12)}.${x(12)}`,
  "generic-assignment": `const ${"pass" + "word"} = "${x(14)}";`,
  "personal-path": "p = '" + "C:" + "\\" + "Users" + "\\" + "someone'",
  email: "mail " + "someone" + "@" + "host.test",
  name: "built by " + "Assu" + "rity",
};

describe("scanText", () => {
  for (const [name, text] of Object.entries(samples)) {
    it(`detects ${name}`, () => {
      expect(scanText("src/a.ts", text).length).toBeGreaterThan(0);
    });
  }

  it("does not read a package specifier as an email", () => {
    expect(scanText("docs/a.md", "| lib | chart.js@4.4.6 | three@0.160.0 |")).toEqual([]);
    expect(scanText("docs/a.md", "git@" + "github.com:o/r.git").length).toBe(1);
  });

  it("passes clean text", () => {
    expect(scanText("src/a.ts", "const answer = 42;\nconsole.log('hello');")).toEqual([]);
  });

  it("reports 1-based line numbers", () => {
    const f = scanText("src/a.ts", "ok\n" + samples["github-token"]);
    expect(f[0].line).toBe(2);
  });

  it("applies the name rule to product files only", () => {
    expect(scanText("baselines/site/baseline.v1.md", samples.name)).toEqual([]);
    expect(scanText("config/domains/site.json", samples.name)).toEqual([]);
    expect(scanText("config/app.config.example.json", samples.name).length).toBe(1);
    expect(scanText("baselines/site/baseline.v1.md", samples["github-token"]).length).toBe(1);
  });

  it("never prints the full match", () => {
    const secret = x(40);
    const text = `v = "gh${"p"}_${secret}"`;
    const [f] = scanText("src/a.ts", text);
    expect(f.match).not.toContain(secret);
    expect(f.match.length).toBeLessThan(16);
    expect(redact("abcdefghijkl")).toBe("abcd...(12)");
  });
});

describe("allowlist", () => {
  it("suppresses a finding by path and kind and records use", () => {
    const entry = { path: "src/a.ts", kind: "email", reason: "fixture" };
    const used = new Set();
    expect(scanText("src/a.ts", samples.email, [entry], used)).toEqual([]);
    expect(used.has(entry)).toBe(true);
  });

  it("does not suppress other kinds, paths, or lines without the 'contains' text", () => {
    const entry = { path: "src/a.ts", kind: "email", contains: "zzz", reason: "fixture" };
    expect(scanText("src/a.ts", samples.email, [entry]).length).toBe(1);
    expect(scanText("src/a.ts", samples["github-token"], [{ ...entry, contains: undefined }]).length).toBe(1);
    expect(scanText("src/b.ts", samples.email, [{ ...entry, contains: undefined }]).length).toBe(1);
  });

  it("supports directory prefixes", () => {
    const entry = { path: "tests/", kind: "email", reason: "fixture" };
    expect(scanText("tests/unit/a.ts", samples.email, [entry])).toEqual([]);
  });

  it("requires a reason on every shipped entry", () => {
    const entries = loadAllowlist("scripts/dev/secret-scan.allow.json");
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) expect(e.reason).toBeTruthy();
  });
});

describe("shouldScan", () => {
  it("skips dependencies, vendored libraries, lockfiles, binaries and transient specs", () => {
    for (const f of [
      "node_modules/a/index.js",
      "dashboard/vendor/chart.js",
      "office/vendor/three.js",
      "package-lock.json",
      "docs/shot.png",
      ".kiro/specs/other/design.md",
    ]) {
      expect(shouldScan(f), f).toBe(false);
    }
  });

  it("scans source, instance data and the consolidated spec", () => {
    for (const f of ["src/a.ts", "baselines/x/baseline.v1.md", "config/app.config.json", ".kiro/specs/web-guardian/design.md"]) {
      expect(shouldScan(f), f).toBe(true);
    }
  });
});
