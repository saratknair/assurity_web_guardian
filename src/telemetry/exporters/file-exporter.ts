import { AppendOnlyLog } from "../audit-log.js";
import type { TelemetryEvent, TelemetryExporter } from "../types.js";

/**
 * Milestone-one exporter (Req 25.1-25.3): writes Telemetry_Events to a local
 * append-only JSONL file. No Collector, cloud service, or DB. OpenTelemetry can
 * be added later as an additional TelemetryExporter without changing content.
 */
export class FileExporter implements TelemetryExporter {
  private readonly log: AppendOnlyLog;

  constructor(eventsPath: string) {
    this.log = new AppendOnlyLog(eventsPath);
  }

  export(event: TelemetryEvent): void {
    this.log.append(event as unknown as Record<string, unknown>);
  }

  async flush(): Promise<void> {
    // appendFileSync is synchronous; nothing buffered.
  }
}
