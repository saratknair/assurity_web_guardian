import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CLI = resolve("dist", "index.js");
const dirs: string[] = [];

function run(args: string[]) {
  const cwd = mkdtempSync(join(tmpdir(), "cli-approve-"));
  dirs.push(cwd);
  const r = spawnSync(process.execPath, [CLI, "approve", ...args], { cwd, encoding: "utf8" });
  return { cwd, status: r.status, out: r.stdout, err: r.stderr };
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe.skipIf(!existsSync(CLI))("CLI approve: finding dispositions (Req 18.14)", () => {
  it("records an ignore with source cli and prints the entry id", () => {
    const r = run([
      "--decision", "ignore", "--scope", "page-rule",
      "--page", "https://example.com/a", "--viewport", "desktop", "--rule", "color-contrast",
      "--reviewer", "Alex Reviewer", "--reason", "Known false positive",
    ]);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/RECORDED id=\S+/);
    const log = JSON.parse(readFileSync(join(r.cwd, "artifacts", "dispositions.json"), "utf8"));
    expect(log.entries).toHaveLength(1);
    expect(log.entries[0].source).toBe("cli");
    expect(log.entries[0].decision).toBe("ignore");
  });

  it("rejects invalid input with the same validation as the GUI and writes nothing", () => {
    const r = run(["--decision", "ignore", "--scope", "page-rule", "--reviewer", "Alex", "--reason", ""]);
    expect(r.status).toBe(2);
    expect(r.err).toContain("INVALID");
    expect(existsSync(join(r.cwd, "artifacts", "dispositions.json"))).toBe(false);
  });

  it("keeps the specification-draft usage error unchanged", () => {
    const r = run(["--decision", "accepted"]);
    expect(r.status).toBe(2);
    expect(r.err).toContain("Usage: approve --slug");
  });
});
