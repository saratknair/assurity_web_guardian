import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// Smoke test: text assertions on the CI workflow (no YAML parser).
const raw = readFileSync(".github/workflows/guardian.yml", "utf8");
// Non-comment lines only, so explanatory comments ("never -f") do not trip checks.
const code = raw
  .split(/\r?\n/)
  .filter((l) => !/^\s*#/.test(l))
  .join("\n");

describe("guardian.yml workflow smoke test", () => {
  it("restores a11y history before running Guardian", () => {
    const restore = code.indexOf("- name: Restore a11y history");
    const run = code.indexOf("- name: Run Guardian");
    expect(restore).toBeGreaterThan(-1);
    expect(run).toBeGreaterThan(-1);
    expect(restore).toBeLessThan(run);
  });

  it("uploads and downloads the a11y history between jobs", () => {
    expect(code).toContain("- name: Upload a11y history");
    expect(code).toContain("- name: Download a11y history");
  });

  it("commit job stages artifacts/a11y-history.json", () => {
    const commitJob = code.slice(code.indexOf("commit-runs-data:\n"));
    expect(commitJob).toMatch(/git add -- artifacts\/a11y-history\.json/);
  });

  it("sets AWG_RUN_ORIGIN=cloud on the Build published data step", () => {
    const start = code.indexOf("- name: Build published data");
    const end = code.indexOf("- name: Add static dashboard to site");
    expect(start).toBeGreaterThan(-1);
    expect(code.slice(start, end)).toMatch(/AWG_RUN_ORIGIN:\s*cloud/);
  });

  it("stamps the build id after both site copies and before the Pages upload", () => {
    const office = code.indexOf("- name: Add static virtual office to site");
    const stamp = code.indexOf("- name: Stamp build id on site assets");
    const upload = code.indexOf("- name: Upload Pages artifact");
    expect(stamp).toBeGreaterThan(office);
    expect(stamp).toBeLessThan(upload);
    expect(code).toContain("node scripts/stamp-build-id.mjs ./_site");
  });

  it("requires instance data in the scan and size-gate steps", () => {
    for (const script of ["scan-dashboard.mjs", "scan-office.mjs", "check-site-sizes.mjs"]) {
      const at = code.indexOf("run: node scripts/" + script);
      expect(at).toBeGreaterThan(-1);
      const stepStart = code.lastIndexOf("- name:", at);
      expect(code.slice(stepStart, at)).toMatch(/GUARDIAN_REQUIRE_INSTANCE_DATA:\s*"1"/);
    }
  });

  it("never force-pushes", () => {
    expect(code).not.toMatch(/push\s+(.*\s)?(-f|--force|--force-with-lease)\b/);
    expect(code).not.toContain("--force-with-lease");
    const pushLines = code.split("\n").filter((l) => /\bgit push\b/.test(l));
    expect(pushLines.length).toBeGreaterThan(0);
    for (const l of pushLines) expect(l).not.toMatch(/\s-f\b|--force/);
  });

  describe("verify-platform job", () => {
    const start = code.indexOf("  verify-platform:\n");
    const end = code.indexOf("\n  publish:\n");
    const job = code.slice(start, end);

    it("exists on a Linux and macOS matrix with a read-only token and a timeout", () => {
      expect(start).toBeGreaterThan(-1);
      expect(end).toBeGreaterThan(start);
      expect(job).toMatch(/runs-on:\s*\$\{\{\s*matrix\.os\s*\}\}/);
      expect(job).toContain("ubuntu-latest");
      expect(job).toContain("macos-latest");
      expect(job).toMatch(/permissions:\s*\n\s+contents:\s*read\b/);
      expect(job).toMatch(/timeout-minutes:\s*\d+/);
    });

    it("uses pinned actions and runs install, build and test", () => {
      const uses = [...job.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
      expect(uses.length).toBeGreaterThan(0);
      for (const u of uses) expect(u).toMatch(/@[0-9a-f]{40}$/);
      expect(job).toMatch(/node-version-file:\s*"\.nvmrc"/);
      const cmds = [...job.matchAll(/run:\s*(.+)$/gm)].map((m) => m[1].trim());
      expect(cmds).toEqual(["npm ci", "npm run build", "npm test"]);
    });

    it("runs only for pull requests and manual dispatch, never push or schedule", () => {
      const cond = job.slice(job.indexOf("if:"), job.indexOf("runs-on:"));
      expect(cond).toContain("workflow_dispatch");
      expect(cond).toContain("pull_request");
      expect(cond).not.toMatch(/\bpush\b|\bschedule\b/);
    });
  });

  it("keeps the publishing jobs off pull requests", () => {
    const runJob = code.slice(code.indexOf("\n  run:\n"), code.indexOf("\n  verify-platform:\n"));
    const commitJob = code.slice(code.indexOf("\n  commit-runs-data:\n"));
    for (const body of [runJob, commitJob]) {
      expect(body.length).toBeGreaterThan(10);
      expect(body).toContain("if: github.event_name != 'pull_request'");
    }
    expect(code).toMatch(/\n  publish:\n    needs: run\n/);
  });

  describe("job hardening", () => {
    const jobsAt = code.indexOf("\njobs:\n");
    const bodies = code
      .slice(jobsAt + 6)
      .split(/\n(?=  [a-z][\w-]*:\n)/)
      .map((b) => b.trim())
      .filter((b) => b.length > 0);
    const byName = new Map(bodies.map((b) => [b.slice(0, b.indexOf(":")), b]));

    it("defines the four expected jobs", () => {
      expect([...byName.keys()].sort()).toEqual(["commit-runs-data", "publish", "run", "verify-platform"]);
    });

    it("gives every job a timeout and a fork guard", () => {
      for (const [name, body] of byName) {
        expect(body, name).toMatch(/timeout-minutes:\s*\d+/);
        expect(body, name).toContain("!github.event.repository.fork");
      }
    });

    it("grants write scopes only to publish and commit-runs-data", () => {
      expect(code).toMatch(/\npermissions:\n  contents: read\n/);
      for (const [name, body] of byName) {
        const writes = /:\s*write\b/.test(body);
        expect(writes, name).toBe(name === "publish" || name === "commit-runs-data");
      }
    });

    it("drops checkout credentials in the verify-platform job", () => {
      expect(byName.get("verify-platform")).toMatch(/persist-credentials:\s*false/);
    });

    it("never uses pull_request_target", () => {
      expect(code).not.toContain("pull_request_target");
    });

    it("keeps event and input contexts out of run scripts", () => {
      let inRun = false;
      let indent = 0;
      for (const line of code.split("\n")) {
        const m = line.match(/^(\s*)(?:-\s+)?run:/);
        if (m) {
          inRun = true;
          indent = m[1].length;
        } else if (inRun && line.trim() && line.search(/\S/) <= indent) {
          inRun = false;
        }
        if (m || inRun) expect(line).not.toMatch(/\$\{\{\s*(github\.(event|head_ref|base_ref)|inputs)\b/);
      }
    });
  });

  it("keeps every action pinned to a 40-hex SHA", () => {
    const uses = [...code.matchAll(/^\s*(?:-\s+)?uses:\s*(\S+)/gm)].map((m) => m[1]);
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(u).toMatch(/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/);
  });
});
