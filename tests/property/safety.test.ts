import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { isApprovedDomain, isExternal } from "../../src/safety/domain-guard.js";
import { RateLimiter, type Clock } from "../../src/core/rate-limiter.js";
import { RetryPolicy } from "../../src/core/retry-policy.js";
import { looksLikePii, GuardedPage } from "../../src/safety/form-guard.js";

const APPROVED = "assurity.nz";

// Deterministic fake clock for timing properties.
function fakeClock(): Clock & { ms: number } {
  const c = {
    ms: 0,
    now() {
      return c.ms;
    },
    async sleep(ms: number) {
      c.ms += ms;
    },
  };
  return c;
}

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

  // Property 3: Request spacing and concurrency honour the configured limits.
  it("Property 3: consecutive acquisitions are spaced >= spacingMs (concurrency 1)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 2000 }),
        fc.integer({ min: 2, max: 8 }),
        async (spacing, n) => {
          const clock = fakeClock();
          const rl = new RateLimiter(spacing, 1, clock);
          const starts: number[] = [];
          for (let i = 0; i < n; i++) {
            const release = await rl.acquire();
            starts.push(clock.now());
            release();
          }
          for (let i = 1; i < starts.length; i++) {
            expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(spacing);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("Property 3: never more than `concurrency` in flight", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 4 }), async (concurrency) => {
        const rl = new RateLimiter(0, concurrency);
        let inFlight = 0;
        let maxSeen = 0;
        await Promise.all(
          Array.from({ length: 12 }, () =>
            rl.acquire().then(async (release) => {
              inFlight++;
              maxSeen = Math.max(maxSeen, inFlight);
              await new Promise((r) => setTimeout(r, 1));
              inFlight--;
              release();
            }),
          ),
        );
        expect(maxSeen).toBeLessThanOrEqual(concurrency);
      }),
      { numRuns: 30 },
    );
  });

  // Property 4: Transient failures are retried within the configured bound.
  it("Property 4: total attempts never exceed retries + 1", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 5 }), async (retries) => {
        const clock = fakeClock();
        const rp = new RetryPolicy(retries, 10, clock);
        let attempts = 0;
        await expect(
          rp.run(
            async () => {
              attempts++;
              throw new Error("transient");
            },
            () => true,
          ),
        ).rejects.toThrow();
        expect(attempts).toBe(retries + 1);
      }),
      { numRuns: 50 },
    );
  });

  it("Property 4: non-transient errors are not retried", async () => {
    const rp = new RetryPolicy(3, 10, fakeClock());
    let attempts = 0;
    await expect(
      rp.run(
        async () => {
          attempts++;
          throw new Error("fatal");
        },
        () => false,
      ),
    ).rejects.toThrow();
    expect(attempts).toBe(1);
  });

  it("Property 4: success stops further attempts", async () => {
    const rp = new RetryPolicy(5, 10, fakeClock());
    let attempts = 0;
    const result = await rp.run(
      async () => {
        attempts++;
        if (attempts < 3) throw new Error("transient");
        return "ok";
      },
      () => true,
    );
    expect(result).toBe("ok");
    expect(attempts).toBe(3);
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
