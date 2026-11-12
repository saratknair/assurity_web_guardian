// Virtual Office self-scan (virtual-office-replay, task 11.7).
//
// Usage: node scripts/scan-office.mjs <siteDir>      (CI: ./_site)
//
// Serves the BUILT static site from a tiny Node `http` server bound to
// 127.0.0.1 on an ephemeral port, opens /office/ in Chromium via Playwright,
// runs @axe-core/playwright (tags wcag2a, wcag2aa, wcag22aa) and checks:
//   - the Transcript is not empty
//   - an Office_Deep_Link restores the playback position
//   - the idle frame count does not change while paused (requirement 16.6)
//   - a forced Fallback_Mode pass (WebGL disabled) shows the message and a
//     non-empty Transcript, and passes axe too (requirement 8.6)
//   - no horizontal scroll at 320 px (requirement 15.3)
//   - no request leaves 127.0.0.1
// Writes <siteDir>/data/office-self-scan.json, appends a table to
// $GITHUB_STEP_SUMMARY (when set) and ALWAYS exits 0 (non-blocking).
//
// This is an automated check only. It does not confirm WCAG conformance.
// The output contains only rule ids, impacts, counts and check names.
//
// Pure helpers are exported; a browser only starts when run directly.

import { createServer } from "node:http";
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { join, extname, normalize, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag22aa"];
export const IMPACTS = ["critical", "serious", "moderate", "minor"];
export const OFFICE_SCAN_NOTE =
  "Automated scan of the Virtual Office. This is not a conformance claim.";
export const DEEP_LINK_T_MS = 1000;
export const NARROW_WIDTH = 320;

function emptyCounts() {
  return { critical: 0, serious: 0, moderate: 0, minor: 0 };
}

function normImpact(v) {
  return IMPACTS.includes(v) ? v : "minor";
}

/** Pure. Office_Deep_Link path for a run and playback position. */
export function deepLinkPath(runId, tMs) {
  return "office/#/run/" + encodeURIComponent(runId) + "?t=" + Math.max(0, Math.round(tMs));
}

/** Pure. True when a URL targets anything other than the 127.0.0.1 server (data: and blob: are local). */
export function isForeignUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol === "data:" || u.protocol === "blob:" || u.protocol === "about:") return false;
    return u.hostname !== "127.0.0.1";
  } catch {
    return true;
  }
}

/** Pure. Deep link restored when the scrubber shows the (clamped) position and has value text. */
export function deepLinkRestored({ value, max, valueText, t }) {
  const v = Number(value);
  const m = Number(max);
  if (!Number.isFinite(v) || !Number.isFinite(m)) return false;
  if (typeof valueText !== "string" || valueText.length === 0) return false;
  const expected = Math.min(t, m);
  // The scrubber step is 100 ms; allow one step of rounding.
  return Math.abs(v - expected) <= 100;
}

/** Pure. Idle check on two data-frame-count readings. */
export function idleFramesUnchanged(a, b) {
  return a !== null && a !== undefined && a === b;
}

/**
 * Pure. raw = { generatedAt, tools?, views: [{ name, route, status, reason?,
 * violations?: [{ id, impact, nodes? }] }],
 * checks: [{ name, status: "pass"|"fail"|"skipped"|"error", note? }] }.
 */
export function shapeResults(raw) {
  const rawViews = raw && Array.isArray(raw.views) ? raw.views : [];
  const rawChecks = raw && Array.isArray(raw.checks) ? raw.checks : [];
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
    const out = { name: String(v && v.name), route: String(v && v.route), status, violations, rules };
    if (v && typeof v.reason === "string" && status !== "scanned") out.reason = v.reason;
    return out;
  });
  const checks = rawChecks.map((c) => {
    const status =
      c && (c.status === "pass" || c.status === "fail" || c.status === "error") ? c.status : "skipped";
    const out = { name: String(c && c.name), status };
    if (c && typeof c.note === "string") out.note = c.note;
    return out;
  });
  const failed = checks.filter((c) => c.status === "fail" || c.status === "error").length;
  return {
    schemaVersion: 1,
    generatedAt: raw && typeof raw.generatedAt === "string" ? raw.generatedAt : null,
    tools: raw && raw.tools && typeof raw.tools === "object" ? raw.tools : {},
    tags: AXE_TAGS.slice(),
    views,
    checks,
    totals: { ...totals, all: totals.critical + totals.serious + totals.moderate + totals.minor },
    checksFailed: failed,
    note: OFFICE_SCAN_NOTE,
  };
}

/** Pure. Markdown for $GITHUB_STEP_SUMMARY. */
export function summaryMarkdown(shaped) {
  const lines = [];
  lines.push("### Virtual Office accessibility self-scan");
  lines.push("");
  lines.push("| View | Status | Critical | Serious | Moderate | Minor |");
  lines.push("| --- | --- | ---: | ---: | ---: | ---: |");
  for (const v of shaped.views) {
    const status = v.reason ? v.status + " (" + v.reason + ")" : v.status;
    const c = v.violations;
    lines.push("| " + [v.name, status, c.critical, c.serious, c.moderate, c.minor].join(" | ") + " |");
  }
  const t = shaped.totals;
  lines.push("| **Total** |  | " + [t.critical, t.serious, t.moderate, t.minor].join(" | ") + " |");
  lines.push("");
  lines.push("| Check | Result | Note |");
  lines.push("| --- | --- | --- |");
  for (const c of shaped.checks) {
    lines.push("| " + [c.name, c.status, c.note || ""].join(" | ") + " |");
  }
  lines.push("");
  lines.push(OFFICE_SCAN_NOTE + " Automated checks cannot confirm WCAG conformance.");
  lines.push("");
  return lines.join("\n");
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

const NO_WEBGL_INIT = () => {
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    if (type === "webgl" || type === "webgl2" || type === "experimental-webgl") return null;
    return orig.call(this, type, ...rest);
  };
};

async function transcriptCount(page) {
  return page.locator("#transcript li").count();
}

async function waitForTranscript(page) {
  await page.waitForSelector("#transcript li", { timeout: 20000 });
}

async function scanAll(siteDir) {
  const index = readJson(join(siteDir, "data", "index.json"));
  const runId = index && index.runs && index.runs[0] && typeof index.runs[0].runId === "string" ? index.runs[0].runId : null;

  const views = [];
  const checks = [];
  const foreign = [];
  let server = null;
  let browser = null;

  const record = (name, fn) =>
    fn().then(
      (r) => checks.push({ name, status: r.ok ? "pass" : r.skip ? "skipped" : "fail", note: r.note }),
      (e) => checks.push({ name, status: "error", note: e instanceof Error ? e.name : "error" }),
    );

  async function openPage(origin, hash, { noWebgl = false, width = 1280 } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    if (noWebgl) await ctx.addInitScript(NO_WEBGL_INIT);
    await ctx.route("**/*", (route) => {
      const url = route.request().url();
      if (isForeignUrl(url)) {
        foreign.push(new URL(url, "http://x").hostname);
        return route.abort();
      }
      return route.continue();
    });
    const page = await ctx.newPage();
    await page.goto(origin + hash, { waitUntil: "load", timeout: 30000 });
    return { ctx, page };
  }

  async function scanView(name, route, origin, opts) {
    let h = null;
    try {
      h = await openPage(origin, route, opts);
      await waitForTranscript(h.page);
      const { default: AxeBuilder } = await import("@axe-core/playwright");
      const res = await new AxeBuilder({ page: h.page }).withTags(AXE_TAGS).analyze();
      views.push({ name, route, status: "scanned", violations: res.violations });
    } catch (e) {
      views.push({ name, route, status: "error", reason: e instanceof Error ? e.name : "error" });
    } finally {
      if (h) await h.ctx.close().catch(() => {});
    }
  }

  try {
    server = await startServer(siteDir);
    const origin = "http://127.0.0.1:" + server.address().port + "/";
    const { chromium } = await import("@playwright/test");
    browser = await chromium.launch();

    if (!existsSync(join(siteDir, "office", "index.html"))) {
      views.push({ name: "Office", route: "office/", status: "skipped", reason: "no office/ in site" });
    } else {
      await scanView("Office", "office/", origin, {});
      await scanView("Office (Fallback_Mode)", "office/", origin, { noWebgl: true });

      await record("Transcript is not empty", async () => {
        const h = await openPage(origin, "office/");
        try {
          await waitForTranscript(h.page);
          const n = await transcriptCount(h.page);
          return { ok: n > 0, note: n + " entries" };
        } finally {
          await h.ctx.close().catch(() => {});
        }
      });

      await record("Deep link restores position", async () => {
        if (!runId) return { skip: true, note: "no published run" };
        const h = await openPage(origin, deepLinkPath(runId, DEEP_LINK_T_MS));
        try {
          await waitForTranscript(h.page);
          const s = h.page.locator("#playback-controls input[type=range]").first();
          await s.waitFor({ timeout: 10000 });
          const value = await s.inputValue();
          const max = await s.getAttribute("max");
          const valueText = await s.getAttribute("aria-valuetext");
          return { ok: deepLinkRestored({ value, max, valueText, t: DEEP_LINK_T_MS }) };
        } finally {
          await h.ctx.close().catch(() => {});
        }
      });

      await record("Idle frame count unchanged", async () => {
        // Paused mid-run (via the deep link) so a working figure is on screen.
        const h = await openPage(origin, runId ? deepLinkPath(runId, DEEP_LINK_T_MS) : "office/");
        try {
          await waitForTranscript(h.page);
          await h.page.waitForTimeout(1000);
          const host = h.page.locator("#diorama-host");
          const read = () => host.getAttribute("data-frame-count");
          const a = await read();
          if (a === null) return { skip: true, note: "Fallback_Mode active or no frame counter (no WebGL)" };
          await h.page.waitForTimeout(1000);
          const b = await read();
          return { ok: idleFramesUnchanged(a, b), note: a + " -> " + b };
        } finally {
          await h.ctx.close().catch(() => {});
        }
      });

      await record("Forced Fallback_Mode shows message and Transcript", async () => {
        const h = await openPage(origin, "office/", { noWebgl: true });
        try {
          await waitForTranscript(h.page);
          await h.page.getByText("The 3D view is unavailable", { exact: false }).first().waitFor({ timeout: 15000 });
          const n = await transcriptCount(h.page);
          return { ok: n > 0, note: n + " entries" };
        } finally {
          await h.ctx.close().catch(() => {});
        }
      });

      await record("No horizontal scroll at 320 px", async () => {
        const h = await openPage(origin, "office/", { width: NARROW_WIDTH });
        try {
          await waitForTranscript(h.page);
          const r = await h.page.evaluate(() => ({
            sw: document.documentElement.scrollWidth,
            cw: document.documentElement.clientWidth,
          }));
          return { ok: r.sw <= r.cw, note: "scrollWidth " + r.sw + ", clientWidth " + r.cw };
        } finally {
          await h.ctx.close().catch(() => {});
        }
      });

      checks.push({
        name: "Only 127.0.0.1 requests",
        status: foreign.length === 0 ? "pass" : "fail",
        note: foreign.length === 0 ? undefined : foreign.length + " blocked",
      });
    }
  } catch (e) {
    const reason = e instanceof Error ? e.name : "error";
    if (views.length === 0) views.push({ name: "Office", route: "office/", status: "error", reason });
    console.warn("office self-scan: could not complete (" + reason + ")");
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
    views,
    checks,
  };
}

async function main() {
  const siteDir = resolve(process.argv[2] || "_site");
  const started = Date.now();
  let shaped;
  try {
    shaped = shapeResults(await scanAll(siteDir));
  } catch (e) {
    console.warn("office self-scan: failed (" + (e instanceof Error ? e.name : "error") + ")");
    return;
  }
  mkdirSync(join(siteDir, "data"), { recursive: true });
  writeFileSync(join(siteDir, "data", "office-self-scan.json"), JSON.stringify(shaped, null, 2) + "\n");
  const md = summaryMarkdown(shaped);
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + "\n");
    } catch {
      /* non-blocking */
    }
  }
  console.log(md);
  console.log("office self-scan finished in " + ((Date.now() - started) / 1000).toFixed(1) + "s");
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  main().then(
    () => process.exit(0),
    () => process.exit(0),
  );
}
