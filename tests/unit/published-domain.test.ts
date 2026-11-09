import { afterAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPublishedData, deriveRunDomain } from "../../src/publish/published-data.js";

// Task 35.1 (R21.6, R29.1): additive optional per-run `domain`; label not hard-coded.

const root = mkdtempSync(join(tmpdir(), "awg-pubdom-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function mkRun(runsRoot: string, id: string, finishedAt: string, urls: string[], recorded?: string): void {
  const dir = join(runsRoot, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "findings.json"),
    JSON.stringify({ runId: id, awaitingReview: false, pages: urls.map((u, i) => ({ page: u, slug: `p${i}`, outcomes: [] })) }),
  );
  writeFileSync(
    join(dir, "events.jsonl"),
    JSON.stringify({ kind: "run.record", data: { finishedAt, result: "passed" } }) + "\n",
  );
  if (recorded) writeFileSync(join(dir, "run-source.json"), JSON.stringify({ domain: recorded }));
}

describe("deriveRunDomain", () => {
  it("prefers recorded, else shared host, else null", () => {
    const d = join(root, "d1");
    mkdirSync(d, { recursive: true });
    expect(deriveRunDomain(d, ["https://a.test/x", "https://A.test/y"])).toBe("a.test");
    expect(deriveRunDomain(d, ["https://a.test/", "https://b.test/"])).toBeNull();
    expect(deriveRunDomain(d, [])).toBeNull();
    writeFileSync(join(d, "run-source.json"), JSON.stringify({ domain: "rec.test" }));
    expect(deriveRunDomain(d, ["https://a.test/"])).toBe("rec.test");
  });
});

describe("published domain field", () => {
  it("adds domain per run, omits when unknown, label from latest run, byte-stable", async () => {
    const runsRoot = join(root, "runs");
    mkRun(runsRoot, "run-a", "2025-01-01T00:00:00.000Z", ["https://old.test/", "https://old.test/x"]);
    mkRun(runsRoot, "run-b", "2025-01-02T00:00:00.000Z", ["https://new.test/"]);
    mkRun(runsRoot, "run-c", "2025-01-03T00:00:00.000Z", ["https://one.test/", "https://two.test/"]);
    const hist = join(root, "hist.json");
    const o1 = join(root, "o1");
    const o2 = join(root, "o2");
    await buildPublishedData({ runsRoot, outDir: o1, historyPath: hist });
    await buildPublishedData({ runsRoot, outDir: o2, historyPath: hist });
    const idx = JSON.parse(readFileSync(join(o1, "data", "index.json"), "utf8"));
    const by = (id: string) => idx.runs.find((r: any) => r.runId === id);
    expect(by("run-a").domain).toBe("old.test");
    expect(by("run-b").domain).toBe("new.test");
    expect("domain" in by("run-c")).toBe(false);
    // Latest run (run-c) has no determinable domain, so the label is empty, not a fixed host.
    expect(idx.domain).not.toBe("assurity.nz");
    const dash = JSON.parse(readFileSync(join(o1, "data", "dashboard.json"), "utf8"));
    expect(dash.runs.find((r: any) => r.runId === "run-a").domain).toBe("old.test");
    expect("domain" in dash.runs.find((r: any) => r.runId === "run-c")).toBe(false);
    expect(idx.schemaVersion).toBe(2);
    const strip = (s: string) => s.replace(/"generatedAt": "[^"]*"/g, "");
    expect(strip(readFileSync(join(o2, "data", "index.json"), "utf8"))).toBe(
      strip(readFileSync(join(o1, "data", "index.json"), "utf8")),
    );
  });
});
