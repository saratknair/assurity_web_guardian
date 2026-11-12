// Stations and the Station_Mapping for the Virtual Office.
// Pure data. No window/document access at import time.
// Must stay equal to src/telemetry/step-model.ts (a unit test compares them).

export const STEP_NAMES = Object.freeze([
  "test-plan", "load", "screenshot", "visual-compare", "accessibility-scan",
  "compare", "notes", "triage", "history", "decisions",
]);

export const STATION_IDS = Object.freeze([
  "test-plan-desk", "browser-bay", "visual-check",
  "accessibility-check", "review-desk", "records-room",
]);

// Display order is process order (also the ring order in the Diorama).
export const STATIONS = Object.freeze([
  Object.freeze({
    id: "test-plan-desk",
    name: "Test plan desk",
    description: "Holds the test plan that the Test_Generator prepares for each page before the browser opens it.",
    steps: Object.freeze(["test-plan"]),
  }),
  Object.freeze({
    id: "browser-bay",
    name: "Browser bay",
    description: "Where the Observation_Runner opens each page in a real browser, reads the response, title, heading and navigation, and takes the screenshot.",
    steps: Object.freeze(["load", "screenshot"]),
  }),
  Object.freeze({
    id: "visual-check",
    name: "Visual check",
    description: "Compares the new screenshot with the saved baseline image and records whether they differ.",
    steps: Object.freeze(["visual-compare"]),
  }),
  Object.freeze({
    id: "accessibility-check",
    name: "Accessibility check",
    description: "Runs the axe accessibility scan on the loaded page and records the rules that were violated, by impact.",
    steps: Object.freeze(["accessibility-scan"]),
  }),
  Object.freeze({
    id: "review-desk",
    name: "Review desk",
    description: "Where the Comparator turns the checks into outcomes, and where the notes and triage steps write fixed template text about them.",
    steps: Object.freeze(["compare", "notes", "triage"]),
  }),
  Object.freeze({
    id: "records-room",
    name: "Records room",
    description: "Keeps the run history (new, recurring and resolved findings) and applies the saved reviewer decisions.",
    steps: Object.freeze(["history", "decisions"]),
  }),
]);

export const STEP_STATION = Object.freeze({
  "test-plan": "test-plan-desk",
  "load": "browser-bay",
  "screenshot": "browser-bay",
  "visual-compare": "visual-check",
  "accessibility-scan": "accessibility-check",
  "compare": "review-desk",
  "notes": "review-desk",
  "triage": "review-desk",
  "history": "records-room",
  "decisions": "records-room",
});

// Guardian component (figure) that performs each step.
export const STEP_AGENT = Object.freeze({
  "test-plan": "Test_Generator",
  "load": "Observation_Runner",
  "screenshot": "Observation_Runner",
  "visual-compare": "Observation_Runner",
  "accessibility-scan": "Observation_Runner",
  "compare": "Comparator",
  "notes": "Quality_Analysis_Agent",
  "triage": "Triage_Agent",
  "history": "Lifecycle_Tracker",
  "decisions": "Decision_Recorder",
});

// Automated_Template_Steps: output comes from fixed text templates.
export const STEP_IS_TEMPLATE = Object.freeze({
  "test-plan": false,
  "load": false,
  "screenshot": false,
  "visual-compare": false,
  "accessibility-scan": false,
  "compare": false,
  "notes": true,
  "triage": true,
  "history": false,
  "decisions": false,
});

export const TEMPLATE_LABEL = "automated template step";

export function isStepName(s) {
  return typeof s === "string" && Object.prototype.hasOwnProperty.call(STEP_STATION, s);
}

export function isStationId(s) {
  return typeof s === "string" && STATION_IDS.indexOf(s) !== -1;
}

export function stationById(id) {
  for (let i = 0; i < STATIONS.length; i++) {
    if (STATIONS[i].id === id) return STATIONS[i];
  }
  return null;
}

export function stationName(id) {
  const s = stationById(id);
  return s ? s.name : "not recorded";
}
