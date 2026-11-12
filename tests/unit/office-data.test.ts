import { describe, it, expect } from "vitest";
// @ts-expect-error plain browser ES module without type declarations
import { dataUrl, imageUrl } from "../../office/lib/data.js";
// @ts-expect-error plain browser ES module without type declarations
import { createStore } from "../../office/lib/store.js";

const BASE = new URL("https://example.test/data/");

describe("office data.js", () => {
  it("resolves valid paths under the data base", () => {
    expect(dataUrl("index.json", BASE)).toBe("https://example.test/data/index.json");
    expect(dataUrl("runs/r1/events.json", BASE)).toBe("https://example.test/data/runs/r1/events.json");
  });

  it("rejects traversal, absolute, scheme, and malformed paths", () => {
    for (const p of ["", "..", ".", "../x", "a/../b", "/abs", "a//b", "a\\b", "x:y", "//evil.test/x", "a/"]) {
      expect(() => dataUrl(p, BASE)).toThrow();
    }
  });

  it("builds screenshot urls and rejects bad parts", () => {
    expect(imageUrl("r1", "home", "desktop", BASE)).toBe("https://example.test/data/runs/r1/screenshots/home.desktop.png");
    expect(() => imageUrl("r1/../x", "home", "desktop", BASE)).toThrow();
  });
});

describe("office store.js", () => {
  it("notifies on change only and supports unsubscribe", () => {
    const s = createStore({ a: 1 });
    let n = 0;
    const off = s.subscribe(() => { n++; });
    s.set({ a: 1 });
    s.set({ a: 2 });
    expect(n).toBe(1);
    off();
    s.set({ a: 3 });
    expect(n).toBe(1);
    expect(s.get().a).toBe(3);
  });
});
