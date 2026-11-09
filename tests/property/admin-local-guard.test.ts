// Feature: dashboard-usability-overhaul, Property 41: Only same-origin loopback requests may change decisions
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { checkLocalRequest, type LocalRequestHeaders } from "../../src/admin/local-guard.js";

const portArb = fc.integer({ min: 1, max: 65535 });

function hostArb(port: number): fc.Arbitrary<string | undefined> {
  return fc.oneof(
    fc.constantFrom(`127.0.0.1:${port}`, `localhost:${port}`, `LocalHost:${port}`),
    fc.constantFrom(
      `127.0.0.1:${port + 1}`,
      `localhost:${port + 1}`,
      "127.0.0.1",
      "localhost",
      `evil.example:${port}`,
      `127.0.0.1.evil.example:${port}`,
      `[::1]:${port}`,
      `0.0.0.0:${port}`,
      "",
    ),
    fc.string({ maxLength: 20 }),
    fc.constant(undefined),
  );
}

function originArb(port: number): fc.Arbitrary<string | undefined> {
  return fc.oneof(
    fc.constant(undefined),
    fc.constantFrom(`http://127.0.0.1:${port}`, `http://localhost:${port}`, `HTTP://LOCALHOST:${port}`),
    fc.constantFrom(
      `https://127.0.0.1:${port}`,
      `http://127.0.0.1:${port + 1}`,
      `http://127.0.0.1:${port}/`,
      "null",
      "http://evil.example",
      "",
    ),
    fc.string({ maxLength: 20 }),
  );
}

const fetchSiteArb = fc.oneof(
  fc.constant(undefined),
  fc.constantFrom("same-origin", "none", "cross-site", "same-site", "Cross-Site", " same-site ", "SAME-SITE"),
  fc.string({ maxLength: 12 }),
);

const contentTypeArb = fc.oneof(
  fc.constant(undefined),
  fc.constantFrom(
    "application/json",
    "Application/JSON",
    "application/json; charset=utf-8",
    " application/json ;charset=x",
    "text/plain",
    "application/x-www-form-urlencoded",
    "multipart/form-data; boundary=x",
    "application/jsonx",
    "",
  ),
  fc.string({ maxLength: 20 }),
);

/** Independent statement of the property's accept-iff rule. */
function expected(h: LocalRequestHeaders, port: number): boolean {
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  const hostOk = typeof h.host === "string" && hosts.includes(h.host.toLowerCase());
  const originOk =
    h.origin === undefined || hosts.map((x) => `http://${x}`).includes(h.origin.toLowerCase());
  const site = h.secFetchSite === undefined ? "" : h.secFetchSite.trim().toLowerCase();
  const siteOk = site !== "cross-site" && site !== "same-site";
  const mime = h.contentType === undefined ? undefined : (h.contentType.split(";")[0] ?? "").trim().toLowerCase();
  return hostOk && originOk && siteOk && mime === "application/json";
}

describe("Feature: dashboard-usability-overhaul, Property 41: Only same-origin loopback requests may change decisions", () => {
  it("**Property 41** accepts iff host, origin, sec-fetch-site and content-type all satisfy the rule", () => {
    fc.assert(
      fc.property(
        portArb.chain((port) =>
          fc.record({
            port: fc.constant(port),
            host: hostArb(port),
            origin: originArb(port),
            secFetchSite: fetchSiteArb,
            contentType: contentTypeArb,
          }),
        ),
        ({ port, host, origin, secFetchSite, contentType }) => {
          const h: LocalRequestHeaders = { host, origin, secFetchSite, contentType };
          const snapshot = JSON.stringify(h);
          const r = checkLocalRequest(h, port);
          expect(r.ok).toBe(expected(h, port));
          if (!r.ok) expect(r.reason.length).toBeGreaterThan(0);
          // The guard is pure: it never mutates its input.
          expect(JSON.stringify(h)).toBe(snapshot);
        },
      ),
      { numRuns: 500 },
    );
  });

  it("**Property 41** accepts a fully valid request for any port", () => {
    fc.assert(
      fc.property(portArb, fc.constantFrom("127.0.0.1", "localhost"), (port, name) => {
        const r = checkLocalRequest(
          { host: `${name}:${port}`, origin: `http://${name}:${port}`, contentType: "application/json", secFetchSite: "same-origin" },
          port,
        );
        expect(r.ok).toBe(true);
      }),
      { numRuns: 200 },
    );
  });
});
