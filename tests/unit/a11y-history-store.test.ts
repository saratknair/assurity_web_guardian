import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadA11yHistory, saveA11yHistory } from "../../src/agents/a11y-history-store.js";
import { emptyHistory } from "../../src/agents/a11y-lifecycle.js";
import { computeLifecycleForRun } from "../../src/core/run-lifecycle.js";

const URL1 = "https://example.test/";
let dir: string;
let hist: string;

function v1Entry(over: Record<string, unknown>) {
  return {
    fingerprint: "fp",
    ruleId: "link-name",
    pageUrl: URL1,
    viewport: "desktop",
    impact: "serious",
    firstSeen: "2025-01-02T00:00:00Z",
    lastSeen: "2025-01-03T00:00:00Z",
    occurrenceCount: 1,
    runsSeen: ["r1"],
    state: "new",
    ...over,
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ahs-"));
  hist = join(dir, "a11y-history.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("loadA11yHistory v1 -> v2 migration", () => {
  it("maps legacy states to the v2 lifecycle states", () => {
    const states: [string, string][] = [
      ["new", "new"],
      ["recurring", "recurring"],
      ["existing-unresolved", "existing-unresolved"],
      ["resolved", "resolved"],
      ["reopened", "new"],
      ["dismissed-reappeared", "recurring"],
    ];
    const v1: Record<string, unknown> = {};
    states.forEach(([s], i) => {
      v1[`fp${i}`] = v1Entry({ fingerprint: `fp${i}`, ruleId: `rule-${i}`, state: s });
    });
    writeFileSync(hist, JSON.stringify(v1));
    const { status, history } = loadA11yHistory(hist);
    expect(status).toBe("restored");
    expect(history.schemaVersion).toBe(2);
    states.forEach(([, expected], i) => {
      expect(history.findings[`${URL1}|desktop|rule-${i}`].state).toBe(expected);
    });
  });

  it("collapses duplicate page|viewport|rule keys (earliest firstSeen, latest lastSeen, union runsSeen)", () => {
    writeFileSync(
      hist,
      JSON.stringify({
        a: v1Entry({ fingerprint: "a", firstSeen: "2025-01-05T00:00:00Z", lastSeen: "2025-01-06T00:00:00Z", runsSeen: ["r2", "r3"], occurrenceCount: 2, state: "recurring" }),
        b: v1Entry({ fingerprint: "b", firstSeen: "2025-01-01T00:00:00Z", lastSeen: "2025-01-02T00:00:00Z", runsSeen: ["r1", "r2"], occurrenceCount: 1, state: "new" }),
      }),
    );
    const { history } = loadA11yHistory(hist);
    const keys = Object.keys(history.findings);
    expect(keys).toEqual([`${URL1}|desktop|link-name`]);
    const e = history.findings[keys[0]];
    expect(e.firstSeen).toBe("2025-01-01T00:00:00Z");
    expect(e.lastSeen).toBe("2025-01-06T00:00:00Z");
    expect([...e.runsSeen].sort()).toEqual(["r1", "r2", "r3"]);
    expect(e.state).toBe("recurring");
  });

  it("computeLifecycleForRun writes a migration audit entry and saves v2", () => {
    writeFileSync(hist, JSON.stringify({ a: v1Entry({}) }));
    const runDir = join(dir, "run");
    mkdirSync(join(runDir, "accessibility"), { recursive: true });
    writeFileSync(join(runDir, "results.json"), JSON.stringify({ pages: [{ page: URL1, slug: "home", checks: [] }] }));
    writeFileSync(
      join(runDir, "accessibility", "home.desktop.json"),
      JSON.stringify({ url: URL1, viewport: "desktop", violations: [{ id: "link-name", impact: "serious" }] }),
    );
    const audits: { type: string; reason: string }[] = [];
    const tel = { event: () => undefined, audit: (a: { type: string; reason: string }) => void audits.push(a) };
    const r = computeLifecycleForRun(runDir, "r9", "2025-02-01T00:00:00Z", [{ pageUrl: URL1, viewport: "desktop" }], hist, join(dir, "status.json"), tel);
    expect(r.migrated).toBe(true);
    expect(audits.filter((a) => a.type === "migration")).toHaveLength(1);
    expect(JSON.parse(readFileSync(hist, "utf8")).schemaVersion).toBe(2);
  });
});

describe("loadA11yHistory failure handling", () => {
  it("reports unavailable for an unparseable file and leaves it unchanged", () => {
    writeFileSync(hist, "{not json");
    const loaded = loadA11yHistory(hist);
    expect(loaded.status).toBe("unavailable");
    expect(loaded.history).toEqual(emptyHistory());
    expect(readFileSync(hist, "utf8")).toBe("{not json");
  });

  it("reports unavailable for a non-object JSON document", () => {
    writeFileSync(hist, "[1,2]");
    expect(loadA11yHistory(hist).status).toBe("unavailable");
    expect(readFileSync(hist, "utf8")).toBe("[1,2]");
  });

  it("reports first-run for a missing file", () => {
    expect(loadA11yHistory(hist).status).toBe("first-run");
  });
});

describe("saveA11yHistory atomicity", () => {
  it("keeps the previous bytes and leaves no temp file when the write fails", () => {
    const prev = JSON.stringify({ schemaVersion: 2, runs: ["r1"], findings: {} });
    writeFileSync(hist, prev);
    // Occupy the temp path with a directory so writing the temp file fails.
    const tmp = `${hist}.${process.pid}.tmp`;
    mkdirSync(tmp);
    expect(() => saveA11yHistory({ schemaVersion: 2, runs: ["new"], findings: {} }, hist)).toThrow();
    expect(readFileSync(hist, "utf8")).toBe(prev);
    rmSync(tmp, { recursive: true, force: true });
    expect(readdirSync(dir)).toEqual(["a11y-history.json"]);
  });

  it("replaces the file on success without leaving a temp file", () => {
    saveA11yHistory({ schemaVersion: 2, runs: ["r1"], findings: {} }, hist);
    expect(JSON.parse(readFileSync(hist, "utf8")).runs).toEqual(["r1"]);
    expect(readdirSync(dir)).toEqual(["a11y-history.json"]);
  });
});
