// Feature: dashboard-usability-overhaul, Property 54: Publish stages exactly the configuration delta and nothing else
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { CONFIG_PATHSPECS, isConfigPath } from "../../src/admin/publish-paths.js";
import { computeDelta } from "../../src/admin/publish-delta.js";

function inSpecs(p: string): boolean {
  return CONFIG_PATHSPECS.some((s) => (s.endsWith("/") ? p.startsWith(s) : p === s));
}

const seg = fc.stringMatching(/^[a-z0-9_-]{1,8}$/);
const rel = (prefix: string) =>
  fc.array(seg, { minLength: 1, maxLength: 3 }).map((a) => prefix + a.join("/"));

const configPath = fc.oneof(
  fc.constantFrom("config/app.config.json", "config/page-seed.json", ".github/workflows/guardian.yml"),
  rel("config/domains/"),
  rel("baselines/"),
  rel("baselines-visual/"),
);
const forbiddenPath = fc.oneof(
  rel("artifacts/"),
  rel("src/"),
  rel("dashboard/"),
  rel("node_modules/"),
  rel("tests/"),
  rel(""),
  fc.constantFrom("package.json", ".env", "config/other.json", ".github/workflows/other.yml"),
);
const badPath = fc.oneof(
  configPath.map((p) => "../" + p),
  configPath.map((p) => "baselines/../" + p),
  configPath.map((p) => "/" + p),
  configPath.map((p) => p.replace("/", "\\")),
  configPath.map((p) => "C:" + p),
  configPath.map((p) => "C:/" + p),
  configPath.map((p) => p + "\0"),
  configPath.map((p) => "./" + p),
  configPath.map((p) => p.replace("/", "//")),
  fc.constantFrom("", "baselines/", "config/domains/", "baselines/..", "..", "/etc/passwd"),
);

const blobMap = fc.dictionary(fc.oneof(configPath, forbiddenPath, badPath), fc.constantFrom("a", "b", "c"));

describe("**Property 54**: Publish stages exactly the configuration delta and nothing else", () => {
  it("selects only paths inside CONFIG_PATHSPECS and never artifacts/, src/ or dashboard/", () => {
    fc.assert(
      fc.property(fc.oneof(configPath, forbiddenPath, badPath), (p) => {
        if (isConfigPath(p)) {
          expect(inSpecs(p)).toBe(true);
          expect(/^(artifacts|src|dashboard)\//.test(p)).toBe(false);
        }
      }),
      { numRuns: 300 },
    );
  });

  it("accepts config paths and rejects non-config paths", () => {
    fc.assert(fc.property(configPath, (p) => isConfigPath(p) === true), { numRuns: 100 });
    fc.assert(fc.property(forbiddenPath, (p) => isConfigPath(p) === inSpecs(p)), { numRuns: 100 });
  });

  it("rejects traversal, absolute, backslash, drive-letter and malformed paths", () => {
    fc.assert(fc.property(badPath, (p) => isConfigPath(p) === false), { numRuns: 300 });
  });

  it("delta contains only config paths and matches the expected blob-id difference", () => {
    fc.assert(
      fc.property(blobMap, blobMap, (local, remote) => {
        const d = computeDelta(local, remote);
        const all = [...d.added, ...d.modified, ...d.deleted];
        for (const p of all) {
          expect(isConfigPath(p)).toBe(true);
          expect(inSpecs(p)).toBe(true);
        }
        const cfg = (m: Record<string, string>) => Object.keys(m).filter(isConfigPath);
        expect(d.added).toEqual(cfg(local).filter((p) => !(p in remote)).sort());
        expect(d.deleted).toEqual(cfg(remote).filter((p) => !(p in local)).sort());
        expect(d.modified).toEqual(cfg(local).filter((p) => p in remote && remote[p] !== local[p]).sort());
      }),
      { numRuns: 200 },
    );
  });

  it("identical maps yield an empty delta", () => {
    fc.assert(
      fc.property(blobMap, (m) => {
        const d = computeDelta(m, { ...m });
        expect([...d.added, ...d.modified, ...d.deleted]).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });
});
