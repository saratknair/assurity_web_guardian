/**
 * Single-flight job runner for the Management_Console (design J.5.2).
 *
 * One browser job at a time across all kinds. Only three fixed scripts can run; the
 * request never supplies a command or path. Spawned with an argument array and
 * shell: false. Output is kept as a ring buffer of scrubbed lines. All side effects
 * (spawn, clock, timers, process-tree kill, persistence) are injectable so tests never
 * start a real process.
 */
import { spawn as nodeSpawn, type SpawnOptions } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteText } from "./atomic-file.js";
import { scrubForDisplay } from "./scrub.js";

export type JobKind = "discovery" | "spec-drafts" | "visual-capture";
export type JobState = "idle" | "running" | "done" | "failed" | "timed-out" | "interrupted";

export interface JobSpec {
  kind: JobKind;
  scope?: "current" | "draft";
  /** Extra environment; only keys starting with AWG_ are passed to the child. */
  env?: Record<string, string>;
}

export interface JobStatus {
  state: JobState;
  kind: JobKind | null;
  scope: "current" | "draft" | null;
  startedAt: string | null;
  finishedAt: string | null;
  elapsedMs: number;
  exitCode: number | null;
  progress: { done: number; total: number } | null;
  tail: string[];
}

export type StartResult =
  | { ok: true }
  | { ok: false; reason: "busy" | "preflight-failed"; detail: string };

export interface JobPort {
  start(spec: JobSpec): StartResult;
  status(): JobStatus;
}

/** The fixed script whitelist. */
export const JOB_SCRIPTS: Readonly<Record<JobKind, string>> = Object.freeze({
  discovery: "scripts/discover-candidates.mjs",
  "spec-drafts": "scripts/make-all-drafts.mjs",
  "visual-capture": "scripts/capture-baselines.mjs",
});

export const JOB_TIMEOUT_MS: Readonly<Record<JobKind, number>> = Object.freeze({
  discovery: 12 * 60 * 1000,
  "spec-drafts": 10 * 60 * 1000,
  "visual-capture": 15 * 60 * 1000,
});

export const MAX_TAIL_LINES = 200;
export const MAX_TAIL_BYTES = 64 * 1024;

const ENV_ALLOW = new Set(
  [
    "PATH",
    "SystemRoot",
    "TEMP",
    "TMP",
    "HOME",
    "USERPROFILE",
    "LOCALAPPDATA",
    "PLAYWRIGHT_BROWSERS_PATH",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
  ].map((k) => k.toUpperCase()),
);

/** Build the child environment: allow-listed base variables plus validated AWG_* values. */
export function buildJobEnv(
  base: Record<string, string | undefined>,
  extra: Record<string, string> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) {
    if (typeof v !== "string") continue;
    const up = k.toUpperCase();
    if (ENV_ALLOW.has(up) || up.startsWith("AWG_")) out[k] = v;
  }
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (/^AWG_[A-Z0-9_]+$/.test(k) && typeof v === "string" && !v.includes("\0")) out[k] = v;
    }
  }
  return out;
}

/** Minimal stream and child shapes so tests can supply fakes. */
export interface ReadableLike {
  on(event: "data", cb: (chunk: Buffer | string) => void): unknown;
}
export interface ChildLike {
  pid?: number;
  stdout: ReadableLike | null;
  stderr: ReadableLike | null;
  on(event: "close" | "exit", cb: (code: number | null, signal: string | null) => void): unknown;
  on(event: "error", cb: (err: Error) => void): unknown;
  kill(signal?: string): unknown;
}
export type SpawnFn = (command: string, args: string[], options: SpawnOptions) => ChildLike;

export interface JobRunnerOptions {
  projectRoot: string;
  /** Defaults to child_process.spawn. */
  spawn?: SpawnFn;
  /** Defaults to Date.now. */
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /** Kill the whole process tree. Defaults to taskkill /T /F (win32) or process.kill(-pid). */
  killTree?: (child: ChildLike) => void;
  /** Defaults to defaultPreflight(projectRoot). */
  preflight?: (spec: JobSpec) => { ok: true } | { ok: false; detail: string };
  /** Directory for last-job.json; omit to skip persistence. */
  stateDir?: string;
  env?: Record<string, string | undefined>;
  execPath?: string;
  platform?: string;
  home?: string;
  timeouts?: Partial<Record<JobKind, number>>;
}

export interface JobRunner extends JobPort {
  /** Kill any running child (server shutdown). */
  close(): void;
}

export function defaultPreflight(projectRoot: string): JobRunnerOptions["preflight"] {
  return () => {
    if (!existsSync(join(projectRoot, "dist", "config", "app-config.js"))) {
      return { ok: false, detail: "Run npm run build first" };
    }
    if (existsSync(join(projectRoot, "artifacts", ".guardian.lock"))) {
      return { ok: false, detail: "A Guardian run is in progress" };
    }
    return { ok: true };
  };
}

function defaultKillTree(platform: string): (child: ChildLike) => void {
  return (child) => {
    const pid = child.pid;
    try {
      if (typeof pid === "number") {
        if (platform === "win32") {
          const k = nodeSpawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
            shell: false,
            windowsHide: true,
            stdio: "ignore",
          });
          k.on("error", () => undefined);
          return;
        }
        process.kill(-pid, "SIGKILL");
        return;
      }
    } catch {
      /* fall through to direct kill */
    }
    try {
      child.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  };
}

const PROGRESS_RE = /^PROGRESS:(\d{1,9})\/(\d{1,9})\s*$/;

export function createJobRunner(opts: JobRunnerOptions): JobRunner {
  const spawnFn: SpawnFn = opts.spawn ?? ((c, a, o) => nodeSpawn(c, a, o) as unknown as ChildLike);
  const now = opts.now ?? (() => Date.now());
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const platform = opts.platform ?? process.platform;
  const killTree = opts.killTree ?? defaultKillTree(platform);
  const preflight = opts.preflight ?? defaultPreflight(opts.projectRoot)!;
  const baseEnv = opts.env ?? (process.env as Record<string, string | undefined>);
  const execPath = opts.execPath ?? process.execPath;
  const scrubCtx = { projectRoot: opts.projectRoot, home: opts.home ?? baseEnv.USERPROFILE ?? baseEnv.HOME };

  let current: {
    state: JobState;
    kind: JobKind | null;
    scope: "current" | "draft" | null;
    startedMs: number | null;
    finishedMs: number | null;
    exitCode: number | null;
    progress: { done: number; total: number } | null;
    lines: string[];
  } = emptyJob();
  let child: ChildLike | null = null;
  let timer: unknown = null;
  let token = 0;

  function emptyJob() {
    return {
      state: "idle" as JobState,
      kind: null as JobKind | null,
      scope: null as "current" | "draft" | null,
      startedMs: null as number | null,
      finishedMs: null as number | null,
      exitCode: null as number | null,
      progress: null as { done: number; total: number } | null,
      lines: [] as string[],
    };
  }

  const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

  function persist(): void {
    if (!opts.stateDir) return;
    try {
      atomicWriteText(
        join(opts.stateDir, "last-job.json"),
        JSON.stringify(
          {
            kind: current.kind,
            scope: current.scope,
            state: current.state,
            startedAt: iso(current.startedMs),
            finishedAt: iso(current.finishedMs),
            exitCode: current.exitCode,
          },
          null,
          2,
        ) + "\n",
      );
    } catch {
      /* persistence is best effort */
    }
  }

  // A job recorded as running by a previous console process is reported as interrupted.
  if (opts.stateDir) {
    try {
      const raw = JSON.parse(readFileSync(join(opts.stateDir, "last-job.json"), "utf8")) as Record<string, unknown>;
      const kind = typeof raw.kind === "string" && raw.kind in JOB_SCRIPTS ? (raw.kind as JobKind) : null;
      const prev = typeof raw.state === "string" ? raw.state : "idle";
      const known: JobState[] = ["idle", "running", "done", "failed", "timed-out", "interrupted"];
      if (kind && known.includes(prev as JobState) && prev !== "idle") {
        const ms = (v: unknown): number | null => {
          const t = typeof v === "string" ? Date.parse(v) : NaN;
          return Number.isFinite(t) ? t : null;
        };
        current = {
          ...emptyJob(),
          kind,
          scope: raw.scope === "current" || raw.scope === "draft" ? raw.scope : null,
          state: prev === "running" ? "interrupted" : (prev as JobState),
          startedMs: ms(raw.startedAt),
          finishedMs: ms(raw.finishedAt),
          exitCode: typeof raw.exitCode === "number" ? raw.exitCode : null,
        };
      }
    } catch {
      /* no usable previous state */
    }
  }

  function finish(state: JobState, exitCode: number | null): void {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
    current.state = state;
    current.exitCode = exitCode;
    current.finishedMs = now();
    child = null;
    token++;
    persist();
  }

  function addLine(raw: string): void {
    const line = scrubForDisplay(raw, scrubCtx);
    const m = PROGRESS_RE.exec(raw.trim());
    if (m) {
      const done = Number(m[1]);
      const total = Number(m[2]);
      if (total > 0 && done <= total) current.progress = { done, total };
    }
    current.lines.push(line);
    if (current.lines.length > MAX_TAIL_LINES * 2) current.lines.splice(0, current.lines.length - MAX_TAIL_LINES);
  }

  function attachStream(stream: ReadableLike | null, myToken: number): () => void {
    let pending = "";
    if (stream) {
      stream.on("data", (chunk) => {
        if (myToken !== token) return;
        pending += typeof chunk === "string" ? chunk : chunk.toString("utf8");
        const parts = pending.split(/\r?\n/);
        pending = parts.pop() ?? "";
        for (const p of parts) addLine(p);
        // Bound a never-ending line.
        if (pending.length > 8192) {
          addLine(pending);
          pending = "";
        }
      });
    }
    return () => {
      if (pending.length > 0 && myToken === token) addLine(pending);
      pending = "";
    };
  }

  function tail(): string[] {
    let lines = current.lines.slice(-MAX_TAIL_LINES);
    let bytes = 0;
    const out: string[] = [];
    for (let i = lines.length - 1; i >= 0; i--) {
      const size = Buffer.byteLength(lines[i], "utf8") + 1;
      if (bytes + size > MAX_TAIL_BYTES) break;
      bytes += size;
      out.unshift(lines[i]);
    }
    lines = out;
    return lines;
  }

  function start(spec: JobSpec): StartResult {
    if (current.state === "running") {
      return { ok: false, reason: "busy", detail: "Another job is already running" };
    }
    const script = Object.prototype.hasOwnProperty.call(JOB_SCRIPTS, spec?.kind) ? JOB_SCRIPTS[spec.kind] : null;
    if (!script) return { ok: false, reason: "preflight-failed", detail: "Unknown job" };

    const pre = preflight(spec);
    if (!pre.ok) return { ok: false, reason: "preflight-failed", detail: pre.detail };

    const myToken = ++token;
    current = emptyJob();
    current.state = "running";
    current.kind = spec.kind;
    current.scope = spec.scope ?? null;
    current.startedMs = now();

    let c: ChildLike;
    try {
      c = spawnFn(execPath, [script], {
        cwd: opts.projectRoot,
        shell: false,
        windowsHide: true,
        env: buildJobEnv(baseEnv, spec.env),
        stdio: ["ignore", "pipe", "pipe"],
        detached: platform !== "win32",
      });
    } catch (err) {
      addLine(err instanceof Error ? err.message : "Could not start the job");
      finish("failed", null);
      return { ok: true };
    }
    child = c;

    const flushOut = attachStream(c.stdout, myToken);
    const flushErr = attachStream(c.stderr, myToken);
    let ended = false;
    const onEnd = (code: number | null): void => {
      if (ended || myToken !== token) return;
      ended = true;
      flushOut();
      flushErr();
      finish(code === 0 ? "done" : "failed", code);
    };
    c.on("error", (err) => {
      if (ended || myToken !== token) return;
      ended = true;
      addLine(err.message);
      finish("failed", null);
    });
    c.on("close", (code) => onEnd(code));
    c.on("exit", (code) => onEnd(code));

    const limit = opts.timeouts?.[spec.kind] ?? JOB_TIMEOUT_MS[spec.kind];
    timer = setTimer(() => {
      if (myToken !== token || ended) return;
      ended = true;
      try {
        killTree(c);
      } catch {
        /* best effort */
      }
      flushOut();
      flushErr();
      finish("timed-out", null);
    }, limit);

    persist();
    return { ok: true };
  }

  function status(): JobStatus {
    const startedMs = current.startedMs;
    const end = current.state === "running" ? now() : current.finishedMs;
    return {
      state: current.state,
      kind: current.kind,
      scope: current.scope,
      startedAt: iso(startedMs),
      finishedAt: iso(current.finishedMs),
      elapsedMs: startedMs !== null && end !== null ? Math.max(0, end - startedMs) : 0,
      exitCode: current.exitCode,
      progress: current.progress ? { ...current.progress } : null,
      tail: tail(),
    };
  }

  function close(): void {
    if (current.state === "running" && child) {
      const c = child;
      try {
        killTree(c);
      } catch {
        /* best effort */
      }
      finish("interrupted", null);
    }
  }

  return { start, status, close };
}
