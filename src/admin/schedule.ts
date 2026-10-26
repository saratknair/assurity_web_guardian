import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import type { ScheduleConfig } from "../config/domain-config.js";

/**
 * Schedule helper for the Admin GUI (Phase 2, Requirements 4.4, 4.5, 10.2).
 *
 * The canonical schedule lives in `config/schedule.json` as a `ScheduleConfig`
 * (`{ enabled, intervalHours, dailyAt }`). The JSON file is the single source
 * of truth. On Windows we ALSO best-effort re-register the Task Scheduler entry
 * by invoking `scripts/guardian-task.ps1 install <HH:mm>` so the OS schedule
 * follows the saved `dailyAt`; `guardian-task.ps1` itself reads
 * `schedule.json` so the PS1 and the JSON never drift (design §3). A failure to
 * re-register MUST NOT fail the whole write — the JSON has already been
 * persisted and remains authoritative; the failure is recorded for diagnostics.
 */

/** Canonical schedule file location (repo-relative). */
const SCHEDULE_PATH = "config/schedule.json";

/** Task Scheduler registration script (Windows, local only). */
const TASK_SCRIPT = "scripts/guardian-task.ps1";

/** Matches a 24-hour clock time `HH:mm` with 00-23 hours and 00-59 minutes. */
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Read the current schedule from `config/schedule.json`. */
export function readSchedule(): ScheduleConfig {
  const raw = readFileSync(resolve(SCHEDULE_PATH), "utf8");
  return JSON.parse(raw) as ScheduleConfig;
}

export interface WriteScheduleResult {
  /** The schedule as persisted to disk. */
  schedule: ScheduleConfig;
  /**
   * Whether the Windows Task Scheduler re-registration was attempted and the
   * child process was successfully launched. `false` on non-Windows platforms
   * or when the spawn failed; the JSON write still succeeded.
   */
  reregistered: boolean;
  /** Human-readable note when re-registration was skipped or failed. */
  reregisterNote?: string;
}

/**
 * Validate and persist a `ScheduleConfig` to `config/schedule.json`.
 *
 * Validation (throws on failure, writing NOTHING):
 *   - `enabled` must be a boolean.
 *   - `intervalHours` must be a finite integer >= 1.
 *   - `dailyAt` must be a `HH:mm` 24-hour time string.
 *
 * On success (Windows only) it best-effort re-registers the daily Task
 * Scheduler entry via `guardian-task.ps1 install <dailyAt>`. A spawn failure is
 * swallowed (recorded in the returned note) because the JSON is the source of
 * truth.
 */
export function writeSchedule(next: ScheduleConfig): WriteScheduleResult {
  const errors = validateSchedule(next);
  if (errors.length > 0) {
    throw new ScheduleValidationError(errors.join("; "));
  }

  // Normalize to exactly the shape we persist (drop any extra fields).
  const schedule: ScheduleConfig = {
    enabled: next.enabled,
    intervalHours: next.intervalHours,
    dailyAt: next.dailyAt,
  };

  writeFileSync(resolve(SCHEDULE_PATH), JSON.stringify(schedule, null, 2) + "\n", "utf8");

  // Best-effort OS re-registration; never fail the call on this.
  if (process.platform !== "win32") {
    return { schedule, reregistered: false, reregisterNote: "non-Windows: Task Scheduler not updated" };
  }
  try {
    const child = spawn(
      "powershell",
      [
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        resolve(TASK_SCRIPT),
        "install",
        schedule.dailyAt,
      ],
      { detached: true, stdio: "ignore", windowsHide: true },
    );
    child.on("error", (err) => {
      // Spawn-time failure arrives asynchronously; the JSON is already written.
      console.warn(
        `schedule: Task Scheduler re-registration failed (JSON still authoritative): ${err.message}`,
      );
    });
    child.unref();
    return { schedule, reregistered: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `schedule: Task Scheduler re-registration could not start (JSON still authoritative): ${message}`,
    );
    return { schedule, reregistered: false, reregisterNote: `re-registration failed: ${message}` };
  }
}

/** Thrown when a proposed schedule fails validation; carries all reasons. */
export class ScheduleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScheduleValidationError";
  }
}

/** Return a list of validation errors for a candidate schedule (empty = valid). */
export function validateSchedule(next: unknown): string[] {
  const errors: string[] = [];
  if (typeof next !== "object" || next === null) {
    return ["schedule must be an object"];
  }
  const cfg = next as Record<string, unknown>;

  if (typeof cfg.enabled !== "boolean") {
    errors.push('"enabled" must be a boolean');
  }
  if (
    typeof cfg.intervalHours !== "number" ||
    !Number.isFinite(cfg.intervalHours) ||
    !Number.isInteger(cfg.intervalHours) ||
    cfg.intervalHours < 1
  ) {
    errors.push('"intervalHours" must be an integer >= 1');
  }
  if (typeof cfg.dailyAt !== "string" || !HHMM.test(cfg.dailyAt)) {
    errors.push('"dailyAt" must be a HH:mm 24-hour time');
  }
  return errors;
}
