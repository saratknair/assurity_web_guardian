// Checks the project docs: relative markdown links and <a href> targets must
// exist, #anchors must match a heading, `npm run <name>` must be a package.json
// script, and backticked repo paths must exist. External links are listed, not
// fetched. Exits 1 on any problem. Usage: node scripts/dev/check-doc-links.mjs

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const DOC_FILES = [
  "README.md",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "docs/SETUP.md",
  "docs/VENDORED.md",
];

// Paths that a documented command creates at run time.
export const RUNTIME_PATHS = [
  "config/app.config.json",
  "config/page-seed.json",
  "config/domains/example-com.json", // created by init-config
  "config/domains/example-site.json", // placeholder slug in the rename example
  "config/scope/", // written by discovery and the console
  "dist/",
  "artifacts/",
  "node_modules/",
];

const PATH_ROOTS = [
  "src", "tests", "scripts", "config", "docs", "admin-ui", "dashboard",
  "office", "baselines", "baselines-visual", ".github", ".kiro",
];

export function slugify(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^a-z0-9 _-]/g, "")
    .replace(/ /g, "-");
}

export function headingSlugs(text) {
  const slugs = new Set();
  let fence = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) fence = !fence;
    if (fence) continue;
    const m = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) slugs.add(slugify(m[1]));
  }
  return slugs;
}

// Returns [{ line, target }] for markdown links and <a href> attributes.
export function extractLinks(text) {
  const out = [];
  const lines = text.split(/\r?\n/);
  let fence = false;
  lines.forEach((line, i) => {
    if (/^\s*```/.test(line)) fence = !fence;
    if (fence) return;
    for (const m of line.matchAll(/\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
      out.push({ line: i + 1, target: m[1] });
    }
    for (const m of line.matchAll(/<a\s[^>]*href=["']([^"']+)["']/gi)) {
      out.push({ line: i + 1, target: m[1] });
    }
  });
  return out;
}

// Returns [{ line, span }] for inline code spans outside fenced blocks, plus
// fenced block lines (as spans) so `npm run` in examples is checked too.
export function extractCode(text) {
  const out = [];
  let fence = false;
  text.split(/\r?\n/).forEach((line, i) => {
    if (/^\s*```/.test(line)) {
      fence = !fence;
      return;
    }
    if (fence) {
      out.push({ line: i + 1, span: line });
      return;
    }
    for (const m of line.matchAll(/`([^`]+)`/g)) out.push({ line: i + 1, span: m[1] });
  });
  return out;
}

function isRuntime(p) {
  return RUNTIME_PATHS.some((r) => (r.endsWith("/") ? p.startsWith(r) || p + "/" === r : p === r));
}

// ctx: { exists(relPath), scripts: Set<string>, read(relPath) }
export function checkDoc(file, text, ctx) {
  const problems = [];
  const external = [];
  const dir = path.posix.dirname(file);
  const add = (line, msg) => problems.push({ file, line, msg });

  for (const { line, target } of extractLinks(text)) {
    if (/^https?:\/\//i.test(target)) {
      external.push({ file, line, target });
      continue;
    }
    if (/^(mailto:|tel:)/i.test(target)) continue;
    const [rawPath, anchor] = target.split("#");
    const rel = rawPath ? path.posix.normalize(path.posix.join(dir, rawPath)) : file;
    if (!ctx.exists(rel)) {
      add(line, `broken link: ${target}`);
      continue;
    }
    if (anchor && rel.endsWith(".md")) {
      if (!headingSlugs(ctx.read(rel)).has(anchor.toLowerCase())) {
        add(line, `missing anchor: ${target}`);
      }
    }
  }

  for (const { line, span } of extractCode(text)) {
    for (const m of span.matchAll(/\bnpm(?:\.cmd)?\s+run\s+([\w:-]+)/g)) {
      if (!ctx.scripts.has(m[1])) add(line, `unknown npm script: ${m[1]}`);
    }
    for (const m of span.matchAll(/(?<![\w./@-])((?:[\w.-]+\/)+[\w.-]*)/g)) {
      const p = m[1].replace(/[.,;:]+$/, "");
      const root = p.split("/")[0];
      if (!PATH_ROOTS.includes(root) || /[*<>{}]/.test(p)) continue;
      if (isRuntime(p)) continue;
      if (!ctx.exists(p.replace(/\/$/, ""))) add(line, `missing path: ${p}`);
    }
  }
  return { problems, external };
}

function main() {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const ctx = {
    exists: (p) => existsSync(p),
    read: (p) => readFileSync(p, "utf8"),
    scripts: new Set(Object.keys(pkg.scripts ?? {})),
  };
  const problems = [];
  const external = [];
  for (const file of DOC_FILES) {
    if (!existsSync(file)) {
      problems.push({ file, line: 0, msg: "doc file missing" });
      continue;
    }
    const r = checkDoc(file, readFileSync(file, "utf8"), ctx);
    problems.push(...r.problems);
    external.push(...r.external);
  }
  for (const e of external) console.log(`${e.file}:${e.line}: external ${e.target}`);
  for (const p of problems) console.log(`${p.file}:${p.line}: ${p.msg}`);
  console.log(`${external.length} external link(s), ${problems.length} problem(s)`);
  process.exit(problems.length > 0 ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
