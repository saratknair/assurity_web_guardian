// Pure severity helpers. No window/document access at import time.
// Requirements 2.7, 2.8: "unrated" shows "Not rated"; legacy runs show
// "Severity not recorded for this run". Symbols are distinct shapes so that
// severity never relies on colour alone.

export const SEVERITY_ORDER = Object.freeze([
  "critical",
  "serious",
  "moderate",
  "minor",
  "unrated",
  "not-recorded",
]);

const LABELS = Object.freeze({
  critical: "Critical",
  serious: "Serious",
  moderate: "Moderate",
  minor: "Minor",
  unrated: "Not rated",
  "not-recorded": "Severity not recorded for this run",
});

// Source stays ASCII; the escapes render as geometric shapes.
const SYMBOLS = Object.freeze({
  critical: "\u25C6", // black diamond
  serious: "\u25B2", // black up-pointing triangle
  moderate: "\u25CF", // black circle
  minor: "\u25A0", // black square
  unrated: "?",
  "not-recorded": "-",
});

function known(severity) {
  return typeof severity === "string" && SEVERITY_ORDER.includes(severity);
}

/** Lower rank = more severe. Unknown values sort after every known value. */
export function rank(severity) {
  return known(severity) ? SEVERITY_ORDER.indexOf(severity) : SEVERITY_ORDER.length;
}

/** Human label. Unknown values are treated as "not-recorded" (never inferred). */
export function label(severity) {
  return known(severity) ? LABELS[severity] : LABELS["not-recorded"];
}

/** Non-colour symbol for a severity. */
export function symbol(severity) {
  return known(severity) ? SYMBOLS[severity] : SYMBOLS["not-recorded"];
}
