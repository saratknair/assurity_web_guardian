import { describe, expect, it } from "vitest";

import { listDomains, loadDomainConfig } from "../../src/config/domain-config.js";
import { loadConfig, loadSeed } from "../../src/config/app-config.js";

describe("instance config files", () => {
  it("pass required-setting validation", () => {
    const cfg = loadConfig();
    expect(loadSeed(cfg).approvedUrls.length).toBeGreaterThan(0);
    for (const slug of listDomains()) {
      expect(loadDomainConfig(slug).domain).toBeTruthy();
    }
  });
});
