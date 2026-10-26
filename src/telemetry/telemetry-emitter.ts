import { AppendOnlyLog } from "./audit-log.js";
import { redact } from "../safety/redactor.js";
import type { AuditSink } from "../safety/form-guard.js";
import type {
  AgentStatus,
  AgentTaskRecord,
  RunRecord,
  TelemetryEvent,
  TelemetryExporter,
} from "./types.js";

/**
 * TelemetryEmitter (Req 18-20, 22). Produces structured JSON events, routes
 * every record through the Redactor before any write, maintains correlation,
 * and emits truthful agent-status events. Implements AuditSink so safety guards
 * can record blocked actions.
 */
export class TelemetryEmitter implements AuditSink {
  constructor(
    private readonly runId: string,
    private readonly correlationId: string,
    private readonly exporter: TelemetryExporter,
    private readonly auditLog: AppendOnlyLog,
    private readonly extraExporters: TelemetryExporter[] = [],
  ) {}

  private base(kind: string): TelemetryEvent {
    return {
      ts: new Date().toISOString(),
      correlationId: this.correlationId,
      runId: this.runId,
      kind,
    };
  }

  event(kind: string, extra: Partial<TelemetryEvent> = {}): void {
    const ev = redact({ ...this.base(kind), ...extra });
    this.exporter.export(ev);
    for (const ex of this.extraExporters) {
      try { ex.export(ev); } catch { /* optional export never stops the run */ }
    }
  }

  /** Blocked-action and approval auditing (append-only). */
  audit(event: { type: string; reason: string; detail?: string }): void {
    const record = redact({
      ts: new Date().toISOString(),
      correlationId: this.correlationId,
      runId: this.runId,
      ...event,
    });
    this.auditLog.append(record);
    // Also surface on the event stream for the dashboard.
    this.exporter.export({ ...this.base("audit"), data: record });
  }

  /** Truthful agent-status event (Req 19.7, 23). */
  agentStatus(
    agentName: string,
    agentRole: string,
    status: AgentStatus | "review_completed",
    taskId?: string,
  ): void {
    const kind =
      status === "review_completed" ? "human.review.completed" : `agent.${status}`;
    this.event(kind, { taskId, data: { agentName, agentRole, status } });
  }

  runRecord(record: RunRecord): void {
    const r = redact(record);
    this.event("run.record", { data: r as unknown as Record<string, unknown> });
  }

  agentTask(record: AgentTaskRecord): void {
    const r = redact(record);
    this.event("agent.task", {
      taskId: record.taskId,
      data: r as unknown as Record<string, unknown>,
    });
  }
}

