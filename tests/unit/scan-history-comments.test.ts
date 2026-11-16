import { describe, it, expect } from "vitest";
import {
  scanText,
  shouldScan,
  // @ts-expect-error plain .mjs module without type declarations
} from "../../scripts/dev/scan-history-comments.mjs";

describe("scan-history-comments", () => {
  it("flags history narration and reports 1-based lines", () => {
    const text = ["const a = 1;", "// Req 6.7 handled here", "// phase 2 only"].join("\n");
    const hits = scanText("x.ts", text);
    expect(hits.map((h: { line: number; kind: string }) => [h.line, h.kind])).toEqual([
      [2, "requirement-number"],
      [3, "phase-narration"],
    ]);
  });

  it("flags non-ASCII and header patterns", () => {
    const hits = scanText("x.ts", "// Validates: 1.2\n// caf\u00e9");
    const kinds = hits.map((h: { kind: string }) => h.kind);
    expect(kinds).toContain("requirement-header");
    expect(kinds).toContain("non-ascii");
  });

  it("flags stage spec names", () => {
    for (const name of [
      "guardian-phase2-overhaul",
      "dashboard-usability-overhaul",
      "virtual-office-replay",
      "project-consolidation",
    ]) {
      const kinds = scanText("x.ts", `// see ${name}`).map((h: { kind: string }) => h.kind);
      expect(kinds).toContain("stage-name");
    }
  });

  it("leaves clean text alone", () => {
    expect(scanText("x.ts", "// Retries the fetch once on timeout.")).toEqual([]);
  });

  it("suppresses allowlisted matches only for the listed path and text", () => {
    const line = '      error: "retired",';
    expect(scanText("src/admin/console-routes.ts", line)).toEqual([]);
    expect(scanText("src/other.ts", line)).toHaveLength(1);
    expect(scanText("src/admin/console-routes.ts", "// previously used")).toHaveLength(1);
  });

  it("allows requirement references in the product spec but flags other history", () => {
    const spec = ".kiro/specs/web-guardian/design.md";
    const text = "### Requirement 3: Title\n**Validates: Requirements 3.2**\nPhase 2 notes\ncaf\u00e9";
    const kinds = scanText(spec, text).map((h: { kind: string }) => h.kind);
    expect(kinds).toEqual(["phase-narration", "non-ascii"]);
    expect(scanText("src/x.ts", "// Requirement 3.2")).toHaveLength(1);
  });

  it("skips vendored, lock and instance files", () => {
    expect(shouldScan("office/vendor/three.module.min.js")).toBe(false);
    expect(shouldScan("package-lock.json")).toBe(false);
    expect(shouldScan("baselines/x/baseline.v1.md")).toBe(false);
    expect(shouldScan("src/index.ts")).toBe(true);
  });
});
