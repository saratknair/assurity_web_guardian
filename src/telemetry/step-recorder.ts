/** Step recorder (virtual-office-replay): honest timing plus a pure Result_Summary per Step_Name. */

import { STEP_IS_TEMPLATE, type StepName } from "./step-model.js";
import type { StepEventData, StepResult } from "./types.js";

// ---------- pure time helpers ----------

/** startedAt = wall start; endedAt = start + max(0, round(duration)). */
export function stepTimes(
  startWallMs: number,
  durationMs: number,
): { startedAt: string; endedAt: string; durationMs: number } {
  const d = Number.isFinite(durationMs) ? Math.max(0, Math.round(durationMs)) : 0;
  return {
    startedAt: new Date(startWallMs).toISOString(),
    endedAt: new Date(startWallMs + d).toISOString(),
    durationMs: d,
  };
}

/** Per-run increasing sequence (starts at 1). Create one per runGuardian call. */
export type StepSeq = () => number;

export function createStepSeq(): StepSeq {
  let n = 0;
  return () => ++n;
}

// ---------- pure summarisers ----------

export interface LoadInput {
  status: number;
  reached: boolean;
  /** Names as in the orchestrator, e.g. "desktop:http" or plain "http". */
  checks: { name: string; passed: boolean }[];
}
export interface VisualInput {
  differs: boolean;
  dimensionsChanged: boolean;
  baselinePath: string | null;
}
export interface AxeInput {
  violations: { id: string; impact?: string | null }[];
}
export interface CompareInput {
  outcomes: number;
  failedChecks: number;
}
export interface CountInput {
  items: number;
}
export interface HistoryInput {
  status: string;
  tracked: number;
}
export interface DecisionsInput {
  status: string;
  entries: number;
}

export interface StepInputs {
  "test-plan": unknown;
  load: LoadInput;
  screenshot: unknown;
  "visual-compare": VisualInput;
  "accessibility-scan": AxeInput;
  compare: CompareInput;
  notes: CountInput;
  triage: CountInput;
  history: HistoryInput;
  decisions: DecisionsInput;
}

export interface StepSummary {
  result: StepResult;
  findings?: string[];
}

const IMPACTS = ["critical", "serious", "moderate", "minor"] as const;

function checkShortName(name: string): string {
  const i = name.indexOf(":");
  return i >= 0 ? name.slice(i + 1) : name;
}

/** Pure: Result_Summary and ruleId list for one step, from the design tables. */
export function summariseStep<S extends StepName>(step: S, input: StepInputs[S]): StepSummary {
  switch (step) {
    case "test-plan":
      return { result: { generated: 1 } };
    case "load": {
      const i = input as LoadInput;
      const failed: string[] = [];
      for (const c of i.checks) {
        const n = checkShortName(c.name);
        if (!c.passed && n !== "a11y-critical-serious" && !failed.includes(n)) failed.push(n);
      }
      return {
        result: {
          httpStatus: i.reached ? i.status : 0,
          reached: i.reached,
          checksFailed: failed,
        },
        findings: failed.map((n) => `check:${n}`),
      };
    }
    case "screenshot":
      return { result: { saved: true } };
    case "visual-compare": {
      const i = input as VisualInput;
      return {
        result: { differs: i.differs, dimensionsChanged: i.dimensionsChanged, baseline: i.baselinePath !== null },
        findings: i.differs ? ["visual-diff"] : [],
      };
    }
    case "accessibility-scan": {
      const i = input as AxeInput;
      const counts = { critical: 0, serious: 0, moderate: 0, minor: 0, unrated: 0 };
      const ids: string[] = [];
      for (const v of i.violations) {
        const imp = (IMPACTS as readonly string[]).includes(v.impact ?? "")
          ? (v.impact as (typeof IMPACTS)[number])
          : "unrated";
        counts[imp] += 1;
        if (v.id !== "a11y-critical-serious" && v.id !== "check:a11y-critical-serious" && !ids.includes(v.id)) ids.push(v.id);
      }
      return { result: { violations: counts, rules: ids.length }, findings: ids };
    }
    case "compare": {
      const i = input as CompareInput;
      return { result: { outcomes: i.outcomes, failedChecks: i.failedChecks } };
    }
    case "notes":
    case "triage":
      return { result: { items: (input as CountInput).items } };
    case "history": {
      const i = input as HistoryInput;
      return { result: { status: i.status, tracked: i.tracked } };
    }
    case "decisions": {
      const i = input as DecisionsInput;
      return { result: { status: i.status, entries: i.entries } };
    }
    default:
      return { result: {} };
  }
}

// ---------- impure shell ----------

export interface StepMeta {
  step: StepName;
  agent: string;
  pageUrl?: string;
  slug?: string;
  viewport?: "desktop" | "mobile";
  /** Per-run sequence from createStepSeq(); a per-emitter counter is used when omitted. */
  seq?: StepSeq;
}

const fallbackSeq = new WeakMap<object, StepSeq>();

function seqFor(tel: object, meta: StepMeta): StepSeq {
  if (meta.seq) return meta.seq;
  let s = fallbackSeq.get(tel);
  if (!s) {
    s = createStepSeq();
    fallbackSeq.set(tel, s);
  }
  return s;
}

/**
 * Run `work`, emit one step.completed with real timing. On throw: emit
 * `result: { failed: true }` (no error text) and rethrow.
 */
export async function recordStep<T>(
  tel: { step(d: StepEventData): void },
  meta: StepMeta,
  work: () => Promise<T> | T,
  summarise: (out: T) => StepSummary,
): Promise<T> {
  const nextSeq = seqFor(tel, meta);
  const wall = Date.now();
  const t0 = performance.now();

  const emit = (summary: StepSummary): void => {
    const times = stepTimes(wall, performance.now() - t0);
    const data: StepEventData = {
      seq: nextSeq(),
      step: meta.step,
      agent: meta.agent,
      startedAt: times.startedAt,
      endedAt: times.endedAt,
      durationMs: times.durationMs,
      template: STEP_IS_TEMPLATE[meta.step],
      result: summary.result,
    };
    if (meta.pageUrl !== undefined) data.pageUrl = meta.pageUrl;
    if (meta.slug !== undefined) data.slug = meta.slug;
    if (meta.viewport !== undefined) data.viewport = meta.viewport;
    if (summary.findings !== undefined) data.findings = summary.findings;
    tel.step(data);
  };

  let out: T;
  try {
    out = await work();
  } catch (err) {
    emit({ result: { failed: true } });
    throw err;
  }
  let summary: StepSummary;
  try {
    summary = summarise(out);
  } catch {
    summary = { result: { failed: true } };
  }
  emit(summary);
  return out;
}
