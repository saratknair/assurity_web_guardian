import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { isApprovedDomain, isExternal } from "../../src/safety/domain-guard.js";
import { looksLikePii, GuardedPage } from "../../src/safety/form-guard.js";

const APPROVED = "assurity.nz";

describe("Feature: assurity-web-guardian — Phase 3 safety", () => {
  // Property 2: Requests never leave the approved domain.
  it("Property 2: off-domain URLs are always external and never approved", () => {
    fc.assert(
      fc.property(fc.webUrl(), (url) => {
        const host = new URL(url).hostname.toLowerCase();
        const approved = host === APPROVED || host.endsWith("." + APPROVED);
        expect(isApprovedDomain(url, APPROVED)).toBe(approved);
        expect(isExternal(url, APPROVED)).toBe(!approved);
      }),
      { numRuns: 200 },
    );
  });

  it("Property 2: known hosts classify correctly", () => {
    expect(isApprovedDomain("https://assurity.nz/", APPROVED)).toBe(true);
    expect(isApprovedDomain("https://www.assurity.nz/x", APPROVED)).toBe(true);
    expect(isApprovedDomain("https://evil.com/assurity.nz", APPROVED)).toBe(false);
    expect(isApprovedDomain("https://assurity.nz.evil.com/", APPROVED)).toBe(false);
    expect(isExternal("https://linkedin.com/company", APPROVED)).toBe(true);
  });

  // Form / PII guard (Req 11.3, 11.4).
  it("blocks PII-named fields and PII-shaped values", () => {
    expect(looksLikePii("email", "whatever")).toBe(true);
    expect(looksLikePii("fullName", "x")).toBe(true);
    expect(looksLikePii("q", "jane@example.com")).toBe(true);
    expect(looksLikePii("q", "+64 21 123 4567")).toBe(true);
    expect(looksLikePii("search", "hello world")).toBe(false);
  });

  it("GuardedPage.submit is always blocked", async () => {
    const audits: unknown[] = [];
    const gp = new GuardedPage({} as never, { audit: (e) => audits.push(e) });
    await expect(gp.submit()).rejects.toThrow(/blocked/i);
    expect(audits.length).toBe(1);
  });

  it("GuardedPage.fill blocks PII and audits", async () => {
    const audits: unknown[] = [];
    const gp = new GuardedPage({} as never, { audit: (e) => audits.push(e) });
    await expect(gp.fill("email", "x")).rejects.toThrow(/personal information/i);
    expect(audits.length).toBe(1);
  });
});
