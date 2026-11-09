import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { editSchedule, readSchedule, replaceCron } from "../../src/admin/workflow-schedule.js";

const LF =
  "name: guardian\n\non:\n  schedule:\n    # 17:00 UTC daily \u2014 note\n    - cron: \"0 17 * * *\"\n" +
  "  workflow_dispatch: {}\n\npermissions:\n  contents: read\n";
const CRLF = LF.replace(/\n/g, "\r\n");

describe("workflow-schedule", () => {
  it("reads the single cron entry", () => {
    const r = readSchedule(LF);
    expect(r.ok && r.cron).toBe("0 17 * * *");
  });

  it("changes only the cron value, for LF and CRLF", () => {
    for (const src of [LF, CRLF]) {
      const r = replaceCron(src, "30 6 * * 1-5");
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.text).toBe(src.replace("0 17 * * *", "30 6 * * 1-5"));
    }
  });

  it("refuses zero or several entries and invalid cron", () => {
    expect(readSchedule("on:\n  workflow_dispatch: {}\n").ok).toBe(false);
    const two = LF.replace("  workflow_dispatch", "    - cron: \"1 1 * * *\"\n  workflow_dispatch");
    expect(readSchedule(two).ok).toBe(false);
    expect(replaceCron(LF, "* * * * *").ok).toBe(false);
  });

  it("edits a copy on disk byte-exactly", () => {
    const dir = mkdtempSync(join(tmpdir(), "wfs-"));
    try {
      const p = join(dir, "guardian.yml");
      writeFileSync(p, Buffer.from(CRLF, "utf8"));
      const before = readFileSync(p);
      const r = editSchedule(p, "0 5 * * *");
      expect(r.ok).toBe(true);
      const after = readFileSync(p);
      expect(after.length).toBe(before.length - 1);
      expect(after.toString("utf8")).toBe(CRLF.replace("0 17 * * *", "0 5 * * *"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
