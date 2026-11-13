import { describe, it, expect } from "vitest";
// @ts-expect-error plain browser ES module without type declarations
import { formatLocalDateTime } from "../../office/lib/format.js";
// @ts-expect-error plain browser ES module without type declarations
import { formatDateTime } from "../../dashboard/views/common.js";
// @ts-expect-error plain browser ES module without type declarations
import { formatRunDate } from "../../dashboard/views/charts.js";
// @ts-expect-error plain browser ES module without type declarations
import { formatRunDate as captionDate } from "../../dashboard/lib/captions.js";

const ISO = "2026-11-12T23:00:00Z";

describe("local time formatting (Requirements 19.1, 18.7)", () => {
  it("Office helper shows 13 Nov in Pacific/Auckland with a zone label", () => {
    expect(formatLocalDateTime(ISO, "Pacific/Auckland")).toMatch(/^2026-11-13 12:00 \S+$/);
  });

  it("Office helper shows UTC", () => {
    expect(formatLocalDateTime(ISO, "UTC")).toBe("2026-11-12 23:00 UTC");
  });

  it("Office helper handles invalid input", () => {
    expect(formatLocalDateTime("nope", "UTC")).toBe("date not recorded");
    expect(formatLocalDateTime(undefined, "UTC")).toBe("date not recorded");
  });

  it("Dashboard formatDateTime matches in both zones and handles invalid input", () => {
    expect(formatDateTime(ISO, "Pacific/Auckland")).toMatch(/^2026-11-13 12:00 \S+$/);
    expect(formatDateTime(ISO, "UTC")).toBe("2026-11-12 23:00 UTC");
    expect(formatDateTime("nope", "UTC")).toBe("Date not recorded");
    expect(formatDateTime(null, "UTC")).toBe("Date not recorded");
  });

  it("chart run dates and caption dates use local time", () => {
    expect(formatRunDate(ISO, "Pacific/Auckland")).toMatch(/^2026-11-13 12:00 \S+$/);
    expect(captionDate(ISO, "Pacific/Auckland")).toMatch(/^13 Nov 2026 12:00 \S+$/);
    expect(captionDate(ISO, "UTC")).toBe("12 Nov 2026 23:00 UTC");
    expect(captionDate("nope", "UTC")).toBe("Run not recorded");
  });
});
