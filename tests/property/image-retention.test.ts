import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import { buildPublishedData } from "../../src/publish/published-data.js";
import {
  runsWithImages,
  imageRetentionRuns,
  DEFAULT_IMAGE_RETENTION_RUNS,
} from "../../src/publish/size-budget.js";

// Feature: dashboard-usability-overhaul, Property 40: Images are published only for the latest N runs and every omission is recorded
// **Validates: Requirements 16.8, 16.9, 16.10, 16.11, 16.12**

type Run = { runId: string; finishedAt: string | null };

// Few distinct dates so ties are frequent; null = missing date.
const dateArb = fc.oneof(
  fc.constant<string | null>(null),
  fc.integer({ min: 0, max: 6 }).map((d) => new Date(Date.UTC(2025, 0, 1 + d)).toISOString()),
);

const runsArb = fc
  .uniqueArray(fc.integer({ min: 0, max: 999 }), { maxLength: 30 })
  .chain((ids) =>
    fc
      .array(dateArb, { minLength: ids.length, maxLength: ids.length })
      .map((dates): Run[] =>
        ids.map((id, i) => ({ runId: `run-${String(id).padStart(4, "0")}`, finishedAt: dates[i] })),
      ),
  );

function expected(runs: Run[], n: number): string[] {
  const t = (r: Run) => (r.finishedAt ? Date.parse(r.finishedAt) : Number.NEGATIVE_INFINITY);
  return [...runs]
    .sort((a, b) => (t(a) !== t(b) ? (t(a) < t(b) ? 1 : -1) : a.runId < b.runId ? 1 : -1))
    .slice(0, n)
    .map((r) => r.runId);
}

describe("Property 40: image retention window", () => {
  it("returns exactly the min(n, len) most recent runs, deterministic and order independent", () => {
    fc.assert(
      fc.property(runsArb, fc.integer({ min: 0, max: 15 }), (runs, n) => {
        const got = runsWithImages(runs, n);
        expect(got.size).toBe(Math.min(n, runs.length));
        expect([...got].sort()).toEqual(expected(runs, n).sort());
        // deterministic
        expect([...runsWithImages(runs, n)].sort()).toEqual([...got].sort());
        // independent of input order
        const reversed = [...runs].reverse();
        expect([...runsWithImages(reversed, n)].sort()).toEqual([...got].sort());
        // missing dates are oldest: a dated run is never excluded in favour of an undated one
        const byId = new Map(runs.map((r) => [r.runId, r]));
        for (const id of got) {
          if (byId.get(id)!.finishedAt === null) {
            for (const r of runs) if (r.finishedAt !== null) expect(got.has(r.runId)).toBe(true);
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it("shuffled input yields the same window", () => {
    fc.assert(
      fc.property(
        runsArb.chain((runs) => fc.tuple(fc.constant(runs), fc.shuffledSubarray(runs, { minLength: runs.length, maxLength: runs.length }))),
        fc.integer({ min: 0, max: 15 }),
        ([runs, shuffled], n) => {
          expect([...runsWithImages(shuffled, n)].sort()).toEqual([...runsWithImages(runs, n)].sort());
        },
      ),
      { numRuns: 100 },
    );
  });

  it("imageRetentionRuns: unset/invalid -> default 10; valid positive integers honoured", () => {
    expect(imageRetentionRuns({})).toBe(DEFAULT_IMAGE_RETENTION_RUNS);
    expect(DEFAULT_IMAGE_RETENTION_RUNS).toBe(10);
    for (const bad of ["", "  ", "abc", "0", "-3", "2.5", "NaN", "Infinity"]) {
      expect(imageRetentionRuns({ AWG_IMAGE_RETENTION_RUNS: bad })).toBe(10);
    }
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100000 }), (n) => {
        expect(imageRetentionRuns({ AWG_IMAGE_RETENTION_RUNS: String(n) })).toBe(n);
      }),
      { numRuns: 100 },
    );
  });
});

// ---- small integration: buildPublishedData honours the retention window ----

const PNG_BYTES = (() => {
  const p = new PNG({ width: 4, height: 4 });
  p.data.fill(120);
  return PNG.sync.write(p);
})();

const SHOTS = ["home.desktop.png", "home.mobile.png"];

function writeRun(runsRoot: string, runId: string, finishedAt: string): void {
  const dir = join(runsRoot, runId);
  mkdirSync(join(dir, "screenshots"), { recursive: true });
  for (const s of SHOTS) writeFileSync(join(dir, "screenshots", s), PNG_BYTES);
  writeFileSync(
    join(dir, "findings.json"),
    JSON.stringify({ runId, awaitingReview: false, pages: [{ page: "https://example.test/", slug: "home", outcomes: [] }] }),
  );
  writeFileSync(
    join(dir, "results.json"),
    JSON.stringify({ pages: [{ page: "https://example.test/", slug: "home", checks: [{ name: "desktop:title", passed: true, detail: "Home" }] }] }),
  );
  writeFileSync(
    join(dir, "events.jsonl"),
    [
      JSON.stringify({ kind: "run.finished", data: { failedChecks: 0, pages: 1, health: "healthy" } }),
      JSON.stringify({ kind: "run.record", data: { finishedAt, result: "passed" } }),
    ].join("\n") + "\n",
  );
}

describe("Property 40: publisher image retention (integration)", () => {
  it("publishes images only for the newest N runs and records image-retention omissions", async () => {
    const before = { r: process.env.AWG_IMAGE_RETENTION_RUNS, b: process.env.AWG_VISUAL_BASELINES };
    try {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 3, max: 4 }).chain((count) =>
            fc.tuple(
              fc.shuffledSubarray([0, 1, 2, 3, 4, 5, 6, 7], { minLength: count, maxLength: count }),
              fc.integer({ min: 1, max: count }),
            ),
          ),
          async ([days, n]) => {
            const root = mkdtempSync(join(tmpdir(), "awg-imgret-"));
            try {
              const runsRoot = join(root, "runs");
              const outDir = join(root, "out");
              mkdirSync(join(root, "baselines"), { recursive: true });
              process.env.AWG_VISUAL_BASELINES = join(root, "baselines");
              process.env.AWG_IMAGE_RETENTION_RUNS = String(n);
              const runs = days.map((d, i) => ({
                runId: `run_${i}`,
                finishedAt: new Date(Date.UTC(2025, 0, 1 + d, 3)).toISOString(),
              }));
              for (const r of runs) writeRun(runsRoot, r.runId, r.finishedAt);

              await buildPublishedData({ runsRoot, outDir, historyPath: join(root, "h.json"), domain: "example.test" });

              const newest = new Set(
                [...runs].sort((a, b) => b.finishedAt.localeCompare(a.finishedAt)).slice(0, n).map((r) => r.runId),
              );
              const index = JSON.parse(readFileSync(join(outDir, "data", "index.json"), "utf8"));
              expect(index.imageRetentionRuns).toBe(n);
              for (const r of runs) {
                const runOut = join(outDir, "data", "runs", r.runId);
                const shotsDir = join(runOut, "screenshots");
                const published = existsSync(shotsDir) ? readdirSync(shotsDir) : [];
                const summary = JSON.parse(readFileSync(join(runOut, "summary.json"), "utf8"));
                const rf = JSON.parse(readFileSync(join(runOut, "run-findings.json"), "utf8"));
                // Findings and visual JSON are published for every run.
                expect(existsSync(join(runOut, "visual.json"))).toBe(true);
                const entry = index.runs.find((x: { runId: string }) => x.runId === r.runId);
                const retPaths = (o: { path: string; reason: string }[]) =>
                  o.filter((x) => x.reason === "image-retention").map((x) => x.path).sort();
                if (newest.has(r.runId)) {
                  expect(published.sort()).toEqual([...SHOTS].sort());
                  expect(summary.hasImages).toBe(true);
                  expect(entry.hasImages).toBe(true);
                  expect(retPaths(rf.omissions)).toEqual([]);
                } else {
                  expect(published).toEqual([]);
                  expect(summary.hasImages).toBe(false);
                  expect(entry.hasImages).toBe(false);
                  const want = SHOTS.map((s) => `screenshots/${s}`).sort();
                  expect(retPaths(rf.omissions)).toEqual(want);
                  expect(retPaths(summary.omissions)).toEqual(want);
                }
              }
            } finally {
              rmSync(root, { recursive: true, force: true });
            }
          },
        ),
        { numRuns: 12 },
      );
    } finally {
      for (const [k, v] of [
        ["AWG_IMAGE_RETENTION_RUNS", before.r],
        ["AWG_VISUAL_BASELINES", before.b],
      ] as const) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  }, 120000);
});
