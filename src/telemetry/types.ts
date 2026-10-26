/** Telemetry types and the OpenTelemetry-ready exporter interface (Req 18-20, 23, 25). */

export type AgentStatus =
  | "queued"
  | "started"
  | "working"
  | "awaiting_review"
  | "completed"
  | "failed";

export type FindingClassification =
  | "deterministic-test-evidence"
  | "observed-website-change"
  | "ai-generated-analysis"
  | "agent-recommendation"
  | "human-decision";

export interface TelemetryEvent {
  ts: string;
  correlationId: string;
  runId: string;
  kind: string; // e.g. run.started, agent.working, check.completed
  taskId?: string;
  checkId?: string;
  findingId?: string;
  evidenceId?: string;
  reviewId?: string;
  message?: string;
  data?: Record<string, unknown>;
}

/** Truthful agent-status event for a future virtual office (Req 19.7, 23). */
export interface AgentStatusEvent extends TelemetryEvent {
  kind:
    | "agent.queued"
    | "agent.started"
    | "agent.working"
    | "agent.awaiting_review"
    | "agent.completed"
    | "agent.failed"
    | "human.review.completed";
  agentName: string;
  agentRole: string;
  status: AgentStatus | "review_completed";
}

export interface RunRecord {
  runId: string;
  correlationId: string;
  startedAt: string;
  finishedAt?: string;
  targetEnvironment: string;
  baseUrl: string;
  browser: string;
  viewport: string;
  baselineVersion?: string;
  testSuiteVersion?: string;
  pagesRequested: string[];
  result?: "passed" | "failed" | "skipped" | "requires-human-review";
  evidenceRefs: string[];
}

export interface AgentTaskRecord {
  taskId: string;
  correlationId: string;
  runId: string;
  agentName: string;
  agentRole: string;
  task: string;
  startedAt: string;
  finishedAt?: string;
  status: AgentStatus;
  inputArtifacts: { ref: string; version?: string }[];
  outputArtifacts: string[];
  toolsUsed: string[];
  handoffs: string[];
  decisions: string[];
  recommendations: string[];
  confidence?: number;
  errors: string[];
  retries: number;
  timeouts: number;
  requiresHumanReview: boolean;
  humanDecision?: "accepted" | "rejected" | "dismissed" | "baseline-update-approved";
  humanDecisionReason?: string;
}

/** OpenTelemetry can be added later behind this interface (Req 20.12, 25.3). */
export interface TelemetryExporter {
  export(event: TelemetryEvent): void;
  flush(): Promise<void>;
}
