/**
 * Schedule API (design J.10, Requirements 28). The schedule lives only in the cron line of
 * .github/workflows/guardian.yml. An edit changes that one value in the working tree, logs a
 * `schedule-changed` entry, and never pushes: it reaches GitHub when the user publishes.
 * The old local-only schedule (schedule.ts / Task Scheduler) is not used here.
 * Handlers use ports only. No AI, no network.
 */
import { validateReviewerName, resolveInside } from "./atomic-file.js";
import type { ConsoleDeps } from "./console-deps.js";
import type { ConsoleResponse, HandlerContext, RouteDef } from "./console-routes.js";
import { describeCron, formatCron, parseCron } from "./cron.js";
import { editSchedule, readSchedule } from "./workflow-schedule.js";
import { authorize, fail, logSetup } from "./urls-api.js";

export const WORKFLOW_REL = ".github/workflows/guardian.yml";
export const SCHEDULE_BODY_MAX = 4 * 1024;

export const UTC_NOTE = "Times are in UTC (cron on GitHub always runs in UTC).";
export const GITHUB_NOTE =
  "GitHub runs scheduled workflows only from the default branch, and the schedule lives only in the workflow file. A changed schedule takes effect on GitHub after you publish it.";

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function summaryOf(cron: string): { summary: string | null; warnings: string[] } {
  const p = parseCron(cron);
  if (!p.ok) return { summary: null, warnings: [`The current schedule is not valid here: ${p.reason}`] };
  return { summary: describeCron(p.ast), warnings: p.warnings };
}

/** The cron value on origin/main from the last fetch (no network), or null when unknown. */
async function valueOnGitHub(deps: ConsoleDeps): Promise<string | null> {
  try {
    const r = await deps.git.run(["show", `origin/main:${WORKFLOW_REL}`]);
    if (r.code !== 0 || r.stdout === "") return null;
    const s = readSchedule(r.stdout);
    return s.ok ? s.cron : null;
  } catch {
    return null;
  }
}

async function getSchedule(ctx: HandlerContext): Promise<ConsoleResponse> {
  const { deps } = ctx;
  let text: string;
  try {
    text = deps.fs.readText(WORKFLOW_REL);
  } catch {
    return fail(500, "The workflow file could not be read.");
  }
  const cur = readSchedule(text);
  if (!cur.ok) return fail(409, cur.reason, { editable: false, note: GITHUB_NOTE, utcNote: UTC_NOTE });
  const { summary, warnings } = summaryOf(cur.cron);
  return {
    status: 200,
    json: {
      cron: cur.cron,
      summary,
      utcNote: UTC_NOTE,
      warnings,
      note: GITHUB_NOTE,
      editable: true,
      onGitHub: await valueOnGitHub(deps),
    },
  };
}

async function postSchedule(ctx: HandlerContext): Promise<ConsoleResponse> {
  const { deps } = ctx;
  const body = isObj(ctx.body) ? ctx.body : {};
  const rv = validateReviewerName(body.reviewer);
  if (!rv.ok) return fail(400, rv.reason);
  const reviewer = rv.name;
  if (typeof body.cron !== "string") return fail(400, "The schedule must be text.");
  const parsed = parseCron(body.cron);
  if (!parsed.ok) return fail(400, parsed.reason);
  const cron = formatCron(parsed.ast);

  let text: string;
  try {
    text = deps.fs.readText(WORKFLOW_REL);
  } catch {
    return fail(500, "The workflow file could not be read.");
  }
  const cur = readSchedule(text);
  if (!cur.ok) return fail(409, cur.reason, { editable: false });

  const denied = authorize(deps, reviewer, "schedule-change", { cron });
  if (denied) return denied;

  let path: string;
  try {
    path = resolveInside(deps.fs.root, ".github", "workflows", "guardian.yml");
  } catch {
    return fail(500, "The workflow file could not be located.");
  }
  const res = editSchedule(path, cron);
  if (!res.ok) return fail(409, res.reason);

  const logErr = logSetup(
    deps,
    reviewer,
    "schedule-changed",
    `Schedule changed from ${res.previous} to ${res.cron} (UTC); not yet published`.slice(0, 280),
    {},
    { cron: res.cron, previous: res.previous },
  );
  const { summary, warnings } = summaryOf(res.cron);
  return {
    status: 200,
    json: {
      ok: true,
      cron: res.cron,
      previous: res.previous,
      summary,
      utcNote: UTC_NOTE,
      warnings: [...parsed.warnings, ...warnings.filter((w) => !parsed.warnings.includes(w))],
      published: false,
      note: "Saved in this folder only. The change takes effect on GitHub after you choose Publish.",
      githubNote: GITHUB_NOTE,
      warning: logErr ? "The activity log could not be written." : undefined,
    },
  };
}

export const SCHEDULE_GROUP: RouteDef[] = [
  { method: "GET", pattern: "/api/schedule", mutating: false, maxBodyBytes: 0, handler: getSchedule },
  { method: "POST", pattern: "/api/schedule", mutating: true, maxBodyBytes: SCHEDULE_BODY_MAX, handler: postSchedule },
];
