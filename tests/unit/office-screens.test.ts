import { describe, it, expect } from "vitest";
// @ts-expect-error plain browser ES module without type declarations
import { truncateLine, wrapLine, fitLines, linesForStation, wantsThumbnail, screenSignature } from "../../office/diorama/screens.js";

const screen = {
  entryId: "e1",
  step: "history",
  done: true,
  lines: ["Step: history", "Page: https://example.test/a", "Viewport: desktop", "Result: ok"],
  evidenceRef: { pageUrl: "https://example.test/a", slug: "a", viewport: "desktop", step: "screenshot" },
};

describe("office screens helpers", () => {
  it("truncates and wraps", () => {
    expect(truncateLine("abcdefghij", 8)).toBe("abcde...");
    expect(wrapLine("aaa bbb ccc", 7)).toEqual(["aaa bbb", "ccc"]);
    expect(wrapLine("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
  });

  it("caps lines and marks the cut", () => {
    const out = fitLines(["one", "two", "three", "four"], 20, 2);
    expect(out).toHaveLength(2);
    expect(out[1].endsWith("...")).toBe(true);
    expect(fitLines(["a"], 20, 3)).toEqual(["a"]);
  });

  it("records room shows the Step_Name only", () => {
    expect(linesForStation("records-room", screen)).toEqual(["Step: history"]);
    expect(linesForStation("review-desk", screen)).toEqual(screen.lines);
    expect(linesForStation("review-desk", null)).toEqual([]);
  });

  it("thumbnails only on browser bay with images", () => {
    expect(wantsThumbnail("browser-bay", screen, true)).toBe(true);
    expect(wantsThumbnail("browser-bay", screen, false)).toBe(false);
    expect(wantsThumbnail("visual-check", screen, true)).toBe(false);
  });

  it("signature changes only with drawn content", () => {
    const a = screenSignature("browser-bay", screen, "none");
    expect(screenSignature("browser-bay", { ...screen }, "none")).toBe(a);
    expect(screenSignature("browser-bay", { ...screen, done: false }, "none")).not.toBe(a);
    expect(screenSignature("browser-bay", screen, "ready")).not.toBe(a);
  });
});
