import type { AgentState, AreaDef } from "../officeState";
import { AREAS } from "../officeState";

// 3D desk layout. Agents are grouped into functional "pods" and placed on a
// floor grid. Positions are deterministic so the room is stable across runs.

export interface DeskLayout {
  area: AreaDef;
  position: [number, number, number];
  rotationY: number;
}

// Group ordering controls which row a pod sits in.
const GROUP_ROW: Record<AreaDef["kind"], number> = {
  coordinator: 0,
  deterministic: 1,
  ai: 2,
  human: 3,
  store: 3,
};

// Build rows per kind, laying desks left-to-right within each row.
export function buildLayout(): DeskLayout[] {
  const byKind: Record<string, AreaDef[]> = {};
  for (const a of AREAS) (byKind[a.kind] ??= []).push(a);

  const spacingX = 4.5;
  const spacingZ = 5.5;
  const out: DeskLayout[] = [];

  // Combine human+store into the same back row but offset.
  const rowMembers: Record<number, AreaDef[]> = {};
  for (const a of AREAS) {
    const row = GROUP_ROW[a.kind];
    (rowMembers[row] ??= []).push(a);
  }

  for (const rowStr of Object.keys(rowMembers)) {
    const row = Number(rowStr);
    const members = rowMembers[row];
    const rowWidth = (members.length - 1) * spacingX;
    members.forEach((area, i) => {
      const x = i * spacingX - rowWidth / 2;
      const z = row * spacingZ - 8;
      // Characters face toward the camera entry (+z), desks face -z.
      out.push({ area, position: [x, 0, z], rotationY: Math.PI });
    });
  }
  return out;
}

// State -> accent color for monitor glow, name tag, and desk trim.
export const STATE_COLOR: Record<AgentState, string> = {
  idle: "#9aa3af",
  queued: "#64748b",
  started: "#38bdf8",
  working: "#22c55e",
  waiting_for_dependency: "#f59e0b",
  awaiting_review: "#a855f7",
  completed: "#16a34a",
  failed: "#ef4444",
  blocked: "#b91c1c",
  skipped: "#6b7280",
};

export const STATE_LABEL: Record<AgentState, string> = {
  idle: "Idle", queued: "Queued", started: "Started", working: "Working",
  waiting_for_dependency: "Waiting", awaiting_review: "Awaiting review",
  completed: "Completed", failed: "Failed", blocked: "Blocked", skipped: "Skipped",
};

// Skin/shirt palette by kind so pods read as distinct teams.
export const KIND_SHIRT: Record<AreaDef["kind"], string> = {
  coordinator: "#2563eb",
  deterministic: "#0ea5e9",
  ai: "#f97316",
  human: "#10b981",
  store: "#8b5cf6",
};

// Areas that are stores/boards, not agents that emit work events. These are
// rendered as furniture/props (no seated worker) so the office does not imply
// an idle person where there simply is no agent.
export const PROP_AREAS = new Set<string>([
  "RunControl", "EvidenceArchive", "CompletedRuns", "FailedBlocked", "HumanReview",
]);

export function isProp(areaId: string): boolean {
  return PROP_AREAS.has(areaId);
}
