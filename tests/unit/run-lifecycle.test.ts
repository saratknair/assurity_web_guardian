import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeLifecycleForRun } from "../../src/core/run-lifecycle.js";

const URL1 = "https://example.test/";
let dir: string;
let runDir: string;
let hist: string;
let stat: string;
const events: string[] = [];
const audits: string[] = [];
const tel = {
  event: (k: string) => void events.push(k),
  audit: (a: { type: string }) => void audits.push(a.type),
};

function writeRun(ruleIds: string[]) {
  mkdirSync(join(runDir, "accessibility"), { recursive: true });
  writeFileSync(join(runDir, "results.json"), JSON.stringify({ pages: [{ page: URL1, slug: "home", checks: [] }] }));
  writeFileSync(
    join(runDir, "accessibility", "home.desktop.json"),
    JSON.stringify({ url: URL1, viewport: "desktop", violations: ruleIds.map((id) => ({ id, impact: "serious" })) }),
  );
}
const scanned = [{ pageUrl: URL1, viewport: "desktop" }];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rl-"));
  runDir = join(dir, "run");
  mkdirSync(runDir);
  hist = join(dir, "a11y-history.json");
  stat = join(dir, "a11y-history.status.json");
  events.length = 0;
  audits.length = 0;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("computeLifecycleForRun", () => {
  it("first run: new states, writes lifecycle.json and v2 history", () => {
    writeRun(["link-name"]);
    const r = computeLifecycleForRun(runDir, "r1", "2025-01-01T00:00:00Z", scanned, hist, stat, tel);
    expect(r.historyStatus).toBe("first-run");
    const lc = JSON.parse(readFileSync(join(runDir, "lifecycle.json"), "utf8"));
    expect(lc.states[`${URL1}|desktop|link-name`]).toBe("new");
    expect(JSON.parse(readFileSync(hist, "utf8")).schemaVersion).toBe(2);
  });

  it("second run: recurring then resolved", () => {
    writeRun(["link-name"]);
    computeLifecycleForRun(runDir, "r1", "t1", scanned, hist, stat, tel);
    const r2 = computeLifecycleForRun(runDir, "r2", "t2", scanned, hist, stat, tel);
    expect(r2.snapshot.states[`${URL1}|desktop|link-name`]).toBe("recurring");
    writeRun([]);
    const r3 = computeLifecycleForRun(runDir, "r3", "t3", scanned, hist, stat, tel);
    expect(r3.snapshot.resolved.map((x) => x.ruleId)).toEqual(["link-name"]);
    expect(r3.snapshot.resolved[0].severity).toBe("serious");
  });

  it("unscanned pages are not resolved", () => {
    writeRun(["link-name"]);
    computeLifecycleForRun(runDir, "r1", "t1", scanned, hist, stat, tel);
    writeRun([]);
    const r = computeLifecycleForRun(runDir, "r2", "t2", [], hist, stat, tel);
    expect(r.snapshot.resolved).toEqual([]);
  });

  it("unavailable: does not create or modify history, emits event", () => {
    writeRun(["link-name"]);
    writeFileSync(stat, '{"status":"unavailable"}');
    const r = computeLifecycleForRun(runDir, "r1", "t1", scanned, hist, stat, tel);
    expect(r.snapshot).toMatchObject({ historyStatus: "unavailable", states: {}, resolved: [] });
    expect(existsSync(hist)).toBe(false);
    expect(events).toContain("a11y.history.unavailable");
  });

  it("unparseable status file or history file is unavailable and history untouched", () => {
    writeRun(["x"]);
    writeFileSync(stat, "{bad");
    expect(computeLifecycleForRun(runDir, "r1", "t", scanned, hist, stat, tel).historyStatus).toBe("unavailable");
    rmSync(stat);
    writeFileSync(hist, "{corrupt");
    expect(computeLifecycleForRun(runDir, "r2", "t", scanned, hist, stat, tel).historyStatus).toBe("unavailable");
    expect(readFileSync(hist, "utf8")).toBe("{corrupt");
  });

  it("CI status file takes precedence; v1 history is migrated with an audit entry", () => {
    writeRun(["link-name"]);
    writeFileSync(stat, '{"status":"restored"}');
    writeFileSync(
      hist,
      JSON.stringify({
        fp1: { fingerprint: "fp1", ruleId: "link-name", pageUrl: URL1, viewport: "desktop", impact: "serious", firstSeen: "a", lastSeen: "b", occurrenceCount: 1, runsSeen: ["r0"], state: "new" },
      }),
    );
    const r = computeLifecycleForRun(runDir, "r1", "t", scanned, hist, stat, tel);
    expect(r.historyStatus).toBe("restored");
    expect(r.migrated).toBe(true);
    expect(audits).toContain("migration");
    expect(r.snapshot.states[`${URL1}|desktop|link-name`]).toBe("recurring");
  });
});
