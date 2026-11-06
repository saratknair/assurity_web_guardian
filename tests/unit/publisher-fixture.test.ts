import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { buildPublishedData } from "../../src/publish/published-data.js";

// Task 7.4 (R1.7, R1.9, R9.12, R17.6): end-to-end publisher run over a small
// generated fixture. Time is frozen (Date only) so generatedAt is identical and
// the two runs can be compared byte for byte without normalization.

const RUN = "run-2025-01-02T03-04-05Z";
const FROZEN = new Date("2025-01-03T00:00:00.000Z");
const EMAIL = "jane.doe@example.com";
const WIN_PATH = "C:\\Users\\bob\\secret\\app.js";

function png(fill: number): PNG {
  const p = new PNG({ width: 8, height: 8 });
  p.data.fill(fill);
  for (let i = 3; i < p.data.length; i += 4) p.data[i] = 255;
  return p;
}

function walk(dir: string, base = dir): Record<string, Buffer> {
  const out: Record<string, Buffer> = {};
  for (const n of readdirSync(dir).sort()) {
    const full = join(dir, n);
    if (statSync(full).isDirectory()) Object.assign(out, walk(full, base));
    else out[relative(base, full).split("\\").join("/")] = readFileSync(full);
  }
  return out;
}

describe("publisher over a fixture run", () => {
  let root = "";
  let runsRoot = "";
  let out1 = "";
  let out2 = "";
  let historyPath = "";
  const envBefore = {
    b: process.env.AWG_VISUAL_BASELINES,
    r: process.env.AWG_IMAGE_RETENTION_RUNS,
  };

  const json = (p: string): any => JSON.parse(readFileSync(p, "utf8"));

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "awg-pubfx-"));
    runsRoot = join(root, "runs");
    const runDir = join(runsRoot, RUN);
    const baselineRoot = join(root, "baselines");
    historyPath = join(root, "a11y-history.json");
    mkdirSync(join(runDir, "screenshots"), { recursive: true });
    mkdirSync(join(runDir, "accessibility"), { recursive: true });
    mkdirSync(join(baselineRoot, "home"), { recursive: true });

    const base = png(10);
    const cur = png(200);
    const diff = new PNG({ width: 8, height: 8 });
    pixelmatch(base.data, cur.data, diff.data, 8, 8, { threshold: 0.1 });
    const baseBytes = PNG.sync.write(base);
    writeFileSync(join(baselineRoot, "home", "desktop.png"), baseBytes);
    const shots = join(runDir, "screenshots");
    writeFileSync(join(shots, "home.desktop.png"), PNG.sync.write(cur));
    writeFileSync(join(shots, "home.desktop.diff.png"), PNG.sync.write(diff));
    writeFileSync(join(shots, "about.mobile.png"), PNG.sync.write(cur));
    const hash = createHash("sha256").update(baseBytes).digest("hex").slice(0, 16);

    writeFileSync(
      join(runDir, "findings.json"),
      JSON.stringify({
        runId: RUN,
        awaitingReview: false,
        pages: [
          {
            page: "https://example.test/",
            slug: "home",
            outcomes: [{ kind: "check", classification: "a11y", detail: "desktop:a11y-critical-serious: color-contrast" }],
            visual: { desktop: { differs: true, diffPixels: 64, totalPixels: 64, diffRatio: 1, baselineHash: hash } },
          },
          { page: "https://example.test/about", slug: "about", outcomes: [] },
        ],
      }),
    );
    writeFileSync(
      join(runDir, "results.json"),
      JSON.stringify({
        pages: [
          { page: "https://example.test/", slug: "home", checks: [{ name: "desktop:title", passed: true, detail: "Home" }] },
          { page: "https://example.test/about", slug: "about", checks: [{ name: "mobile:links", passed: false, detail: "broken link" }] },
        ],
      }),
    );
    writeFileSync(
      join(runDir, "events.jsonl"),
      [
        JSON.stringify({ kind: "run.finished", data: { failedChecks: 2, pages: 2, health: "attention" } }),
        JSON.stringify({ kind: "run.record", data: { finishedAt: "2025-01-02T03:10:00.000Z", result: "failed" } }),
      ].join("\n") + "\n",
    );
    writeFileSync(
      join(runDir, "accessibility", "home.desktop.json"),
      JSON.stringify({
        url: "https://example.test/",
        violations: [
          {
            id: "color-contrast",
            impact: "serious",
            help: "Elements must have sufficient color contrast",
            nodes: [{ html: `<a href="mailto:${EMAIL}">${WIN_PATH}</a>`, target: ["a"] }],
          },
        ],
      }),
    );
    // Corrupt axe file: must degrade, not fail.
    writeFileSync(join(runDir, "accessibility", "about.mobile.json"), "{ not json");

    process.env.AWG_VISUAL_BASELINES = baselineRoot;
    process.env.AWG_IMAGE_RETENTION_RUNS = "5";

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(FROZEN);
    out1 = join(root, "out1");
    out2 = join(root, "out2");
    await buildPublishedData({ runsRoot, outDir: out1, historyPath, domain: "example.test" });
    await buildPublishedData({ runsRoot, outDir: out2, historyPath, domain: "example.test" });
    vi.useRealTimers();
  });

  afterAll(() => {
    vi.useRealTimers();
    for (const [k, v] of [
      ["AWG_VISUAL_BASELINES", envBefore.b],
      ["AWG_IMAGE_RETENTION_RUNS", envBefore.r],
    ] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("keeps the legacy file names and fields", () => {
    const runOut = join(out1, "data", "runs", RUN);
    for (const f of ["summary.json", "events.json", "findings.json", "results.json"]) {
      expect(statSync(join(runOut, f)).isFile(), f).toBe(true);
    }
    const idx = json(join(out1, "data", "index.json"));
    expect(idx.runs).toHaveLength(1);
    expect(idx.runs[0]).toMatchObject({
      runId: RUN,
      status: "failed",
      health: "attention",
      pages: 2,
      failedChecks: 2,
      pendingReview: false,
      origin: "local",
    });
    const dash = json(join(out1, "data", "dashboard.json"));
    for (const k of ["generatedAt", "domain", "runHealthTrend", "findingsByPage", "findingsBySeverity", "a11yNewVsRecurring", "aiItems", "empty"]) {
      expect(dash, k).toHaveProperty(k);
    }
    expect(json(join(runOut, "findings.json")).pages[0].slug).toBe("home");
    expect(json(join(runOut, "summary.json"))).toMatchObject({ runId: RUN, origin: "local", health: "attention" });
  });

  it("publishes rule detail, visual items and images, and degrades on the corrupt axe file", () => {
    const runOut = join(out1, "data", "runs", RUN);
    const rf = json(join(runOut, "run-findings.json"));
    expect(rf.findings.some((f: any) => f.kind === "a11y-rule" && f.ruleId === "color-contrast")).toBe(true);
    const summary = json(join(runOut, "summary.json"));
    expect(summary.omissions.some((o: any) => o.path === "accessibility/about.mobile.json" && o.reason === "raw-axe-unreadable")).toBe(true);
    const vis = json(join(runOut, "visual.json"));
    expect(vis.items).toHaveLength(1);
    expect(vis.items[0]).toMatchObject({ slug: "home", viewport: "desktop" });
    expect(vis.items[0].images.diff).toBe("screenshots/home.desktop.diff.png");
    expect(statSync(join(runOut, "screenshots", "home.desktop.diff.png")).isFile()).toBe(true);
    expect(statSync(join(runOut, "screenshots", "about.mobile.png")).isFile()).toBe(true);
    expect(json(join(runOut, "guidance.json")).schemaVersion).toBe(2);
  });

  it("leaves no absolute paths or secrets in the output tree", () => {
    const files = walk(out1);
    expect(Object.keys(files).length).toBeGreaterThan(5);
    for (const [name, buf] of Object.entries(files)) {
      if (name.endsWith(".png")) continue;
      const text = buf.toString("utf8");
      expect(text, name).not.toContain(EMAIL);
      expect(text, name).not.toMatch(/[A-Za-z]:\\+Users/i);
      expect(text, name).not.toContain("bob");
      expect(text, name).not.toContain(root);
      expect(text, name).not.toContain(root.split("\\").join("\\\\"));
      expect(text, name).not.toContain(root.split("\\").join("/"));
    }
  });

  it("produces a byte-identical tree on a second run (time frozen via fake Date)", () => {
    const a = walk(out1);
    const b = walk(out2);
    expect(Object.keys(b)).toEqual(Object.keys(a));
    for (const k of Object.keys(a)) expect(b[k].equals(a[k]), k).toBe(true);
  });
});
