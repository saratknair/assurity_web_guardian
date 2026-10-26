import { useEffect, useRef, useState, useCallback } from "react";

// Connects to the Phase-10 read-only event-access layer. The office is a
// VISUALISATION layer only — it never manufactures events or agent work.
const BASE = "http://127.0.0.1:7788";

export interface GEvent {
  ts: string;
  correlationId: string;
  runId: string;
  kind: string;
  taskId?: string;
  data?: Record<string, unknown>;
  mode?: string; // "replay" when replayed
}

export type Mode = "live" | "historical" | "replay";

export function useRuns() {
  const [runs, setRuns] = useState<{ runId: string }[]>([]);
  useEffect(() => {
    fetch(`${BASE}/runs`).then((r) => r.json()).then(setRuns).catch(() => setRuns([]));
  }, []);
  return runs;
}

/** Live mode: SSE of the active run's genuine events. Idle when none active. */
export function useLive(active: boolean) {
  const [events, setEvents] = useState<GEvent[]>([]);
  const [idle, setIdle] = useState(true);
  const esRef = useRef<EventSource | null>(null);
  useEffect(() => {
    if (!active) return;
    setEvents([]);
    const es = new EventSource(`${BASE}/live`);
    esRef.current = es;
    es.addEventListener("idle", () => setIdle(true));
    es.onmessage = (m) => {
      try { const e = JSON.parse(m.data) as GEvent; if (!(e as { idle?: boolean }).idle) { setIdle(false); setEvents((p) => [...p, e]); } } catch { /* ignore */ }
    };
    es.onerror = () => { /* browser auto-reconnects; server dedupes by sent-count */ };
    return () => es.close();
  }, [active]);
  return { events, idle };
}

/** Replay mode: timestamp-ordered replay of a completed run. Clearly labeled. */
export function useReplay(runId: string | null, speed: number, playing: boolean) {
  const [events, setEvents] = useState<GEvent[]>([]);
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!runId || !playing) return;
    setEvents([]); setDone(false);
    const es = new EventSource(`${BASE}/replay/${runId}?speed=${speed}`);
    es.addEventListener("replay-end", () => { setDone(true); es.close(); });
    es.onmessage = (m) => { try { setEvents((p) => [...p, JSON.parse(m.data) as GEvent]); } catch { /* ignore */ } };
    return () => es.close();
  }, [runId, speed, playing]);
  return { events, done };
}

export function useHistorical(runId: string | null) {
  const [events, setEvents] = useState<GEvent[]>([]);
  const load = useCallback(() => {
    if (!runId) return;
    fetch(`${BASE}/runs/${runId}/events`).then((r) => r.json()).then(setEvents).catch(() => setEvents([]));
  }, [runId]);
  useEffect(() => { load(); }, [load]);
  return events;
}

export async function fetchFindings(runId: string): Promise<unknown> {
  return fetch(`${BASE}/runs/${runId}/findings`).then((r) => r.json()).catch(() => ({}));
}
