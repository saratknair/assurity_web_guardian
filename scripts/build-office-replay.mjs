// Build the Virtual_Office for the static Pages_Site in REPLAY mode (Req 6.10).
//
// The office must resolve to Replay_Mode on the published site: no live SSE, no
// loopback Event_Server, no manual trigger. `resolveOfficeMode()` keys off the
// build-time flag `VITE_AWG_MODE` (see virtual-office/src/office/dataSource.ts):
// when it is "replay", the office never opens an EventSource and only fetches a
// relative, same-origin `./data/runs/<id>/events.json`. This wrapper exists so
// the flag is set the same way on Windows (local) and Linux (CI) without adding
// a cross-env dependency — inline `VAR=... vite build` is not portable to the
// Windows shell used locally.
//
// The build is OPTIONAL/non-fatal locally: if the office toolchain is not
// installed (virtual-office/node_modules missing) or the build fails, we log and
// exit 0 so a backend run is never broken by a missing office build. Pass
// AWG_OFFICE_REQUIRED=1 to make a failure fatal (CI sets this).
//
// Output: the office is built into <outDir>/office with base `./office/` so the
// deployed Pages site serves it at `/office/` alongside `data/` and the
// dashboard. outDir defaults to `artifacts/published` (the local published
// bundle); CI passes the Pages artifact dir (e.g. `_site`).
//
// Usage:
//   node scripts/build-office-replay.mjs [publishedBundleDir]
// Env:
//   AWG_PUBLISH_OUT_DIR   published bundle dir (default "artifacts/published")
//   AWG_OFFICE_REQUIRED   "1" => a build failure is fatal (exit 1)

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const officeDir = join(repoRoot, "virtual-office");

const bundleDir = resolve(
  repoRoot,
  process.argv[2] ?? process.env.AWG_PUBLISH_OUT_DIR ?? "artifacts/published",
);
const outDir = join(bundleDir, "office");
const required = process.env.AWG_OFFICE_REQUIRED === "1";

function finish(code, msg) {
  if (msg) console.log(msg);
  process.exit(required ? code : 0);
}

if (!existsSync(join(officeDir, "node_modules"))) {
  finish(
    1,
    `[build-office-replay] office deps not installed at ${officeDir}/node_modules; ` +
      `skipping replay office build (run "npm ci" in virtual-office first). ` +
      `Set AWG_OFFICE_REQUIRED=1 to make this fatal.`,
  );
}

// Build via the office's LOCAL tsc + vite binaries (matching the office's own
// "build" script) but add replay-mode flags:
//   --base=./        emit RELATIVE asset URLs so the bundle is self-contained
//                    and works at any Pages subpath (it is served from /office/).
//                    Vite 5 only accepts an absolute URL, "./", or "" for base;
//                    a relative subpath like "./office/" is rejected, and "./"
//                    is exactly what a folder-hosted sub-app needs.
//   --outDir          so output lands directly in the published bundle
// VITE_AWG_MODE=replay is injected into the child env; Vite exposes VITE_*
// process env vars to import.meta.env at build time.
//
// We resolve the binaries' JS entrypoints inside virtual-office/node_modules and
// run them with the CURRENT node (process.execPath) rather than shelling out to
// `npx`/`vite`. This keeps the build working where Node is portable / not on
// PATH (local dev) as well as in CI, and avoids any shell interpolation.
const env = { ...process.env, VITE_AWG_MODE: "replay" };
const tscBin = join(officeDir, "node_modules", "typescript", "bin", "tsc");
const viteBin = join(officeDir, "node_modules", "vite", "bin", "vite.js");

// 1) type-check (office build script runs tsc first).
const tsc = spawnSync(process.execPath, [tscBin, "--noEmit"], {
  cwd: officeDir,
  env,
  stdio: "inherit",
  shell: false,
});
if (tsc.status !== 0) {
  finish(tsc.status ?? 1, "[build-office-replay] office type-check failed.");
}

// 2) vite build in replay mode into the published bundle's office subdir.
const build = spawnSync(
  process.execPath,
  [viteBin, "build", "--base=./", `--outDir=${outDir}`, "--emptyOutDir"],
  { cwd: officeDir, env, stdio: "inherit", shell: false },
);
if (build.status !== 0) {
  finish(build.status ?? 1, "[build-office-replay] office vite build failed.");
}

console.log(`[build-office-replay] office (VITE_AWG_MODE=replay) built to ${outDir}`);
