import { runGuardian } from "../dist/core/orchestrator.js";
import { loadConfig } from "../dist/config/app-config.js";

const cfg = loadConfig();
const runId = await runGuardian(cfg);
console.log("RUN_COMPLETE:" + runId);
