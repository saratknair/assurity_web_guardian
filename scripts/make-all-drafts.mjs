import { chromium } from "@playwright/test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig, loadSeed } from "../dist/config/app-config.js";
import { extractInventory } from "../dist/agents/inventory-agent.js";
import { writeDraftSpec, slugify } from "../dist/agents/spec-generator.js";

const cfg = loadConfig();
const seed = loadSeed(cfg);

const browser = await chromium.launch();
const results = [];
for (const url of seed.approvedUrls) {
  const slug = slugify(url);
  // Skip homepage if it already has an approved baseline.
  const hasBaseline = existsSync(resolve("baselines", slug)) &&
    (existsSync(resolve("baselines", slug, "baseline.v1.md")) || existsSync(resolve("baselines", slug, "baseline.v2.md")));
  if (hasBaseline) { results.push({ url, slug, status: "baseline-exists-skipped" }); continue; }

  await new Promise((r) => setTimeout(r, cfg.limits.requestSpacingMs)); // pacing
  const context = await browser.newContext({ viewport: cfg.viewports.desktop });
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: "load", timeout: cfg.limits.navTimeoutMs });
    const inv = await extractInventory(page, url, cfg.approvedDomain);
    const ref = writeDraftSpec(inv);
    results.push({ url, slug, status: "draft-written", draftPath: ref.draftPath, headings: inv.headings.length, links: inv.links.length, images: inv.images.length, buttons: inv.buttons.length, forms: inv.forms.length });
  } catch (e) {
    results.push({ url, slug, status: "error", error: String(e).slice(0, 120) });
  } finally {
    await context.close();
  }
}
await browser.close();
for (const r of results) console.log(JSON.stringify(r));
