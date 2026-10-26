import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fc from "fast-check";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AppendOnlyLog, IntegrityError } from "../../src/telemetry/audit-log.js";
import { FileExporter } from "../../src/telemetry/exporters/file-exporter.js";
import { TelemetryEmitter } from "../../src/telemetry/telemetry-emitter.js";
import { redact, REDACTED } from "../../src/safety/redactor.js";
import { newRunIds, newTaskId } from "../../src/core/ids.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "awg-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("Feature: assurity-web-guardian — Phase 4 telemetry", () => {
  // Property 11: Audit and event logs are append-only.
  it("Property 11: append grows the log; overwrite is rejected and preserves content", () => {
    const log = new AppendOnlyLog(join(dir, "audit.jsonl"));
    log.append({ type: "a", reason: "one" });
    log.append({ type: "b", reason: "two" });
    const before = log.readAll();
    expect(before.length).toBe(2);
    expect(() => log.overwriteAt(0, { type: "x", reason: "edit" })).toThrow(IntegrityError);
    const after = log.readAll();
    expect(after).toEqual(before); // content unchanged
  });

  it("Property 11: appended count only ever increases", () => {
    fc.assert(
      fc.property(fc.array(fc.string(), { minLength: 1, maxLength: 30 }), (msgs) => {
        const log = new AppendOnlyLog(join(dir, `${Math.random()}.jsonl`));
        let prev = 0;
        for (const m of msgs) {
          log.append({ type: "e", reason: m });
          const n = log.count();
          expect(n).toBe(prev + 1);
          prev = n;
        }
      }),
      { numRuns: 50 },
    );
  });

  // Property 6: No telemetry record contains secrets/PII after redaction.
  it("Property 6: redaction removes emails, tokens, and sensitive keys", () => {
    fc.assert(
      fc.property(
        fc.record({
          password: fc.string({ minLength: 1 }),
          note: fc.constant("contact me at jane@example.com"),
          apiKey: fc.string({ minLength: 1 }),
          safe: fc.constant("hello world"),
        }),
        (rec) => {
          const out = redact(rec) as Record<string, string>;
          expect(out.password).toBe(REDACTED);
          expect(out.apiKey).toBe(REDACTED);
          expect(out.note).not.toContain("jane@example.com");
          expect(out.safe).toBe("hello world");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("Property 6: nested secrets are redacted", () => {
    const out = redact({ a: { b: { token: "abc", c: "ok" } } }) as any;
    expect(out.a.b.token).toBe(REDACTED);
    expect(out.a.b.c).toBe("ok");
  });

  // Property 12: Every child entity references the parent correlationId.
  it("Property 12: emitted events carry the run's correlationId", () => {
    const { runId, correlationId } = newRunIds();
    const eventsPath = join(dir, "events.jsonl");
    const exporter = new FileExporter(eventsPath);
    const auditLog = new AppendOnlyLog(join(dir, "audit.jsonl"));
    const tel = new TelemetryEmitter(runId, correlationId, exporter, auditLog);

    const taskId = newTaskId();
    tel.agentStatus("Discovery crawler", "deterministic", "queued", taskId);
    tel.agentStatus("Discovery crawler", "deterministic", "working", taskId);
    tel.event("check.completed", { checkId: "chk_x" });
    tel.audit({ type: "blocked-action", reason: "domain-boundary" });

    const events = new AppendOnlyLog(eventsPath).readAll();
    expect(events.length).toBeGreaterThanOrEqual(3);
    for (const e of events) {
      expect(e.correlationId).toBe(correlationId);
      expect(e.runId).toBe(runId);
    }
    // Audit entry also linked.
    const audits = auditLog.readAll();
    expect(audits.length).toBe(1);
    expect(audits[0].correlationId).toBe(correlationId);
  });

  it("Property 12: ID prefixes are correct", () => {
    const { runId, correlationId } = newRunIds();
    expect(runId.startsWith("run_")).toBe(true);
    expect(correlationId.startsWith("cor_")).toBe(true);
    expect(newTaskId().startsWith("task_")).toBe(true);
  });
});
