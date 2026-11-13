import { describe, it, expect } from "vitest";
// @ts-expect-error plain browser ES module without type declarations
import * as T from "../../office/lib/timeline.js";

const e = (step: string, pageUrl: string | null, viewport: string | null) => ({
  kind: "step", step, agent: "Comparator", pageUrl, slug: "s", viewport,
});

describe("activityCaption", () => {
  it("builds verb, page path and viewport", () => {
    expect(T.activityCaption(e("load", "https://x.test/careers/", "desktop"))).toBe("Loading /careers/ (desktop)");
    expect(T.activityCaption(e("screenshot", "https://x.test/a", "mobile"))).toBe("Taking screenshot of /a (mobile)");
    expect(T.activityCaption(e("visual-compare", "https://x.test/a", "mobile"))).toBe("Comparing /a (mobile)");
    expect(T.activityCaption(e("accessibility-scan", "https://x.test/careers", "mobile"))).toBe("Scanning /careers (mobile)");
  });
  it("uses / for the home page and omits a missing viewport", () => {
    expect(T.activityCaption(e("test-plan", "https://x.test", null))).toBe("Planning tests for /");
    expect(T.activityCaption(e("compare", "https://x.test/", null))).toBe("Reviewing results for /");
    expect(T.activityCaption(e("notes", "https://x.test/n/", null))).toBe("Writing notes for /n/");
    expect(T.activityCaption(e("triage", "https://x.test/n/", null))).toBe("Triaging /n/");
  });
  it("has no page for history and decisions", () => {
    expect(T.activityCaption(e("history", null, null))).toBe("Updating history");
    expect(T.activityCaption(e("decisions", null, null))).toBe("Applying decisions");
  });
  it("degrades for coarse agent entries and never uses forbidden words", () => {
    const c = T.activityCaption({ kind: "agent", step: null, agent: "Triage_Agent", pageUrl: null, viewport: null });
    expect(c).toBe("Working: Triage_Agent");
    expect(T.activityCaption(null)).toBe("");
    const all = ["load", "screenshot", "visual-compare", "accessibility-scan", "test-plan", "compare", "notes", "triage", "history", "decisions"]
      .map((s) => T.activityCaption(e(s, "https://x.test/p", "desktop")) + " " + c).join(" ");
    expect(/\b(AI|model|LLM|autonomous)\b/i.test(all)).toBe(false);
  });
  it("stateAt exposes the caption only on working figures", () => {
    const base = Date.parse("2026-01-01T00:00:00.000Z");
    const iso = (ms: number) => new Date(base + ms).toISOString();
    const events = [
      { ts: iso(0), correlationId: "c", runId: "r", kind: "run.started", data: { replaySchema: 1, pages: 1 } },
      { ts: iso(400), correlationId: "c", runId: "r", kind: "step.completed", data: {
        seq: 0, step: "accessibility-scan", pageUrl: "https://x.test/careers/", slug: "careers", viewport: "mobile",
        startedAt: iso(100), endedAt: iso(400) } },
    ];
    const tl = T.buildTimeline(events);
    const during = T.stateAt(tl, 200).figures[0];
    expect(during.working).toBe(true);
    expect(during.caption).toBe("Scanning /careers/ (mobile) (took 300 ms)");
    const after = T.stateAt(tl, 400).figures[0];
    expect(after.working).toBe(false);
    expect(after.caption).toBe("Scanning /careers/ (mobile) (took 300 ms)"); // held (19.14)

  });
});

describe("activityCaption path shortening (19.7)", () => {
  it("keeps only the last segment of long paths", () => {
    expect(T.activityCaption(e("load", "https://x.test/capability/software-quality-accelerators/exmonitoring/", "desktop")))
      .toBe("Loading .../exmonitoring/ (desktop)");
    expect(T.activityCaption(e("triage", "https://x.test/a/b", null))).toBe("Triaging .../b");
  });
  it("leaves home and single-segment paths unchanged", () => {
    expect(T.activityCaption(e("triage", "https://x.test/", null))).toBe("Triaging /");
    expect(T.activityCaption(e("triage", "https://x.test/careers/", null))).toBe("Triaging /careers/");
  });
});
