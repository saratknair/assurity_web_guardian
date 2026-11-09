// Feature: dashboard-usability-overhaul - task 22.5 approval gate setup actions
// (Requirements 21.5, 22.12, 24.4, 24.7, 25.4).
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppendOnlyLog } from "../../src/telemetry/audit-log.js";
import { ApprovalGate, SelfApprovalError, ApprovalError } from "../../src/approval/approval-gate.js";

const dirs: string[] = [];
function setup() {
  const root = mkdtempSync(join(tmpdir(), "gate-"));
  dirs.push(root);
  const logPath = join(root, "audit.jsonl");
  const gate = new ApprovalGate(new AppendOnlyLog(logPath), join(root, "pending"), join(root, "baselines"));
  const entries = () =>
    existsSync(logPath)
      ? readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
      : [];
  return { root, gate, entries };
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("ApprovalGate setup actions", () => {
  it("authorizeSetupAction appends config-change-authorized for a human", () => {
    const { gate, entries } = setup();
    const id = gate.authorizeSetupAction({ reviewer: "Jane", action: "publish", detail: { pages: 3 } });
    const e = entries();
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ type: "config-change-authorized", reviewId: id, reviewer: "Jane", action: "publish", detail: { pages: 3 } });
  });

  it("authorizeSetupAction rejects agents and empty reviewers", () => {
    const { gate, entries } = setup();
    expect(() => gate.authorizeSetupAction({ reviewer: "Orchestrator", action: "publish" })).toThrow(SelfApprovalError);
    expect(() => gate.authorizeSetupAction({ reviewer: "  ", action: "publish" })).toThrow(ApprovalError);
    expect(entries().map((x) => x.type)).toEqual(["self-approval-rejected"]);
  });

  it("approveVisualBaseline records approved vs updated with script keys plus source and sha16", () => {
    const { root, gate, entries } = setup();
    const p = join(root, "vb", "s1", "desktop.png");
    gate.approveVisualBaseline({ reviewer: "Jane", slug: "s1", viewport: "desktop", source: "run-1", sha16: "abcd", baselinePath: p });
    mkdirSync(join(root, "vb", "s1"), { recursive: true });
    writeFileSync(p, "x");
    gate.approveVisualBaseline({ reviewer: "Jane", slug: "s1", viewport: "desktop", source: "run-2", sha16: "ef01", baselinePath: p });
    const e = entries();
    expect(e[0]).toMatchObject({ type: "visual-baseline-approved", reviewer: "Jane", slug: "s1", viewport: "desktop", sourceRun: "run-1", baselinePath: p, source: "run-1", sha16: "abcd" });
    expect(e[1]).toMatchObject({ type: "visual-baseline-updated", source: "run-2", sha16: "ef01" });
    expect(() => gate.approveVisualBaseline({ reviewer: "Triage_Agent", slug: "s1", viewport: "desktop", source: "r", sha16: "x" })).toThrow(SelfApprovalError);
  });

  it("approveSpecification honours a staging baselinesRoot and keeps the default", () => {
    const { root, gate } = setup();
    mkdirSync(join(root, "pending"), { recursive: true });
    writeFileSync(join(root, "pending", "pg.draft.md"), "- **State:** draft\n");
    const staged = gate.approveSpecification({ reviewer: "Jane", decision: "accepted", reason: "ok", slug: "pg" }, { baselinesRoot: join(root, "staging") });
    expect(staged.baselinePath).toBe(join(root, "staging", "pg", "baseline.v1.md"));
    const def = gate.approveSpecification({ reviewer: "Jane", decision: "accepted", reason: "ok", slug: "pg" });
    expect(def.baselinePath).toBe(join(root, "baselines", "pg", "baseline.v1.md"));
  });
});
