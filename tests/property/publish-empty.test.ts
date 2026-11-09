// Feature: dashboard-usability-overhaul, Property 55: An empty delta disables publishing and creates no commit
import { describe, it, expect, beforeEach } from "vitest";
import fc from "fast-check";
import type { ConsoleDeps } from "../../src/admin/console-deps.js";
import type { GitPort, GitResult } from "../../src/admin/git-port.js";
import { PUBLISH_GROUP, publishOverview, resetPublishLock } from "../../src/admin/publish-api.js";
import { canPublish, computeDelta, isDeltaEmpty } from "../../src/admin/publish-delta.js";
import type { PublishDelta } from "../../src/admin/publish-delta.js";
import { isConfigPath } from "../../src/admin/publish-paths.js";

// Fakes only: an in-memory file system and a recording git port. No real repository or remote is used.

const NUM_RUNS = 100;
const TIP = "a".repeat(40);

const configPathArb = fc.oneof(
  fc.constantFrom("config/app.config.json", "config/page-seed.json", ".github/workflows/guardian.yml"),
  fc.stringMatching(/^[a-z0-9]{1,6}\.json$/).map((n) => `config/domains/${n}`),
  fc.stringMatching(/^[a-z0-9]{1,6}$/).map((n) => `baselines/${n}/baseline.v1.md`),
  fc.stringMatching(/^[a-z0-9]{1,6}$/).map((n) => `baselines-visual/${n}/desktop.png`),
);
const otherPathArb = fc.oneof(
  fc.stringMatching(/^[a-z0-9]{1,6}\.txt$/).map((n) => `notes/${n}`),
  fc.stringMatching(/^[a-z0-9]{1,6}\.ts$/).map((n) => `src/${n}`),
  fc.stringMatching(/^[a-z0-9]{1,6}\.json$/).map((n) => `artifacts/${n}`),
  fc.constant("config/domains/"),
  fc.constant("README.md"),
);
const idArb = fc.stringMatching(/^[0-9a-f]{40}$/);

const mapArb = (pathArb: fc.Arbitrary<string>): fc.Arbitrary<Map<string, string>> =>
  fc.array(fc.tuple(pathArb, idArb), { maxLength: 8 }).map((e) => new Map(e));

function configOnly(m: Map<string, string>): Map<string, string> {
  return new Map([...m].filter(([p]) => isConfigPath(p)));
}
function sameOnConfig(a: Map<string, string>, b: Map<string, string>): boolean {
  const x = configOnly(a);
  const y = configOnly(b);
  if (x.size !== y.size) return false;
  for (const [p, id] of x) if (y.get(p) !== id) return false;
  return true;
}
function size(d: PublishDelta): number {
  return d.added.length + d.modified.length + d.deleted.length;
}

interface Rig {
  deps: ConsoleDeps;
  calls: string[][];
}

function makeRig(local: Map<string, string>, remote: Map<string, string>): Rig {
  const calls: string[][] = [];
  const ok = (stdout = ""): GitResult => ({ code: 0, stdout, stderr: "" });
  const git: GitPort = {
    run: async (args, opts) => {
      calls.push([...args]);
      const [sub, a1] = args;
      if (sub === "remote") return ok("https://example.invalid/repo.git\n");
      if (sub === "rev-parse" && a1 === "--abbrev-ref") return ok("main\n");
      if (sub === "rev-parse") return ok(`${TIP}\n`);
      if (sub === "fetch") return ok();
      if (sub === "ls-files") return ok([...local.keys()].map((p) => p + "\0").join(""));
      if (sub === "hash-object") {
        const paths = (opts?.stdin ?? "").split("\n").filter((l) => l !== "");
        return ok(paths.map((p) => (local.get(p) as string) + "\n").join(""));
      }
      if (sub === "ls-tree") return ok([...remote].map(([p, id]) => `100644 blob ${id}\t${p}\0`).join(""));
      if (sub === "config") return ok("value\n");
      return ok();
    },
  };
  const files = new Set(local.keys());
  const deps: ConsoleDeps = {
    port: 7787,
    fs: {
      root: "C:/fake-root",
      exists: (rel) => files.has(rel),
      readText: () => {
        throw new Error("missing");
      },
      readBytes: () => new Uint8Array(4),
      writeText: () => undefined,
      listDir: () => [],
    },
    git,
    jobs: { current: () => null, start: () => ({ ok: false, reason: "idle" }) },
    approval: { authorizeSetupAction: () => undefined, approveVisualBaseline: () => undefined },
    clock: { now: () => new Date("2025-01-02T03:04:05.000Z") },
  };
  return { deps, calls };
}

async function call(deps: ConsoleDeps, method: "GET" | "POST", pattern: string, body: unknown = {}) {
  const route = PUBLISH_GROUP.find((r) => r.method === method && r.pattern === pattern);
  if (!route) throw new Error("no route");
  return route.handler({ deps, req: {} as never, params: {}, query: {}, body });
}

const FORBIDDEN_WRITES = new Set(["commit-tree", "update-index", "push", "write-tree", "update-ref", "read-tree"]);

describe("**Property 55**: An empty delta disables publishing and creates no commit", () => {
  beforeEach(() => resetPublishLock());

  it("computeDelta is empty if and only if the maps agree on configuration paths", () => {
    fc.assert(
      fc.property(mapArb(fc.oneof(configPathArb, otherPathArb)), mapArb(fc.oneof(configPathArb, otherPathArb)), (a, b) => {
        expect(isDeltaEmpty(computeDelta(a, b))).toBe(sameOnConfig(a, b));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("identical maps give an empty delta, and non-configuration differences never make it non-empty", () => {
    fc.assert(
      fc.property(
        mapArb(configPathArb),
        mapArb(otherPathArb),
        mapArb(otherPathArb),
        (cfg, extraLocal, extraRemote) => {
          expect(size(computeDelta(cfg, new Map(cfg)))).toBe(0);
          const local = new Map([...extraLocal, ...cfg]);
          const remote = new Map([...extraRemote, ...cfg]);
          expect(isDeltaEmpty(computeDelta(local, remote))).toBe(true);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("canPublish is false with the right reason for each blocking condition", () => {
    const deltaArb = fc.record({
      added: fc.array(configPathArb, { maxLength: 3 }),
      modified: fc.array(configPathArb, { maxLength: 3 }),
      deleted: fc.array(configPathArb, { maxLength: 3 }),
    });
    fc.assert(
      fc.property(deltaArb, fc.boolean(), fc.boolean(), fc.nat({ max: 5 }), (delta, originExists, publishRunning, stagedOperations) => {
        const r = canPublish({ delta, originExists, publishRunning, stagedOperations });
        if (isDeltaEmpty(delta)) {
          expect(r).toEqual({ canPublish: false, reason: "nothing-to-publish" });
        } else if (!originExists) {
          expect(r).toEqual({ canPublish: false, reason: "no-origin" });
        } else if (publishRunning) {
          expect(r).toEqual({ canPublish: false, reason: "publish-running" });
        } else if (stagedOperations > 0) {
          expect(r).toEqual({ canPublish: false, reason: "staged-changes" });
        } else {
          expect(r.canPublish).toBe(true);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("with an empty delta POST /api/publish returns 409 and no commit, index, or push call is made", async () => {
    await fc.assert(
      fc.asyncProperty(
        mapArb(configPathArb),
        mapArb(otherPathArb),
        mapArb(otherPathArb),
        fc.constantFrom("publish", "trigger"),
        async (cfg, extraLocal, extraRemote, purpose) => {
          resetPublishLock();
          const { deps, calls } = makeRig(new Map([...extraLocal, ...cfg]), new Map([...extraRemote, ...cfg]));
          const r = await call(deps, "POST", "/api/publish", { reviewer: "Sam", confirm: true, purpose });
          expect(r.status).toBe(409);
          expect((r.json as { reason: string }).reason).toBe("nothing-to-publish");
          expect(calls.some((c) => FORBIDDEN_WRITES.has(c[0] as string))).toBe(false);

          const st = await call(deps, "GET", "/api/publish/status");
          const sj = st.json as { canPublish: boolean; reason: string; count: number };
          expect(sj.canPublish).toBe(false);
          expect(sj.reason).toBe("nothing-to-publish");
          expect(sj.count).toBe(0);
          expect((await publishOverview(deps)).unpublishedChanges).toBe(0);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("the unpublished-changes indicator is on if and only if the delta is non-empty", async () => {
    await fc.assert(
      fc.asyncProperty(mapArb(configPathArb), mapArb(configPathArb), async (local, remote) => {
        resetPublishLock();
        const { deps } = makeRig(local, remote);
        const expected = size(computeDelta(local, remote));
        const overview = await publishOverview(deps);
        expect(overview.unpublishedChanges).toBe(expected);
        expect(overview.unpublishedChanges !== 0).toBe(!sameOnConfig(local, remote));
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
