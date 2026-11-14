import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { loadConfig, loadSeed } from "../../src/config/app-config.js";
import { loadDomainConfig } from "../../src/config/domain-config.js";
import { completeAppConfig } from "../helpers/config-fixture.js";

const repoRoot = resolve(__dirname, "../..");
const dirs: string[] = [];

function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "required-settings-"));
  dirs.push(d);
  return d;
}

afterEach(() => {
  vi.restoreAllMocks();
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

function loadAppWithout(path: string): void {
  const cfg = completeAppConfig();
  const parts = path.split(".");
  let cur = cfg;
  for (const p of parts.slice(0, -1)) cur = cur[p];
  delete cur[parts[parts.length - 1]];
  const file = join(tempDir(), "app.config.json");
  writeFileSync(file, JSON.stringify(cfg));
  loadConfig(file);
}

const appMessage = (path: string): string =>
  `Missing required setting "${path}" in config/app.config.json. See config/app.config.example.json.`;

describe("app config required settings", () => {
  it("passes for a complete config", () => {
    const file = join(tempDir(), "app.config.json");
    writeFileSync(file, JSON.stringify(completeAppConfig()));
    expect(loadConfig(file).approvedDomain).toBe("example.com");
  });

  it.each(["approvedDomain", "baseUrl", "seedFilePath"])("names missing top-level %s", (p) => {
    expect(() => loadAppWithout(p)).toThrow(appMessage(p));
  });

  it.each(["limits.pages", "limits.requestSpacingMs", "limits.runTimeoutMs"])(
    "names missing limit %s",
    (p) => {
      expect(() => loadAppWithout(p)).toThrow(appMessage(p));
    },
  );

  it.each(["retention.maxRuns", "retention.maxAgeDays"])("names missing %s", (p) => {
    expect(() => loadAppWithout(p)).toThrow(appMessage(p));
  });

  it.each(["viewports.desktop.width", "viewports.mobile.height"])(
    "names missing %s",
    (p) => {
      expect(() => loadAppWithout(p)).toThrow(appMessage(p));
    },
  );

  it("reports a wrongly typed setting", () => {
    const cfg = completeAppConfig();
    cfg.limits.pages = "ten";
    const file = join(tempDir(), "app.config.json");
    writeFileSync(file, JSON.stringify(cfg));
    expect(() => loadConfig(file)).toThrow(
      'Invalid setting "limits.pages" in config/app.config.json: expected a number.',
    );
  });
});

describe("domain config required settings", () => {
  function domainRoot(content: Record<string, unknown>): void {
    const root = tempDir();
    mkdirSync(join(root, "config", "domains"), { recursive: true });
    writeFileSync(join(root, "config", "domains", "my-site.json"), JSON.stringify(content));
    vi.spyOn(process, "cwd").mockReturnValue(root);
  }
  const valid = (): Record<string, unknown> =>
    JSON.parse(
      readFileSync(join(repoRoot, "config", "domains", "example-com.example.json"), "utf8"),
    );

  it.each(["domain", "baseUrl", "approvedSchemes", "maxDiscoveryCount", "scopeFile"])(
    "names missing %s",
    (key) => {
      const cfg = valid();
      delete cfg[key];
      domainRoot(cfg);
      expect(() => loadDomainConfig("my-site")).toThrow(
        `Missing required setting "${key}" in config/domains/my-site.json. See config/domains/example-com.example.json.`,
      );
    },
  );
});

describe("page seed required settings", () => {
  function seedWith(content: Record<string, unknown>): void {
    const root = tempDir();
    mkdirSync(join(root, "config"), { recursive: true });
    const seedFile = join(root, "config", "page-seed.json");
    writeFileSync(seedFile, JSON.stringify(content));
    loadSeed({ ...completeAppConfig(), seedFilePath: seedFile } as never);
  }

  it.each(["maxUrls", "approvedUrls"])("names missing %s", (key) => {
    const seed: Record<string, unknown> = { maxUrls: 2, approvedUrls: ["https://example.com/"] };
    delete seed[key];
    expect(() => seedWith(seed)).toThrow(
      `Missing required setting "${key}" in config/page-seed.json. See config/page-seed.example.json.`,
    );
  });
});

describe("example config files", () => {
  const files = [
    ...readdirSync(join(repoRoot, "config")).map((f) => join("config", f)),
    ...readdirSync(join(repoRoot, "config", "domains")).map((f) => join("config", "domains", f)),
  ].filter((f) => f.endsWith(".example.json"));

  it("finds all three example files", () => {
    expect(files).toHaveLength(3);
  });

  it("validates every example file", () => {
    for (const f of files) {
      const abs = join(repoRoot, f);
      if (f.includes("domains")) {
        const root = tempDir();
        mkdirSync(join(root, "config", "domains"), { recursive: true });
        writeFileSync(join(root, "config", "domains", "x.json"), readFileSync(abs));
        vi.spyOn(process, "cwd").mockReturnValue(root);
        expect(loadDomainConfig("x").domain).toBeTruthy();
        vi.restoreAllMocks();
      } else if (f.includes("app.config")) {
        expect(loadConfig(abs).approvedDomain).toBeTruthy();
      } else {
        const cfg = loadConfig(join(repoRoot, "config", "app.config.example.json"));
        expect(loadSeed({ ...cfg, seedFilePath: abs }).approvedUrls.length).toBeGreaterThan(0);
      }
    }
  });
});
