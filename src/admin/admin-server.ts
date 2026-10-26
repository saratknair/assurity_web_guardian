import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { loadDomainConfig, type ScheduleConfig } from "../config/domain-config.js";
import { readRunsNewestFirst } from "../publish/published-data.js";
import { writeSchedule, validateSchedule, ScheduleValidationError } from "./schedule.js";
import { cloudSync, type CloudSyncResult } from "./cloud-sync.js";

/**
 * Local Admin GUI control panel server (Phase 2, Requirements 4.1, 11.1).
 *
 * SAFETY — LOOPBACK ONLY: this server binds exclusively to 127.0.0.1 and must
 * NEVER listen on 0.0.0.0 or any externally reachable interface (Req 11.1 /
 * design admin safety). It mirrors the bind pattern of the read-only
 * `Event_Server` (`src/reporting/event-server.ts`).
 *
 * This task (7.1) provides the server shell, the loopback bind, and the static
 * control page served at `GET /`. The JSON API endpoints live in later tasks:
 *   - `GET  /api/domain`, `/api/runs`, `/api/schedule`   (task 7.3)
 *   - `POST /api/schedule`, `/api/run`, `/api/open/*`     (task 7.7)
 *   - `POST /api/sync`, `GET /api/sync/status`            (task 7.9)
 * The route dispatch below is the extension point: unknown `/api/*` paths
 * return 404 for now, and later tasks slot their handlers in ahead of that
 * fallback. The static control page already renders the placeholder
 * sections/buttons those tasks will wire up.
 */

const DEFAULT_PORT = 7787;
const HOST = "127.0.0.1";

export interface StartAdminServerOptions {
  /** Port to bind on the loopback interface. Defaults to 7787. */
  port?: number;
}

function sendHtml(res: ServerResponse, code: number, body: string): void {
  res.writeHead(code, { "Content-Type": "text/html; charset=utf-8" });
  res.end(body);
}

function sendJson(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

/**
 * The static control page. Minimal, clean, no external/CDN assets — all markup
 * and styling are inline. Buttons and sections are placeholders that later
 * tasks (7.3/7.7/7.9) wire to the admin API; they are intentionally
 * non-functional in this task.
 */
function controlPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Assurity Web Guardian — Admin</title>
  <style>
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      line-height: 1.5;
      background: #0f1115;
      color: #e6e8eb;
    }
    header {
      padding: 1.25rem 1.5rem;
      border-bottom: 1px solid #262b33;
      background: #151922;
    }
    header h1 { margin: 0; font-size: 1.15rem; font-weight: 600; }
    header p { margin: 0.25rem 0 0; font-size: 0.85rem; color: #9aa4b2; }
    main {
      max-width: 880px;
      margin: 0 auto;
      padding: 1.5rem;
      display: grid;
      gap: 1.25rem;
    }
    section {
      background: #151922;
      border: 1px solid #262b33;
      border-radius: 8px;
      padding: 1rem 1.25rem;
    }
    section h2 { margin: 0 0 0.75rem; font-size: 0.95rem; font-weight: 600; }
    .row { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; }
    button {
      font: inherit;
      padding: 0.45rem 0.9rem;
      border-radius: 6px;
      border: 1px solid #39414d;
      background: #1e2430;
      color: #e6e8eb;
      cursor: pointer;
    }
    button:hover { background: #262e3c; }
    button.primary { border-color: #2d6cdf; background: #2d6cdf; }
    button.primary:hover { background: #3a78ee; }
    label { font-size: 0.85rem; color: #9aa4b2; }
    input {
      font: inherit;
      padding: 0.4rem 0.5rem;
      border-radius: 6px;
      border: 1px solid #39414d;
      background: #0f1115;
      color: #e6e8eb;
    }
    .muted { color: #9aa4b2; font-size: 0.85rem; }
    .runs { min-height: 3rem; }
    .placeholder {
      color: #6b7686;
      font-size: 0.85rem;
      font-style: italic;
    }
    footer { max-width: 880px; margin: 0 auto; padding: 0 1.5rem 2rem; }
  </style>
</head>
<body>
  <header>
    <h1>Assurity Web Guardian — Admin</h1>
    <p>Local control panel · loopback only (127.0.0.1)</p>
  </header>
  <main>
    <section id="views">
      <h2>Views</h2>
      <div class="row">
        <button id="open-office" type="button">Open Virtual Office</button>
        <button id="open-dashboard" type="button">Open Dashboard</button>
      </div>
    </section>

    <section id="domain">
      <h2>Guarded domain</h2>
      <p class="placeholder" id="domain-value">Loaded from Domain_Config when the API is wired.</p>
    </section>

    <section id="runs-section">
      <h2>Runs</h2>
      <div class="runs placeholder" id="runs-list">No runs loaded yet.</div>
    </section>

    <section id="schedule-section">
      <h2>Schedule</h2>
      <form id="schedule-form" class="row">
        <label for="schedule-interval">Every (hours)</label>
        <input id="schedule-interval" name="intervalHours" type="number" min="1" placeholder="24" disabled />
        <label for="schedule-time">Daily at</label>
        <input id="schedule-time" name="dailyAt" type="time" placeholder="09:00" disabled />
        <button id="schedule-save" type="submit" disabled>Save schedule</button>
      </form>
      <p class="placeholder">Schedule editing is wired up in a later step.</p>
    </section>

    <section id="actions">
      <h2>Actions</h2>
      <div class="row">
        <button id="run-now" class="primary" type="button">Run now</button>
        <button id="sync-cloud" type="button">Sync from cloud</button>
      </div>
      <p class="placeholder">These controls become active once the admin API endpoints are added.</p>
    </section>
  </main>
  <footer>
    <p class="muted">This control panel is reachable only from this machine.</p>
  </footer>
</body>
</html>`;
}

/** Default location of the canonical schedule file (repo-relative). */
const SCHEDULE_PATH = "config/schedule.json";

/**
 * Lockfile that guards against overlapping runs (Req 10.2). This MUST match the
 * path used by `ScheduledTrigger` (`src/core/scheduled-trigger.ts`) so a manual
 * run and a scheduled run cannot both start — the admin endpoint rejects with
 * 409 when the lock is present, and the background run itself re-checks it
 * (belt-and-suspenders).
 */
const GUARDIAN_LOCK = "artifacts/.guardian.lock";

/** Background launcher for a single manual run (reuses ScheduledTrigger). */
const RUN_SCRIPT = "scripts/run-scheduled.mjs";

/** Portable Node used by the local tooling (matches scripts/guardian-task.ps1). */
const NODE_BIN = "C:\\Users\\nairs\\nodejs\\node-v22.11.0-win-x64\\node.exe";

/** Virtual Office dev/preview URL (Req 4.1). */
const OFFICE_URL = "http://localhost:5173";

/** Static dashboard entry point; opened as a file URL (Req 4.1). */
const DASHBOARD_PATH = "artifacts/dashboard.html";

/**
 * `GET /api/domain` — the current Guarded_Domain, read from `Domain_Config`
 * (Req 4.6). The host is NEVER hard-coded; it is read from
 * `config/domains/<slug>.json` via `loadDomainConfig()`. Returns the guarded
 * host and its canonical base URL.
 */
function getDomain(res: ServerResponse): void {
  try {
    const cfg = loadDomainConfig();
    return sendJson(res, 200, { domain: cfg.domain, baseUrl: cfg.baseUrl });
  } catch (err) {
    return sendJson(res, 500, {
      error: "domain config unavailable",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * `GET /api/runs` — the run list, newest-first (Req 4.3, 7.7).
 *
 * Reuses the published-data source of truth (`readRunsNewestFirst`) so the
 * admin view and the published `RunsIndex` agree on ordering (finishedAt desc,
 * fallback dir mtime) and per-run facts, including `origin: "local" | "cloud"`.
 * Responses carry only run-relative data (run ids, counts) — no absolute paths.
 */
function getRuns(res: ServerResponse): void {
  try {
    const facts = readRunsNewestFirst("artifacts/runs", process.env.AWG_RUN_ORIGIN);
    const runs = facts.map((f) => ({
      runId: f.runId,
      finishedAt: f.finishedAt,
      status: f.status,
      health: f.health,
      pages: f.pages,
      failedChecks: f.failedChecks,
      pendingReview: f.pendingReview,
      origin: f.origin,
    }));
    return sendJson(res, 200, { runs });
  } catch (err) {
    return sendJson(res, 500, {
      error: "runs unavailable",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * `GET /api/schedule` — the current schedule, read from `config/schedule.json`
 * (the canonical `ScheduleConfig`: `{ enabled, intervalHours, dailyAt }`).
 * Editing the schedule (`POST /api/schedule`) is a later task (7.7).
 */
function getSchedule(res: ServerResponse): void {
  try {
    const raw = readFileSync(resolve(SCHEDULE_PATH), "utf8");
    const cfg = JSON.parse(raw) as ScheduleConfig;
    return sendJson(res, 200, {
      enabled: cfg.enabled,
      intervalHours: cfg.intervalHours,
      dailyAt: cfg.dailyAt,
    });
  } catch (err) {
    return sendJson(res, 500, {
      error: "schedule unavailable",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Collect a request body and parse it as JSON. Resolves `{ ok: false }` with a
 * reason on malformed JSON so callers can return a 400 without throwing. Caps
 * the body size as a cheap guard against unbounded loopback input.
 */
function readJsonBody(req: IncomingMessage): Promise<
  { ok: true; value: unknown } | { ok: false; reason: string }
> {
  return new Promise((resolveBody) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const MAX = 64 * 1024;
    let aborted = false;
    req.on("data", (chunk: Buffer) => {
      if (aborted) return;
      size += chunk.length;
      if (size > MAX) {
        aborted = true;
        resolveBody({ ok: false, reason: "request body too large" });
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (aborted) return;
      const text = Buffer.concat(chunks).toString("utf8").trim();
      if (text.length === 0) {
        resolveBody({ ok: false, reason: "empty request body" });
        return;
      }
      try {
        resolveBody({ ok: true, value: JSON.parse(text) });
      } catch {
        resolveBody({ ok: false, reason: "malformed JSON body" });
      }
    });
    req.on("error", () => {
      if (aborted) return;
      aborted = true;
      resolveBody({ ok: false, reason: "request stream error" });
    });
  });
}

/**
 * `POST /api/schedule` — persist a schedule change (Req 4.4). Parses the JSON
 * body `{ enabled, intervalHours, dailyAt }`, validates `HH:mm` and
 * `intervalHours >= 1`, and writes `config/schedule.json` via `writeSchedule`.
 * Invalid input returns 400 with the reason and writes NOTHING. On Windows the
 * write also best-effort re-registers the Task Scheduler entry; a registration
 * failure does not fail the request (the JSON is authoritative).
 */
async function postSchedule(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJsonBody(req);
  if (!body.ok) {
    return sendJson(res, 400, { error: "invalid schedule", reason: body.reason });
  }
  const errors = validateSchedule(body.value);
  if (errors.length > 0) {
    return sendJson(res, 400, { error: "invalid schedule", reason: errors.join("; ") });
  }
  try {
    const result = writeSchedule(body.value as ScheduleConfig);
    return sendJson(res, 200, {
      enabled: result.schedule.enabled,
      intervalHours: result.schedule.intervalHours,
      dailyAt: result.schedule.dailyAt,
      reregistered: result.reregistered,
      ...(result.reregisterNote ? { note: result.reregisterNote } : {}),
    });
  } catch (err) {
    if (err instanceof ScheduleValidationError) {
      return sendJson(res, 400, { error: "invalid schedule", reason: err.message });
    }
    return sendJson(res, 500, {
      error: "schedule save failed",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * `POST /api/run` — trigger a SINGLE manual run (Req 4.5, 10.2). Honors the same
 * lockfile protocol as `ScheduledTrigger`: if `artifacts/.guardian.lock` exists
 * a run is already active, so this returns 409 and starts NOTHING. Otherwise it
 * launches the run as a DETACHED background process (via
 * `scripts/run-scheduled.mjs`, which itself acquires the lock) and returns 202
 * immediately — the long run is never awaited inside the request handler. The
 * launched process creates/owns the lockfile, which reflects the active run.
 */
function postRun(res: ServerResponse): void {
  const lockPath = resolve(GUARDIAN_LOCK);
  if (existsSync(lockPath)) {
    let owner = "";
    try {
      owner = readFileSync(lockPath, "utf8");
    } catch {
      /* ignore */
    }
    return sendJson(res, 409, {
      error: "run already active",
      reason: "a Guardian run is already in progress; refusing to start a concurrent run",
      activeRun: owner || undefined,
    });
  }

  // Launch detached so the HTTP response returns before the (long) run finishes.
  const node = existsSync(NODE_BIN) ? NODE_BIN : process.execPath;
  try {
    const child = spawn(node, [resolve(RUN_SCRIPT)], {
      cwd: process.cwd(),
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.on("error", (err) => {
      console.warn(`run: failed to launch background run: ${err.message}`);
    });
    child.unref();
    return sendJson(res, 202, {
      status: "accepted",
      note: "manual run launched in the background; follow its progress via runs/events",
    });
  } catch (err) {
    return sendJson(res, 500, {
      error: "run launch failed",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Best-effort launch of a URL in the default browser (Windows). Uses
 * `cmd /c start "" <url>` (the empty title arg keeps `start` from treating a
 * quoted URL as a window title). Returns whether the launcher was spawned.
 */
function openInBrowser(url: string): boolean {
  try {
    const child =
      process.platform === "win32"
        ? spawn("cmd", ["/c", "start", "", url], {
            detached: true,
            stdio: "ignore",
            windowsHide: true,
          })
        : spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], {
            detached: true,
            stdio: "ignore",
          });
    child.on("error", (err) => {
      console.warn(`open: failed to launch browser for ${url}: ${err.message}`);
    });
    child.unref();
    return true;
  } catch (err) {
    console.warn(`open: could not start browser for ${url}: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/** `POST /api/open/office` — launch the Virtual Office in the browser (Req 4.1). */
function postOpenOffice(res: ServerResponse): void {
  const launched = openInBrowser(OFFICE_URL);
  return sendJson(res, 200, { url: OFFICE_URL, launched });
}

/** `POST /api/open/dashboard` — launch the static dashboard in the browser (Req 4.1). */
function postOpenDashboard(res: ServerResponse): void {
  const url = pathToFileURL(resolve(DASHBOARD_PATH)).href;
  const launched = openInBrowser(url);
  return sendJson(res, 200, { url, launched });
}

/** The cloud Run_Data_Branch synced from (Req 7.3, 7.8). */
const RUN_DATA_BRANCH = "runs-data";

/** Local raw run store that Cloud_Sync adds into (never overwrites). */
const RUNS_ROOT = "artifacts/runs";

/**
 * Tracks the most recent Cloud_Sync outcome for `GET /api/sync/status`. Kept in
 * a module variable because sync runs in the background (git fetch may take a
 * moment); the status endpoint reports the last result or an idle state.
 */
type SyncState =
  | { state: "idle" }
  | { state: "running"; startedAt: string }
  | { state: "done"; finishedAt: string; result: CloudSyncResult };

let lastSync: SyncState = { state: "idle" };

/**
 * `POST /api/sync` — run Cloud_Sync against the configured Run_Data_Branch (Req
 * 7.3–7.6, 7.8). Fetches `runs-data` read-only, copies in ONLY run-ids absent
 * locally, marks them `origin: "cloud"`, and never overwrites/deletes existing
 * local runs. Sync is launched in the background and its result recorded for
 * `GET /api/sync/status`; a 409 is returned if a sync is already running. On
 * offline/error the local store is left unchanged (handled inside `cloudSync`).
 */
function postSync(res: ServerResponse): void {
  if (lastSync.state === "running") {
    return sendJson(res, 409, {
      error: "sync already running",
      reason: "a cloud sync is already in progress",
      startedAt: lastSync.startedAt,
    });
  }

  lastSync = { state: "running", startedAt: new Date().toISOString() };
  // Launch in the background; status is observable via GET /api/sync/status.
  void cloudSync({ repoDir: process.cwd(), branch: RUN_DATA_BRANCH, runsRoot: RUNS_ROOT })
    .then((result) => {
      lastSync = { state: "done", finishedAt: new Date().toISOString(), result };
    })
    .catch((err: unknown) => {
      // cloudSync is fail-safe and resolves rather than rejects, but guard the
      // module state against any unexpected rejection so status stays coherent.
      lastSync = {
        state: "done",
        finishedAt: new Date().toISOString(),
        result: {
          added: [],
          skipped: [],
          ok: false,
          reason: err instanceof Error ? err.message : String(err),
        },
      };
    });

  return sendJson(res, 202, { status: "accepted", branch: RUN_DATA_BRANCH });
}

/**
 * `GET /api/sync/status` — report the last Cloud_Sync result (Req 7.6). Returns
 * `idle` before any sync, `running` while a sync is in flight, and `done` with
 * the full `CloudSyncResult` (`added`/`skipped`/`ok`/`reason`) afterwards.
 */
function getSyncStatus(res: ServerResponse): void {
  return sendJson(res, 200, lastSync);
}

/**
 * Route a single request. Kept small and explicit so later tasks can add
 * `/api/*` handlers immediately before the 404 fallback without restructuring.
 */
function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? "/", `http://${HOST}`);

  if (req.method === "GET" && url.pathname === "/") {
    return sendHtml(res, 200, controlPage());
  }

  // EXTENSION POINT: later tasks register their JSON API handlers here,
  // ahead of the fallback below.
  //   - task 7.3: GET /api/domain, /api/runs, /api/schedule   (this task)
  //   - task 7.7: POST /api/schedule, /api/run, /api/open/*
  //   - task 7.9: POST /api/sync, GET /api/sync/status
  if (req.method === "GET" && url.pathname === "/api/domain") {
    return getDomain(res);
  }
  if (req.method === "GET" && url.pathname === "/api/runs") {
    return getRuns(res);
  }
  if (req.method === "GET" && url.pathname === "/api/schedule") {
    return getSchedule(res);
  }

  // task 7.7: write/action endpoints.
  if (req.method === "POST" && url.pathname === "/api/schedule") {
    void postSchedule(req, res);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/run") {
    return postRun(res);
  }
  if (req.method === "POST" && url.pathname === "/api/open/office") {
    return postOpenOffice(res);
  }
  if (req.method === "POST" && url.pathname === "/api/open/dashboard") {
    return postOpenDashboard(res);
  }

  // task 7.9: cloud sync (read-only, additive) + status.
  if (req.method === "POST" && url.pathname === "/api/sync") {
    return postSync(res);
  }
  if (req.method === "GET" && url.pathname === "/api/sync/status") {
    return getSyncStatus(res);
  }

  if (url.pathname.startsWith("/api/")) {
    return sendJson(res, 404, { error: "not implemented" });
  }

  sendJson(res, 404, { error: "not found" });
}

/**
 * Start the Admin GUI server on the loopback interface only.
 *
 * @param opts.port Port to bind (default 7787).
 * @returns the listening `http.Server`.
 */
export function startAdminServer(opts: StartAdminServerOptions = {}): Server {
  const port = opts.port ?? DEFAULT_PORT;
  const server = createServer(handleRequest);
  // LOOPBACK ONLY — never bind 0.0.0.0 or a public interface (Req 11.1).
  server.listen(port, HOST, () => {
    console.log(`Guardian admin control panel (local only) at http://${HOST}:${port}`);
  });
  return server;
}
