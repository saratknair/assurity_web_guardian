import type { Browser } from "@playwright/test";
import { isApprovedDomain } from "../safety/domain-guard.js";

/**
 * Discovery_Crawler (Req 5.1-5.3, 5.8, 12.4-12.6) — a BFS same-domain crawler
 * that proposes the Full_Site_Scope for a Guarded_Domain.
 *
 * Guarantees preserved from Phase 1 and carried into full-site coverage:
 *  - Approved-domain boundary (5.2, 12.4): only same-approved-domain links are
 *    ever enqueued, and off-domain redirect targets are excluded (5.8).
 *  - Conservative_Request_Rate (5.3, 12.6): a sleep of `requestSpacingMs`
 *    (>= 1000 ms, 1 req/s/host) is awaited BEFORE every navigation.
 *  - No forms, no load testing (12.5): the crawler issues GET/navigation only
 *    via `page.goto`; it never submits a form nor hammers a host.
 *
 * The approved-domain check reuses `src/safety/domain-guard.ts`
 * (`isApprovedDomain`) rather than re-implementing host comparison.
 */

export interface CrawlParams {
  /** Seed URL the BFS starts from (should already be on the approved domain). */
  startUrl: string;
  /** Approved domain (e.g. "assurity.nz"); subdomains are in-scope. */
  approvedDomain: string;
  /** Hard upper bound on discovered pages (default 500). */
  maxDiscoveryCount: number;
  /** Delay before each navigation; clamped to a 1000 ms floor (1 req/s/host). */
  requestSpacingMs: number;
  /** Per-navigation timeout in milliseconds. */
  navTimeoutMs: number;
}

export interface DiscoveredPage {
  /** Normalized absolute URL (fragment stripped). */
  url: string;
  /** BFS depth from the start URL (startUrl = 0). */
  depth: number;
  /** The page this URL was first discovered from ("" for the start URL). */
  discoveredFrom: string;
}

export interface CrawlResult {
  /** Full_Site_Scope: same-domain pages actually visited, <= maxDiscoveryCount. */
  scope: DiscoveredPage[];
  /** Off-domain redirect targets excluded from scope (5.8). */
  offDomainRedirectsSkipped: { from: string; to: string }[];
  /** True when the crawl stopped because it hit maxDiscoveryCount. */
  truncatedAtMax: boolean;
}

/** The minimum crawl delay between consecutive requests to the same host (5.3). */
const MIN_REQUEST_SPACING_MS = 1000;

/**
 * Normalize a URL for the visited set / scope: resolve against an optional base
 * to an absolute URL, drop the fragment, and lowercase the host. Returns null
 * when the href cannot be parsed into an http(s) URL.
 *
 * Pure helper — exported for property-based tests (no navigation, no I/O).
 */
export function normalizeUrl(href: string, base?: string): string | null {
  let u: URL;
  try {
    u = base ? new URL(href, base) : new URL(href);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  u.hash = "";
  u.hostname = u.hostname.toLowerCase();
  return u.toString();
}

/**
 * From a page's raw hrefs, produce the set of normalized, de-duplicated,
 * same-approved-domain absolute URLs that are eligible to be enqueued.
 *
 * Pure helper — exported for property-based tests (Property 11). It performs no
 * navigation and makes no enqueue/bound decisions itself; it only decides which
 * candidate links are on the approved domain.
 */
export function sameDomainLinks(hrefs: string[], base: string, approvedDomain: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const href of hrefs) {
    const norm = normalizeUrl(href, base);
    if (norm === null) continue;
    if (seen.has(norm)) continue;
    if (!isApprovedDomain(norm, approvedDomain)) continue;
    seen.add(norm);
    out.push(norm);
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * BFS same-domain crawl. Enqueues only approved-domain links, stops at
 * `maxDiscoveryCount` (setting `truncatedAtMax`), paces every navigation by at
 * least 1000 ms, and excludes/records off-domain redirect targets (5.8).
 *
 * Navigation happens through Playwright `page.goto` (GET/navigation only); no
 * form is ever submitted (12.5).
 */
export async function crawlSite(p: CrawlParams, browser: Browser): Promise<CrawlResult> {
  const spacingMs = Math.max(MIN_REQUEST_SPACING_MS, p.requestSpacingMs);
  const maxCount = Math.max(0, p.maxDiscoveryCount);

  const scope: DiscoveredPage[] = [];
  const offDomainRedirectsSkipped: { from: string; to: string }[] = [];
  const visited = new Set<string>();
  let truncatedAtMax = false;

  const startNorm = normalizeUrl(p.startUrl);
  // A start URL that is unparseable or off the approved domain yields an empty
  // scope rather than ever leaving the boundary.
  if (startNorm === null || !isApprovedDomain(startNorm, p.approvedDomain)) {
    return { scope, offDomainRedirectsSkipped, truncatedAtMax };
  }

  const queue: DiscoveredPage[] = [{ url: startNorm, depth: 0, discoveredFrom: "" }];
  visited.add(startNorm);

  const context = await browser.newContext();
  try {
    while (queue.length > 0) {
      if (scope.length >= maxCount) {
        truncatedAtMax = true;
        break;
      }
      const current = queue.shift() as DiscoveredPage;

      // Conservative pacing: sleep BEFORE each navigation (5.3, 12.6).
      await sleep(spacingMs);

      const page = await context.newPage();
      try {
        const resp = await page
          .goto(current.url, { waitUntil: "load", timeout: p.navTimeoutMs })
          .catch(() => null);

        // Off-domain redirect handling (5.8): compare the FINAL URL host. If the
        // navigation left the approved domain, exclude this target, keep every
        // page already discovered, and record {from, to}. Do not enqueue links
        // from an off-domain page.
        const finalUrl = normalizeUrl(page.url()) ?? current.url;
        if (!isApprovedDomain(finalUrl, p.approvedDomain)) {
          offDomainRedirectsSkipped.push({ from: current.discoveredFrom || current.url, to: finalUrl });
          continue;
        }

        // The page is same-domain and reachable: record it in the Full_Site_Scope.
        scope.push(current);

        // A failed navigation (null response) yields no links to follow, but the
        // page itself still counts as discovered on the approved domain.
        if (resp === null) continue;

        // Extract links via the DOM, resolve to absolute, normalize, dedupe, and
        // keep only same-approved-domain links.
        const hrefs = await page.$$eval("a[href]", (els) =>
          els.map((el) => (el as HTMLAnchorElement).getAttribute("href") ?? "").filter((h) => h.length > 0),
        );
        const candidates = sameDomainLinks(hrefs, finalUrl, p.approvedDomain);

        for (const link of candidates) {
          if (visited.has(link)) continue;
          // Respect the discovery bound: do not enqueue beyond what can fit.
          if (visited.size >= maxCount) {
            truncatedAtMax = true;
            break;
          }
          visited.add(link);
          queue.push({ url: link, depth: current.depth + 1, discoveredFrom: finalUrl });
        }
      } finally {
        await page.close();
      }
    }
  } finally {
    await context.close();
  }

  // If we exited the loop with a full scope and more was pending, mark truncated.
  if (scope.length >= maxCount && queue.length > 0) truncatedAtMax = true;

  return { scope, offDomainRedirectsSkipped, truncatedAtMax };
}
