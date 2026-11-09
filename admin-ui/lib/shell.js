// Pure view-model helpers for the console shell. No DOM access, so tests can import this file directly.

/** "N of 10 used" (design J.13, Requirement 22.2). */
export function usedText(n, max) {
  const used = Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  const limit = Number.isFinite(max) && max >= 0 ? Math.floor(max) : 10;
  return used + " of " + limit + " used";
}

/** The four steps of the New_Domain_Setup wizard. */
export const WIZARD_STEPS = ["Enter the new domain", "Build the approved page list", "Produce baselines", "Confirm and publish"];

/** "Step 2 of 4: Build the approved page list" for a 1-based step number. Out-of-range input is clamped. */
export function stepLabel(step) {
  const total = WIZARD_STEPS.length;
  let n = Number.isFinite(step) ? Math.floor(step) : 1;
  if (n < 1) n = 1;
  if (n > total) n = total;
  return "Step " + n + " of " + total + ": " + WIZARD_STEPS[n - 1];
}

/** Plain-English text for a running or finished job snapshot from GET /api/status. */
export function jobText(job) {
  if (!job || typeof job !== "object") return "No job is running.";
  const kind = typeof job.kind === "string" ? job.kind : "job";
  const state = typeof job.state === "string" ? job.state : "running";
  let progress = "";
  if (typeof job.progress === "string" && job.progress) progress = " (" + job.progress + ")";
  else if (job.progress && typeof job.progress === "object" && Number.isFinite(job.progress.total)) {
    progress = " (" + job.progress.done + " of " + job.progress.total + ")";
  }
  return "Job " + kind + ": " + state + progress;
}
