import { describe, it, expect } from "vitest";
// @ts-expect-error plain browser ES module without type declarations
import { rowModel, currentIndex, entryEnded } from "../../office/views/transcript.js";
// @ts-expect-error plain browser ES module without type declarations
import { noticeItems } from "../../office/views/notices.js";

describe("office transcript row model", () => {
  const entry = {
    id: "e1", startMs: 1250, agent: "Scanner", station: "a11y", step: "accessibility-scan",
    pageUrl: "https://x.test/a", slug: "a", viewport: "desktop",
    result: { violations: { critical: 1 } },
    findingKeys: ["https://x.test/a|desktop|color-contrast"], findingIds: { "color-contrast": "f1" },
  };

  it("builds summary, result lines, and Dashboard links", () => {
    const r = rowModel(entry, "run1");
    expect(r.summary).toContain("Scanner at a11y");
    expect(r.summary).toContain("accessibility-scan");
    expect(r.lines.length).toBeGreaterThan(0);
    expect(r.links.map((l: { href: string }) => l.href)).toContain("../#/finding/run1/f1");
  });

  it("names run markers by label, stations by visible name, and flags template steps", () => {
    expect(rowModel({ id: "run-started", kind: "marker", station: "records-room", label: "Run started" }, "run1").summary)
      .toBe("Run started");
    expect(rowModel({ id: "run-finished", kind: "marker", station: "records-room", label: "Run finished (health: ok)" }, "run1").summary)
      .toBe("Run finished (health: ok)");
    const notes = rowModel({ id: "s9", kind: "step", agent: "Quality_Analysis_Agent", station: "review-desk", step: "notes", template: true }, "run1");
    expect(notes.summary).toBe("Quality_Analysis_Agent at Review desk: notes (automated template step)");
  });

  it("shows no links when nothing links", () => {
    const r = rowModel({ id: "e2", startMs: 0, agent: "A" }, "run1");
    expect(r.links).toEqual([]);
  });

  it("entryEnded is true only once the entry is closed and endMs <= t", () => {
    expect(entryEnded({ startMs: 0, endMs: 500 }, 300)).toBe(false);
    expect(entryEnded({ startMs: 0, endMs: 500 }, 500)).toBe(true);
    expect(entryEnded({ startMs: 0, endMs: 0, open: true }, 900)).toBe(false);
  });

  it("currentIndex is -1 before the first entry", () => {
    const tl = { entries: [{ startMs: 100 }, { startMs: 200 }] };
    expect(currentIndex(tl, 50)).toBe(-1);
    expect(currentIndex(tl, 150)).toBe(0);
  });
});

describe("office notices model", () => {
  it("lists load errors, skipped events, and differing totals", () => {
    const list = noticeItems({
      loadErrors: [{ file: "events.json" }],
      timeline: { notices: { notRecorded: [], skipped: ["bad one"], truncated: null, empty: null, unsupported: null } },
      consistency: { status: "differs", message: "Totals differ.", reasons: ["r"] },
    });
    const ids = list.map((x: { id: string }) => x.id);
    expect(ids).toEqual(["load-0", "skipped", "consistency"]);
    expect(list[0].text).toContain("events.json");
  });

  it("does not repeat a reason that the message already states", () => {
    const list = noticeItems({
      consistency: { status: "unavailable", message: "Check not performed: No step results.", reasons: ["No step results."] },
    });
    expect(list[0].items).toBeUndefined();
  });

  it("omits matching consistency and handles no model", () => {
    expect(noticeItems({ consistency: { status: "match", message: "ok" } })).toEqual([]);
    expect(noticeItems(null)).toEqual([]);
  });
});
