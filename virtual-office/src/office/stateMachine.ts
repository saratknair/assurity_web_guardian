import type { GEvent } from "../useGuardianEvents.js";
import { AREAS } from "../officeState.js";
import type { DeskManager } from "./deskManager.js";
import type { HumanAppearance } from "./appearance.js";
import { appearanceFor } from "./appearance.js";

// Office state machine — a PURE fold over genuine Guardian events.
//
// HONESTY is the critical guarantee (validated later by Property 4 and
// Property 5): a character exists on screen ONLY because a genuine agent event
// backs it. Malformed or absent events never create a character or otherwise
// change the honest state. The module is intentionally free of three.js / React
// so it is unit- and property-testable in isolation.

export type CharPhase =
  | "entering"
  | "waiting"
  | "seated"
  | "working"
  | "leaving"
  | "gone";

export type CharRole = "deterministic" | "ai" | "coordinator" | "human";

export interface OfficeCharacter {
  id: string; // stable per (agentName, run occurrence)
  agentName: string; // genuine name from event.data.agentName
  role: CharRole;
  appearance: HumanAppearance; // derived deterministically from agentName
  phase: CharPhase;
  deskId: string | null; // assigned dynamically; null while waiting/entering/leaving/gone
  labelText: string; // agent name truncated to 24 chars + "…"
}

export interface OfficeModel {
  characters: OfficeCharacter[];
  idle: boolean;
  runId?: string;
}

export type { HumanAppearance, DeskManager };

// ---------------------------------------------------------------------------
// Label truncation (defined once; also used by the billboard label, task 5.12)
// ---------------------------------------------------------------------------

const MAX_LABEL = 24;

/** Full agent name truncated to 24 chars with a trailing ellipsis if longer. */
export function truncateLabel(name: string): string {
  if (name.length <= MAX_LABEL) return name;
  // Reserve the final slot for the ellipsis so the result is exactly 24 chars.
  return name.slice(0, MAX_LABEL - 1) + "…";
}

// ---------------------------------------------------------------------------
// Role derivation — kept consistent with officeState.ts AREAS
// ---------------------------------------------------------------------------

// Build a direct lookup from the canonical AREAS list. AREAS also contains
// "store" kinds (archives/boards) which are not characters; those are excluded
// from the character role union by the fallback below.
const AREA_ROLE: Record<string, CharRole> = (() => {
  const map: Record<string, CharRole> = {};
  for (const a of AREAS) {
    if (a.kind === "coordinator" || a.kind === "ai" || a.kind === "human" || a.kind === "deterministic") {
      map[a.id] = a.kind;
    }
  }
  return map;
})();

/**
 * Role for an agent name, derived using the same mapping as AREAS:
 *   coordinator = Orchestrator / RunControl
 *   ai          = Specification / Quality_Analysis / Visual_Explanation / Triage
 *   human       = HumanReview
 *   else        = deterministic
 * Exact AREAS ids win; otherwise a case-insensitive pattern match is used so
 * genuine names that differ slightly from the AREAS id still resolve sensibly.
 */
export function roleFor(agentName: string): CharRole {
  const exact = AREA_ROLE[agentName];
  if (exact) return exact;

  const n = agentName.toLowerCase();
  if (n.includes("orchestrator") || n.includes("runcontrol") || n.includes("run control")) {
    return "coordinator";
  }
  if (
    n.includes("specification") ||
    n.includes("quality_analysis") ||
    n.includes("quality analysis") ||
    n.includes("visual_explanation") ||
    n.includes("visual explanation") ||
    n.includes("triage")
  ) {
    return "ai";
  }
  if (n.includes("humanreview") || n.includes("human review")) {
    return "human";
  }
  return "deterministic";
}

// ---------------------------------------------------------------------------
// Event classification
// ---------------------------------------------------------------------------

const ENTER_KINDS = new Set(["agent.started", "agent.working"]);
const EXIT_KINDS = new Set(["agent.completed", "agent.failed"]);

/** A character is "present" (visible, holding/awaiting a desk) in these phases. */
const PRESENT_PHASES: ReadonlySet<CharPhase> = new Set<CharPhase>([
  "entering",
  "waiting",
  "seated",
  "working",
]);

function isPresent(c: OfficeCharacter): boolean {
  return PRESENT_PHASES.has(c.phase);
}

/**
 * Extract the genuine agent name from an event, or null if the event is
 * malformed/absent for lifecycle purposes (no string kind, or no non-empty
 * string data.agentName). Honest state is retained when this returns null.
 */
function agentNameOf(event: GEvent | null | undefined): string | null {
  if (!event || typeof event !== "object") return null;
  if (typeof event.kind !== "string" || event.kind.length === 0) return null;
  const data = event.data;
  if (!data || typeof data !== "object") return null;
  const name = (data as Record<string, unknown>).agentName;
  if (typeof name !== "string" || name.length === 0) return null;
  return name;
}

function makeCharacter(agentName: string, phase: CharPhase, deskId: string | null): OfficeCharacter {
  return {
    id: agentName, // stable per present occurrence of the agent
    agentName,
    role: roleFor(agentName),
    appearance: appearanceFor(agentName),
    phase,
    deskId,
    labelText: truncateLabel(agentName),
  };
}

function computeIdle(characters: OfficeCharacter[]): boolean {
  return !characters.some(isPresent);
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

/**
 * Fold a single event into the office model. PURE given (prev, event, desks):
 * the only side effects are desk acquire/release calls on the supplied
 * DeskManager, which is the declared contract. Malformed/absent/unknown events
 * return `prev` unchanged.
 */
export function reduceOffice(prev: OfficeModel, event: GEvent, desks: DeskManager): OfficeModel {
  const agentName = agentNameOf(event);

  // Unknown lifecycle kinds that still carry a runId can refresh runId, but
  // malformed events (no name) never create characters and never mutate state.
  const kind = event?.kind;
  const isEnter = typeof kind === "string" && ENTER_KINDS.has(kind);
  const isExit = typeof kind === "string" && EXIT_KINDS.has(kind);

  if (!agentName || (!isEnter && !isExit)) {
    // Ignore: malformed/absent/unknown event. Honest state retained.
    return prev;
  }

  const runId = event.runId ?? prev.runId;
  const idx = prev.characters.findIndex((c) => c.agentName === agentName && isPresent(c));

  if (isEnter) {
    if (idx !== -1) {
      // Agent already has a present character. Advance seated -> working on
      // genuine work, but otherwise leave the honest phase as-is.
      const existing = prev.characters[idx];
      let nextPhase = existing.phase;
      if (kind === "agent.working" && (existing.phase === "seated" || existing.phase === "entering")) {
        nextPhase = "working";
      }
      if (nextPhase === existing.phase && runId === prev.runId) {
        return prev;
      }
      const characters = prev.characters.slice();
      characters[idx] = { ...existing, phase: nextPhase };
      return { ...prev, characters, runId, idle: computeIdle(characters) };
    }

    // No present character for this agent -> create one in "entering" and try
    // to acquire a desk. A free desk seats/works the character; otherwise it
    // waits with no desk.
    const newChar = makeCharacter(agentName, "entering", null);
    const deskId = desks.acquire(newChar.id);
    if (deskId !== null) {
      newChar.deskId = deskId;
      newChar.phase = kind === "agent.working" ? "working" : "seated";
    } else {
      newChar.deskId = null;
      newChar.phase = "waiting";
    }
    const characters = [...prev.characters, newChar];
    return { ...prev, characters, runId, idle: computeIdle(characters) };
  }

  // isExit: agent.completed / agent.failed -> present character leaves.
  if (idx === -1) {
    // No present character to retire. Ignore (honest state retained) but keep
    // runId fresh if newer.
    if (runId === prev.runId) return prev;
    return { ...prev, runId };
  }

  const existing = prev.characters[idx];
  // Free the desk the character held (no-op if it was waiting with no desk).
  desks.release(existing.deskId);
  const characters = prev.characters.slice();
  characters[idx] = { ...existing, phase: "leaving", deskId: null };
  // "leaving" is a transient, non-present phase -> immediately considered gone
  // for honesty/idle purposes; the Human component animates the exit.
  return { ...prev, characters, runId, idle: computeIdle(characters) };
}

/** Fold reduceOffice over an ordered event list, starting from an empty office. */
export function deriveOffice(events: GEvent[], desks: DeskManager): OfficeModel {
  let model: OfficeModel = { characters: [], idle: true };
  if (!Array.isArray(events)) return model;
  for (const event of events) {
    model = reduceOffice(model, event, desks);
  }
  return model;
}
