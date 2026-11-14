import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const orchestrator = join(root, "dist", "core", "orchestrator.js");

if (!existsSync(orchestrator)) {
  // Compile with the local TypeScript, no shell involved.
  const tsc = join(root, "node_modules", "typescript", "bin", "tsc");
  console.log("dist/ is missing; building first.");
  const built = spawnSync(process.execPath, [tsc, "-p", "tsconfig.json"], { cwd: root, stdio: "inherit" });
  if (built.status !== 0) {
    console.error("Build failed; not starting the run.");
    process.exit(built.status ?? 1);
  }
}

const { runGuardian } = await import(pathToFileURL(orchestrator).href);
const { loadConfig } = await import(pathToFileURL(join(root, "dist", "config", "app-config.js")).href);

const cfg = loadConfig();
const runId = await runGuardian(cfg);
console.log("RUN_COMPLETE:" + runId);
