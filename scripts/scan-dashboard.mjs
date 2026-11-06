// Dashboard self-scan (dashboard-usability-overhaul, design section H).
//
// Usage: node scripts/scan-dashboard.mjs <siteDir>      (CI: ./_site)
//
// Serves the BUILT static site from a tiny Node `http` server bound to
// 127.0.0.1 (no new dependency), opens the Overview, a Run view, a Page detail
// view, a Finding detail view and the Visual comparison in Chromium via
// Playwright, runs @axe-core/playwright (tags wcag2a, wcag2aa, wcag22aa) on
// each, writes <siteDir>/data/self-scan.json, appends a table to
// $GITHUB_STEP_SUMMARY (when set) and ALWAYS exits 0 (non-blocking).
//
// SiteGateway exemption (R17.11): this script only talks to its own loopback
// server and observes the Dashboard itself, not a website. It therefore does
// not go through the SiteGateway. Approved_Domain handling for site scans is
// untouched by this script.
//
// This is an automated check only. It does not confirm WCAG conformance.
// The output contains only rule ids, impacts and counts (no page content).
//
// The pure result shaping (shapeResults / summaryMarkdown) is exported and the
// server only starts when this file is run directly.

import { createServer } from "node:http";
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { join, extname, normalize, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag22aa"];
export const IMPACTS = ["critical", "serious", "moderate", "minor"];
export const SELF_SCAN_NOTE =
  "Automated scan of the Dashboard. This is not a conformance claim.";

function emptyCounts() {
  return { critical: 0, serious: 0, moderate: 0, minor: 0 };
}

function normImpact(v) {
  return IMPACTS.includes(v) ? v : "minor";
}

/**
 * Pure. raw = { generatedAt, tools?, views: [{ name, route, status, reason?,
 * violations?: [{ id, impact, nodes?: any[] }] }] }.
 * Returns the self-scan.json object.
 */
export function shapeResults(raw) {
  const rawViews = raw && Array.isArray(raw.views) ? raw.views : [];
  const totals = emptyCounts();
  const views = rawViews.map((v) => {
    const status = v && (v.status === "scanned" || v.status === "error") ? v.status : "skipped";
    const violations = emptyCounts();
    const ruleMap = new Map();
    if (status === "scanned" && Array.isArray(v.violations)) {
      for (const x of v.violations) {
        if (!x || typeof x.id !== "string") continue;
        const impact = normImpact(x.impact);
        const count = Array.isArray(x.nodes) && x.nodes.length > 0 ? x.nodes.length : 1;
        violations[impact] += count;
        totals[impact] += count;
        const key = x.id + "|" + impact;
        const prev = ruleMap.get(key);
        if (prev) prev.count += count;
        else ruleMap.set(key, { id: x.id, impact, count });
      }
    }
    const rules = [...ruleMap.values()].sort(
      (a, b) => IMPACTS.indexOf(a.impact) - IMPACTS.indexOf(b.impact) || a.id.localeCompare(b.id),
    );
    const out = {
      name: String(v && v.name),
      route: String(v && v.route),
      status,
      violations,
      rules,
    };
    if (v && typeof v.reason === "string" && status !== "scanned") out.reason = v.reason;
    return out;
  });
  const result = {
    schemaVersion: 1,
    generatedAt: raw && typeof raw.generatedAt === "string" ? raw.generatedAt : null,
    tools: raw && raw.tools && typeof raw.tools === "object" ? raw.tools : {},
    tags: AXE_TAGS.slice(),
    views,
    totals: { ...totals, all: totals.critical + totals.serious + totals.moderate + totals.minor },
    note: SELF_SCAN_NOTE,
  };
  return result;
}

/** Pure. Markdown table for $GITHUB_STEP_SUMMARY. */
export function summaryMarkdown(shaped) {
  const lines = [];
  lines.push("### Dashboard accessibility self-scan");
  lines.push("");
  lines.push("| View | Status | Critical | Serious | Moderate | Minor |");
  lines.push("| --- | --- | ---: | ---: | ---: | ---: |");
  for (const v of shaped.views) {
    const status = v.reason ? v.status + " (" + v.reason + ")" : v.status;
    const c = v.violations;
    lines.push(
      "| " + [v.name, status, c.critical, c.serious, c.moderate, c.minor].join(" | ") + " |",
    );
  }
  const t = shaped.totals;
  lines.push("| **Total** |  | " + [t.critical, t.serious, t.moderate, t.minor].join(" | ") + " |");
  lines.push("");
  lines.push(SELF_SCAN_NOTE + " Automated checks cannot confirm WCAG conformance.");
  lines.push("");
  return lines.join("\n");
}

/** Pure. Pick the views to scan from already-parsed published data. */
export function planViews({ index, dashboard, runFindings, visual }) {
  const planned = [{ name: "Overview", route: "#/" }];
  const runs = index && Array.isArray(index.runs) ? index.runs : [];
  const latestId =
    (dashboard && dashboard.latest && typeof dashboard.latest.runId === "string" && dashboard.latest.runId) ||
    (runs[0] && typeof runs[0].runId === "string" && runs[0].runId) ||
    null;
  if (!latestId) {
    for (const n of ["Run view", "Page detail", "Finding detail", "Visual comparison"]) {
      planned.push({ name: n, skip: "no published run" });
    }
    return { runId: null, views: planned };
  }
  const enc = encodeURIComponent;
  planned.push({ name: "Run view", route: "#/run/" + enc(latestId) });

  const pages = dashboard && dashboard.latest && Array.isArray(dashboard.latest.pages) ? dashboard.latest.pages : [];
  const slug = pages.find((p) => p && typeof p.slug === "string")?.slug;
  if (slug) planned.push({ name: "Page detail", route: "#/page/" + enc(slug) + "?run=" + enc(latestId) });
  else planned.push({ name: "Page detail", skip: "no page data" });

  const findings = runFindings && Array.isArray(runFindings.findings) ? runFindings.findings : [];
  const fid = findings.find((f) => f && typeof f.id === "string")?.id;
  if (fid) planned.push({ name: "Finding detail", route: "#/finding/" + enc(latestId) + "/" + enc(fid) });
  else planned.push({ name: "Finding detail", skip: "no findings in latest run" });

  const items = visual && Array.isArray(visual.items) ? visual.items : [];
  const vi = items.find((i) => i && typeof i.slug === "string" && typeof i.viewport === "string");
  if (vi) {
    planned.push({
      name: "Visual comparison",
      route: "#/visual/" + enc(latestId) + "/" + enc(vi.slug) + "/" + enc(vi.viewport),
    });
  } else planned.push({ name: "Visual comparison", skip: "no visual items in latest run" });
  return { runId: latestId, views: planned };
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
};

function startServer(root) {
  const base = resolve(root);
  const server = createServer((req, res) => {
    try {
      const u = new URL(req.url || "/", "http://127.0.0.1");
      let rel = decodeURIComponent(u.pathname);
      if (rel.endsWith("/")) rel += "index.html";
      const file = resolve(join(base, normalize(rel)));
      if (file !== base && !file.startsWith(base + sep)) {
        res.writeHead(403).end();
        return;
      }
      if (!existsSync(file) || !statSync(file).isFile()) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { "content-type": MIME[extname(file).toLowerCase()] || "application/octet-stream" });
      res.end(readFileSync(file));
    } catch {
      res.writeHead(400).end();
    }
  });
  return new Promise((ok, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => ok(server));
  });
}

function readJson(p) {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function pkgVersion(name) {
  try {
    const p = fileURLToPath(new URL("../node_modules/" + name + "/package.json", import.meta.url));
    return readJson(p)?.version ?? null;
  } catch {
    return null;
  }
}

async function scanAll(siteDir) {
  const data = join(siteDir, "data");
  const index = readJson(join(data, "index.json"));
  const dashboard = readJson(join(data, "dashboard.json"));
  const first = index && index.runs && index.runs[0] && index.runs[0].runId;
  const rid = (dashboard && dashboard.latest && dashboard.latest.runId) || first || null;
  const runFindings = rid ? readJson(join(data, "runs", rid, "run-findings.json")) : null;
  const visual = rid ? readJson(join(data, "runs", rid, "visual.json")) : null;
  const plan = planViews({ index, dashboard, runFindings, visual });

  const rawViews = [];
  let server = null;
  let browser = null;
  try {
    server = await startServer(siteDir);
    const origin = "http://127.0.0.1:" + server.address().port + "/";
    const { chromium } = await import("@playwright/test");
    const { default: AxeBuilder } = await import("@axe-core/playwright");
    browser = await chromium.launch();
    for (const v of plan.views) {
      if (v.skip) {
        rawViews.push({ name: v.name, route: "-", status: "skipped", reason: v.skip });
        continue;
      }
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await page.goto(origin + v.route, { waitUntil: "load", timeout: 30000 });
        await page.waitForSelector("#view h2", { timeout: 20000 });
        const res = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
        rawViews.push({ name: v.name, route: v.route, status: "scanned", violations: res.violations });
      } catch (e) {
        const reason = e instanceof Error ? e.name : "error";
        rawViews.push({ name: v.name, route: v.route, status: "error", reason });
      } finally {
        await ctx.close().catch(() => {});
      }
    }
  } catch (e) {
    const reason = e instanceof Error ? e.name : "error";
    for (const v of plan.views) {
      if (!rawViews.some((r) => r.name === v.name)) {
        rawViews.push({ name: v.name, route: v.route || "-", status: v.skip ? "skipped" : "error", reason: v.skip || reason });
      }
    }
    console.warn("self-scan: could not complete (" + reason + ")");
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) server.close();
  }
  return {
    generatedAt: new Date().toISOString(),
    tools: {
      playwright: pkgVersion("@playwright/test"),
      axeCorePlaywright: pkgVersion("@axe-core/playwright"),
      axeCore: pkgVersion("axe-core"),
    },
    views: rawViews,
  };
}

async function main() {
  const siteDir = resolve(process.argv[2] || "_site");
  const started = Date.now();
  let shaped;
  try {
    shaped = shapeResults(await scanAll(siteDir));
  } catch (e) {
    console.warn("self-scan: failed (" + (e instanceof Error ? e.name : "error") + ")");
    return;
  }
  mkdirSync(join(siteDir, "data"), { recursive: true });
  writeFileSync(join(siteDir, "data", "self-scan.json"), JSON.stringify(shaped, null, 2) + "\n");
  const md = summaryMarkdown(shaped);
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + "\n");
    } catch {
      /* non-blocking */
    }
  }
  console.log(md);
  console.log("self-scan finished in " + ((Date.now() - started) / 1000).toFixed(1) + "s");
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  main().then(
    () => process.exit(0),
    () => process.exit(0),
  );
}
