// Feature: dashboard-usability-overhaul, Property 46: A new-domain draft changes nothing until it is confirmed
import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConsole } from "../../src/admin/console-router.js";
import { realFs } from "../../src/admin/console-deps.js";
import type { ConsoleDeps } from "../../src/admin/console-deps.js";
import { setHostResolver } from "../../src/admin/domain-setup-api.js";
import { discoveryChecks } from "../../src/admin/discovery-api.js";

/**
 * **Validates: Requirements 21.2, 21.3, 21.7, 21.8, 21.9, 21.11**
 *
 * Sequences of wizard actions that never include a successful confirm leave the project
 * configuration and baselines byte-identical; cancel removes the draft file and staging folder.
 * Filesystem-heavy, so 60 runs of up to 12 actions each.
 */

const CONFIG = '{\r\n    "approvedDomain": "example.test",\r\n    "baseUrl": "https://example.test",\r\n    "domain": "example-test",\r\n    "limits": { "pages": 3 }\r\n}\r\n';
const SEED = '{\n  "maxUrls": 10,\n  "approvedUrls": ["https://example.test/"]\n}\n';
const DOMAIN_FILE = '{"domain":"example.test","baseUrl":"https://example.test","approvedSchemes":["https"]}\n';
const HOSTS = ["new-site.example", "other-site.example"];
const REVIEWER = "S. Nair";
const DRAFT = "artifacts/admin/new-domain-draft.json";
const STAGING = "artifacts/admin/new-domain";

type Action =
  | { t: "start"; host: number; mismatch: boolean }
  | { t: "add"; host: number; path: string }
  | { t: "addForeign" }
  | { t: "cancel" }
  | { t: "restart"; host: number }
  | { t: "discovery" }
  | { t: "specDraft" }
  | { t: "capture" }
  | { t: "confirmMistyped" }
  | { t: "confirmNotReady" }
  | { t: "get" };

const actionArb: fc.Arbitrary<Action> = fc.oneof(
  fc.record({ t: fc.constant("start" as const), host: fc.nat(1), mismatch: fc.boolean() }),
  fc.record({ t: fc.constant("add" as const), host: fc.nat(1), path: fc.stringMatching(/^[a-z]{1,6}$/) }),
  fc.constant<Action>({ t: "addForeign" }),
  fc.constant<Action>({ t: "cancel" }),
  fc.record({ t: fc.constant("restart" as const), host: fc.nat(1) }),
  fc.constant<Action>({ t: "discovery" }),
  fc.constant<Action>({ t: "specDraft" }),
  fc.constant<Action>({ t: "capture" }),
  fc.constant<Action>({ t: "confirmMistyped" }),
  fc.constant<Action>({ t: "confirmNotReady" }),
  fc.constant<Action>({ t: "get" }),
);

function put(root: string, rel: string, text: string): void {
  const p = join(root, rel);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, text, "utf8");
}

function snapshot(dir: string, base: string, out: Record<string, string>): void {
  if (!existsSync(dir)) return;
  for (const n of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, n.name);
    if (n.isDirectory()) snapshot(p, base, out);
    else out[p.slice(base.length)] = readFileSync(p).toString("base64");
  }
}

function projectState(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of ["config", "baselines", "baselines-visual"]) snapshot(join(root, d), root, out);
  return out;
}

const headers = { host: "127.0.0.1:7787", contentType: "application/json" };

describe("Property 46: A new-domain draft changes nothing until it is confirmed", () => {
  it("keeps project config and baselines byte-identical across draft actions; cancel removes draft and staging", async () => {
    setHostResolver(async () => ["93.184.216.34"]);
    const savedChecks = { ...discoveryChecks };
    discoveryChecks.chromiumInstalled = async () => true;
    discoveryChecks.hostResolves = async () => true;
    try {
      await fc.assert(
        fc.asyncProperty(fc.array(actionArb, { minLength: 1, maxLength: 12 }), async (actions) => {
          const root = mkdtempSync(join(tmpdir(), "awg-p46-"));
          try {
            put(root, "config/app.config.json", CONFIG);
            put(root, "config/page-seed.json", SEED);
            put(root, "config/domains/example-test.json", DOMAIN_FILE);
            put(root, "baselines/example-test/baseline.v1.md", "old spec");
            put(root, "baselines-visual/example-test/desktop.png", "png-bytes");
            const before = projectState(root);

            const running = false;
            const deps: ConsoleDeps = {
              port: 7787,
              fs: realFs(root),
              git: { run: async () => ({ code: 0, stdout: "", stderr: "" }) },
              jobs: {
                current: () => null,
                status: () => ({
                  state: running ? "running" : "idle", kind: null, scope: null, startedAt: null, finishedAt: null,
                  elapsedMs: 0, exitCode: null, progress: null, tail: [],
                }),
                // A fake job: it "produces" a staged spec draft only (never a visual baseline),
                // so a confirm can never be ready in this property.
                start: (spec: { scope: string }) => {
                  if (spec.scope === "draft") put(root, `${STAGING}/baselines/fake-page/baseline.v1.md`, "staged spec");
                  return { ok: true };
                },
              } as unknown as ConsoleDeps["jobs"],
              approval: { authorizeSetupAction: () => undefined, approveVisualBaseline: () => undefined },
              clock: { now: () => new Date("2025-01-02T03:04:05.000Z") },
            };
            const post = (path: string, body: unknown) =>
              createConsole(deps).handle({ method: "POST", path, query: {}, headers, body: JSON.stringify(body) });
            const get = (path: string) =>
              createConsole(deps).handle({ method: "GET", path, query: {}, headers: { host: headers.host }, body: null });
            const start = (host: number, mismatch = false) =>
              post("/api/domain/setup/start", {
                host: HOSTS[host], retypedHost: mismatch ? "wrong.example" : HOSTS[host], reviewer: REVIEWER,
              });
            const draftHost = (): string | null => {
              if (!existsSync(join(root, DRAFT))) return null;
              return (JSON.parse(readFileSync(join(root, DRAFT), "utf8")) as { host: string }).host;
            };
            const expectCancelled = (): void => {
              expect(existsSync(join(root, DRAFT))).toBe(false);
              expect(existsSync(join(root, STAGING))).toBe(false);
            };

            for (const a of actions) {
              switch (a.t) {
                case "start":
                  await start(a.host, a.mismatch);
                  break;
                case "add":
                  await post("/api/urls/add", {
                    scope: "draft", reviewer: REVIEWER, url: `https://${draftHost() ?? HOSTS[a.host]}/${a.path}/`,
                  });
                  break;
                case "addForeign":
                  await post("/api/urls/add", { scope: "draft", reviewer: REVIEWER, url: "https://example.test/x/" });
                  break;
                case "cancel": {
                  const had = draftHost() !== null;
                  const r = await post("/api/domain/setup/cancel", { reviewer: REVIEWER });
                  expect(r.status).toBe(had ? 200 : 409);
                  expectCancelled();
                  break;
                }
                case "restart": {
                  if (draftHost() !== null) {
                    expect((await post("/api/domain/setup/cancel", { reviewer: REVIEWER })).status).toBe(200);
                    expectCancelled();
                  }
                  await start(a.host);
                  break;
                }
                case "discovery":
                  await post("/api/discovery/run", { scope: "draft" });
                  break;
                case "specDraft":
                  await post("/api/baselines/spec/draft", { scope: "draft" });
                  break;
                case "capture":
                  await post("/api/baselines/visual/capture", { scope: "draft" });
                  break;
                case "confirmMistyped": {
                  const h = draftHost();
                  const r = await post("/api/domain/setup/confirm", { reviewer: REVIEWER, retypedHost: "wrong.example", confirm: true });
                  expect(r.status).toBeGreaterThanOrEqual(400);
                  expect(h === null ? true : existsSync(join(root, DRAFT))).toBe(true);
                  break;
                }
                case "confirmNotReady": {
                  const h = draftHost();
                  const r = await post("/api/domain/setup/confirm", { reviewer: REVIEWER, retypedHost: h ?? HOSTS[0], confirm: true });
                  expect(r.status).toBeGreaterThanOrEqual(400); // no visual baselines are ever approved
                  break;
                }
                case "get":
                  await get("/api/domain/setup");
                  break;
              }
              // The invariant: nothing in the project changed.
              expect(projectState(root)).toEqual(before);
            }

            // Final cancel always clears the draft and staging, still without touching the project.
            if (draftHost() !== null) {
              expect((await post("/api/domain/setup/cancel", { reviewer: REVIEWER })).status).toBe(200);
            }
            expectCancelled();
            expect(projectState(root)).toEqual(before);
          } finally {
            rmSync(root, { recursive: true, force: true });
          }
        }),
        { numRuns: 60 },
      );
    } finally {
      Object.assign(discoveryChecks, savedChecks);
      setHostResolver();
    }
  }, 120_000);
});
