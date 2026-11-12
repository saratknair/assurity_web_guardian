import { findingKey } from "../core/finding-model.js";
import { STEP_STATION, isStepName, type StationId, type StepName } from "../telemetry/step-model.js";

/**
 * Pure replay publication (virtual-office-replay design section B). No fs.
 * Takes sanitized Run_Events plus the built run findings and returns the
 * compact ASCII events text, the run-level `replay` object, `producedAt`
 * per published finding id and the first-step time per page slug.
 * Requirements 1.11, 1.12, 1.13, 1.15, 12.5, 18.4.
 */

export const EVENTS_CAP_BYTES = 262144;

export interface ProducedAt {
  entryId: string;
  t: number;
  station: StationId;
}

export interface TruncationInfo {
  level: number;
  droppedKinds: string[];
  droppedEvents: number;
  overCap: boolean;
}

export interface ReplayPublication {
  eventsText: string;
  replay: { enriched: boolean; durationMs: number };
  producedAtById: Map<string, ProducedAt | null>;
  replayTBySlug: Map<string, number>;
}

/** The minimal slice of BuiltRun this module reads. */
export interface ReplayBuiltInput {
  runFindings: {
    findings: { id: string; pageUrl: string; viewport: string; ruleId: string }[];
    ignored: { id: string; pageUrl: string; viewport: string; ruleId: string }[];
  };
}

export interface ReplayOptions {
  /** Byte cap for the events text; defaults to 262,144. */
  capBytes?: number;
}

type Json = Record<string, unknown>;

function isObj(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Compact JSON where every code unit above 0x7E is written as \uXXXX. Round-trips via JSON.parse. */
export function toAsciiJson(value: unknown): string {
  const text = JSON.stringify(value);
  return text.replace(/[\u007f-\uffff]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
}

function kindOf(ev: unknown): string {
  return isObj(ev) && typeof ev.kind === "string" ? ev.kind : "";
}

function dataOf(ev: unknown): Json | null {
  return isObj(ev) && isObj(ev.data) ? ev.data : null;
}

function isStepEvent(ev: unknown): ev is Json {
  const d = dataOf(ev);
  return kindOf(ev) === "step.completed" && d !== null && typeof d.seq === "number" && Number.isFinite(d.seq);
}

function tsMs(ev: unknown): number | null {
  if (!isObj(ev) || typeof ev.ts !== "string") return null;
  const n = Date.parse(ev.ts);
  return Number.isNaN(n) ? null : n;
}

/** Enriched iff run.started carries replaySchema 1 and at least one step.completed has a numeric seq. */
export function isEnrichedRun(events: unknown[]): boolean {
  const started = events.find((e) => kindOf(e) === "run.started");
  const d = dataOf(started);
  if (!d || d.replaySchema !== 1) return false;
  return events.some(isStepEvent);
}

function stepStartMs(ev: Json): number | null {
  const d = dataOf(ev);
  if (!d || typeof d.startedAt !== "string") return null;
  const n = Date.parse(d.startedAt);
  return Number.isNaN(n) ? null : n;
}

function stepEndMs(ev: Json): number | null {
  const d = dataOf(ev);
  if (!d || typeof d.endedAt !== "string") return null;
  const n = Date.parse(d.endedAt);
  return Number.isNaN(n) ? null : n;
}

function stepKeys(ev: Json): string[] {
  const d = dataOf(ev);
  if (!d || typeof d.pageUrl !== "string" || (d.viewport !== "desktop" && d.viewport !== "mobile")) return [];
  if (!Array.isArray(d.findings)) return [];
  const out: string[] = [];
  for (const r of d.findings) {
    if (typeof r === "string") out.push(findingKey({ pageUrl: d.pageUrl, viewport: d.viewport, ruleId: r }));
  }
  return out;
}

/** Returns a copy of the events with `findingIds` added by exact key lookup. Never guesses. */
export function addFindingIds(events: unknown[], built: ReplayBuiltInput, _runId?: string): unknown[] {
  const idByKey = new Map<string, string>();
  for (const f of [...built.runFindings.findings, ...built.runFindings.ignored]) {
    if (f.viewport !== "desktop" && f.viewport !== "mobile") continue;
    idByKey.set(findingKey({ pageUrl: f.pageUrl, viewport: f.viewport, ruleId: f.ruleId }), f.id);
  }
  return events.map((ev) => {
    if (!isStepEvent(ev)) return ev;
    const d = dataOf(ev)!;
    if (typeof d.pageUrl !== "string" || (d.viewport !== "desktop" && d.viewport !== "mobile")) return ev;
    if (!Array.isArray(d.findings)) return ev;
    const ids: Record<string, string> = {};
    for (const r of d.findings) {
      if (typeof r !== "string") continue;
      const id = idByKey.get(findingKey({ pageUrl: d.pageUrl, viewport: d.viewport, ruleId: r }));
      if (id !== undefined) ids[r] = id;
    }
    if (Object.keys(ids).length === 0) return ev;
    return { ...ev, data: { ...d, findingIds: ids } };
  });
}

function runStartedMs(events: unknown[]): number | null {
  const s = events.find((e) => kindOf(e) === "run.started");
  return s === undefined ? null : tsMs(s);
}

/** Exact key match only: the first step by (startedAt, seq) that records the finding key. No proximity. */
export function computeProducedAt(
  events: unknown[],
  built: ReplayBuiltInput,
): Map<string, ProducedAt | null> {
  const out = new Map<string, ProducedAt | null>();
  const base = runStartedMs(events);
  const steps = events
    .filter(isStepEvent)
    .map((ev) => ({ ev, start: stepStartMs(ev), seq: dataOf(ev)!.seq as number }))
    .filter((s): s is { ev: Json; start: number; seq: number } => s.start !== null)
    .sort((a, b) => a.start - b.start || a.seq - b.seq);
  const first = new Map<string, { ev: Json; start: number; seq: number }>();
  for (const s of steps) {
    for (const k of stepKeys(s.ev)) if (!first.has(k)) first.set(k, s);
  }
  for (const f of [...built.runFindings.findings, ...built.runFindings.ignored]) {
    const hit =
      base !== null && (f.viewport === "desktop" || f.viewport === "mobile")
        ? first.get(findingKey({ pageUrl: f.pageUrl, viewport: f.viewport, ruleId: f.ruleId }))
        : undefined;
    if (!hit) {
      out.set(f.id, null);
      continue;
    }
    const step = dataOf(hit.ev)!.step;
    out.set(f.id, {
      entryId: `step-${hit.seq}`,
      t: Math.max(0, hit.start - (base as number)),
      station: isStepName(step) ? STEP_STATION[step] : "review-desk",
    });
  }
  return out;
}

function computeReplayT(events: unknown[]): Map<string, number> {
  const out = new Map<string, number>();
  const base = runStartedMs(events);
  if (base === null) return out;
  for (const ev of events) {
    if (!isStepEvent(ev)) continue;
    const d = dataOf(ev)!;
    const start = stepStartMs(ev);
    if (typeof d.slug !== "string" || start === null) continue;
    const t = Math.max(0, start - base);
    const cur = out.get(d.slug);
    if (cur === undefined || t < cur) out.set(d.slug, t);
  }
  return out;
}

function computeDurationMs(events: unknown[]): number {
  const base = runStartedMs(events);
  if (base === null) return 0;
  let end = 0;
  for (const ev of events) {
    if (kindOf(ev) === "run.finished") {
      const t = tsMs(ev);
      if (t !== null) end = Math.max(end, t - base);
    }
    if (isStepEvent(ev)) {
      const e = stepEndMs(ev);
      if (e !== null) end = Math.max(end, e - base);
    }
  }
  return Math.max(0, Math.round(end));
}

// ---- truncation -----------------------------------------------------------

const TIER1_EXACT = new Set(["audit", "a11y.history", "a11y.history.unavailable", "run.record", "discovery.validated"]);

function isTier1Kind(kind: string): boolean {
  return TIER1_EXACT.has(kind) || kind.startsWith("publish.") || kind.startsWith("dashboard.");
}

function isTier2Kind(kind: string): boolean {
  return kind.startsWith("agent.") || kind === "human.review.completed";
}

const TIER4_STEPS = new Set<string>(["compare", "notes", "triage", "history", "decisions", "test-plan", "screenshot"]);

function mapStepData(events: unknown[], fn: (d: Json) => Json): unknown[] {
  return events.map((ev) => {
    if (!isStepEvent(ev)) return ev;
    return { ...ev, data: fn(dataOf(ev)!) };
  });
}

function omit(d: Json, keys: string[]): Json {
  const o: Json = {};
  for (const k of Object.keys(d)) if (!keys.includes(k)) o[k] = d[k];
  return o;
}

interface TierResult {
  events: unknown[];
  droppedKinds: string[];
  droppedEvents: number;
  changed: boolean;
}

function applyTier(tier: number, events: unknown[], enriched: boolean): TierResult {
  const dropKinds = new Set<string>();
  let dropped = 0;
  let out = events;
  if (tier === 1 || (tier === 2 && enriched)) {
    const pred = tier === 1 ? isTier1Kind : isTier2Kind;
    out = events.filter((ev) => {
      const k = kindOf(ev);
      if (pred(k)) {
        dropKinds.add(k);
        dropped++;
        return false;
      }
      return true;
    });
    return { events: out, droppedKinds: [...dropKinds], droppedEvents: dropped, changed: dropped > 0 };
  }
  let changed = false;
  if (tier === 3) {
    out = mapStepData(events, (d) => {
      if ("agent" in d || "template" in d) changed = true;
      return omit(d, ["agent", "template"]);
    });
  } else if (tier === 4) {
    out = mapStepData(events, (d) => {
      if (typeof d.step === "string" && TIER4_STEPS.has(d.step) && "result" in d) {
        changed = true;
        return omit(d, ["result"]);
      }
      return d;
    });
  } else if (tier === 5) {
    out = mapStepData(events, (d) => {
      if (!isObj(d.result)) return d;
      const r = d.result;
      if (!("checksFailed" in r || "baseline" in r || "dimensionsChanged" in r)) return d;
      changed = true;
      return { ...d, result: omit(r, ["checksFailed", "baseline", "dimensionsChanged"]) };
    });
  }
  return { events: out, droppedKinds: [], droppedEvents: 0, changed };
}

function stepCount(events: unknown[]): number {
  return events.filter(isStepEvent).length;
}

function buildMeta(
  events: unknown[],
  enriched: boolean,
  truncated: TruncationInfo | null,
  runId: string,
): Json {
  const started = events.find((e) => kindOf(e) === "run.started");
  const last = events[events.length - 1];
  const ref = isObj(last) ? last : isObj(started) ? started : {};
  const src = isObj(started) ? started : ref;
  return {
    ts: typeof ref.ts === "string" ? ref.ts : typeof src.ts === "string" ? src.ts : "",
    correlationId: typeof src.correlationId === "string" ? src.correlationId : "",
    runId: typeof src.runId === "string" ? src.runId : runId,
    kind: "replay.meta",
    data: { schemaVersion: 1, enriched, stepCount: stepCount(events), truncated },
  };
}

/**
 * Serialize with truncation tiers 1 to 5 applied in order, re-measuring after each,
 * until the text fits the cap. Always-kept fields (step identity, times, findings,
 * findingIds, results of load / visual-compare / accessibility-scan) are never removed.
 * A trailing replay.meta event is added for enriched or truncated runs.
 */
export function capEvents(
  events: unknown[],
  runId: string,
  enriched: boolean,
  capBytes: number = EVENTS_CAP_BYTES,
): { text: string; truncated: TruncationInfo | null } {
  const base = events.filter((e) => kindOf(e) !== "replay.meta");
  const render = (evs: unknown[], trunc: TruncationInfo | null): string => {
    const list = enriched || trunc ? [...evs, buildMeta(evs, enriched, trunc, runId)] : evs;
    return toAsciiJson(list);
  };
  let text = render(base, null);
  if (text.length <= capBytes) return { text, truncated: null };

  let cur = base;
  let level = 0;
  const kinds = new Set<string>();
  let droppedEvents = 0;
  let trunc: TruncationInfo = { level: 0, droppedKinds: [], droppedEvents: 0, overCap: false };
  for (let tier = 1; tier <= 5; tier++) {
    const r = applyTier(tier, cur, enriched);
    if (r.changed) {
      cur = r.events;
      level = tier;
      for (const k of r.droppedKinds) kinds.add(k);
      droppedEvents += r.droppedEvents;
    }
    trunc = { level, droppedKinds: [...kinds].sort(), droppedEvents, overCap: false };
    text = render(cur, trunc);
    if (text.length <= capBytes) return { text, truncated: trunc };
  }
  trunc = { ...trunc, overCap: true };
  return { text: render(cur, trunc), truncated: trunc };
}

/** Entry point used by the Publisher (task 3.2 wires it in). Pure: no fs, no clock. */
export function buildReplayPublication(
  events: unknown[],
  built: ReplayBuiltInput,
  runId: string,
  opts: ReplayOptions = {},
): ReplayPublication {
  const list = Array.isArray(events) ? events : [];
  const enriched = isEnrichedRun(list);
  const withIds = enriched ? addFindingIds(list, built, runId) : list;
  const { text } = capEvents(withIds, runId, enriched, opts.capBytes ?? EVENTS_CAP_BYTES);
  return {
    eventsText: text,
    replay: { enriched, durationMs: computeDurationMs(list) },
    producedAtById: enriched ? computeProducedAt(list, built) : nullProducedAt(built),
    replayTBySlug: enriched ? computeReplayT(list) : new Map(),
  };
}

function nullProducedAt(built: ReplayBuiltInput): Map<string, ProducedAt | null> {
  const out = new Map<string, ProducedAt | null>();
  for (const f of [...built.runFindings.findings, ...built.runFindings.ignored]) out.set(f.id, null);
  return out;
}

export type { StepName };
