// Standalone local Visual_Baseline capture (not a monitoring run).
// Writes proposals only, under artifacts/admin/captures/<captureId>/ (PNGs + manifest.json).
// Never writes under artifacts/runs/, baselines-visual/, or any run record.
//
// Env (all optional):
//   AWG_CAPTURE_ID        capture id (letters, digits, '-' and '_' only); default is time based
//   AWG_CAPTURE_OUT_ROOT  output root; default artifacts/admin/captures
//   AWG_CAPTURE_URLS_FILE JSON array of URLs (subset of the approved scope)
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";
import { loadConfig, resolveApprovedUrls } from "../dist/config/app-config.js";
import { SiteGateway } from "../dist/core/site-gateway.js";
import { slugify } from "../dist/agents/spec-generator.js";
import { takeScreenshot } from "../dist/agents/screenshot.js";

const cfg = loadConfig();
const gateway = new SiteGateway(cfg);

const captureId = process.env.AWG_CAPTURE_ID || "cap-" + new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
if (!/^[A-Za-z0-9_-]{1,64}$/.test(captureId)) {
  console.error("Invalid capture id.");
  process.exit(2);
}
const outRoot = resolve(process.env.AWG_CAPTURE_OUT_ROOT || "artifacts/admin/captures");
const outDir = join(outRoot, captureId);

// Safety: never write into run records or the approved baselines.
for (const forbidden of ["artifacts/runs", "baselines-visual"]) {
  const f = resolve(forbidden).toLowerCase();
  const o = outDir.toLowerCase();
  if (o === f || o.startsWith(f + "\\") || o.startsWith(f + "/")) {
    console.error("Refusing to write captures under " + forbidden + ".");
    process.exit(2);
  }
}

// Only Approved_URLs of the Guarded_Domain may be fetched.
const approved = new Set(resolveApprovedUrls(cfg).urls);
let urls = [...approved];
if (process.env.AWG_CAPTURE_URLS_FILE) {
  const requested = JSON.parse(readFileSync(resolve(process.env.AWG_CAPTURE_URLS_FILE), "utf8"));
  if (!Array.isArray(requested)) {
    console.error("URL file must hold a JSON array.");
    process.exit(2);
  }
  urls = requested.filter((u) => typeof u === "string" && approved.has(u));
}
urls = urls.filter((u) => gateway.isApprovedDomain(u));

mkdirSync(outDir, { recursive: true });
const viewports = [
  { name: "desktop", size: cfg.viewports.desktop },
  { name: "mobile", size: cfg.viewports.mobile },
];
const total = urls.length * viewports.length;
const entries = [];
const failures = [];
let done = 0;

const browser = await chromium.launch();
try {
  for (const url of urls) {
    const slug = slugify(url);
    for (const vp of viewports) {
      await new Promise((r) => setTimeout(r, cfg.limits.requestSpacingMs));
      const context = await browser.newContext({ viewport: vp.size });
      try {
        const page = await context.newPage();
        gateway.guardUrl(url);
        const resp = await page.goto(url, { waitUntil: "load", timeout: cfg.limits.navTimeoutMs }).catch(() => null);
        const status = resp?.status() ?? 0;
        if (status < 200 || status >= 400) {
          failures.push({ slug, viewport: vp.name, reason: "page not reached (status " + status + ")" });
        } else {
          const dir = join(outDir, slug);
          mkdirSync(dir, { recursive: true });
          const file = join(dir, vp.name + ".png");
          await takeScreenshot(page, file);
          const buf = readFileSync(file);
          entries.push({
            slug,
            url,
            viewport: vp.name,
            sha16: createHash("sha256").update(buf).digest("hex").slice(0, 16),
            size: statSync(file).size,
            capturedAt: new Date().toISOString(),
          });
        }
      } catch (e) {
        failures.push({ slug, viewport: vp.name, reason: String(e && e.message ? e.message : e).slice(0, 200) });
      } finally {
        await context.close().catch(() => {});
      }
      done += 1;
      console.log("PROGRESS:" + done + "/" + total);
    }
  }
} finally {
  await browser.close().catch(() => {});
}

const manifest = {
  captureId,
  domain: cfg.approvedDomain,
  createdAt: new Date().toISOString(),
  isMonitoringRun: false,
  entries,
  failures,
};
const tmp = join(outDir, "manifest.json.tmp");
writeFileSync(tmp, JSON.stringify(manifest, null, 2) + "\n", "utf8");
renameSync(tmp, join(outDir, "manifest.json"));
console.log("CAPTURE_COMPLETE:" + captureId);
console.log("CAPTURED:" + entries.length + " FAILED:" + failures.length);
