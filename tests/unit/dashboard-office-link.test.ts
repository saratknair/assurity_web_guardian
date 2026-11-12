import { describe, it, expect } from "vitest";
// @ts-expect-error plain browser ES module without type declarations
import { officeRunLink, officeFindingLink, officePageLink } from "../../dashboard/lib/office-link.js";
// @ts-expect-error plain browser ES module without type declarations
import { parseOfficeRoute } from "../../office/lib/route.js";

describe("dashboard office-link", () => {
  it("run link starts at t=0 and round-trips", () => {
    const link = officeRunLink("run 1/a");
    expect(link).toBe("./office/#/run/run%201%2Fa?t=0");
    expect(parseOfficeRoute(link.slice(link.indexOf("#")))).toEqual({ runId: "run 1/a", t: 0, station: null });
  });

  it("finding link uses producedAt t and station", () => {
    const link = officeFindingLink("r1", { producedAt: { entryId: "e", t: 1234.7, station: "review-desk" } });
    expect(link).toBe("./office/#/run/r1?t=1234&station=review-desk");
    expect(parseOfficeRoute(link.slice(link.indexOf("#")))).toEqual({ runId: "r1", t: 1234, station: "review-desk" });
  });

  it("finding link falls back to t=0 without station", () => {
    expect(officeFindingLink("r1", { producedAt: null })).toBe("./office/#/run/r1?t=0");
    expect(officeFindingLink("r1", { producedAt: { t: 5, station: "bogus" } })).toBe("./office/#/run/r1?t=5");
  });

  it("page link requires enriched run and finite replayT", () => {
    const run = { replay: { enriched: true, durationMs: 9000 } };
    expect(officePageLink("r1", { replayT: 400 }, run)).toBe("./office/#/run/r1?t=400");
    expect(officePageLink("r1", {}, run)).toBeNull();
    expect(officePageLink("r1", { replayT: 400 }, { replay: { enriched: false } })).toBeNull();
  });

  it("returns null for empty runId", () => {
    expect(officeRunLink("")).toBeNull();
    expect(officeFindingLink("  ", null)).toBeNull();
  });
});
