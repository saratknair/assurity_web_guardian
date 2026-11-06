import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { buildVisualItems, deriveDiffMeasure, type RecordedVisual } from "../../src/publish/visual.js";

function makePng(w: number, h: number, data: Uint8Array): PNG {
  const png = new PNG({ width: w, height: h });
  png.data = Buffer.from(data.subarray(0, w * h * 4));
  return png;
}

const sizeArb = fc.record({ w: fc.integer({ min: 1, max: 16 }), h: fc.integer({ min: 1, max: 16 }) });
const bytesArb = fc.uint8Array({ minLength: 16 * 16 * 4, maxLength: 16 * 16 * 4 });

// Feature: dashboard-usability-overhaul, Property 19: Derived difference measure equals the comparer's count
// **Validates: Requirements 4.3, 4.4**
describe("Property 19: Derived difference measure equals the comparer's count", () => {
  it("deriveDiffMeasure(pixelmatch diff PNG).diffPixels === pixelmatch count", () => {
    fc.assert(
      fc.property(
        sizeArb,
        bytesArb,
        bytesArb,
        fc.constantFrom(0, 0.5, 1),
        (size, a, b, mix) => {
          const { w, h } = size;
          const base = makePng(w, h, a);
          // mix controls how much of cur equals base so we get a spread of diff counts
          const curData = new Uint8Array(w * h * 4);
          for (let i = 0; i < curData.length; i++) curData[i] = i % 7 / 7 < mix ? a[i] : b[i];
          const cur = makePng(w, h, curData);
          const diff = new PNG({ width: w, height: h });
          const count = pixelmatch(base.data, cur.data, diff.data, w, h, { threshold: 0.1 });
          const m = deriveDiffMeasure(PNG.sync.write(diff));
          expect(m.diffPixels).toBe(count);
          expect(m.totalPixels).toBe(w * h);
          expect(m.diffRatio).toBe(count / (w * h));
        },
      ),
      { numRuns: 200 },
    );
  });
});

type Kind =
  | "not-differing"
  | "rec-match"
  | "rec-mismatch"
  | "rec-no-baseline"
  | "old-same"
  | "old-other"
  | "old-no-baseline";

const KINDS: Kind[] = [
  "not-differing",
  "rec-match",
  "rec-mismatch",
  "rec-no-baseline",
  "old-same",
  "old-other",
  "old-no-baseline",
];

const pairArb = fc.record({
  kind: fc.constantFrom(...KINDS),
  vp: fc.constantFrom("desktop", "mobile") as fc.Arbitrary<"desktop" | "mobile">,
  size: sizeArb,
  base: bytesArb,
  cur: bytesArb,
  other: bytesArb,
  stray: fc.boolean(), // not-differing pairs may still have a baseline and a stale diff file on disk
});

// Feature: dashboard-usability-overhaul, Property 18: Baselines are published exactly for differing pairs
// **Validates: Requirements 5.1, 5.2, 5.7**
describe("Property 18: Baselines are published exactly for differing pairs", () => {
  it("publishes a baseline copy exactly for verified differing pairs, with reasons otherwise", () => {
    // File-system cases: 50 runs rather than 100 to keep the suite fast.
    fc.assert(
      fc.property(fc.array(pairArb, { minLength: 1, maxLength: 6 }), (pairs) => {
        const root = mkdtempSync(join(tmpdir(), "awg-vis-"));
        try {
          const runDir = join(root, "run");
          const baselineRoot = join(root, "baselines");
          mkdirSync(join(runDir, "screenshots"), { recursive: true });
          const results: { slug: string; page: string }[] = [];
          const findingsVisual: Record<string, Record<string, RecordedVisual>> = {};
          const expected = new Map<string, { baseline: boolean; reason: string | null }>();

          pairs.forEach((p, i) => {
            const slug = `p${i}`;
            const { w, h } = p.size;
            results.push({ slug, page: `https://example.test/${slug}` });
            const base = makePng(w, h, p.base);
            const cur = makePng(w, h, p.cur);
            const baseBuf = PNG.sync.write(base);
            writeFileSync(join(runDir, "screenshots", `${slug}.${p.vp}.png`), PNG.sync.write(cur));

            const writeBaseline = (buf: Buffer) => {
              mkdirSync(join(baselineRoot, slug), { recursive: true });
              writeFileSync(join(baselineRoot, slug, `${p.vp}.png`), buf);
            };
            const writeDiff = (against: PNG) => {
              const d = new PNG({ width: w, height: h });
              const n = pixelmatch(against.data, cur.data, d.data, w, h, { threshold: 0.1 });
              writeFileSync(join(runDir, "screenshots", `${slug}.${p.vp}.diff.png`), PNG.sync.write(d));
              return n;
            };
            const hashOf = (b: Buffer) => createHash("sha256").update(b).digest("hex").slice(0, 16);
            const key = `${slug}.${p.vp}`;

            switch (p.kind) {
              case "not-differing":
                findingsVisual[slug] = { [p.vp]: { differs: false } };
                if (p.stray) {
                  writeBaseline(baseBuf);
                  writeDiff(base);
                }
                break;
              case "rec-match":
                writeBaseline(baseBuf);
                writeDiff(base);
                findingsVisual[slug] = { [p.vp]: { differs: true, baselineHash: hashOf(baseBuf) } };
                expected.set(key, { baseline: true, reason: null });
                break;
              case "rec-mismatch":
                writeBaseline(baseBuf);
                writeDiff(base);
                findingsVisual[slug] = { [p.vp]: { differs: true, baselineHash: "ffffffffffffffff" } };
                expected.set(key, { baseline: false, reason: "baseline-changed-since-run" });
                break;
              case "rec-no-baseline":
                writeDiff(base);
                findingsVisual[slug] = { [p.vp]: { differs: true, baselineHash: hashOf(baseBuf) } };
                expected.set(key, { baseline: false, reason: "no-baseline-file" });
                break;
              case "old-same":
                writeBaseline(baseBuf);
                writeDiff(base);
                expected.set(key, { baseline: true, reason: null });
                break;
              case "old-other": {
                const n = writeDiff(base);
                const other = makePng(w, h, p.other);
                writeBaseline(PNG.sync.write(other));
                const reproduces = pixelmatch(other.data, cur.data, null, w, h, { threshold: 0.1 }) === n;
                expected.set(key, reproduces ? { baseline: true, reason: null } : { baseline: false, reason: "baseline-changed-since-run" });
                break;
              }
              case "old-no-baseline":
                writeDiff(base);
                expected.set(key, { baseline: false, reason: "no-baseline-file" });
                break;
            }
          });
          writeFileSync(join(runDir, "results.json"), JSON.stringify({ pages: results }));

          const { items, copies } = buildVisualItems({ runDir, runId: "run-1", findingsVisual, baselineRoot });

          // Items exist exactly for differing pairs; never for non-differing ones.
          const got = new Map(items.map((it) => [`${it.slug}.${it.viewport}`, it]));
          expect([...got.keys()].sort()).toEqual([...expected.keys()].sort());

          const baselineCopies = copies.filter((c) => c.role === "baseline");
          const copiedKeys = new Set(baselineCopies.map((c) => `${c.slug}.${c.viewport}`));
          const wantKeys = [...expected].filter(([, v]) => v.baseline).map(([k]) => k).sort();
          expect([...copiedKeys].sort()).toEqual(wantKeys);
          expect(baselineCopies.length).toBe(wantKeys.length);

          for (const [key, exp] of expected) {
            const it = got.get(key)!;
            if (exp.baseline) {
              expect(it.images.baseline).toBe(`screenshots/${it.slug}.${it.viewport}.baseline.png`);
              expect(it.baseline.published).toBe(true);
              expect(it.baseline.reason).toBeNull();
            } else {
              expect(it.images.baseline).toBeNull();
              expect(it.baseline.published).toBe(false);
              expect(it.baseline.reason).toBe(exp.reason);
            }
          }
        } finally {
          rmSync(root, { recursive: true, force: true });
        }
      }),
      { numRuns: 50 },
    );
  });
});
