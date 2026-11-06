import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

// Validates: Requirements 3.11, 6.1, 7.1, 15.12, 16.4, 17.4, 17.7
// Source-scan smoke test over the shipped dashboard code (vendor/ excluded).

const ROOT = process.cwd();
const DASH = join(ROOT, "dashboard");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "vendor") continue;
      walk(p, out);
    } else out.push(p);
  }
  return out;
}

const allFiles = walk(DASH);
const codeFiles = allFiles.filter((f) => /\.(js|html|css)$/.test(f));
const jsFiles = allFiles.filter((f) => f.endsWith(".js"));

const rel = (f: string) => relative(ROOT, f).split(sep).join("/");

/** Remove JS/CSS block and line comments while respecting string literals. */
function stripJsComments(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end < 0 ? n : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
    } else if (c === "/" && d === "/") {
      while (i < n && src[i] !== "\n") i++;
    } else if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < n && src[j] !== c) {
        if (src[j] === "\\") j++;
        else if (src[j] === "\n" && c !== "`") break;
        j++;
      }
      out += src.slice(i, j + 1);
      i = j + 1;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

function stripHtmlComments(src: string): string {
  return src.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " "));
}

function code(f: string): string {
  const raw = readFileSync(f, "utf8");
  if (f.endsWith(".html")) return stripHtmlComments(raw);
  if (f.endsWith(".js") || f.endsWith(".css")) return stripJsComments(raw);
  return raw;
}

function hits(files: string[], re: RegExp, text: (f: string) => string = code): string[] {
  const found: string[] = [];
  for (const f of files) {
    const lines = text(f).split("\n");
    lines.forEach((line, idx) => {
      if (re.test(line)) found.push(`${rel(f)}:${idx + 1}: ${line.trim().slice(0, 100)}`);
    });
  }
  return found;
}

describe("dashboard source scan", () => {
  it("finds dashboard files to scan", () => {
    expect(codeFiles.length).toBeGreaterThan(5);
    expect(codeFiles.some((f) => rel(f).startsWith("dashboard/vendor/"))).toBe(false);
  });

  it("uses no HTML-injection APIs (innerHTML, outerHTML, insertAdjacentHTML, document.write)", () => {
    const re = /\.\s*(innerHTML|outerHTML)\b|insertAdjacentHTML\s*\(|document\s*\.\s*write(ln)?\s*\(/;
    expect(hits(jsFiles, re)).toEqual([]);
  });

  it("has no form element and no mutating fetch (read-only dashboard)", () => {
    expect(hits(codeFiles, /<form\b/i)).toEqual([]);
    expect(hits(jsFiles, /createElement\(\s*["'`]form["'`]\s*\)/)).toEqual([]);
    expect(hits(jsFiles, /\bmethod\s*:\s*["'`](POST|PUT|DELETE|PATCH)["'`]/i)).toEqual([]);
    expect(hits(jsFiles, /\.open\(\s*["'`](POST|PUT|DELETE|PATCH)["'`]/i)).toEqual([]);
    expect(hits(jsFiles, /\bsendBeacon\s*\(/)).toEqual([]);
  });

  it("makes no AI / LLM claims", () => {
    const re = /large[\s-]*language[\s-]*model|AI[\s-]*assisted\s+analysis/i;
    expect(hits(codeFiles, re, (f) => readFileSync(f, "utf8"))).toEqual([]);
  });

  it("makes no WCAG conformance claims", () => {
    const re =
      /WCAG[\s\d.]*(AA?A?\s+)?(compliant|conformant|certified)|fully\s+accessible|conforms?\s+to\s+WCAG|100\s*%\s*accessible|meets\s+WCAG|WCAG\s+compliance\s+(achieved|guaranteed)/i;
    expect(hits(codeFiles, re, (f) => readFileSync(f, "utf8"))).toEqual([]);
  });

  it("uses lazy loading in the dashboard views", () => {
    const viewFiles = jsFiles.filter((f) => rel(f).startsWith("dashboard/views/"));
    const re = /loading\s*=\s*["']lazy["']|setAttribute\(\s*["']loading["']\s*,\s*["']lazy["']\s*\)|loading\s*:\s*["']lazy["']|\.loading\s*=\s*["']lazy["']/;
    expect(viewFiles.some((f) => re.test(code(f)))).toBe(true);
  });

  it("keeps dashboard files ASCII-only", () => {
    const bad: string[] = [];
    for (const f of allFiles) {
      const lines = readFileSync(f, "utf8").split("\n");
      lines.forEach((l, i) => {
        if (/[^\x00-\x7f]/.test(l)) bad.push(`${rel(f)}:${i + 1}`);
      });
    }
    expect(bad).toEqual([]);
  });

  const newSrc = [
    "src/core/finding-model.ts",
    "src/core/run-lifecycle.ts",
    "src/agents/a11y-lifecycle.ts",
    "src/publish/evidence.ts",
    "src/publish/run-findings.ts",
    "src/publish/visual.ts",
    "src/publish/size-budget.ts",
    "src/publish/guidance.ts",
    "src/publish/pages.ts",
  ];

  it("keeps new src files ASCII-only (missing files skipped)", () => {
    const bad: string[] = [];
    for (const r of newSrc) {
      const p = join(ROOT, r);
      if (!existsSync(p)) {
        console.log(`skipped missing file: ${r}`);
        continue;
      }
      readFileSync(p, "utf8")
        .split("\n")
        .forEach((l, i) => {
          if (/[^\x00-\x7f]/.test(l)) bad.push(`${r}:${i + 1}`);
        });
    }
    expect(bad).toEqual([]);
  });
});
