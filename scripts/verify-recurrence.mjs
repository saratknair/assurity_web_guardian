import { readdirSync, readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { mergeRunIntoHistory } from "../dist/agents/a11y-history-store.js";

const runsRoot = resolve("artifacts/runs");
const runs = readdirSync(runsRoot).filter((n) => existsSync(join(runsRoot, n, "accessibility")));
runs.sort((a, b) => (a < b ? 1 : -1));
const sourceRun = runs[0];
const a11yDir = join(runsRoot, sourceRun, "accessibility");

const violations = [];
for (const f of readdirSync(a11yDir)) {
  const data = JSON.parse(readFileSync(join(a11yDir, f), "utf8"));
  for (const v of data.violations ?? []) {
    violations.push({
      ruleId: v.id, pageUrl: data.url, viewport: data.viewport, impact: v.impact,
      help: v.help, helpUrl: v.helpUrl,
      targets: (v.nodes ?? []).flatMap((n) => n.target ?? []).slice(0, 5), summary: v.help,
    });
  }
}

const runId = "run_verify_recurrence_" + Date.now().toString(36);
const { summary } = mergeRunIntoHistory(violations, runId, new Date().toISOString());
console.log("RECURRENCE_SUMMARY:" + JSON.stringify(summary));
console.log("REPLAYED_FROM:" + sourceRun + " violations=" + violations.length);
