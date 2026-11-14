import { afterAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPublishedData } from "../../src/publish/published-data.js";
import { loadDisplayTitle } from "../../src/config/app-config.js";
import { createConsole } from "../../src/admin/console-router.js";
import type { ConsoleDeps } from "../../src/admin/console-deps.js";
// @ts-expect-error plain browser ES module without type declarations
import { titleFrom as dashboardTitle } from "../../dashboard/lib/title.js";
// @ts-expect-error plain browser ES module without type declarations
import { titleFrom as officeTitle } from "../../office/lib/title.js";

const root = mkdtempSync(join(tmpdir(), "awg-title-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function mkRun(runsRoot: string, id: string): void {
  const dir = join(runsRoot, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "findings.json"),
    JSON.stringify({ runId: id, awaitingReview: false, pages: [{ page: "https://example.test/", slug: "p0", outcomes: [] }] }),
  );
  writeFileSync(
    join(dir, "events.jsonl"),
    JSON.stringify({ kind: "run.record", data: { finishedAt: "2025-01-01T00:00:00.000Z", result: "passed" } }) + "\n",
  );
}

describe("published index displayTitle", () => {
  it("writes the default title, or the trimmed configured title", async () => {
    const runsRoot = join(root, "runs");
    mkRun(runsRoot, "run-a");
    const historyPath = join(root, "hist.json");
    const read = (out: string) => JSON.parse(readFileSync(join(out, "data", "index.json"), "utf8"));

    const o1 = join(root, "o1");
    await buildPublishedData({ runsRoot, outDir: o1, historyPath });
    expect(read(o1).displayTitle).toBe("Web Guardian");

    const o2 = join(root, "o2");
    await buildPublishedData({ runsRoot, outDir: o2, historyPath, displayTitle: "  Acme Guardian " });
    expect(read(o2).displayTitle).toBe("Acme Guardian");
  });

  it("falls back to the default when the app config is missing", () => {
    expect(loadDisplayTitle(join(root, "no-such-config.json"))).toBe("Web Guardian");
  });
});

describe("dashboard and office titleFrom", () => {
  it("uses the index title and falls back when absent or blank", () => {
    for (const titleFrom of [dashboardTitle, officeTitle]) {
      expect(titleFrom({ displayTitle: "Acme Guardian" })).toBe("Acme Guardian");
      expect(titleFrom({ runs: [] })).toBe("Web Guardian");
      expect(titleFrom({ displayTitle: "   " })).toBe("Web Guardian");
      expect(titleFrom({ displayTitle: 7 })).toBe("Web Guardian");
      expect(titleFrom(null)).toBe("Web Guardian");
    }
  });
});

describe("console endpoints displayTitle", () => {
  const goodGet = { host: "127.0.0.1:7787" };
  function deps(cfg: Record<string, unknown>): ConsoleDeps {
    const files: Record<string, string> = {
      "config/app.config.json": JSON.stringify({
        approvedDomain: "example.test",
        baseUrl: "https://example.test",
        domain: "example-test",
        limits: { pages: 10 },
        ...cfg,
      }),
    };
    return {
      port: 7787,
      fs: {
        root: "C:/proj",
        exists: (r) => r in files,
        readText: (r) => {
          const v = files[r];
          if (v === undefined) throw new Error("missing");
          return v;
        },
        readBytes: () => new Uint8Array(),
        writeText: () => undefined,
        listDir: () => [],
      },
      git: { run: async () => ({ code: 0, stdout: "", stderr: "" }) },
      jobs: { current: () => null, start: () => ({ ok: false, reason: "no" }) },
      approval: { authorizeSetupAction: () => undefined, approveVisualBaseline: () => undefined },
      clock: { now: () => new Date(0) },
    };
  }

  it("returns the default and a configured title from status and domain", async () => {
    for (const [cfg, want] of [
      [{}, "Web Guardian"],
      [{ displayTitle: " Acme Guardian " }, "Acme Guardian"],
    ] as const) {
      const c = createConsole(deps(cfg));
      for (const path of ["/api/status", "/api/domain"]) {
        const r = await c.handle({ method: "GET", path, query: {}, headers: goodGet, body: null });
        expect((r.json as { displayTitle: string }).displayTitle).toBe(want);
      }
    }
  });
});

describe("title-setting code", () => {
  it("never uses innerHTML for the title", () => {
    for (const f of ["dashboard/lib/title.js", "office/lib/title.js"]) {
      expect(readFileSync(join(process.cwd(), f), "utf8")).not.toMatch(/innerHTML/);
    }
  });
});
