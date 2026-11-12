import { describe, it, expect } from "vitest";
// @ts-expect-error plain browser ES module without type declarations
import { normalizeRun } from "../../dashboard/lib/findings.js";

// Validates: Requirements 12.4, 12.7
describe("normalizeRun replay pass-through", () => {
  it("defaults replay when absent or malformed", () => {
    expect(normalizeRun({}).replay).toEqual({ enriched: false, durationMs: null });
    expect(normalizeRun({ replay: { enriched: "yes", durationMs: -1 } }).replay).toEqual({
      enriched: false,
      durationMs: null,
    });
    expect(normalizeRun({ replay: { enriched: true, durationMs: 1.5 } }).replay.durationMs).toBeNull();
  });

  it("passes through valid replay, producedAt and replayT", () => {
    const run = normalizeRun({
      replay: { enriched: true, durationMs: 1200 },
      pages: [{ slug: "a", replayT: 3.5 }, { slug: "b", replayT: "x" }, { slug: "c" }],
      findings: [
        { id: "1", producedAt: { entryId: "e1", t: 2, station: "scanner" } },
        { id: "2", producedAt: { entryId: "e1" } },
        { id: "3" },
      ],
    });
    expect(run.replay).toEqual({ enriched: true, durationMs: 1200 });
    expect(run.pages[0].replayT).toBe(3.5);
    expect("replayT" in run.pages[1]).toBe(false);
    expect("replayT" in run.pages[2]).toBe(false);
    expect(run.findings[0].producedAt).toEqual({ entryId: "e1", t: 2, station: "scanner" });
    expect(run.findings[1].producedAt).toBeNull();
    expect(run.findings[2].producedAt).toBeNull();
  });
});
