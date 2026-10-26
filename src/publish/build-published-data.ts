import { buildPublishedData } from "./published-data.js";

/**
 * CLI entry for the publisher / CI workflow (design → Cloud_Runner step
 * `node dist/publish/build-published-data.js`). Thin wrapper: reads the output
 * directory from argv or env and delegates to `buildPublishedData`.
 *
 * Usage:
 *   node dist/publish/build-published-data.js [outDir]
 * Env:
 *   AWG_PUBLISH_OUT_DIR  output dir (default "." → writes ./data/*)
 *   AWG_RUNS_ROOT        raw run store (default "artifacts/runs")
 *   AWG_A11Y_HISTORY     a11y history path (default "artifacts/a11y-history.json")
 *   AWG_DOMAIN           domain label (default "assurity.nz")
 *   AWG_RUN_ORIGIN       "cloud" marks runs cloud-origin when no per-run marker
 */
async function main(): Promise<void> {
  const outDir = process.argv[2] ?? process.env.AWG_PUBLISH_OUT_DIR ?? ".";
  const runsRoot = process.env.AWG_RUNS_ROOT ?? "artifacts/runs";
  const historyPath = process.env.AWG_A11Y_HISTORY ?? "artifacts/a11y-history.json";
  const domain = process.env.AWG_DOMAIN ?? "assurity.nz";

  const result = await buildPublishedData({ runsRoot, outDir, historyPath, domain });

  const withheldRuns = Object.keys(result.withheld);
  console.log(
    `Published ${result.runsPublished.length} run(s) to ${outDir}/data` +
      (withheldRuns.length > 0
        ? `; withheld files in ${withheldRuns.length} run(s): ${withheldRuns.join(", ")}`
        : ""),
  );
}

main().catch((err) => {
  console.error("build-published-data failed:", err);
  process.exitCode = 1;
});
