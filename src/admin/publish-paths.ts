/**
 * Config_Publish path rules (design J.8.1). Pure: no I/O.
 * Nothing under artifacts/ is ever a configuration path.
 */
export const CONFIG_PATHSPECS = [
  "config/app.config.json",
  "config/page-seed.json",
  "config/domains/",
  "baselines/",
  "baselines-visual/",
  ".github/workflows/guardian.yml",
] as const;

/**
 * True when the repo-relative path is one the console may publish.
 * Rejects empty, absolute, drive-letter, backslash, NUL, and ".." paths.
 */
export function isConfigPath(repoRelativePath: string): boolean {
  if (typeof repoRelativePath !== "string" || repoRelativePath.length === 0) return false;
  if (repoRelativePath.includes("\\") || repoRelativePath.includes("\0")) return false;
  if (repoRelativePath.startsWith("/") || /^[A-Za-z]:/.test(repoRelativePath)) return false;
  const segments = repoRelativePath.split("/");
  for (const seg of segments) {
    if (seg === ".." || seg === "." || seg === "") return false;
  }
  for (const spec of CONFIG_PATHSPECS) {
    if (spec.endsWith("/")) {
      if (repoRelativePath.startsWith(spec) && repoRelativePath.length > spec.length) return true;
    } else if (repoRelativePath === spec) {
      return true;
    }
  }
  return false;
}
