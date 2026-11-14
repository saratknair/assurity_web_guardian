import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import { listDomains, loadDomainConfig } from "../../src/config/domain-config.js";
import { loadConfig } from "../../src/config/app-config.js";

const repoRoot = resolve(__dirname, "../..");
const scriptUrl = pathToFileURL(join(repoRoot, "scripts", "init-config.mjs")).href;

type InitResult = { copied: string[]; skipped: string[] };
async function run(root: string): Promise<InitResult> {
  const mod = (await import(/* @vite-ignore */ scriptUrl)) as { initConfig: (r: string) => InitResult };
  return mod.initConfig(root);
}

const dirs: string[] = [];
function tempProject(): string {
  const root = mkdtempSync(join(tmpdir(), "init-config-"));
  dirs.push(root);
  mkdirSync(join(root, "config", "domains"), { recursive: true });
  cpSync(join(repoRoot, "config", "app.config.example.json"), join(root, "config", "app.config.example.json"));
  cpSync(join(repoRoot, "config", "page-seed.example.json"), join(root, "config", "page-seed.example.json"));
  cpSync(
    join(repoRoot, "config", "domains", "example-com.example.json"),
    join(root, "config", "domains", "example-com.example.json"),
  );
  return root;
}

afterEach(() => {
  vi.restoreAllMocks();
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

describe("initConfig", () => {
  it("copies each example when the real file is missing", async () => {
    const root = tempProject();
    const res = await run(root);
    expect(res.skipped).toEqual([]);
    expect(res.copied).toHaveLength(3);
    expect(existsSync(join(root, "config", "app.config.json"))).toBe(true);
    expect(existsSync(join(root, "config", "page-seed.json"))).toBe(true);
    expect(existsSync(join(root, "config", "domains", "example-com.json"))).toBe(true);
  });

  it("never overwrites an existing file and is idempotent", async () => {
    const root = tempProject();
    writeFileSync(join(root, "config", "app.config.json"), "{\"mine\":true}");
    const first = await run(root);
    expect(first.skipped).toEqual([join("config", "app.config.json")]);
    expect(readFileSync(join(root, "config", "app.config.json"), "utf8")).toBe("{\"mine\":true}");
    const second = await run(root);
    expect(second.copied).toEqual([]);
    expect(second.skipped).toHaveLength(3);
  });
});

describe("example config files", () => {
  it("load with the real loaders after init and are not listed as domains", async () => {
    const root = tempProject();
    expect(await run(root)).toBeTruthy();
    vi.spyOn(process, "cwd").mockReturnValue(root);
    const app = loadConfig(join(root, "config", "app.config.json"));
    expect(listDomains()).toEqual([app.domain]);
    expect(loadDomainConfig(app.domain).baseUrl).toBe(app.baseUrl);
  });

  it("listDomains skips *.example.json templates", () => {
    const root = tempProject();
    vi.spyOn(process, "cwd").mockReturnValue(root);
    expect(listDomains()).toEqual([]);
  });
});
