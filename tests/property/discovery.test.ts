import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { buildDiscovery } from "../../src/agents/discovery-agent.js";
import type { AppConfig, PageSeedFile } from "../../src/config/app-config.js";

const cfg = {
  approvedDomain: "assurity.nz",
  baseUrl: "https://assurity.nz",
  seedFilePath: "config/page-seed.json",
  limits: { pages: 10, crawlDepth: 2, concurrency: 1, requestSpacingMs: 1000, retries: 2, navTimeoutMs: 30000, runTimeoutMs: 600000 },
  retention: { maxRuns: 50, maxAgeDays: 30 },
  viewports: { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } },
} as AppConfig;

describe("Feature: assurity-web-guardian — Phase 7 discovery", () => {
  // Property 1: Discovery never expands the approved scope.
  it("Property 1: approved pages are a subset of the seed and never exceed the limit", () => {
    fc.assert(
      fc.property(
        fc.array(fc.webUrl(), { maxLength: 30 }),
        (hrefs) => {
          const seed: PageSeedFile = { maxUrls: 10, approvedUrls: ["https://assurity.nz/"] };
          const handoff = buildDiscovery(cfg, seed, "cor_x", { "https://assurity.nz/": hrefs });
          // Approved set is exactly the (same-domain) seed, never grown by crawl.
          expect(handoff.approvedPages.length).toBeLessThanOrEqual(cfg.limits.pages);
          expect(handoff.approvedPages.every((p) => seed.approvedUrls.includes(p.url))).toBe(true);
          // No crawled href ever appears in approvedPages.
          const approvedUrls = new Set(handoff.approvedPages.map((p) => p.url));
          for (const href of hrefs) {
            if (!seed.approvedUrls.includes(href)) {
              expect(approvedUrls.has(href)).toBe(false);
            }
          }
        },
      ),
      { numRuns: 150 },
    );
  });

  it("same-domain non-seed links go to pagesRequiringReview; external to externalLinks", () => {
    const seed: PageSeedFile = { maxUrls: 10, approvedUrls: ["https://assurity.nz/"] };
    const handoff = buildDiscovery(cfg, seed, "cor_x", {
      "https://assurity.nz/": [
        "https://assurity.nz/careers",
        "https://assurity.nz/about",
        "https://linkedin.com/company/assurity",
      ],
    });
    const reviewUrls = handoff.pagesRequiringReview.map((p) => p.url);
    expect(reviewUrls).toContain("https://assurity.nz/careers");
    expect(reviewUrls).toContain("https://assurity.nz/about");
    expect(handoff.externalLinks).toContain("https://linkedin.com/company/assurity");
    // External link never navigated/approved.
    expect(handoff.approvedPages.map((p) => p.url)).not.toContain("https://linkedin.com/company/assurity");
  });

  it("caps approved pages at the configured limit", () => {
    const urls = Array.from({ length: 15 }, (_, i) => `https://assurity.nz/p${i}`);
    const seed: PageSeedFile = { maxUrls: 20, approvedUrls: urls };
    const handoff = buildDiscovery(cfg, seed, "cor_x");
    expect(handoff.approvedPages.length).toBe(10);
  });
});
