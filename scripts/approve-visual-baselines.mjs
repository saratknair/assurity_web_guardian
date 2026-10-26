import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { AppendOnlyLog } from "../dist/telemetry/audit-log.js";

const reviewer = process.argv[2] || "unknown";
const runIdArg = process.argv[3];

const runsRoot = resolve("artifacts/runs");
let runs = readdirSync(runsRoot).filter((n) => existsSync(join(runsRoot, n, "proposed-visual-baselines")));
runs.sort((a, b) => statSync(join(runsRoot, b)).mtimeMs - statSync(join(runsRoot, a)).mtimeMs);
const useRun = runIdArg || runs[0];
if (!useRun) { console.log("No run with proposed visual baselines found."); process.exit(1); }

const proposedRoot = join(runsRoot, useRun, "proposed-visual-baselines");
const audit = new AppendOnlyLog(resolve("artifacts/audit.jsonl"));
const promoted = [];

for (const slug of readdirSync(proposedRoot)) {
  const slugDir = join(proposedRoot, slug);
  for (const file of readdirSync(slugDir)) {
    const viewport = file.replace(/\.png$/, "");
    const destDir = resolve("baselines-visual", slug);
    mkdirSync(destDir, { recursive: true });
    const dest = join(destDir, file);
    const already = existsSync(dest);
    writeFileSync(dest, readFileSync(join(slugDir, file)));
    audit.append({
      type: already ? "visual-baseline-updated" : "visual-baseline-approved",
      reviewer, slug, viewport, sourceRun: useRun, baselinePath: dest,
    });
    promoted.push(slug + "/" + viewport);
  }
}
console.log("VISUAL_BASELINES_PROMOTED:" + promoted.length);
console.log("FROM_RUN:" + useRun);
