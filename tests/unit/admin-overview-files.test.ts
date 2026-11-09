import { describe, it, expect } from "vitest";

// The console UI module is plain browser JS; give it the few DOM pieces it needs.
class Node_ {
  children: Node_[] = [];
  attrs: Record<string, string> = {};
  className = "";
  id = "";
  textContent = "";
  constructor(public tag: string) {}
  appendChild(c: Node_): Node_ {
    this.children.push(c);
    return c;
  }
  setAttribute(k: string, v: string): void {
    this.attrs[k] = v;
  }
}

function collect(n: Node_, out: Node_[] = []): Node_[] {
  out.push(n);
  n.children.forEach((c) => collect(c, out));
  return out;
}

describe("Overview unpublished file list", () => {
  it("shows at most 10 labelled files, 'and N more', and a Publish link", async () => {
    (globalThis as unknown as { document: unknown }).document = { createElement: (t: string) => new Node_(t) };
    // @ts-expect-error plain browser ES module without type declarations
    const mod = await import("../../admin-ui/sections/overview.js");
    const unpublishedList = (mod as { unpublishedList: (f: unknown) => Node_ }).unpublishedList;
    const files = Array.from({ length: 13 }, (_, i) => ({ path: `config/f${i}.json`, change: i === 0 ? "Added" : i === 1 ? "Deleted" : "Changed" }));
    const lines = collect(unpublishedList(files)).filter((n) => n.tag === "p").map((n) => n.textContent);
    expect(lines.slice(0, 2)).toEqual(["Added: config/f0.json", "Deleted: config/f1.json"]);
    expect(lines[2]).toBe("Changed: config/f2.json");
    expect(lines).toContain("and 3 more");
    expect(lines.filter((l) => /^(Added|Changed|Deleted): /.test(l))).toHaveLength(10);
    const link = collect(unpublishedList(files)).find((n) => n.tag === "a");
    expect(link?.attrs.href).toBe("#publish");
  });

  it("renders nothing for an empty or unknown list", async () => {
    (globalThis as unknown as { document: unknown }).document = { createElement: (t: string) => new Node_(t) };
    // @ts-expect-error plain browser ES module without type declarations
    const mod = await import("../../admin-ui/sections/overview.js");
    const f = (mod as { unpublishedList: (f: unknown) => Node_ }).unpublishedList;
    expect(f([]).children).toHaveLength(0);
    expect(f(null).children).toHaveLength(0);
  });
});
