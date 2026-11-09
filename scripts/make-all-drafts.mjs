import { chromium } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig, loadSeed } from "../dist/config/app-config.js";
import { extractInventory } from "../dist/agents/inventory-agent.js";
import { writeDraftSpec, slugify } from "../dist/agents/spec-generator.js";

const cfg = loadConfig();

// Everything below is configurable from the environment; with nothing set the
// behaviour is exactly as before (seed URLs, ./baselines, artifacts/pending-review/spec-drafts).
const WORKSPACE = process.env.AWG_DRAFT_WORKSPACE || process.cwd();
const DOMAIN = process.env.AWG_DRAFT_DOMAIN || cfg.approvedDomain;
const BASELINES_ROOT = resolve(WORKSPACE, process.env.AWG_BASELINES_ROOT || "baselines");
const OUT_ROOT = resolve(WORKSPACE, process.env.AWG_DRAFT_OUT || "artifacts/pending-review/spec-drafts");

let urls;
if (process.env.AWG_DRAFT_URLS_FILE) {
  const parsed = JSON.parse(readFileSync(resolve(WORKSPACE, process.env.AWG_DRAFT_URLS_FILE), "utf8"));
  if (!Array.isArray(parsed) || !parsed.every((u) => typeof u === "string")) {
    throw new Error("AWG_DRAFT_URLS_FILE must contain a JSON array of URL strings");
  }
  urls = parsed;
} else {
  urls = loadSeed(cfg).approvedUrls;
}

const browser = await chromium.launch();
const results = [];
let done = 0;
for (const url of urls) {
  const slug = slugify(url);
  console.log(`PROGRESS: ${done}/${urls.length} ${url}`);
  // Skip a page that already has an approved baseline.
  const hasBaseline = existsSync(resolve(BASELINES_ROOT, slug)) &&
    (existsSync(resolve(BASELINES_ROOT, slug, "baseline.v1.md")) || existsSync(resolve(BASELINES_ROOT, slug, "baseline.v2.md")));
  if (hasBaseline) { results.push({ url, slug, status: "baseline-exists-skipped" }); done++; continue; }

  await new Promise((r) => setTimeout(r, cfg.limits.requestSpacingMs)); // pacing
  const context = await browser.newContext({ viewport: cfg.viewports.desktop });
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: "load", timeout: cfg.limits.navTimeoutMs });
    const inv = await extractInventory(page, url, DOMAIN);
    const ref = writeDraftSpec(inv, OUT_ROOT);
    results.push({ url, slug, status: "draft-written", draftPath: ref.draftPath, headings: inv.headings.length, links: inv.links.length, images: inv.images.length, buttons: inv.buttons.length, forms: inv.forms.length });
  } catch (e) {
    results.push({ url, slug, status: "error", error: String(e).slice(0, 120) });
  } finally {
    await context.close();
    done++;
  }
}
await browser.close();
for (const r of results) console.log(JSON.stringify(r));
