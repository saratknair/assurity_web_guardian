import { describe, it, expect } from "vitest";
// @ts-expect-error plain browser ES module without type declarations
import { detectWebGL, pointerToNdc, isClick, figuresSignature, createDiorama } from "../../office/diorama/diorama.js";

describe("office diorama entry helpers", () => {
  it("detectWebGL reports ok when a context exists and not ok otherwise", () => {
    expect(detectWebGL(() => ({ getContext: (k: string) => (k === "webgl" ? {} : null) })).ok).toBe(true);
    expect(detectWebGL(() => ({ getContext: () => null })).ok).toBe(false);
    expect(detectWebGL(() => { throw new Error("x"); }).ok).toBe(false);
  });

  it("pointerToNdc maps rect corners and centre", () => {
    const rect = { left: 10, top: 20, width: 200, height: 100 };
    expect(pointerToNdc(rect, 110, 70)).toEqual({ x: 0, y: -0 });
    expect(pointerToNdc(rect, 10, 20)).toEqual({ x: -1, y: 1 });
    expect(pointerToNdc(rect, 210, 120)).toEqual({ x: 1, y: -1 });
  });

  it("isClick distinguishes clicks from drags", () => {
    expect(isClick({ x: 1, y: 1 }, { x: 3, y: 2 })).toBe(true);
    expect(isClick({ x: 1, y: 1 }, { x: 30, y: 2 })).toBe(false);
    expect(isClick(null, { x: 0, y: 0 })).toBe(false);
  });

  it("figuresSignature changes with station, working and scrub flag", () => {
    const a = [{ agent: "a", station: "s1", working: true, template: false }];
    const b = [{ agent: "a", station: "s2", working: true, template: false }];
    expect(figuresSignature(a, false)).toBe(figuresSignature(a.slice(), false));
    expect(figuresSignature(a, false)).not.toBe(figuresSignature(b, false));
    expect(figuresSignature(a, false)).not.toBe(figuresSignature(a, true));
  });

  it("createDiorama resolves null and calls onFallback without a DOM", async () => {
    const reasons: string[] = [];
    const api = await createDiorama(null, { onFallback: (r: string) => reasons.push(r), reducedMotion: () => false });
    expect(api).toBeNull();
    expect(reasons).toEqual(["setup-failed"]);
  });
});
