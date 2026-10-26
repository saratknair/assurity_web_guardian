import type { GEvent } from "./useGuardianEvents";

// Deterministic office state derived ONLY from genuine Guardian events.
// No synthetic activity. Idle when there are no events for an agent.

export type AgentState =
  | "idle" | "queued" | "started" | "working"
  | "waiting_for_dependency" | "awaiting_review"
  | "completed" | "failed" | "blocked" | "skipped";

export interface AreaDef { id: string; label: string; kind: "deterministic" | "ai" | "human" | "coordinator" | "store"; }

// The office areas map to agents/components that ACTUALLY exist in the Guardian.
export const AREAS: AreaDef[] = [
  { id: "Orchestrator", label: "Supervisor Desk", kind: "coordinator" },
  { id: "RunControl", label: "Run Control Board", kind: "coordinator" },
  { id: "Discovery crawler", label: "Discovery Desk", kind: "deterministic" },
  { id: "Inventory_Agent", label: "Inventory Desk", kind: "deterministic" },
  { id: "Specification_Agent", label: "Specification Desk", kind: "ai" },
  { id: "Test_Generator", label: "Test Generation Desk", kind: "deterministic" },
  { id: "Observation_Runner", label: "Deterministic Testing Area", kind: "deterministic" },
  { id: "Axe", label: "Accessibility Desk", kind: "deterministic" },
  { id: "Comparator", label: "Visual Comparison Desk", kind: "deterministic" },
  { id: "Quality_Analysis_Agent", label: "Quality Analysis Desk", kind: "ai" },
  { id: "Visual_Explanation_Agent", label: "Visual Explanation Desk", kind: "ai" },
  { id: "Triage_Agent", label: "Triage Desk", kind: "ai" },
  { id: "HumanReview", label: "Human Review Room", kind: "human" },
  { id: "EvidenceArchive", label: "Evidence Archive", kind: "store" },
  { id: "CompletedRuns", label: "Completed Runs Area", kind: "store" },
  { id: "FailedBlocked", label: "Failed or Blocked Tasks Area", kind: "store" },
];

const KIND_TO_STATE: Record<string, AgentState> = {
  "agent.queued": "queued",
  "agent.started": "started",
  "agent.working": "working",
  "agent.awaiting_review": "awaiting_review",
  "agent.completed": "completed",
  "agent.failed": "failed",
};

export interface AgentStatus {
  agent: string;
  state: AgentState;
  lastEvent?: GEvent;
  latestKind?: string;
}

export interface OfficeSnapshot {
  byAgent: Record<string, AgentStatus>;
  runId?: string;
  correlationId?: string;
  phase?: string;
  pendingReview: boolean;
  anyFailed: boolean;
  anyBlocked: boolean;
}

export function deriveSnapshot(events: GEvent[]): OfficeSnapshot {
  const byAgent: Record<string, AgentStatus> = {};
  for (const a of AREAS) byAgent[a.id] = { agent: a.id, state: "idle" };

  let runId: string | undefined, correlationId: string | undefined, phase: string | undefined;
  let pendingReview = false, anyFailed = false, anyBlocked = false;

  for (const e of events) {
    runId = e.runId ?? runId;
    correlationId = e.correlationId ?? correlationId;
    const agentName = (e.data?.agentName as string) ?? agentFromKind(e.kind);
    if (agentName && byAgent[agentName]) {
      const st = KIND_TO_STATE[e.kind];
      if (st) {
        byAgent[agentName].state = st;
        byAgent[agentName].lastEvent = e;
        byAgent[agentName].latestKind = e.kind;
        if (st === "failed") anyFailed = true;
        if (st === "awaiting_review") pendingReview = true;
      }
    }
    if (e.kind === "run.started") { phase = "running"; if (byAgent["Orchestrator"]) { byAgent["Orchestrator"].state = "working"; byAgent["Orchestrator"].latestKind = e.kind; byAgent["Orchestrator"].lastEvent = e; } }
    if (e.kind === "run.finished") { phase = "completed"; if (byAgent["Orchestrator"]) { byAgent["Orchestrator"].state = "completed"; byAgent["Orchestrator"].latestKind = e.kind; byAgent["Orchestrator"].lastEvent = e; } }
    if (e.kind === "page.skipped") anyBlocked = true;
    if (e.kind === "human.review.completed") pendingReview = false;
    if (e.kind.startsWith("audit") && /blocked/.test(JSON.stringify(e.data ?? {}))) anyBlocked = true;
  }

  return { byAgent, runId, correlationId, phase, pendingReview, anyFailed, anyBlocked };
}

function agentFromKind(_kind: string): string | null { return null; }
