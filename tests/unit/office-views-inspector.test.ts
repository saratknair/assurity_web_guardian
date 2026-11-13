import { describe, it, expect } from "vitest";
// @ts-expect-error plain browser ES module without type declarations
import { buildInspectorModel, describeSelection, EMPTY_TEXT } from "../../office/views/inspector.js";
// @ts-expect-error plain browser ES module without type declarations
import { TEMPLATE_STATEMENT } from "../../office/lib/honesty.js";
// @ts-expect-error plain browser ES module without type declarations
import { SHORTCUTS } from "../../office/views/help.js";

function entry(over: Record<string, unknown>) {
  return {
    id: "s", index: 0, srcIndex: 0, kind: "step", step: "screenshot", station: "browser-bay",
    agent: "Observation_Runner", template: false, pageUrl: "https://x.test/a", slug: "a",
    viewport: "desktop", startMs: 0, endMs: 500, result: null, findingKeys: [], findingIds: {}, label: "",
    ...over,
  };
}

const tl = {
  mode: "enriched", runId: "run1", durationMs: 5000,
  entries: [
    entry({ id: "s1", step: "screenshot", startMs: 100, endMs: 600, result: { saved: true } }),
    entry({ id: "s2", step: "notes", station: "review-desk", agent: "Quality_Analysis_Agent", template: true, startMs: 700, endMs: 900 }),
  ],
};
const index = { runs: [{ runId: "run1", hasImages: true }] };

describe("office inspector model", () => {
  it("shows a prompt without selection", () => {
    const m = buildInspectorModel({ timeline: tl, t: 0, selection: null });
    expect(m.empty).toBe(true);
    expect(m.text).toBe(EMPTY_TEXT);
  });

  it("lists only entries up to the position, with not recorded and evidence", () => {
    const sel = { type: "station", id: "browser-bay" };
    const early = buildInspectorModel({ timeline: tl, t: 50, selection: sel, index });
    expect(early.rows).toEqual([]);
    const m = buildInspectorModel({ timeline: tl, t: 1000, selection: sel, index });
    expect(m.rows.length).toBe(1);
    expect(m.rows[0].duration).toBe("500 ms");
    expect(m.rows[0].result).toEqual(["Screenshot saved: yes"]);
    expect(m.evidence.screenshot.imageSrc).toContain("a.desktop.png");
    expect(m.runLink).toBe("../#/run/run1");
    expect(m.isTemplate).toBe(false);
  });

  it("flags template steps and uses not recorded for missing results", () => {
    const m = buildInspectorModel({ timeline: tl, t: 1000, selection: { type: "agent", id: "Quality_Analysis_Agent" }, index });
    expect(m.isTemplate).toBe(true);
    expect(m.templateText).toContain(TEMPLATE_STATEMENT);
    expect(m.rows[0].result).toEqual(["not recorded"]);
  });

  it("hides results and final duration until the entry has ended", () => {
    const sel = { type: "station", id: "browser-bay" };
    const during = buildInspectorModel({ timeline: tl, t: 300, selection: sel, index });
    expect(during.rows.length).toBe(1);
    expect(during.rows[0].result).toEqual(["In progress"]);
    expect(during.rows[0].duration).toBe("running");
    expect(during.evidence).toBeNull();
    const after = buildInspectorModel({ timeline: tl, t: 600, selection: sel, index });
    expect(after.rows[0].result).toEqual(["Screenshot saved: yes"]);
    expect(after.rows[0].duration).toBe("500 ms");
  });

  it("treats open entries as in progress even past their endMs", () => {
    const open = { ...tl, entries: [entry({ id: "o", startMs: 100, endMs: 100, open: true, result: { saved: true } })] };
    const m = buildInspectorModel({ timeline: open, t: 4000, selection: { type: "station", id: "browser-bay" }, index });
    expect(m.rows[0].result).toEqual(["In progress"]);
    expect(m.rows[0].duration).toBe("running");
  });

  it("ignores unknown selections", () => {
    expect(describeSelection({ type: "station", id: "nope" })).toBeNull();
    expect(describeSelection({ type: "agent", id: "Nobody" })).toBeNull();
  });
});

describe("office shortcut table", () => {
  it("documents the design shortcuts", () => {
    expect(SHORTCUTS.length).toBe(8);
    expect(SHORTCUTS.map((s: { keys: string }) => s.keys)).toContain("Escape");
  });
});
