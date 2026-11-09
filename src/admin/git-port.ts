/**
 * GitPort for the Management_Console (design J.8.3). git is driven with execFile, an
 * argument array, and no shell. Only a fixed whitelist of subcommands may run, and
 * history-rewriting or force options are rejected before any process starts.
 * No AI, no network of its own (push and fetch use the Reviewer's own git credentials).
 */
import { execFile } from "node:child_process";

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface GitRunOptions {
  /** Text written to git's standard input (for example a commit message). */
  stdin?: string;
  /** Extra environment variables (for example GIT_INDEX_FILE). */
  env?: Record<string, string>;
}

/** git is driven with an args array and no shell. */
export interface GitPort {
  run(args: string[], opts?: GitRunOptions): Promise<GitResult>;
}

/** Thrown (as a rejected promise) when a command is outside the whitelist. */
export class GitCommandRejectedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "GitCommandRejectedError";
  }
}

const ALLOWED_SUBCOMMANDS: ReadonlySet<string> = new Set([
  "fetch",
  "rev-parse",
  "ls-files",
  "ls-tree",
  "cat-file",
  "hash-object",
  "read-tree",
  "update-index",
  "write-tree",
  "commit-tree",
  "push",
  "diff",
  "update-ref",
  "reset",
  "remote",
  "config",
  "status",
]);

const NEVER_SUBCOMMANDS: ReadonlySet<string> = new Set([
  "rebase",
  "merge",
  "pull",
  "checkout",
  "stash",
  "add",
  "commit",
  "switch",
  "restore",
  "clean",
  "cherry-pick",
  "revert",
  "am",
  "apply",
]);

/** Options that can run other programs or rewrite remote history. */
const FORBIDDEN_PREFIXES = ["--force", "--upload-pack", "--receive-pack", "--exec", "--mirror", "--delete"];

/**
 * Returns a plain-English reason when the command must not run, or null when it is
 * allowed. Pure; used by `realGit` and by tests.
 */
export function checkGitArgs(args: readonly string[]): string | null {
  if (!Array.isArray(args) || args.length === 0 || args.some((a) => typeof a !== "string")) {
    return "Empty or invalid git command";
  }
  const sub = args[0] as string;
  if (NEVER_SUBCOMMANDS.has(sub)) return `git ${sub} is not allowed`;
  if (!ALLOWED_SUBCOMMANDS.has(sub)) return `git ${sub} is not allowed`;

  const dd = args.indexOf("--");
  const optionArgs = dd === -1 ? args.slice(1) : args.slice(1, dd);
  for (const a of optionArgs) {
    if (a === "-f" || a === "-d") return "Force and delete options are not allowed";
    if (FORBIDDEN_PREFIXES.some((p) => a === p || a.startsWith(p))) return "Force or unsafe options are not allowed";
    if (a.startsWith("+")) return "Forced refspecs are not allowed";
    if (/^[^:]*:\+/.test(a)) return "Forced refspecs are not allowed";
  }

  if (sub === "reset") {
    for (const a of optionArgs) {
      if (a === "--hard" || a === "--merge" || a === "--keep" || a === "--soft") {
        return "Only an index-only reset is allowed";
      }
    }
  }
  // cat-file is read-only; it is allowed only to print an object (used by disposition-sync).
  if (sub === "cat-file" && args[1] !== "-p") return "Only git cat-file -p is allowed";
  if (sub === "remote" && args[1] !== "get-url") return "Only git remote get-url is allowed";
  if (sub === "config" && args[1] !== "--get") return "Only git config --get is allowed";
  if (sub === "status" && !args.includes("--short")) return "Only git status --short is allowed";
  if (sub === "diff" && !args.includes("--name-only") && !args.includes("--name-status")) {
    return "Only a names-only git diff is allowed";
  }
  return null;
}

export function realGit(root: string): GitPort {
  return {
    run: (args, opts) => {
      const why = checkGitArgs(args);
      if (why !== null) return Promise.reject(new GitCommandRejectedError(why));
      return new Promise<GitResult>((resolveRun) => {
        const child = execFile(
          "git",
          args,
          {
            cwd: root,
            windowsHide: true,
            shell: false,
            maxBuffer: 16 * 1024 * 1024,
            env: { ...process.env, ...(opts?.env ?? {}), GIT_TERMINAL_PROMPT: "0" },
          },
          (err, stdout, stderr) => {
            const code = err ? (typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : 1) : 0;
            resolveRun({ code, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
          },
        );
        if (child.stdin) {
          child.stdin.on("error", () => {
            /* process ended before reading stdin */
          });
          child.stdin.end(opts?.stdin ?? "");
        }
      });
    },
  };
}
