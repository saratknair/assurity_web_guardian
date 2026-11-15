import { describe, expect, it } from "vitest";
import {
  checkDoc,
  extractLinks,
  headingSlugs,
  // @ts-expect-error plain .mjs module without type declarations
} from "../../scripts/dev/check-doc-links.mjs";

const files: Record<string, string> = {
  "docs/A.md": "# Alpha Beta\n",
  "README.md": "# Readme\n",
};
const ctx = {
  exists: (p: string) => p in files || p === "scripts/ok.mjs",
  read: (p: string) => files[p] ?? "",
  scripts: new Set(["verify"]),
};

describe("check-doc-links", () => {
  it("extracts markdown and anchor links, skipping fenced blocks", () => {
    const t = "[a](x.md) <a href=\"y.md\">y</a>\n```\n[no](z.md)\n```";
    expect(extractLinks(t).map((l: { target: string }) => l.target)).toEqual(["x.md", "y.md"]);
  });

  it("slugifies headings", () => {
    expect([...headingSlugs("## Alpha `Beta`!\n")]).toEqual(["alpha-beta"]);
  });

  it("reports broken links, anchors, scripts and paths; lists external", () => {
    const text = [
      "[ok](A.md#alpha-beta) [bad](nope.md) [anchor](A.md#zzz)",
      "[ext](https://example.com)",
      "`npm run verify` `npm run ghost` `scripts/ok.mjs` `scripts/gone.mjs` `dist/index.js`",
    ].join("\n");
    const r = checkDoc("docs/B.md", text, ctx);
    expect(r.problems.map((p: { msg: string }) => p.msg)).toEqual([
      "broken link: nope.md",
      "missing anchor: A.md#zzz",
      "unknown npm script: ghost",
      "missing path: scripts/gone.mjs",
    ]);
    expect(r.external).toHaveLength(1);
  });
});
