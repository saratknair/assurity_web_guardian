import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRunFindingSet } from "../../src/core/finding-model.js";
import { buildRunFindings, loadRawRunInputs } from "../../src/publish/run-findings.js";
import { readRunFacts, runOriginMarker } from "../../src/publish/published-data.js";

const dirs: string[] = [];
function mkRun(): string {
  const d = mkdtempSync(join(tmpdir(), "awg-vk-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("visual Finding key rule is shared", () => {
  it("lifecycle key set equals published Finding keys, including size-changed screenshots", () => {
    const d = mkRun();
    mkdirSync(join(d, "screenshots"), { recursive: true });
    writeFileSync(join(d, "screenshots", "home.desktop.diff.png"), "x");
    // Rule-level run: readable raw axe output (no violations) for each page/viewport.
    mkdirSync(join(d, "accessibility"), { recursive: true });
    for (const [slug, url] of [["home", "https://example.test/"], ["a", "https://example.test/a"]]) {
      for (const vp of ["desktop", "mobile"]) {
        writeFileSync(join(d, "accessibility", `${slug}.${vp}.json`), JSON.stringify({ url, violations: [] }));
      }
    }
    writeFileSync(
      join(d, "results.json"),
      JSON.stringify({
        pages: [
          { page: "https://example.test/", slug: "home", checks: [] },
          { page: "https://example.test/a", slug: "a", checks: [] },
        ],
      }),
    );
    writeFileSync(
      join(d, "findings.json"),
      JSON.stringify({
        runId: "r1",
        pages: [
          { page: "https://example.test/", slug: "home", outcomes: [], visual: { desktop: { differs: true }, mobile: { differs: false } } },
          { page: "https://example.test/a", slug: "a", outcomes: [], visual: { mobile: { differs: true, dimensionsChanged: true } } },
        ],
      }),
    );
    const lifecycleKeys = [...buildRunFindingSet(d).keys()].sort();
    const built = buildRunFindings(loadRawRunInputs(d));
    const publishedKeys = built.runFindings.findings
      .map((f) => `${f.pageUrl}|${f.viewport}|${f.ruleId}`)
      .sort();
    expect(lifecycleKeys).toEqual(publishedKeys);
    expect(lifecycleKeys).toEqual([
      "https://example.test/a|mobile|visual-diff",
      "https://example.test/|desktop|visual-diff",
    ].sort());
  });
});

describe("run origin marker", () => {
  it("runOriginMarker yields cloud only for exactly cloud", () => {
    expect(runOriginMarker("cloud")).toBe("cloud");
    expect(runOriginMarker(" cloud ")).toBe("cloud");
    expect(runOriginMarker(undefined)).toBe("local");
    expect(runOriginMarker("Cloud!")).toBe("local");
  });

  it("a persisted marker wins over the env fallback", () => {
    const d = mkRun();
    writeFileSync(join(d, "origin"), "local", "utf8");
    expect(readRunFacts(d, "r1", "cloud").origin).toBe("local");
    const e = mkRun();
    writeFileSync(join(e, "origin"), "cloud", "utf8");
    expect(readRunFacts(e, "r2", undefined).origin).toBe("cloud");
    const f = mkRun();
    expect(readRunFacts(f, "r3", "cloud").origin).toBe("cloud");
  });
});
