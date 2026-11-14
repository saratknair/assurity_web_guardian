import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDashboardData } from "../../src/reporting/dashboard-data.js";

describe("buildDashboardData domain", () => {
  it("reports the domain it is given", () => {
    const dir = mkdtempSync(join(tmpdir(), "awg-dd-"));
    try {
      const data = buildDashboardData(join(dir, "runs"), join(dir, "history.json"), "example.com");
      expect(data.domain).toBe("example.com");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
