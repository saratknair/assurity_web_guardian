import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  DEFAULT_DISPLAY_TITLE,
  loadConfig,
  resolveDisplayTitle,
} from "../../src/config/app-config.js";

const dir = mkdtempSync(join(tmpdir(), "display-title-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function load(extra: Record<string, unknown>): ReturnType<typeof loadConfig> {
  const file = join(dir, "app.config.json");
  writeFileSync(
    file,
    JSON.stringify({
      approvedDomain: "example.com",
      baseUrl: "https://example.com",
      seedFilePath: "config/page-seed.json",
      limits: { requestSpacingMs: 1000 },
      retention: { maxRuns: 1, maxAgeDays: 1 },
      viewports: {
        desktop: { width: 1, height: 1 },
        mobile: { width: 1, height: 1 },
      },
      ...extra,
    }),
  );
  return loadConfig(file);
}

describe("resolveDisplayTitle", () => {
  it("defaults when absent", () => {
    expect(resolveDisplayTitle({})).toBe("Web Guardian");
    expect(DEFAULT_DISPLAY_TITLE).toBe("Web Guardian");
  });
  it("returns the configured title, trimmed", () => {
    expect(resolveDisplayTitle({ displayTitle: "Acme Guardian" })).toBe("Acme Guardian");
    expect(resolveDisplayTitle({ displayTitle: "  Acme  " })).toBe("Acme");
  });
  it("defaults for empty and whitespace-only values", () => {
    expect(resolveDisplayTitle({ displayTitle: "" })).toBe("Web Guardian");
    expect(resolveDisplayTitle({ displayTitle: " \t " })).toBe("Web Guardian");
  });
});

describe("displayTitle validation at load", () => {
  it("accepts an absent title and an 80 char title", () => {
    expect(load({}).displayTitle).toBeUndefined();
    expect(load({ displayTitle: "x".repeat(80) }).displayTitle).toHaveLength(80);
  });
  it("rejects a title over 80 characters", () => {
    expect(() => load({ displayTitle: "x".repeat(81) })).toThrow(/displayTitle/);
  });
  it("rejects a non-string title", () => {
    expect(() => load({ displayTitle: 5 })).toThrow(/displayTitle/);
  });
});
