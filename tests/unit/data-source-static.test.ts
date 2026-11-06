import { describe, it, expect, beforeEach, afterEach } from "vitest";
// @ts-expect-error plain browser ES module without type declarations
import { resolveDataSource, readModeFlag, loadStatic, loadPublished } from "../../dashboard/data-source.js";

// Validates: Requirements 15.2, 15.3 (relative URLs only in static mode; errors name the file)
const g = globalThis as any;
let urls: string[] = [];
let savedFetch: unknown;
let savedWindow: unknown;
let respond: (url: string) => any;

beforeEach(() => {
  urls = [];
  savedFetch = g.fetch;
  savedWindow = g.window;
  g.window = { AWG_MODE: "static" };
  respond = () => ({ ok: true, status: 200, json: async () => ({ ok: 1 }) });
  g.fetch = async (url: unknown) => {
    urls.push(String(url));
    return respond(String(url));
  };
});

afterEach(() => {
  g.fetch = savedFetch;
  if (savedWindow === undefined) delete g.window;
  else g.window = savedWindow;
});

function expectOnlyRelative() {
  for (const u of urls) {
    expect(u).not.toContain("127.0.0.1");
    expect(u).not.toMatch(/^[a-z][a-z0-9+.-]*:/i);
    expect(u.startsWith("./")).toBe(true);
  }
}

describe("static data source", () => {
  it("reads static and replay flags as static", () => {
    expect(readModeFlag()).toBe("static");
    g.window = { AWG_MODE: "replay" };
    expect(readModeFlag()).toBe("static");
  });

  it("resolves static without any fetch or probe", async () => {
    const src = await resolveDataSource();
    expect(src.mode).toBe("static");
    expect(urls).toEqual([]);
  });

  it("loadStatic fetches only a relative URL", async () => {
    const src = await resolveDataSource();
    await src.load();
    expect(urls).toEqual(["./data/dashboard.json"]);
    expectOnlyRelative();
  });

  it("loadPublished builds ./data/ URLs with encoded segments", async () => {
    await loadPublished("index.json");
    await loadPublished("runs/run 1#a/run-findings.json");
    expect(urls[0]).toBe("./data/index.json");
    expect(urls[1]).toBe("./data/runs/run%201%23a/run-findings.json");
    expectOnlyRelative();
  });

  it.each(["", ".", "..", "/abs.json", "a\\b.json", "a/../b.json", "a//b.json", "a/./b.json"])(
    "loadPublished rejects bad path %j without fetching",
    async (p) => {
      await expect(loadPublished(p)).rejects.toThrow(/Invalid published data path/);
      expect(urls).toEqual([]);
    },
  );

  it("HTTP errors name the file", async () => {
    respond = () => ({ ok: false, status: 404, json: async () => ({}) });
    await expect(loadPublished("runs/x/run-findings.json")).rejects.toThrow(
      "Could not load runs/x/run-findings.json: HTTP 404",
    );
  });

  it("network errors name the file", async () => {
    g.fetch = async () => {
      throw new TypeError("boom");
    };
    await expect(loadPublished("index.json")).rejects.toThrow("Could not load index.json: network error");
  });

  it("invalid JSON errors name the file", async () => {
    respond = () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("bad");
      },
    });
    await expect(loadPublished("index.json")).rejects.toThrow("Could not load index.json: the file is not valid JSON");
  });
});
