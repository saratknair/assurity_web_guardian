// Unit tests for the site size gate (task 13.1).
// Validates: Requirements 16.8, 17.6, 17.7
import { describe, it, expect } from "vitest";
import {
  evaluateSizes,
  OFFICE_LIMIT_BYTES,
  EVENTS_LIMIT_BYTES,
  // @ts-expect-error plain .mjs module without type declarations
} from "../../scripts/check-site-sizes.mjs";

describe("evaluateSizes", () => {
  it("passes at exactly the limits", () => {
    const r = evaluateSizes({
      officeFiles: [{ path: "office/a.js", bytes: OFFICE_LIMIT_BYTES }],
      eventFiles: [{ path: "data/runs/r1/events.json", bytes: EVENTS_LIMIT_BYTES }],
    });
    expect(r.ok).toBe(true);
    expect(r.problems).toEqual([]);
  });

  it("names the largest office file when the total is over", () => {
    const r = evaluateSizes({
      officeFiles: [
        { path: "office/vendor/three.module.min.js", bytes: 1500000 },
        { path: "office/app.js", bytes: 100000 },
      ],
      eventFiles: [],
    });
    expect(r.ok).toBe(false);
    expect(r.office.largest.path).toBe("office/vendor/three.module.min.js");
    expect(r.problems[0].path).toBe("office/vendor/three.module.min.js");
  });

  it("reports each oversize events file by path", () => {
    const r = evaluateSizes({
      officeFiles: [],
      eventFiles: [
        { path: "data/runs/a/events.json", bytes: EVENTS_LIMIT_BYTES + 1 },
        { path: "data/runs/b/events.json", bytes: 10 },
        { path: "data/runs/c/events.json", bytes: EVENTS_LIMIT_BYTES + 5 },
      ],
    });
    expect(r.ok).toBe(false);
    expect(r.oversizeEvents.map((e: { path: string }) => e.path)).toEqual([
      "data/runs/a/events.json",
      "data/runs/c/events.json",
    ]);
  });

  it("never throws on bad input", () => {
    expect(evaluateSizes(undefined).ok).toBe(true);
    expect(evaluateSizes({ officeFiles: "x", eventFiles: [null, { path: 1 }] }).ok).toBe(true);
  });
});
