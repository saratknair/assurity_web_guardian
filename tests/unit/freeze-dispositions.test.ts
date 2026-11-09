import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freezeDispositions } from "../../src/core/orchestrator.js";
import { entryId, serializeLog, type DispositionEntry } from "../../src/core/dispositions.js";

function setup(): { art: string; run: string } {
  const root = mkdtempSync(join(tmpdir(), "freeze-"));
  const art = join(root, "artifacts");
  const run = join(art, "runs", "run_x");
  mkdirSync(run, { recursive: true });
  return { art, run };
}

function mk(at: string): DispositionEntry {
  const body: Omit<DispositionEntry, "id"> = {
    decision: "ignore",
    scope: "site-rule",
    matcher: { pageUrl: "", viewport: "", ruleId: "color-contrast", cssTarget: "" },
    reason: "accepted",
    reviewer: "Tester",
    at,
    undoes: null,
    source: "cli",
  };
  return { id: entryId(body), ...body };
}

describe("freezeDispositions", () => {
  it("applies only entries strictly before finishedAt", () => {
    const { art, run } = setup();
    const log = { schemaVersion: 1 as const, entries: [mk("2026-01-01T00:00:00.000Z"), mk("2026-03-01T00:00:00.000Z")] };
    writeFileSync(join(art, "dispositions.json"), serializeLog(log), "utf8");
    freezeDispositions(run, "run_x", "2026-02-01T00:00:00.000Z", art);
    const out = JSON.parse(readFileSync(join(run, "dispositions-applied.json"), "utf8"));
    expect(out.status).toBe("applied");
    expect(out.entries).toHaveLength(1);
    expect(out.logDigest).toMatch(/^[0-9a-f]{16}$/);
    rmSync(join(art, ".."), { recursive: true, force: true });
  });

  it("is applied with no entries when the log is missing", () => {
    const { art, run } = setup();
    freezeDispositions(run, "run_x", "2026-02-01T00:00:00.000Z", art);
    const out = JSON.parse(readFileSync(join(run, "dispositions-applied.json"), "utf8"));
    expect(out.status).toBe("applied");
    expect(out.entries).toEqual([]);
    rmSync(join(art, ".."), { recursive: true, force: true });
  });

  it("is unavailable for an invalid log or an unavailable restore status", () => {
    const a = setup();
    writeFileSync(join(a.art, "dispositions.json"), "{not json", "utf8");
    freezeDispositions(a.run, "run_x", "2026-02-01T00:00:00.000Z", a.art);
    expect(JSON.parse(readFileSync(join(a.run, "dispositions-applied.json"), "utf8")).status).toBe("unavailable");
    const b = setup();
    writeFileSync(join(b.art, "dispositions.json"), serializeLog({ schemaVersion: 1, entries: [mk("2026-01-01T00:00:00.000Z")] }), "utf8");
    writeFileSync(join(b.art, "dispositions.status.json"), '{"status":"unavailable"}', "utf8");
    freezeDispositions(b.run, "run_x", "2026-02-01T00:00:00.000Z", b.art);
    const out = JSON.parse(readFileSync(join(b.run, "dispositions-applied.json"), "utf8"));
    expect(out.status).toBe("unavailable");
    expect(out.entries).toEqual([]);
    rmSync(join(a.art, ".."), { recursive: true, force: true });
    rmSync(join(b.art, ".."), { recursive: true, force: true });
  });
});
