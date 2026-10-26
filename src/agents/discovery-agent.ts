import type { AppConfig, PageSeedFile } from "../config/app-config.js";
import { isApprovedDomain, isExternal } from "../safety/domain-guard.js";
import { newTaskId } from "../core/ids.js";

export interface DiscoveredPage {
  url: string;
  depth: number;
  source: "page-seed-file";
}
export interface ReviewPage {
  url: string;
  discoveredFrom: string;
}
export interface DiscoveryHandoff {
  correlationId: string;
  taskId: string;
  approvedPages: DiscoveredPage[];
  pagesRequiringReview: ReviewPage[];
  externalLinks: string[];
}

/**
 * Discovery_Agent (Req 1, 13, 30-31). Deterministic crawler component.
 * Approved scope comes ONLY from the Page_Seed_File. Same-domain pages not in
 * the seed are listed for human review (never auto-added). External links are
 * recorded but never navigated.
 *
 * `linksByPage` maps an approved page URL to the hrefs found on it (collected
 * by a read-only Playwright pass). This function performs no navigation itself,
 * keeping it deterministic and unit-testable.
 */
export function buildDiscovery(
  cfg: AppConfig,
  seed: PageSeedFile,
  correlationId: string,
  linksByPage: Record<string, string[]> = {},
): DiscoveryHandoff {
  const approved: DiscoveredPage[] = seed.approvedUrls
    .filter((u) => isApprovedDomain(u, cfg.approvedDomain))
    .slice(0, cfg.limits.pages)
    .map((url) => ({ url, depth: 0, source: "page-seed-file" as const }));

  const approvedSet = new Set(approved.map((p) => p.url.replace(/#.*$/, "")));
  const reviewSet = new Map<string, string>();
  const external = new Set<string>();

  for (const [fromUrl, hrefs] of Object.entries(linksByPage)) {
    for (const href of hrefs) {
      const norm = href.replace(/#.*$/, "");
      if (isExternal(norm, cfg.approvedDomain)) {
        external.add(norm);
        continue;
      }
      // Same-domain and not already approved => requires human review.
      if (!approvedSet.has(norm) && !reviewSet.has(norm)) {
        reviewSet.set(norm, fromUrl);
      }
    }
  }

  return {
    correlationId,
    taskId: newTaskId(),
    approvedPages: approved,
    pagesRequiringReview: [...reviewSet].map(([url, discoveredFrom]) => ({ url, discoveredFrom })),
    externalLinks: [...external],
  };
}
