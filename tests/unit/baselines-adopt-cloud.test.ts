import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConsole } from "../../src/admin/console-router.js";
import { realFs } from "../../src/admin/console-deps.js";
import type { ConsoleDeps, VisualBaselineInput } from "../../src/admin/console-deps.js";
import { SelfApprovalError } from "../../src/approval/approval-gate.js";

let root: string;
let visualCalls: VisualBaselineInput[];

const RUN = "run_abcdef123456";
const LOCAL_RUN = "run_local1234567";
const SLUG = "example-test";
const PNG_A = Buffer.from([137, 80, 78, 71, 1, 2, 3, 4]);
const PNG_B = Buffer.from([137, 80, 78, 71, 9, 9, 9, 9]);

function put(rel: string, data: string | Buffer): void {
  const p = join(root, rel);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, data);
}
function deps(): ConsoleDeps {
  return {
    port: 7787,
    fs: realFs(root),
    git: { run: async () => ({ code: 0, stdout: "", stderr: "" }) },
    jobs: { current: () => null, start: () => ({ ok: false, reason: "none" }) },
    approval: {
      authorizeSetupAction: (i) => {
        if (/agent/i.test(i.reviewer)) throw new SelfApprovalError("agent identity rejected");
      },
      approveVisualBaseline: (i) => {
        expect(existsSync(join(root, "baselines-visual", i.slug, `${i.viewport}.png`))).toBe(true);
        visualCalls.push(i);
      },
    },
    clock: { now: () => new Date("2025-01-02T03:04:05.000Z") },
  };
}
const headers = { host: "127.0.0.1:7787", contentType: "application/json" };
async function post(body: unknown) {
  return createConsole(deps()).handle({ method: "POST", path: "/api/baselines/adopt-cloud", query: {}, headers, body: JSON.stringify(body) });
}
const body = (extra: Record<string, unknown> = {}) => ({
  reviewer: "Pat Reviewer", runId: RUN, items: [{ slug: SLUG, viewport: "desktop" }], ...extra,
});

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "awg-adopt-"));
  visualCalls = [];
  put("config/app.config.json", JSON.stringify({ approvedDomain: "example.test", baseUrl: "https://example.test", domain: "example-test", limits: { pages: 4 } }));
  put("config/page-seed.json", JSON.stringify({ maxUrls: 10, approvedUrls: ["https://example.test/"] }, null, 2) + "\n");
  put(`artifacts/runs/${RUN}/origin`, "cloud");
  put(`artifacts/runs/${RUN}/screenshots/${SLUG}.desktop.png`, PNG_A);
  put(`artifacts/runs/${LOCAL_RUN}/origin`, "local");
  put(`artifacts/runs/${LOCAL_RUN}/screenshots/${SLUG}.desktop.png`, PNG_A);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("adopt cloud screenshots", () => {
  it("copies the cloud PNG byte for byte, audits after, and logs the setup entry", async () => {
    put(`baselines-visual/${SLUG}/desktop.png`, PNG_B);
    const r = await post(body());
    expect(r.status).toBe(200);
    expect(readFileSync(join(root, "baselines-visual", SLUG, "desktop.png")).equals(PNG_A)).toBe(true);
    expect(visualCalls).toHaveLength(1);
    expect(visualCalls[0].source).toBe(RUN);
    expect(visualCalls[0].updated).toBe(true);
    expect(visualCalls[0].sha16).toMatch(/^[0-9a-f]{16}$/);
    expect(readdirSync(join(root, "baselines-visual", SLUG))).toEqual(["desktop.png"]);
    expect(readFileSync(join(root, "artifacts", "admin", "setup-activity.jsonl"), "utf8")).toContain("baselines-adopted-from-cloud");
  });

  it("skips unchanged bytes", async () => {
    put(`baselines-visual/${SLUG}/desktop.png`, PNG_A);
    const r = await post(body());
    expect((r.json as { unchanged: number }).unchanged).toBe(1);
    expect(visualCalls).toHaveLength(0);
  });

  it("rejects an unknown run, traversal, a local run, and an agent name with nothing written", async () => {
    expect((await post(body({ runId: "run_zzzzzz999999" }))).status).toBe(404);
    expect((await post(body({ runId: "../etc" }))).status).toBe(400);
    expect((await post(body({ items: [{ slug: "../x", viewport: "desktop" }] }))).status).toBe(400);
    const local = await post(body({ runId: LOCAL_RUN }));
    expect(local.status).toBe(409);
    expect((await post(body({ reviewer: "Agent Smith" }))).status).toBe(403);
    expect((await post(body({ reviewer: "  " }))).status).toBe(400);
    expect(existsSync(join(root, "baselines-visual"))).toBe(false);
    expect(visualCalls).toHaveLength(0);
  });

  it("refuses a page that is not an approved address", async () => {
    put(`artifacts/runs/${RUN}/screenshots/other-page.desktop.png`, PNG_A);
    const r = await post(body({ items: [{ slug: "other-page", viewport: "desktop" }] }));
    expect((r.json as { refused: number }).refused).toBe(1);
    expect(existsSync(join(root, "baselines-visual"))).toBe(false);
  });

  it("lists adoptable items only from cloud runs", async () => {
    const r = await createConsole(deps()).handle({ method: "GET", path: "/api/baselines/cloud-runs", query: {}, headers: { host: headers.host }, body: null });
    const j = r.json as { runs: { runId: string; items: { slug: string }[] }[] };
    expect(j.runs.map((x) => x.runId)).toEqual([RUN]);
    expect(j.runs[0].items[0].slug).toBe(SLUG);
  });
});
