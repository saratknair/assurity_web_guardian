// Copies each config/**/<name>.example.json to <name>.json when the real file
// is missing. Existing files are never overwritten.

import { copyFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SUFFIX = ".example.json";
const CONFIG_DIRS = ["config", join("config", "domains")];

/**
 * @param {string} rootDir project root
 * @returns {{ copied: string[], skipped: string[] }} paths relative to rootDir
 */
export function initConfig(rootDir) {
  const copied = [];
  const skipped = [];
  for (const rel of CONFIG_DIRS) {
    const dir = resolve(rootDir, rel);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).sort()) {
      if (!name.endsWith(SUFFIX)) continue;
      const target = name.slice(0, -SUFFIX.length) + ".json";
      const label = join(rel, target);
      if (existsSync(join(dir, target))) {
        skipped.push(label);
      } else {
        copyFileSync(join(dir, name), join(dir, target));
        copied.push(label);
      }
    }
  }
  return { copied, skipped };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { copied, skipped } = initConfig(process.cwd());
  for (const f of copied) console.log(`copied  ${f}`);
  for (const f of skipped) console.log(`skipped ${f} (already exists)`);
  if (copied.length === 0 && skipped.length === 0) console.log("No example config files found.");
}
