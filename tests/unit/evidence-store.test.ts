import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EvidenceStore, applyRetention } from "../../src/core/evidence-store.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "awg-ev-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("Feature: assurity-web-guardian — Phase 5 evidence store", () => {
  it("creates the full run directory layout (Req 24)", () => {
    const store = new EvidenceStore("run_test1", root);
    for (const sub of ["screenshots", "traces", "accessibility", "agent-tasks", "report"]) {
      expect(existsSync(join(store.runDir, sub))).toBe(true);
    }
  });

  it("writes run.json atomically and evidence references resolve", () => {
    const store = new EvidenceStore("run_test2", root);
    const p = store.writeJson("run.json", { runId: "run_test2" });
    expect(existsSync(p)).toBe(true);
    const shot = join(store.runDir, "screenshots", "home.png");
    writeFileSync(shot, "x");
    store.addEvidence({ kind: "screenshot", path: shot, page: "https://assurity.nz/", viewport: "desktop" });
    expect(store.evidenceResolves()).toBe(true);
    store.addEvidence({ kind: "trace", path: join(store.runDir, "traces", "missing.zip") });
    expect(store.evidenceResolves()).toBe(false);
  });

  it("retention never deletes a run awaiting human review (Req 10.5, 24.6)", () => {
    // Build three run dirs; one is awaiting review.
    const makeRun = (name: string, awaiting: boolean) => {
      const d = join(root, name);
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, "findings.json"), JSON.stringify({ awaitingReview: awaiting }));
    };
    makeRun("run_a", false);
    makeRun("run_b", true);
    makeRun("run_c", false);

    // maxRuns = 1 would normally delete two of three; the awaiting one survives.
    const deleted = applyRetention(root, 1, 3650, Date.now());
    expect(existsSync(join(root, "run_b"))).toBe(true); // protected
    expect(deleted).not.toContain("run_b");
  });

  it("retention deletes old non-review runs when over age", () => {
    const d = join(root, "run_old");
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "findings.json"), JSON.stringify({ awaitingReview: false }));
    // age cutoff in the future forces deletion
    const deleted = applyRetention(root, 100, 0, Date.now() + 1000);
    expect(deleted).toContain("run_old");
    expect(existsSync(d)).toBe(false);
  });
});
