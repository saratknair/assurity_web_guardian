/**
 * Workspace roots (design J.3.4, J.1.1). A Workspace tells URL, discovery, and baseline code
 * where to read and write, so the same code serves the normal console (scope "project", real
 * files) and the New_Domain_Setup wizard (scope "draft", the staging area under
 * artifacts/admin/new-domain/). PURE: builds path strings only, performs no I/O.
 */

export type WorkspaceScope = "project" | "draft";

export interface Workspace {
  scope: WorkspaceScope;
  /** Folder holding baseline.vN.md files per slug. */
  baselinesRoot: string;
  /** Folder holding <slug>/<viewport>.png files. */
  visualRoot: string;
  /** Discovery candidates file. */
  candidatesPath: string;
  /** Project scope: the page seed file. Draft scope: the draft file whose `urls` is the seed. */
  seedPath: string;
  /** Project scope: staged changes file. Draft scope: null (the draft is itself the staging area). */
  pendingPath: string | null;
}

/** Join path segments with "/" (Node accepts it on every platform). */
function join(...parts: string[]): string {
  return parts
    .map((p, i) => (i === 0 ? p.replace(/[\\/]+$/, "") : p.replace(/^[\\/]+|[\\/]+$/g, "")))
    .filter((p, i) => i === 0 || p.length > 0)
    .join("/");
}

/** Workspace for the real project files under `repoRoot`. */
export function projectWorkspace(repoRoot: string): Workspace {
  return {
    scope: "project",
    baselinesRoot: join(repoRoot, "baselines"),
    visualRoot: join(repoRoot, "baselines-visual"),
    candidatesPath: join(repoRoot, "artifacts", "admin", "candidates.json"),
    seedPath: join(repoRoot, "config", "page-seed.json"),
    pendingPath: join(repoRoot, "artifacts", "admin", "pending-changes.json"),
  };
}

/** Workspace for the new-domain draft staged under `repoRoot`/artifacts/admin. */
export function draftWorkspace(repoRoot: string): Workspace {
  const staging = join(repoRoot, "artifacts", "admin", "new-domain");
  return {
    scope: "draft",
    baselinesRoot: join(staging, "baselines"),
    visualRoot: join(staging, "baselines-visual"),
    candidatesPath: join(staging, "candidates.json"),
    seedPath: join(repoRoot, "artifacts", "admin", "new-domain-draft.json"),
    pendingPath: null,
  };
}

/** Pick the workspace for a scope. */
export function workspaceFor(scope: WorkspaceScope, repoRoot: string): Workspace {
  return scope === "draft" ? draftWorkspace(repoRoot) : projectWorkspace(repoRoot);
}
