import { describe, it, expect } from "vitest";
// @ts-expect-error plain browser ES module without type declarations
import { scrubberValueText, playButtonLabel, READ_ALOUD_LABEL } from "../../office/views/controls.js";
// @ts-expect-error plain browser ES module without type declarations
import { runOptionLabel } from "../../office/views/run-picker.js";

describe("office controls pure helpers", () => {
  it("formats scrubber aria-valuetext with and without a step", () => {
    expect(scrubberValueText(12300, 95000, "accessibility-scan")).toBe(
      "00:12.3 of 01:35.0, step accessibility-scan",
    );
    expect(scrubberValueText(0, 95000, null)).toBe("00:00.0 of 01:35.0");
  });

  it("labels the play button", () => {
    expect(playButtonLabel(true)).toBe("Pause");
    expect(playButtonLabel(false)).toBe("Play");
  });

  it("names the read-aloud toggle for screen reader users", () => {
    expect(READ_ALOUD_LABEL).toBe("Read steps aloud (screen reader)");
  });

  it("labels run options with date, time and health", () => {
    expect(runOptionLabel({ runId: "r", finishedAt: "2026-11-05T22:39:56.934Z", health: "attention" }, "UTC")).toBe(
      "2026-11-05 22:39 UTC, health attention",
    );
    expect(runOptionLabel({ runId: "r", finishedAt: "2026-11-12T23:00:00Z", health: "ok" }, "Pacific/Auckland")).toMatch(
      /^2026-11-13 12:00 \S+, health ok$/,
    );
    expect(runOptionLabel({})).toBe("date not recorded, health not recorded");
  });
});
