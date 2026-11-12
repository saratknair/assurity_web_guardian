import { afterAll, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publish } from "../../src/publish/publisher.js";
import { readLocalDashboardFile } from "../../src/admin/local-dashboard.js";

// Task 11.3 (R17.1, R17.4): the local publish stages office/ next to data/.

describe("publisher stages the Virtual Office", () => {
  const root = mkdtempSync(join(tmpdir(), "awg-puboffice-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("copies office/ recursively beside data/ and serves it at /local-dashboard/office/", async () => {
    const runsRoot = join(root, "runs");
    mkdirSync(runsRoot, { recursive: true });
    const outDir = join(root, "published");
    const r = await publish({ runsRoot, outDir });
    expect(r.ok).toBe(true);
    for (const f of [
      "office/index.html",
      "office/lib/data.js",
      "office/views/inspector.js",
      "office/diorama/scene.js",
      "office/vendor/three.module.min.js",
    ]) {
      expect(existsSync(join(outDir, f)), f).toBe(true);
    }
    expect(existsSync(join(outDir, "data", "index.json"))).toBe(true);
    const page = readLocalDashboardFile("/local-dashboard/office/", outDir);
    expect(page.status).toBe(200);
    expect(page.contentType).toContain("text/html");
    const js = readLocalDashboardFile("/local-dashboard/office/lib/data.js", outDir);
    expect(js.contentType).toContain("text/javascript");
    expect(readLocalDashboardFile("/local-dashboard/office/office.css", outDir).contentType).toContain("text/css");
  });
});
