import { chromium } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { loadConfig } from "../dist/config/app-config.js";
import { loadDomainConfig } from "../dist/config/domain-config.js";
import { isApprovedDomain, isExternal } from "../dist/safety/domain-guard.js";

const cfg = loadConfig();
// Draft scope: the console passes the draft domain and base URL; otherwise the config is used.
const envDomain = (process.env.AWG_DISCOVERY_DOMAIN || "").trim().toLowerCase();
const envBase = (process.env.AWG_DISCOVERY_BASE_URL || "").trim();
const APPROVED = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(envDomain) ? envDomain : cfg.approvedDomain;
const BASE_URL = envBase && /^https?:\/\//i.test(envBase) ? envBase.replace(/\/+$/, "") : cfg.baseUrl;
const OTHER_DOMAIN = APPROVED !== cfg.approvedDomain;

// Candidate seeds representing the areas requested (candidates ONLY; nothing is
// added to approved scope here). We discover same-domain links from the
// homepage and also probe these representative paths if present.
// Probe paths come from the configured Domain_Config; a domain without a list probes "/" only.
const domainCfg = OTHER_DOMAIN ? {} : loadDomainConfig(cfg.domain);
const probePaths = Array.isArray(domainCfg.probePaths) && domainCfg.probePaths.length > 0
  ? domainCfg.probePaths
  : ["/"];

// Workspace and output path come from the environment (same defaults as before).
const WORKSPACE = process.env.AWG_DISCOVERY_WORKSPACE || process.cwd();
const OUT_PATH = resolve(
  WORKSPACE,
  process.env.AWG_DISCOVERY_OUT || "artifacts/pending-review/candidates/candidate-pages.json",
);

function norm(u) { try { return new URL(u).toString().replace(/#.*$/, ""); } catch { return null; } }

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: cfg.viewports.desktop });
const page = await context.newPage();

// 1. Crawl homepage links (same-domain only).
await page.goto(BASE_URL + "/", { waitUntil: "load", timeout: cfg.limits.navTimeoutMs });
const homeLinks = await page.$$eval("a[href]", (as) => as.map((a) => a.href));
const sameDomain = new Set();
for (const l of homeLinks) {
  const n = norm(l);
  if (n && isApprovedDomain(n, APPROVED)) sameDomain.add(n.replace(/\/$/, "") + "/");
}

// 2. Build candidate list = probePaths that resolve + a few discovered pages.
const candidatesSet = new Set();
for (const p of probePaths) candidatesSet.add((BASE_URL + p).replace(/\/+$/, "/"));
for (const s of [...sameDomain].slice(0, 30)) candidatesSet.add(s);

const candidates = [...candidatesSet].slice(0, 20); // cap probing
const results = [];

for (const url of candidates) {
  // Conservative pacing (Req 12.1): >= 1s between requests.
  await new Promise((r) => setTimeout(r, cfg.limits.requestSpacingMs));
  const rec = { url, httpStatus: null, title: "", h1: "", purpose: "", navCount: 0, ctas: [], forms: 0, hasExternalLinks: false, concern: "" };
  try {
    const resp = await page.goto(url, { waitUntil: "load", timeout: cfg.limits.navTimeoutMs });
    rec.httpStatus = resp ? resp.status() : null;
    if (!resp || resp.status() >= 400) { rec.concern = "non-success HTTP status"; results.push(rec); continue; }
    rec.title = (await page.title()).trim();
    rec.h1 = (await page.locator("h1").first().textContent().catch(() => ""))?.trim() ?? "";
    rec.navCount = await page.locator("nav").count();
    rec.forms = await page.locator("form").count();
    const ctas = await page.$$eval("a,button", (els) =>
      els.map((e) => (e.getAttribute("aria-label") || e.textContent || "").replace(/\s+/g, " ").trim())
        .filter((t) => /contact|get in touch|talk|book|download|learn more|subscribe|apply|read more|explore/i.test(t) && t.length <= 60));
    rec.ctas = [...new Set(ctas)].slice(0, 8);
    const links = await page.$$eval("a[href]", (as) => as.map((a) => a.href));
    rec.hasExternalLinks = links.some((l) => { try { const h = new URL(l).hostname.toLowerCase(); return !(h === APPROVED || h.endsWith("." + APPROVED)); } catch { return false; } });
    rec.purpose = rec.h1 || rec.title;
  } catch (e) {
    rec.concern = "navigation failed: " + String(e).slice(0, 80);
  }
  results.push(rec);
}

await browser.close();

mkdirSync(dirname(OUT_PATH), { recursive: true });
const out = OUT_PATH;
writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), approvedDomain: APPROVED, candidates: results }, null, 2));
console.log("CANDIDATES_WRITTEN:" + out);
console.log("COUNT:" + results.length);
