/** Step model: the single Guardian-side source of the Station_Mapping (virtual-office-replay). */

export const STEP_NAMES = [
  "test-plan",
  "load",
  "screenshot",
  "visual-compare",
  "accessibility-scan",
  "compare",
  "notes",
  "triage",
  "history",
  "decisions",
] as const;

export type StepName = (typeof STEP_NAMES)[number];

export const STATION_IDS = [
  "test-plan-desk",
  "browser-bay",
  "visual-check",
  "accessibility-check",
  "review-desk",
  "records-room",
] as const;

export type StationId = (typeof STATION_IDS)[number];

export const STEP_STATION: Readonly<Record<StepName, StationId>> = {
  "test-plan": "test-plan-desk",
  load: "browser-bay",
  screenshot: "browser-bay",
  "visual-compare": "visual-check",
  "accessibility-scan": "accessibility-check",
  compare: "review-desk",
  notes: "review-desk",
  triage: "review-desk",
  history: "records-room",
  decisions: "records-room",
};

export const STEP_AGENT: Readonly<Record<StepName, string>> = {
  "test-plan": "Test_Generator",
  load: "Observation_Runner",
  screenshot: "Observation_Runner",
  "visual-compare": "Observation_Runner",
  "accessibility-scan": "Observation_Runner",
  compare: "Comparator",
  notes: "Quality_Analysis_Agent",
  triage: "Triage_Agent",
  history: "Lifecycle_Tracker",
  decisions: "Decision_Recorder",
};

/** Automated template steps: output comes from fixed text templates, no AI. */
export const STEP_IS_TEMPLATE: Readonly<Record<StepName, boolean>> = {
  "test-plan": false,
  load: false,
  screenshot: false,
  "visual-compare": false,
  "accessibility-scan": false,
  compare: false,
  notes: true,
  triage: true,
  history: false,
  decisions: false,
};

export function isStepName(value: unknown): value is StepName {
  return typeof value === "string" && (STEP_NAMES as readonly string[]).includes(value);
}
