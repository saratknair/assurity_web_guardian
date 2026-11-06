import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { findingId } from "../core/finding-model.js";

/**
 * Visual publishing (dashboard-usability-overhaul, task 4.2; R4, R5).
 *
 * Pure with respect to the output tree: this module only READS from the run
 * directory and the baseline root. It returns the items for `visual.json`
 * plus the list of image copies to make (`copies`), so the caller (the size
 * budget in task 7.2) decides which copies actually happen. Items initially
 * reference every image that exists; after budgeting the caller should pass the
 * dropped files to `applyDroppedImages` to null them with a reason.
 */

export type Viewport = "desktop" | "mobile";
export type MeasureSource = "recorded" | "derived-from-diff-image";
export type BaselineReason =
  | "no-baseline-file"
  | "baseline-changed-since-run"
  | "image-cap"
  | "run-cap"
  | "image-retention";

export interface RecordedVisual {
  differs?: boolean;
  diffPixels?: number;
  totalPixels?: number;
  diffRatio?: number;
  dimensionsChanged?: boolean;
  baselineHash?: string | null;
  note?: string;
}

export interface VisualMeasure {
  diffPixels: number;
  totalPixels: number;
  diffRatio: number;
  source: MeasureSource;
}

export interface VisualItem {
  id: string; // vis_<findingId without prefix>
  findingId: string; // vf_...
  pageUrl: string;
  slug: string;
  viewport: Viewport;
  differs: true;
  dimensionsChanged: boolean;
  measure: VisualMeasure | null;
  images: { baseline: string | null; current: string | null; diff: string | null };
  baseline: {
    published: boolean;
    hash: string | null;
    approvedAt: null;
    sourceRunId: null;
    reason: BaselineReason | null;
  };
  suppressed: boolean;
  suppressedBy: string[];
  diffLegend: string;
}

export interface ImageCopy {
  /** Absolute source path. */
  src: string;
  /** Path relative to the published run directory (matches `images.*`). */
  dest: string;
  role: "baseline" | "current" | "diff";
  bytes: number;
  slug: string;
  viewport: Viewport;
}

export interface VisualBuildResult {
  items: VisualItem[];
  copies: ImageCopy[];
}

export const DIFF_LEGEND =
  "red = changed pixels; yellow = anti-aliasing differences ignored; faded grey = unchanged";

const SLUG_RE = /^[A-Za-z0-9._-]+$/;

export function defaultBaselineRoot(): string {
  const env = process.env.AWG_VISUAL_BASELINES;
  return resolve(env && env.trim() ? env : "baselines-visual");
}

/**
 * Count pixels exactly equal to pixelmatch's default diffColor (255, 0, 0, 255).
 * pixelmatch draws counted differences in that colour, anti-aliased pixels in
 * yellow (255, 255, 0) and unchanged pixels as grey blended with white (r=g=b),
 * so neither of the latter can match. The count therefore equals pixelmatch's
 * return value (which excludes anti-aliased pixels).
 */
export function deriveDiffMeasure(diffPng: Buffer): { diffPixels: number; totalPixels: number; diffRatio: number } {
  const png = PNG.sync.read(diffPng);
  const d = png.data;
  let diffPixels = 0;
  for (let i = 0; i + 3 < d.length; i += 4) {
    if (d[i] === 255 && d[i + 1] === 0 && d[i + 2] === 0 && d[i + 3] === 255) diffPixels++;
  }
  const totalPixels = png.width * png.height;
  return { diffPixels, totalPixels, diffRatio: totalPixels ? diffPixels / totalPixels : 0 };
}

function hash16(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 16);
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function fileBytes(path: string): number | null {
  try {
    const st = statSync(path);
    return st.isFile() ? st.size : null;
  } catch {
    return null;
  }
}

function pageUrlsBySlug(runDir: string): Map<string, string> {
  const out = new Map<string, string>();
  const results = readJson(join(runDir, "results.json"));
  const findings = readJson(join(runDir, "findings.json"));
  for (const doc of [results, findings]) {
    const pages = isObj(doc) && Array.isArray(doc.pages) ? doc.pages : [];
    for (const p of pages) {
      if (!isObj(p) || typeof p.slug !== "string") continue;
      const url = typeof p.page === "string" ? p.page : typeof p.url === "string" ? p.url : null;
      if (url && !out.has(p.slug)) out.set(p.slug, url);
    }
  }
  return out;
}

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/**
 * Older runs (no recorded baselineHash): the baseline is trusted only when
 * re-running pixelmatch(baselineNow, currentRunShot) reproduces the derived count.
 */
function baselineReproducesDiff(baselineBytes: Buffer, currentPath: string, expectedDiffPixels: number): boolean {
  try {
    if (!existsSync(currentPath)) return false;
    const base = PNG.sync.read(baselineBytes);
    const cur = PNG.sync.read(readFileSync(currentPath));
    if (base.width !== cur.width || base.height !== cur.height) return false;
    return pixelmatch(base.data, cur.data, null, base.width, base.height, { threshold: 0.1 }) === expectedDiffPixels;
  } catch {
    return false;
  }
}

export function buildVisualItems(args: {
  runDir: string;
  runId: string;
  findingsVisual: Record<string, Record<string, RecordedVisual>> | undefined;
  /** env AWG_VISUAL_BASELINES, default "baselines-visual" */
  baselineRoot?: string;
  /** Optional suppression info keyed `${slug}.${viewport}` (from run-findings). */
  suppressedBy?: Map<string, string[]> | Record<string, string[]>;
  /**
   * False when the run is outside the image-retention window: images are not
   * published, so PNG decode (derived measure) and baseline verification
   * (hashing, pixelmatch) are skipped. Default true.
   */
  images?: boolean;
}): VisualBuildResult {
  const withImages = args.images !== false;
  const { runDir, runId } = args;
  const baselineRoot = resolve(args.baselineRoot ?? defaultBaselineRoot());
  const recorded = args.findingsVisual ?? {};
  const urls = pageUrlsBySlug(runDir);
  const suppression = (k: string): string[] => {
    const s = args.suppressedBy;
    const v = s instanceof Map ? s.get(k) : s ? s[k] : undefined;
    return Array.isArray(v) ? [...v].sort() : [];
  };

  // Candidate pairs: recorded differs:true, plus diff images on disk for pairs
  // with no recorded entry (older runs).
  const pairs = new Map<string, { slug: string; viewport: Viewport }>();
  for (const [slug, byVp] of Object.entries(recorded)) {
    if (!SLUG_RE.test(slug) || !isObj(byVp)) continue;
    for (const vp of ["desktop", "mobile"] as const) {
      const r = (byVp as Record<string, RecordedVisual>)[vp];
      if (isObj(r) && r.differs === true) pairs.set(`${slug}.${vp}`, { slug, viewport: vp });
    }
  }
  const shotDir = join(runDir, "screenshots");
  let shotFiles: string[] = [];
  try {
    shotFiles = readdirSync(shotDir);
  } catch {
    shotFiles = [];
  }
  for (const f of shotFiles) {
    const m = /^(.*)\.(desktop|mobile)\.diff\.png$/.exec(f);
    if (!m || !SLUG_RE.test(m[1])) continue;
    const vp = m[2] as Viewport;
    const rec = recorded[m[1]]?.[vp];
    if (isObj(rec) && rec.differs === false) continue; // recorded says no difference
    pairs.set(`${m[1]}.${vp}`, { slug: m[1], viewport: vp });
  }

  const items: VisualItem[] = [];
  const copies: ImageCopy[] = [];

  for (const [viewKey, { slug, viewport }] of [...pairs].sort((a, b) => a[0].localeCompare(b[0]))) {
    const pageUrl = urls.get(slug);
    if (!pageUrl) continue; // cannot form the finding key; run-findings would not emit a Finding either
    const fid = findingId(runId, `${pageUrl}|${viewport}|visual-diff`, "visual");
    const rec = isObj(recorded[slug]?.[viewport]) ? recorded[slug][viewport] : undefined;
    const dimensionsChanged = rec?.dimensionsChanged === true;

    const diffName = `${slug}.${viewport}.diff.png`;
    const curName = `${slug}.${viewport}.png`;
    const diffSrc = join(shotDir, diffName);
    const curSrc = join(shotDir, curName);
    const diffBytes = fileBytes(diffSrc);
    const curBytes = fileBytes(curSrc);

    // ---- measure ----
    let measure: VisualMeasure | null = null;
    if (rec && !dimensionsChanged && finite(rec.diffPixels) && finite(rec.totalPixels) && rec.totalPixels > 0) {
      measure = {
        diffPixels: rec.diffPixels,
        totalPixels: rec.totalPixels,
        diffRatio: finite(rec.diffRatio) ? rec.diffRatio : rec.diffPixels / rec.totalPixels,
        source: "recorded",
      };
    } else if (withImages && !rec && diffBytes !== null) {
      try {
        measure = { ...deriveDiffMeasure(readFileSync(diffSrc)), source: "derived-from-diff-image" };
      } catch {
        measure = null;
      }
    }

    // ---- baseline ----
    const baselineSrc = join(baselineRoot, slug, `${viewport}.png`);
    const baselineBytes = fileBytes(baselineSrc);
    let baselineOk = false;
    let baselineHash: string | null = null;
    let reason: BaselineReason | null = null;
    if (baselineBytes === null) {
      reason = "no-baseline-file";
    } else if (!withImages) {
      reason = "image-retention";
    } else {
      const buf = readFileSync(baselineSrc);
      baselineHash = hash16(buf);
      const recordedHash = typeof rec?.baselineHash === "string" && rec.baselineHash ? rec.baselineHash : null;
      if (recordedHash) {
        baselineOk = recordedHash === baselineHash;
        baselineHash = recordedHash === baselineHash ? baselineHash : null;
      } else if (measure && measure.source === "derived-from-diff-image") {
        baselineOk = baselineReproducesDiff(buf, curSrc, measure.diffPixels);
        if (!baselineOk) baselineHash = null;
      } else {
        // No recorded hash and nothing to cross-check against: cannot prove it is the same baseline.
        baselineOk = false;
        baselineHash = null;
      }
      if (!baselineOk) reason = "baseline-changed-since-run";
    }

    const images: VisualItem["images"] = {
      baseline: baselineOk ? `screenshots/${slug}.${viewport}.baseline.png` : null,
      current: curBytes !== null ? `screenshots/${curName}` : null,
      diff: diffBytes !== null ? `screenshots/${diffName}` : null,
    };
    if (baselineOk && baselineBytes !== null) {
      copies.push({ src: baselineSrc, dest: images.baseline!, role: "baseline", bytes: baselineBytes, slug, viewport });
    }
    if (curBytes !== null) copies.push({ src: curSrc, dest: images.current!, role: "current", bytes: curBytes, slug, viewport });
    if (diffBytes !== null) copies.push({ src: diffSrc, dest: images.diff!, role: "diff", bytes: diffBytes, slug, viewport });

    const by = suppression(viewKey);
    items.push({
      id: `vis_${fid.slice(3)}`,
      findingId: fid,
      pageUrl,
      slug,
      viewport,
      differs: true,
      dimensionsChanged,
      measure,
      images,
      baseline: { published: baselineOk, hash: baselineOk ? baselineHash : null, approvedAt: null, sourceRunId: null, reason },
      suppressed: by.length > 0,
      suppressedBy: by,
      diffLegend: DIFF_LEGEND,
    });
  }
  return { items, copies };
}

/**
 * After size budgeting: null every image whose copy was dropped and record why.
 * `dropped` entries are keyed by published relative path (ImageCopy.dest).
 * Only baseline drops change `baseline.reason`/`published`.
 */
export function applyDroppedImages(
  items: VisualItem[],
  dropped: { dest: string; reason: "image-cap" | "run-cap" | "image-retention" }[],
): VisualItem[] {
  const byDest = new Map(dropped.map((d) => [d.dest, d.reason]));
  return items.map((it) => {
    const images = { ...it.images };
    let baseline = it.baseline;
    for (const role of ["baseline", "current", "diff"] as const) {
      const p = images[role];
      const why = p ? byDest.get(p) : undefined;
      if (!p || !why) continue;
      images[role] = null;
      if (role === "baseline") baseline = { ...baseline, published: false, hash: null, reason: why };
    }
    return { ...it, images, baseline };
  });
}
