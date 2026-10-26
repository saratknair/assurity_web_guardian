import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { redact } from "../safety/redactor.js";
import type { TelemetryEvent, TelemetryExporter } from "./types.js";

/**
 * Optional LOCAL OpenTelemetry-shaped adapter (Phase 8, Req 8-series).
 *
 * - DISABLED BY DEFAULT. The Guardian runs fully without it. Local JSON/JSONL
 *   records remain authoritative; this is an ADDITIONAL, optional export.
 * - ZERO new dependencies: no OTel SDK, no Collector, no network, no cloud.
 *   Writes OTel-shaped spans + metrics to local files only.
 * - Represents each run as a root trace; major workflow tasks as child spans.
 * - Redacts secrets/PII/credentials/chain-of-thought before writing.
 * - Export failure NEVER stops the Guardian (all writes are wrapped).
 * - IDs map to existing run/correlation IDs.
 *
 * A real @opentelemetry/* SDK can later be dropped in behind TelemetryExporter
 * without changing recorded content.
 */
export interface OtelConfig {
  enabled: boolean;              // default false
  outDir: string;                // local only, e.g. artifacts/otel
}

export const DEFAULT_OTEL: OtelConfig = { enabled: false, outDir: "artifacts/otel" };

interface Span {
  traceId: string;       // = correlationId
  spanId: string;        // derived id
  name: string;
  startTime: string;
  endTime?: string;
  attributes: Record<string, unknown>;
}

const SPAN_TASKS = new Set([
  "agent.queued", "agent.started", "agent.working", "agent.awaiting_review",
  "agent.completed", "agent.failed", "run.started", "run.finished",
]);

export class LocalOtelExporter implements TelemetryExporter {
  private readonly spansPath: string;
  private readonly metricsPath: string;
  private readonly metrics: Record<string, number> = {};

  constructor(private readonly cfg: OtelConfig = DEFAULT_OTEL) {
    this.spansPath = resolve(cfg.outDir, "spans.jsonl");
    this.metricsPath = resolve(cfg.outDir, "metrics.json");
    if (cfg.enabled) mkdirSync(dirname(this.spansPath), { recursive: true });
  }

  export(event: TelemetryEvent): void {
    if (!this.cfg.enabled) return; // disabled by default: no-op
    try {
      const safe = redact(event);
      // Root trace = correlationId; span per major workflow task.
      if (SPAN_TASKS.has(safe.kind)) {
        const span: Span = {
          traceId: safe.correlationId,
          spanId: `${safe.runId}:${safe.kind}:${Date.now().toString(36)}`,
          name: safe.kind,
          startTime: safe.ts,
          attributes: { runId: safe.runId, taskId: safe.taskId, ...(safe.data ?? {}) },
        };
        appendFileSync(this.spansPath, JSON.stringify(span) + "\n", "utf8");
      }
      // Simple local metrics counters (no sensitive data).
      this.bump("events_total");
      if (safe.kind === "run.started") this.bump("run_count");
      if (safe.kind === "agent.failed") this.bump("agent_failures");
      if (safe.kind === "run.finished") this.flushMetrics();
    } catch {
      // Export failure must never stop the Guardian.
    }
  }

  private bump(key: string): void {
    this.metrics[key] = (this.metrics[key] ?? 0) + 1;
  }

  private flushMetrics(): void {
    try { writeFileSync(this.metricsPath, JSON.stringify(this.metrics, null, 2), "utf8"); } catch { /* ignore */ }
  }

  async flush(): Promise<void> {
    if (this.cfg.enabled) this.flushMetrics();
  }
}
