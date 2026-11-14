/** Telemetry types and the OpenTelemetry-ready exporter interface. */

export type AgentStatus =
  | "queued"
  | "started"
  | "working"
  | "awaiting_review"
  | "completed"
  | "failed";

import type { StepName } from "./step-model.js";

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

/** Result_Summary: numbers, booleans, short strings, string arrays, or nested objects of those. */
export type StepResultValue =
  | number
  | boolean
  | string
  | string[]
  | { [key: string]: number | boolean | string | string[] };

export type StepResult = Record<string, StepResultValue>;

/** Data of a `step.completed` event (virtual-office-replay). */
export interface StepEventData {
  seq: number;
  step: StepName;
  agent: string;
  pageUrl?: string;
  slug?: string;
  viewport?: "desktop" | "mobile";
  startedAt: string;
  endedAt: string;
  durationMs: number;
  template: boolean;
  result: StepResult;
  findings?: string[];
  /** Added by the Publisher only. */
  findingIds?: Record<string, string>;
  [key: string]: unknown;
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

/** OpenTelemetry can be added later behind this interface. */
export interface TelemetryExporter {
  export(event: TelemetryEvent): void;
  flush(): Promise<void>;
}
