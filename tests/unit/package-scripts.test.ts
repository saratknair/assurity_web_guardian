import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

const root = resolve(__dirname, "../..");
const scripts: Record<string, string> = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).scripts;

const REQUIRED = ["console", "guardian", "build", "test", "verify", "typecheck", "init-config", "scan:history", "scan:secrets"];

describe("package.json scripts", () => {
  it("defines the required script set", () => {
    for (const name of REQUIRED) expect(scripts[name], name).toBeTruthy();
  });

  it("has no scripts that only print a pointer", () => {
    expect(scripts.run).toBeUndefined();
    expect(scripts.report).toBeUndefined();
  });

  it("uses only portable Node commands", () => {
    const banned = /\b(rm|cp|mv|export|set|powershell|pwsh|cmd)\b|\.ps1|\.cmd\b|\$\(|%[A-Z_]+%/;
    for (const [name, cmd] of Object.entries(scripts)) {
      expect(banned.test(cmd), `${name}: ${cmd}`).toBe(false);
    }
  });

  it("declares the same Node major in .nvmrc and engines.node", () => {
    const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
    const nvmMajor = /^v?(\d+)/.exec(readFileSync(resolve(root, ".nvmrc"), "utf8").trim());
    const enginesMajor = /(\d+)/.exec(pkg.engines.node);
    expect(nvmMajor).not.toBeNull();
    expect(enginesMajor).not.toBeNull();
    expect(enginesMajor![1]).toBe(nvmMajor![1]);
  });

  it("pins every dependency to the exact version recorded in package-lock.json", () => {
    const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
    const lock = JSON.parse(readFileSync(resolve(root, "package-lock.json"), "utf8"));
    const rootSpecs = lock.packages[""];
    for (const field of ["dependencies", "devDependencies"] as const) {
      for (const [name, version] of Object.entries<string>(pkg[field])) {
        expect(version, `${name} must be an exact version`).toMatch(/^\d+\.\d+\.\d+$/);
        expect(lock.packages[`node_modules/${name}`].version, `${name} locked version`).toBe(version);
        expect(rootSpecs[field][name], `${name} lockfile root spec`).toBe(version);
      }
    }
  });

  it("points node scripts at files that exist", () => {
    for (const [name, cmd] of Object.entries(scripts)) {
      const m = /^node (scripts\/\S+)$/.exec(cmd);
      if (m) expect(existsSync(resolve(root, m[1])), name).toBe(true);
    }
  });
});
