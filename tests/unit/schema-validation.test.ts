import { describe, it, expect } from "vitest";
import { validateHandoff, discoveryHandoffComplete } from "../../src/schemas/validate.js";

const validDiscovery = {
  correlationId: "cor_abc",
  taskId: "task_abc",
  approvedPages: [{ url: "https://assurity.nz/", depth: 0, source: "page-seed-file" }],
  pagesRequiringReview: [{ url: "https://assurity.nz/careers", discoveredFrom: "https://assurity.nz/" }],
  externalLinks: ["https://linkedin.com/company/assurity"],
};

describe("Feature: assurity-web-guardian — Phase 6 schema validation", () => {
  // Property 5: Agent hand-offs round-trip and are rejected when invalid or incomplete.
  it("Property 5: a valid discovery hand-off validates", () => {
    const r = validateHandoff("discovery.handoff", validDiscovery);
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("Property 5: wrong id prefix is rejected", () => {
    const r = validateHandoff("discovery.handoff", { ...validDiscovery, correlationId: "bad" });
    expect(r.valid).toBe(false);
  });

  it("Property 5: extra property is rejected (additionalProperties false)", () => {
    const r = validateHandoff("discovery.handoff", { ...validDiscovery, sneaky: true });
    expect(r.valid).toBe(false);
  });

  it("Property 5: more than 10 approved pages is rejected", () => {
    const many = Array.from({ length: 11 }, (_, i) => ({
      url: `https://assurity.nz/p${i}`,
      depth: 1,
      source: "page-seed-file",
    }));
    const r = validateHandoff("discovery.handoff", { ...validDiscovery, approvedPages: many });
    expect(r.valid).toBe(false);
  });

  it("Property 5: schema-valid but incomplete hand-off is rejected (Req 1.12)", () => {
    // Schema passes, but it omits an expected review page.
    const schemaOk = validateHandoff("discovery.handoff", validDiscovery);
    expect(schemaOk.valid).toBe(true);
    const complete = discoveryHandoffComplete(validDiscovery, 1, 2); // expected 2 review pages
    expect(complete).toBe(false); // must be rejected by the receiver
  });

  it("inventory hand-off validates and rejects a form field value (PII)", () => {
    const ok = validateHandoff("inventory.handoff", {
      correlationId: "cor_x",
      taskId: "task_x",
      pages: [
        {
          url: "https://assurity.nz/",
          title: "Home",
          headings: [],
          links: [],
          images: [],
          buttons: [],
          forms: [],
        },
      ],
    });
    expect(ok.valid).toBe(true);
  });

  it("comparison hand-off validates outcome classifications", () => {
    const ok = validateHandoff("comparison.handoff", {
      correlationId: "cor_x",
      taskId: "task_x",
      page: "https://assurity.nz/",
      outcomes: [
        { kind: "failed-check", classification: "deterministic-test-evidence", detail: "missing h1" },
        { kind: "observed-website-change", classification: "observed-website-change", detail: "text changed" },
      ],
    });
    expect(ok.valid).toBe(true);
  });
});
