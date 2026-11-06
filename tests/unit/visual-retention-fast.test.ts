import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { buildVisualItems } from "../../src/publish/visual.js";

// Task 7.6 (R16.8, R16.9, R17.1, R17.2): runs outside the image-retention window
// publish no images, so the publisher must not decode PNGs or verify baselines
// for them (that work dominated publish time).

function png(w: number, h: number, fill: number): PNG {
  const p = new PNG({ width: w, height: h });
  p.data.fill(fill);
  for (let i = 3; i < p.data.length; i += 4) p.data[i] = 255;
  return p;
}

function fixture(): { root: string; runDir: string; baselineRoot: string } {
  const root = mkdtempSync(join(tmpdir(), "awg-vfast-"));
  const runDir = join(root, "run");
  const baselineRoot = join(root, "baselines");
  mkdirSync(join(runDir, "screenshots"), { recursive: true });
  mkdirSync(join(baselineRoot, "home"), { recursive: true });
  mkdirSync(join(baselineRoot, "about"), { recursive: true });
  const base = png(8, 8, 10);
  const cur = png(8, 8, 200);
  const diff = new PNG({ width: 8, height: 8 });
  pixelmatch(base.data, cur.data, diff.data, 8, 8, { threshold: 0.1 });
  // "home": older run, no recorded visual entry (would need derive + pixelmatch).
  writeFileSync(join(baselineRoot, "home", "desktop.png"), PNG.sync.write(base));
  writeFileSync(join(runDir, "screenshots", "home.desktop.png"), PNG.sync.write(cur));
  writeFileSync(join(runDir, "screenshots", "home.desktop.diff.png"), PNG.sync.write(diff));
  // "about": recorded measure and hash.
  writeFileSync(join(baselineRoot, "about", "mobile.png"), PNG.sync.write(base));
  writeFileSync(join(runDir, "screenshots", "about.mobile.png"), PNG.sync.write(cur));
  writeFileSync(join(runDir, "screenshots", "about.mobile.diff.png"), PNG.sync.write(diff));
  writeFileSync(
    join(runDir, "results.json"),
    JSON.stringify({
      pages: [
        { slug: "home", page: "https://example.test/" },
        { slug: "about", page: "https://example.test/about" },
      ],
    }),
  );
  return { root, runDir, baselineRoot };
}

const recorded = {
  about: { mobile: { differs: true, diffPixels: 64, totalPixels: 64, diffRatio: 1, baselineHash: "0123456789abcdef" } },
};

describe("buildVisualItems outside the image-retention window", () => {
  let root = "";
  afterEach(() => {
    vi.restoreAllMocks();
    if (root) rmSync(root, { recursive: true, force: true });
    root = "";
  });

  it("does no PNG decode or baseline verification and records image-retention", () => {
    const fx = fixture();
    root = fx.root;
    const read = vi.spyOn(PNG.sync, "read");
    const { items, copies } = buildVisualItems({
      runDir: fx.runDir,
      runId: "run-old",
      findingsVisual: recorded,
      baselineRoot: fx.baselineRoot,
      images: false,
    });
    expect(read).not.toHaveBeenCalled();
    expect(items.map((i) => `${i.slug}.${i.viewport}`)).toEqual(["about.mobile", "home.desktop"]);
    for (const it of items) {
      expect(it.baseline).toEqual({ published: false, hash: null, approvedAt: null, sourceRunId: null, reason: "image-retention" });
      expect(it.images.baseline).toBeNull();
    }
    expect(copies.some((c) => c.role === "baseline")).toBe(false);
    // Recorded measure is still published; the derived one is skipped (needs a decode).
    expect(items[0].measure).toEqual({ diffPixels: 64, totalPixels: 64, diffRatio: 1, source: "recorded" });
    expect(items[1].measure).toBeNull();
  });

  it("still derives and verifies inside the window (default)", () => {
    const fx = fixture();
    root = fx.root;
    const read = vi.spyOn(PNG.sync, "read");
    const { items } = buildVisualItems({
      runDir: fx.runDir,
      runId: "run-new",
      findingsVisual: recorded,
      baselineRoot: fx.baselineRoot,
    });
    expect(read).toHaveBeenCalled();
    const home = items.find((i) => i.slug === "home")!;
    expect(home.measure?.source).toBe("derived-from-diff-image");
    expect(home.measure?.diffPixels).toBe(64);
    expect(home.baseline.published).toBe(true);
  });
});
