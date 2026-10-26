import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

/**
 * Visual comparison (Phase 2, Req 27). Compares a current screenshot against an
 * approved screenshot baseline and produces a diff image + metadata. NEVER
 * auto-fails on pixel percentage; NEVER auto-updates the baseline. When no
 * baseline exists yet, the current shot is recorded as the proposed baseline
 * (requires human approval) and no diff is produced.
 */
export interface VisualResult {
  slug: string;
  viewport: string;
  baselinePath: string | null;
  currentPath: string;
  diffPath: string | null;
  differs: boolean;
  diffPixels: number;
  totalPixels: number;
  diffRatio: number;
  note: string;
}

const SCREENSHOT_BASELINE_ROOT = "baselines-visual";

export function visualBaselinePath(slug: string, viewport: string): string {
  return resolve(SCREENSHOT_BASELINE_ROOT, slug, `${viewport}.png`);
}

export function compareScreenshot(
  slug: string,
  viewport: string,
  currentPath: string,
  runDir: string,
): VisualResult {
  const baselinePath = visualBaselinePath(slug, viewport);
  const result: VisualResult = {
    slug,
    viewport,
    baselinePath: null,
    currentPath,
    diffPath: null,
    differs: false,
    diffPixels: 0,
    totalPixels: 0,
    diffRatio: 0,
    note: "",
  };

  if (!existsSync(baselinePath)) {
    // No approved visual baseline yet. Propose the current shot for human
    // approval; do not auto-adopt it as a baseline.
    const proposedDir = join(runDir, "proposed-visual-baselines", slug);
    mkdirSync(proposedDir, { recursive: true });
    const proposed = join(proposedDir, `${viewport}.png`);
    writeFileSync(proposed, readFileSync(currentPath));
    result.note = "No approved visual baseline; current screenshot proposed for human approval.";
    return result;
  }

  result.baselinePath = baselinePath;
  const baseImg = PNG.sync.read(readFileSync(baselinePath));
  const curImg = PNG.sync.read(readFileSync(currentPath));

  // If dimensions differ, that itself is a visual difference requiring review.
  if (baseImg.width !== curImg.width || baseImg.height !== curImg.height) {
    result.differs = true;
    result.note = `Dimensions changed: baseline ${baseImg.width}x${baseImg.height} vs current ${curImg.width}x${curImg.height}.`;
    return result;
  }

  const { width, height } = baseImg;
  const diff = new PNG({ width, height });
  const diffPixels = pixelmatch(baseImg.data, curImg.data, diff.data, width, height, { threshold: 0.1 });
  const diffPath = join(runDir, "screenshots", `${slug}.${viewport}.diff.png`);
  mkdirSync(dirname(diffPath), { recursive: true });
  writeFileSync(diffPath, PNG.sync.write(diff));

  result.diffPath = diffPath;
  result.diffPixels = diffPixels;
  result.totalPixels = width * height;
  result.diffRatio = result.totalPixels ? diffPixels / result.totalPixels : 0;
  result.differs = diffPixels > 0;
  result.note = result.differs
    ? `Visual difference detected (${diffPixels} px, ${(result.diffRatio * 100).toFixed(3)}%). Requires human review; run is NOT auto-failed on pixel percentage.`
    : "No visual difference.";
  return result;
}
