import { describe, it, expect, beforeAll, afterAll } from "vitest";
// @ts-expect-error plain browser ES module without type declarations
import { label as sevLabel } from "../../dashboard/lib/severity.js";
// @ts-expect-error plain browser ES module without type declarations
import { normalizeLegacyRun } from "../../dashboard/lib/legacy.js";
// @ts-expect-error plain browser ES module without type declarations
import { normalizeRun } from "../../dashboard/lib/findings.js";
// @ts-expect-error plain browser ES module without type declarations
import { runRows, findRunEntry, previousRun, changeText, render as renderRun } from "../../dashboard/views/run-view.js";
// @ts-expect-error plain browser ES module without type declarations
import { render as renderOverview, legacySummary, buildRunList } from "../../dashboard/views/overview.js";
// @ts-expect-error plain browser ES module without type declarations
import { pickRunId, activeChips, countText, emptyMessage } from "../../dashboard/views/filtered-findings.js";
// @ts-expect-error plain browser ES module without type declarations
import { highestSeverityOf, countBySeverityList, groupByViewport, historyRows } from "../../dashboard/views/page-detail.js";
// @ts-expect-error plain browser ES module without type declarations
import { trendRows, severityRows, lifecycleRows, RUN_DATA_MISSING_TEXT } from "../../dashboard/views/charts.js";
// @ts-expect-error plain browser ES module without type declarations
import { wcagLabel, runFileUrl, VISUAL_NOT_RATED_TEXT, NO_ELEMENT_DETAIL_TEXT } from "../../dashboard/views/finding-detail.js";

// ---------------------------------------------------------------------------
// Minimal hand-rolled DOM stub (no jsdom): just enough for common.js el()/
// append()/link()/button(), the chart fallbacks and the list renderers.
// ---------------------------------------------------------------------------
class FakeNode {
  nodeType = 1;
  tagName = "";
  className = "";
  children: FakeNode[] = [];
  parentNode: FakeNode | null = null;
  attrs: Record<string, string> = {};
  style: Record<string, string> = {};
  open = false;
  private text = "";
  constructor(tag: string, nodeType = 1) {
    this.tagName = tag.toUpperCase();
    this.nodeType = nodeType;
  }
  get firstChild() {
    return this.children[0] ?? null;
  }
  get id() {
    return this.attrs.id ?? "";
  }
  set href(v: string) {
    this.attrs.href = v;
  }
  get textContent(): string {
    if (this.nodeType === 3) return this.text;
    return this.children.length ? this.children.map((c) => c.textContent).join("") : this.text;
  }
  set textContent(v: string) {
    this.children = [];
    this.text = String(v);
  }
  appendChild(c: FakeNode) {
    if (c.parentNode) c.parentNode.removeChild(c);
    c.parentNode = this;
    this.children.push(c);
    return c;
  }
  removeChild(c: FakeNode) {
    const i = this.children.indexOf(c);
    if (i >= 0) this.children.splice(i, 1);
    c.parentNode = null;
    return c;
  }
  insertBefore(c: FakeNode, ref: FakeNode | null) {
    if (c.parentNode) c.parentNode.removeChild(c);
    c.parentNode = this;
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i < 0) this.children.push(c);
    else this.children.splice(i, 0, c);
    return c;
  }
  setAttribute(k: string, v: string) {
    this.attrs[k] = String(v);
  }
  getAttribute(k: string) {
    return k in this.attrs ? this.attrs[k] : null;
  }
  addEventListener() {}
  focus() {}
  getContext() {
    return null;
  }
  get value() {
    return this.attrs.value ?? "";
  }
  set value(v: string) {
    this.attrs.value = v;
  }
}

function fakeDocument() {
  return {
    createElement: (t: string) => new FakeNode(t),
    createTextNode: (s: string) => {
      const n = new FakeNode("#text", 3);
      n.textContent = s;
      return n;
    },
    documentElement: new FakeNode("html"),
    getElementById: () => null,
  };
}

function findAll(root: FakeNode, pred: (n: FakeNode) => boolean, out: FakeNode[] = []) {
  for (const c of root.children) {
    if (c.nodeType === 1 && pred(c)) out.push(c);
    findAll(c, pred, out);
  }
  return out;
}
const hasClass = (n: FakeNode, cls: string) => n.className.split(/\s+/).includes(cls);

function makeCtx(over: Record<string, unknown>) {
  const base = {
    state: { dashboard: {}, index: null, ui: {} },
    route: { params: {} },
    navigate: () => {},
    formatRoute: (r: { view: string }) => "#/" + r.view,
    isCurrent: () => true,
    notFound: () => {},
    announce: () => {},
    loadRun: async () => {
      throw new Error("not available");
    },
  };
  return Object.assign(base, over);
}

// Let the explorer's async update() settle.
const settle = () => new Promise((r) => setTimeout(r, 0));

const g = globalThis as Record<string, unknown>;
let savedDocument: unknown;
beforeAll(() => {
  savedDocument = g.document;
  g.document = fakeDocument();
});
afterAll(() => {
  g.document = savedDocument;
});

function textOf(n: FakeNode) {
  return n.textContent;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const pageA = {
  url: "https://example.test/a",
  slug: "a",
  title: null,
  counts: { total: 3, critical: 1, serious: 1, moderate: 1, minor: 0, unrated: 0, notRecorded: 0 },
  highest: "critical",
};
const dashboardNew = {
  runs: [
    { runId: "r2", finishedAt: "2026-02-02T10:00:00.000Z", total: 3, bySeverity: { critical: 1, serious: 1, moderate: 1 }, pages: 1, ignored: 2, health: "attention" },
    { runId: "r1", finishedAt: "2026-02-01T10:00:00.000Z", total: 5, bySeverity: { critical: 2, serious: 3 }, pages: 1, health: "attention" },
  ],
  latest: { runId: "r2", pages: [pageA] },
};

describe("Not rated and not-recorded severity labels (R2.7, R2.8)", () => {
  it("labels unrated severity as 'Not rated'", () => {
    expect(sevLabel("unrated")).toBe("Not rated");
  });

  it("labels legacy / unknown severity as not recorded and never infers it", () => {
    expect(sevLabel("not-recorded")).toBe("Severity not recorded for this run");
    expect(sevLabel("a11y-critical-serious")).toBe("Severity not recorded for this run");
    expect(sevLabel(undefined)).toBe("Severity not recorded for this run");
  });

  it("keeps real impacts distinct", () => {
    expect(sevLabel("critical")).toBe("Critical");
    expect(sevLabel("serious")).toBe("Serious");
  });

  it("legacy runs get not-recorded severity regardless of detail text", () => {
    const run = normalizeLegacyRun({
      runId: "old",
      pages: [{ page: "https://x.test/", slug: "x", outcomes: [{ findingId: "f1", detail: "desktop:a11y-critical-serious: link-name" }] }],
    });
    expect(run.findings).toHaveLength(1);
    expect(run.findings[0].severity).toBe("not-recorded");
    expect(sevLabel(run.findings[0].severity)).toBe("Severity not recorded for this run");
  });

  it("exposes the visual-not-rated text", () => {
    expect(VISUAL_NOT_RATED_TEXT).toBe("Not rated - visual changes need human review");
    expect(NO_ELEMENT_DETAIL_TEXT).toBe("No element detail was recorded for this finding");
  });
});

describe("KPI cards have no duplicate meaning (R14.4)", () => {
  async function kpis(dashboard: unknown) {
    const container = new FakeNode("div");
    const ctx = makeCtx({ state: { dashboard, index: null, ui: {} } });
    await renderOverview(container, ctx);
    await settle();
    const labels = findAll(container, (n) => hasClass(n, "kpi__label")).map(textOf);
    const defs = findAll(container, (n) => hasClass(n, "sr-only")).map(textOf);
    return { labels, defs, container };
  }

  it("renders the expected cards once each, with unique labels and definitions", async () => {
    const { labels, defs } = await kpis(dashboardNew);
    expect(labels).toEqual(["Health", "Runs tracked", "Total findings", "Findings by severity", "Pages scanned", "Ignored"]);
    expect(new Set(labels).size).toBe(labels.length);
    expect(new Set(defs).size).toBe(defs.length);
    for (const d of defs) expect(d.length).toBeGreaterThan(10);
  });

  it("does not show an Ignored card for a run that does not record it", async () => {
    const d = { runs: [{ runId: "r1", finishedAt: "2026-02-01T10:00:00.000Z", total: 3, bySeverity: { critical: 3 } }], latest: { runId: "r1", pages: [pageA] } };
    const { labels } = await kpis(d);
    expect(labels).not.toContain("Ignored");
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("Run view change text and trigger (R10.4)", () => {
  const rows = runRows(dashboardNew, null);

  it("orders runs newest first and finds entries and previous runs", () => {
    expect(rows.map((r: { runId: string }) => r.runId)).toEqual(["r2", "r1"]);
    expect(findRunEntry(rows, "r1")?.runId).toBe("r1");
    expect(findRunEntry(rows, "zzz")).toBeNull();
    expect(previousRun(rows, "r2")?.runId).toBe("r1");
    expect(previousRun(rows, "r1")).toBeNull();
    expect(previousRun(rows, "zzz")).toBeNull();
  });

  it("describes the change versus the previous run", () => {
    expect(changeText(3, { total: 5 })).toBe("-2");
    expect(changeText(7, { total: 5 })).toBe("+2");
    expect(changeText(5, { total: 5 })).toBe("no change");
    expect(changeText(5, null)).toBe("no earlier run");
    expect(changeText(5, { total: null })).toBe("not available");
  });

  async function facts(entryOver: Record<string, unknown>, runRaw: Record<string, unknown>) {
    const dashboard = {
      runs: [
        Object.assign({ runId: "r2", finishedAt: "2026-02-02T10:00:00.000Z", total: 1 }, entryOver),
        { runId: "r1", finishedAt: "2026-02-01T10:00:00.000Z", total: 4 },
      ],
      latest: { runId: "r2", pages: [] },
    };
    const container = new FakeNode("div");
    const ctx = makeCtx({
      state: { dashboard, index: null, ui: {} },
      route: { view: "run", runId: "r2", params: {} },
      loadRun: async () => ({ run: normalizeRun(runRaw) }),
    });
    await renderRun(container, ctx);
    const dts = findAll(container, (n) => n.tagName === "DT").map(textOf);
    const dds = findAll(container, (n) => n.tagName === "DD").map(textOf);
    const map: Record<string, string> = {};
    dts.forEach((k, i) => (map[k] = dds[i]));
    return map;
  }

  it("shows 'not recorded' when the trigger and origin are absent", async () => {
    const f = await facts({}, { runId: "r2", finishedAt: "2026-02-02T10:00:00.000Z", findings: [] });
    expect(f["Trigger"]).toBe("not recorded");
    expect(f["Origin"]).toBe("not recorded");
    expect(f["Change versus previous run"]).toBe("-4 (previous run r1)");
  });

  it("shows the trigger when it is recorded", async () => {
    const f = await facts({ trigger: "schedule" }, { runId: "r2", finishedAt: "2026-02-02T10:00:00.000Z", findings: [] });
    expect(f["Trigger"]).toBe("schedule");
  });
});

describe("Overview falls back to the latest loaded run (R14.6)", () => {
  it("names the failed file and shows the most recent run that loaded", async () => {
    const dashboard = {
      runs: [
        { runId: "r3", finishedAt: "2026-03-01T10:00:00.000Z", total: 1 },
        { runId: "r2", finishedAt: "2026-02-02T10:00:00.000Z", total: 1 },
        { runId: "r1", finishedAt: "2026-02-01T10:00:00.000Z", total: 0 },
      ],
    };
    const container = new FakeNode("div");
    const ctx = makeCtx({
      state: { dashboard, index: null, ui: {} },
      loadRun: async (id: string) => {
        if (id !== "r2") throw new Error("HTTP 404 for " + id);
        return { run: normalizeRun({ runId: "r2", finishedAt: "2026-02-02T10:00:00.000Z", findings: [] }) };
      },
    });
    await renderOverview(container, ctx);
    await settle();
    const alerts = findAll(container, (n) => n.attrs.role === "alert").map(textOf);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toContain("runs/r3/run-findings.json");
    expect(alerts[0]).toContain("Showing run r2 instead, the most recent run that loaded.");
    const muted = findAll(container, (n) => hasClass(n, "muted")).map(textOf);
    expect(muted.some((t) => t.startsWith("Showing run r2 "))).toBe(true);
  });

  it("says no figures are shown when nothing loads", async () => {
    const dashboard = { runs: [{ runId: "r1", finishedAt: "2026-02-01T10:00:00.000Z", total: 0 }] };
    const container = new FakeNode("div");
    await renderOverview(container, makeCtx({ state: { dashboard, index: null, ui: {} } }));
    const alerts = findAll(container, (n) => n.attrs.role === "alert").map(textOf);
    expect(alerts[0]).toContain("No run could be loaded, so no figures are shown.");
    expect(findAll(container, (n) => hasClass(n, "kpi"))).toHaveLength(0);
  });
});

describe("Legacy data renders (R17.9)", () => {
  const legacyDashboard = {
    runHealthTrend: [{ runId: "old1", finishedAt: "2025-01-01T00:00:00.000Z", health: "attention" }],
    findingsByPage: [{ page: "https://old.test/", count: 2 }],
    findingsBySeverity: {},
  };

  it("builds a summary from pre-overhaul fields without throwing", () => {
    const s = legacySummary(legacyDashboard);
    expect(s.runId).toBe("old1");
    expect(s.total).toBe(2);
    expect(s.pages[0].highest).toBe("not-recorded");
    expect(s.lifecycle).toBeNull();
    expect(() => legacySummary(undefined)).not.toThrow();
    expect(buildRunList(legacyDashboard, null).map((r: { runId: string }) => r.runId)).toEqual(["old1"]);
  });

  it("renders the overview for a legacy dashboard with no runs[] or latest", async () => {
    const container = new FakeNode("div");
    await renderOverview(container, makeCtx({ state: { dashboard: legacyDashboard, index: null, ui: {} } }));
    await settle();
    expect(findAll(container, (n) => n.tagName === "H2").map(textOf)).toEqual(["Overview"]);
    const labels = findAll(container, (n) => hasClass(n, "kpi__label")).map(textOf);
    expect(labels).toContain("Total findings");
    expect(findAll(container, (n) => n.attrs.role === "alert")).toHaveLength(0);
  });

  it("renders a legacy run (no rule, severity, lifecycle, trigger) in the run view", async () => {
    const legacyRun = normalizeLegacyRun(
      { runId: "old1", pages: [{ page: "https://old.test/", slug: "old", outcomes: [{ findingId: "f1", detail: "something" }] }] },
      { finishedAt: "2025-01-01T00:00:00.000Z" },
    );
    const container = new FakeNode("div");
    const ctx = makeCtx({
      state: { dashboard: { runs: [{ runId: "old1", finishedAt: "2025-01-01T00:00:00.000Z" }] }, index: null, ui: {} },
      route: { view: "run", runId: "old1", params: {} },
      loadRun: async () => ({ run: legacyRun }),
    });
    await renderRun(container, ctx);
    expect(findAll(container, (n) => n.tagName === "H2").map(textOf)).toEqual(["Run old1"]);
    const dts = findAll(container, (n) => n.tagName === "DT").map(textOf);
    const dds = findAll(container, (n) => n.tagName === "DD").map(textOf);
    expect(dds[dts.indexOf("Trigger")]).toBe("not recorded");
    expect(findAll(container, (n) => n.attrs.role === "alert")).toHaveLength(0);
  });
});

describe("Other view-model helpers", () => {
  it("trend rows give an unpublished run no route", () => {
    const rows = trendRows([
      { runId: "r1", finishedAt: "2026-02-01T10:00:00.000Z", total: 2 },
      { runId: "r2", finishedAt: "2026-02-02T10:00:00.000Z", total: 1, hasRunData: false },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.find((r: { route: unknown; runId?: string }) => r.route === null)).toBeTruthy();
    expect(RUN_DATA_MISSING_TEXT).toBe("Run data not published");
  });

  it("severity rows list only severities with findings; lifecycle rows tolerate empty input", () => {
    const rows = severityRows({ critical: 2, serious: 0, minor: 1 }, "r1");
    expect(rows.map((r: { key: string }) => r.key)).toEqual(["critical", "minor"]);
    expect(() => lifecycleRows(undefined, "r1")).not.toThrow();
  });

  it("filtered findings helpers", () => {
    expect(pickRunId({ run: "r9" }, {})).toBe("r9");
    expect(pickRunId({}, { dashboard: { latest: { runId: "r5" } } })).toBe("r5");
    expect(countText(1, "active")).toBe("Showing 1 finding");
    expect(countText(2, "ignored")).toBe("Showing 2 ignored findings");
    expect(emptyMessage("active", true)).toBe("No findings match these filters");
    expect(emptyMessage("active", false)).toBe("No active findings in this run");
    expect(emptyMessage("ignored", false)).toBe("No issues are ignored in this run");
    expect(activeChips({ sev: ["unrated"] })[0].text).toBe("severity not rated");
  });

  it("page detail helpers", () => {
    const fs = [
      { severity: "minor", viewport: "mobile" },
      { severity: "serious", viewport: "desktop" },
      { severity: "serious", viewport: "desktop" },
    ];
    expect(highestSeverityOf(fs)).toBe("serious");
    expect(highestSeverityOf([])).toBe("none");
    expect(countBySeverityList(fs)).toEqual([
      { severity: "serious", count: 2 },
      { severity: "minor", count: 1 },
    ]);
    expect(groupByViewport(fs).map((x: { viewport: string }) => x.viewport)).toEqual(["desktop", "mobile"]);
    expect(historyRows(undefined)).toEqual([]);
  });

  it("finding detail helpers", () => {
    expect(wcagLabel("wcag244")).toBe("WCAG 2.4.4");
    expect(wcagLabel("wcag1410")).toBe("WCAG 1.4.10");
    expect(wcagLabel("best-practice")).toBeNull();
    expect(runFileUrl("r1", "../secret")).toBe("");
  });
});
