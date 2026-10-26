import { useEffect, useMemo, useState } from "react";
import type { GEvent } from "../useGuardianEvents.js";
import { useLive, useReplay, useHistorical } from "../useGuardianEvents.js";
import { createDeskManager, defaultDesks } from "./deskManager.js";
import type { OfficeModel } from "./stateMachine.js";
import { deriveOffice } from "./stateMachine.js";

// Office data source abstraction (Requirements 6.10, 6.11).
//
// This module cleanly separates TWO concerns:
//
//   1. WHERE events come from (the transport / mode):
//        - live       → the read-only Event_Server SSE stream at :7788
//        - replay     → a published, sanitized static JSON file (Pages site)
//        - historical → the same static JSON, loaded all at once
//
//   2. HOW office state is derived (the honesty pipeline):
//        - the SAME `deriveOffice` reducer from ./stateMachine.js runs in every
//          mode, so a character appears on screen ONLY because a genuine agent
//          event backs it — whether those events arrived over SSE (live) or
//          were read from published JSON (replay/historical).
//
// The point of the abstraction is that the office App (task 5.19) can consume
// one `OfficeDataSource`/`useOfficeModel` and get identical honesty guarantees
// regardless of where the events originated.
//
// STATIC-MODE NETWORK GUARANTEE (6.10/6.11): in replay and historical modes the
// loader fetches ONLY a relative, same-origin path (`./data/runs/<id>/events.json`).
// It never opens an EventSource (no SSE) and never contacts `127.0.0.1:7788`.
// Only `resolveOfficeMode()` and the `live` hook ever reference the loopback
// Event_Server, and in a `replay` build neither is exercised.

export type OfficeMode = "live" | "replay" | "historical";

/**
 * A single abstraction over "where events come from". `subscribe` registers a
 * callback that receives the current, ordered event list whenever it changes
 * and returns an unsubscribe function. Implementations never fabricate events;
 * they only forward genuine events (SSE) or published events (static JSON).
 */
export interface OfficeDataSource {
  mode: OfficeMode;
  subscribe(cb: (events: GEvent[]) => void): () => void;
}

// ---------------------------------------------------------------------------
// Mode resolution
// ---------------------------------------------------------------------------

// The published Pages build injects `VITE_AWG_MODE` at build time. We read it
// through a narrow, defensive accessor so the module type-checks whether or not
// `vite/client`'s `ImportMetaEnv` augmentation is in scope.
interface AwgImportMetaEnv {
  VITE_AWG_MODE?: string;
}

function readBuildMode(): string | undefined {
  try {
    const meta = import.meta as unknown as { env?: AwgImportMetaEnv };
    const raw = meta.env?.VITE_AWG_MODE;
    return typeof raw === "string" ? raw.trim().toLowerCase() : undefined;
  } catch {
    // `import.meta.env` is unavailable (e.g. a non-Vite context). Fall through.
    return undefined;
  }
}

/**
 * Resolve the office mode.
 *
 * Resolution order (build flag first — explicit and deterministic for the
 * published Pages site):
 *   1. `import.meta.env.VITE_AWG_MODE === "replay"`     → "replay"
 *   2. `import.meta.env.VITE_AWG_MODE === "historical"` → "historical"
 *   3. `import.meta.env.VITE_AWG_MODE === "live"`       → "live"
 *   4. otherwise                                        → "live" (local dev default)
 *
 * Design note (why flag-only, no runtime `/idle` probe): the existing `useLive`
 * hook already owns the loopback SSE connection and reports idle state, so the
 * office does not need a separate probe to decide the mode. A build flag is
 * explicit, synchronous, and — critically — guarantees the static Pages build
 * (`VITE_AWG_MODE=replay`) resolves to "replay" without ever touching the
 * network. Defaulting to "live" for local dev matches today's behavior, where
 * the Event_Server runs on :7788. (A runtime `/idle` probe remains a possible
 * future refinement, but it is intentionally omitted here to keep static mode
 * provably network-free.)
 */
export function resolveOfficeMode(): OfficeMode {
  const flag = readBuildMode();
  if (flag === "replay") return "replay";
  if (flag === "historical") return "historical";
  if (flag === "live") return "live";
  return "live";
}

// ---------------------------------------------------------------------------
// Static (published JSON) loader — replay / historical
// ---------------------------------------------------------------------------

/**
 * Relative, same-origin path to a published run's sanitized events. Kept
 * relative on purpose: on the Pages site this resolves against the office
 * app's base URL, so the request never leaves the origin and never targets
 * `127.0.0.1:7788`.
 */
export function staticEventsPath(runId: string): string {
  return `./data/runs/${encodeURIComponent(runId)}/events.json`;
}

function asEventArray(raw: unknown): GEvent[] {
  // Accept either a bare array or a `{ events: [...] }` envelope; anything else
  // yields an empty list so a malformed file can never fabricate characters.
  if (Array.isArray(raw)) return raw as GEvent[];
  if (raw && typeof raw === "object") {
    const events = (raw as { events?: unknown }).events;
    if (Array.isArray(events)) return events as GEvent[];
  }
  return [];
}

/**
 * Load a published run's events from the static, same-origin path. No SSE, no
 * loopback request — a single relative `fetch`. Resolves to `[]` on any error
 * so the office degrades to honest idle rather than throwing.
 */
export async function loadStaticRunEvents(
  runId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GEvent[]> {
  try {
    const res = await fetchImpl(staticEventsPath(runId));
    if (!res.ok) return [];
    return asEventArray(await res.json());
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// React hooks: "where events come from"
// ---------------------------------------------------------------------------

/**
 * Static events hook shared by replay and historical modes. Both read the same
 * published JSON at once; the distinction is purely semantic (replay = play
 * back a completed run, historical = inspect it), and both feed the identical
 * reducer. Returns the ordered events plus a `loaded` flag.
 */
export function useStaticRunEvents(runId: string | null): { events: GEvent[]; loaded: boolean } {
  const [events, setEvents] = useState<GEvent[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setEvents([]);
    setLoaded(false);
    if (!runId) {
      setLoaded(true);
      return;
    }
    void loadStaticRunEvents(runId).then((evs) => {
      if (cancelled) return;
      setEvents(evs);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [runId]);

  return { events, loaded };
}

/**
 * Resolve the raw event stream for a mode. This is the single place that maps a
 * mode to a transport:
 *   - live       → `useLive` SSE (loopback Event_Server)
 *   - replay     → static published JSON (no SSE, no loopback)
 *   - historical → static published JSON, loaded at once (no SSE, no loopback)
 *
 * `runId` is required for replay/historical and ignored for live.
 */
export function useOfficeEvents(mode: OfficeMode, runId: string | null): GEvent[] {
  // All hooks are called unconditionally (Rules of Hooks); only the relevant
  // transport is activated per mode. In replay/historical the live SSE hook is
  // passed `active=false`, so NO EventSource is opened.
  const live = useLive(mode === "live");
  const staticEvents = useStaticRunEvents(mode === "live" ? null : runId);

  return mode === "live" ? live.events : staticEvents.events;
}

// ---------------------------------------------------------------------------
// React hook: "how office state is derived" (the honesty pipeline)
// ---------------------------------------------------------------------------

/**
 * The single abstraction the office App consumes. It wires a transport (chosen
 * by `mode`) into the SAME `deriveOffice` honesty pipeline, so live (SSE) and
 * static (published JSON) modes produce office state the identical way.
 *
 * A fresh {@link createDeskManager} is created per derivation so desk
 * assignment is a pure function of the current event list (no cross-render
 * leakage of desk state).
 */
export function useOfficeModel(
  mode: OfficeMode = resolveOfficeMode(),
  runId: string | null = null,
  deskCount = 12,
): OfficeModel {
  const events = useOfficeEvents(mode, runId);

  return useMemo(() => {
    const desks = createDeskManager(defaultDesks(deskCount));
    const model = deriveOffice(events, desks);
    return { ...model, mode } as OfficeModel & { mode: OfficeMode };
  }, [events, mode, deskCount]);
}

// ---------------------------------------------------------------------------
// Imperative OfficeDataSource (non-React consumers / tests)
// ---------------------------------------------------------------------------

/**
 * Build an imperative {@link OfficeDataSource} for the static modes. Useful for
 * non-React consumers (e.g. the `verify.mjs` honesty invariant in task 12.2)
 * and tests that want events without a render tree. It performs a single
 * relative `fetch` and then notifies subscribers with the loaded list.
 *
 * Live mode is intentionally NOT provided here because its transport is the
 * React `useLive` SSE hook; use {@link useOfficeModel} with `mode="live"`.
 */
export function createStaticDataSource(
  mode: Extract<OfficeMode, "replay" | "historical">,
  runId: string,
  fetchImpl: typeof fetch = fetch,
): OfficeDataSource {
  return {
    mode,
    subscribe(cb: (events: GEvent[]) => void): () => void {
      let active = true;
      void loadStaticRunEvents(runId, fetchImpl).then((events) => {
        if (active) cb(events);
      });
      return () => {
        active = false;
      };
    },
  };
}

// Re-export the raw historical/replay SSE hooks for consumers that still want
// the loopback-backed variants (live-dev inspection). These are NOT used by the
// static Pages build; `useStaticRunEvents` is the no-network path.
export { useReplay, useHistorical };
