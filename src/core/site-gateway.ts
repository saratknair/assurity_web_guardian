import type { Page } from "@playwright/test";
import type { AppConfig } from "../config/app-config.js";

/**
 * SiteGateway (Phase 2 minimal): the single choke point for application-owned
 * Playwright navigation. Enforces the approved-domain boundary and the
 * navigation timeout. Rate limiter / retry / form guards arrive in Phase 3.
 *
 * NOTE: This gateway governs APPLICATION-OWNED Playwright activity only.
 * It does not and cannot intercept Playwright MCP browser traffic.
 */
export class DomainBoundaryError extends Error {
  constructor(url: string, approvedDomain: string) {
    super(`Blocked navigation outside approved domain: ${url} (approved: ${approvedDomain})`);
    this.name = "DomainBoundaryError";
  }
}

export class SiteGateway {
  constructor(private readonly cfg: AppConfig) {}

  /** Returns true when the URL host is the approved domain or a subdomain of it. */
  isApprovedDomain(url: string): boolean {
    let host: string;
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      return false;
    }
    const approved = this.cfg.approvedDomain.toLowerCase();
    return host === approved || host.endsWith("." + approved);
  }

  isExternal(url: string): boolean {
    return !this.isApprovedDomain(url);
  }

  /** Throws DomainBoundaryError if the URL leaves the approved domain. */
  guardUrl(url: string): URL {
    if (!this.isApprovedDomain(url)) {
      throw new DomainBoundaryError(url, this.cfg.approvedDomain);
    }
    return new URL(url);
  }

  /** Navigates a Playwright page to a guarded URL with the configured timeout. */
  async navigate(page: Page, url: string): Promise<void> {
    this.guardUrl(url);
    await page.goto(url, {
      waitUntil: "load",
      timeout: this.cfg.limits.navTimeoutMs,
    });
  }
}
