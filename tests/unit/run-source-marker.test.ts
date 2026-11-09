import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRunSource, writeRunSourceMarker } from "../../src/core/orchestrator.js";

const SHA = "a".repeat(40);

describe("run-source marker", () => {
  it("keeps only validated tokens", () => {
    expect(
      buildRunSource({ AWG_RUN_TRIGGER: "push", AWG_GH_RUN_ID: "123", AWG_GH_SHA: SHA, AWG_GH_EVENT_NAME: "push" }),
    ).toEqual({ trigger: "push", githubRunId: "123", sha: SHA, eventName: "push" });
    expect(buildRunSource({ AWG_GH_RUN_ID: "12x", AWG_GH_SHA: "abc", AWG_GH_EVENT_NAME: "Push;rm" })).toBeNull();
    expect(buildRunSource({ AWG_RUN_TRIGGER: "schedule" })).toBeNull();
  });

  it("writes the file in a temp dir only when valid", () => {
    const dir = mkdtempSync(join(tmpdir(), "awg-rs-"));
    try {
      expect(writeRunSourceMarker(dir, {})).toBe(false);
      expect(existsSync(join(dir, "run-source.json"))).toBe(false);
      expect(writeRunSourceMarker(dir, { AWG_GH_RUN_ID: "42", AWG_GH_SHA: "zz" })).toBe(true);
      expect(JSON.parse(readFileSync(join(dir, "run-source.json"), "utf8"))).toEqual({ githubRunId: "42" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
