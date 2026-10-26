# Design Document — Guardian Phase 2 Overhaul

## Overview

Guardian Phase 2 Overhaul extends the existing Assurity Web Guardian (AWG) — a human-supervised, deterministic, zero-token website quality monitor — without rewriting its proven core. The existing pipeline (`runGuardian` in `src/core/orchestrator.ts`), the per-run `EvidenceStore`, the append-only audit log, the read-only `Event_Server` (loopback SSE/HTTP on `127.0.0.1:7788`), the deterministic/AI agent split, and the human approval gates all remain the source of truth. This phase layers six capabilities on top of that foundation:

1. **Redesigned Dashboard** — a static, server-less HTML+JS dashboard with large charts (run health, trends over ≥10 runs, findings by page/severity, new-vs-recurring a11y) that renders identically from static `Published_Data` (GitHub Pages, no server) and from the local `Event_Server`.
2. **Virtual Office overhaul + intro cinematic** — a command-center 3D environment where human-looking characters enter through a door, take a *dynamically assigned* available desk, work, and leave, driven *only* by genuine run events; preceded by a skippable clouds-over-New-Zealand cinematic.
3. **Admin GUI** — a loopback-only control panel that launches the office and dashboard, shows the `Guarded_Domain` and runs newest-first, edits the schedule, and triggers a single manual run (rejecting concurrency).
4. **Full-site coverage** — a BFS same-domain crawler up to a `Maximum_Discovery_Count` (default 500) producing a `Full_Site_Scope`, a `Scope_Difference` against previously approved scope, path-segment grouping above a `Large_Scope_Threshold` (default 25), and a human `Scope_Approval` gate.
5. **Hybrid free deployment** — a public GitHub repo, a hardened GitHub Actions `Cloud_Runner` (scheduled + `workflow_dispatch`), a sanitizing publisher that converts run artifacts into `Published_Data`, and a GitHub Pages `Pages_Site` that serves the dashboard and office in `Replay_Mode`.
6. **Security and robustness** — no committed secrets, published-data sanitization (including the known absolute-path leak in `test-manifest.json`), Actions hardening, admin SSRF/loopback safety, dependency pinning, and preservation of every existing guarantee.

### Design principles (non-negotiable, inherited)

- **Deterministic and zero-token at runtime.** No LLM calls during a run. "AI agents" stay templated and clearly labelled.
- **Human-in-control.** Scope, baselines, and findings require explicit human approval. No agent approves its own output.
- **Honest visualization.** The office renders a character only when a genuine run event backs it. No fabricated activity.
- **Free and offline-capable.** No paid services. Charting and 3D assets are vendored/pinned so the published site works offline.
- **Backward compatible.** Existing `findings.json` (`pages[]` shape), evidence, baselines, and audit history are preserved; any migration is recorded.

### Key decisions and tradeoffs

- **Charting library: Chart.js (MIT), vendored locally.** Chosen over D3 (lower-level, more code for standard charts) and over CDN-hosted libraries (fails Requirement 5's "no requests to any server" and offline constraint). Chart.js v4 is MIT-licensed, actively maintained, small, and renders bar/line/doughnut charts to `<canvas>` with zero network calls once vendored. We pin an exact version and commit the UMD bundle under `dashboard/vendor/chart.umd.min.js`. Tradeoff: ~200 KB committed binary vs. a CDN link; acceptable because offline + no-network is a hard requirement. Licensing is recorded in a `DEPENDENCIES.md` ledger (Requirement 12.3).
- **Characters: procedural parametric low-poly humanoids, not purchased asset packs.** Generated at runtime from a small set of primitive meshes (capsule torso, spheres/boxes for head/limbs) parameterized by seed → body proportions, skin tone, hair style/color, clothing color, and gender silhouette. This is free, offline, deterministic, tiny, and guarantees the "distinct by ≥2 attributes" requirement by construction. A single optional CC0 glTF (e.g. a public-domain low-poly human) is acceptable as a fallback but is **not** required and is rejected as the primary approach because it adds a binary asset, is harder to vary into distinct males/females, and complicates offline bundling. Tradeoff: procedural humans look stylized rather than photoreal; acceptable for a command-center aesthetic and keeps zero-cost/offline guarantees.
- **Live-vs-static detection in the office/dashboard: build-time flag with runtime fallback.** The Vite build is produced twice-capable: a runtime `dataSource` resolver first checks for an injected build flag (`import.meta.env.VITE_AWG_MODE`), then falls back to probing `GET http://127.0.0.1:7788/idle` with a short timeout. On the `Pages_Site` the flag is `replay`, so no probe is attempted and no request leaves the page. Locally the flag is `live` (or absent → probe succeeds). Tradeoff: a build flag is explicit and avoids any accidental network call on the static site, which is why it takes precedence over runtime detection.

---

## Architecture

### Two data-flow planes

AWG Phase 2 runs in two planes that share one artifact format but never share a server.

**Plane A — Local Live (`Live_Mode`), laptop on:**

```
                 Admin GUI (loopback:7787)
                   | launch        | trigger run         | edit schedule
                   v               v                     v
             open browser    spawn run pipeline     guardian-task.ps1 / schedule.json
                   |          (lockfile-guarded)
                   |               |
                   |               v
                   |        runGuardian(cfg)  --writes-->  artifacts/runs/<id>/
                   |               |                        events.jsonl, findings.json,
                   |               |                        results.json, screenshots/, ...
                   v               v
          Event_Server (loopback:7788, read-only)  <-- reads artifacts/runs + .guardian.lock
                   |  /runs /runs/:id/events /findings /live(SSE) /replay /idle
                   v
         Dashboard (live)            Virtual Office (live, SSE)
```

**Plane B — Cloud + Pages (`Replay_Mode`), laptop off or publishing:**

```
   schedule (>=daily) / workflow_dispatch
                   |
                   v
   GitHub Actions Cloud_Runner (ubuntu, pinned Node + Playwright, 30-min timeout)
     job: run  (read-only GITHUB_TOKEN)
        -> install pinned deps, playwright install --with-deps chromium
        -> node dist/index.js run   (deterministic, zero-token, approved scope only)
        -> publisher: artifacts -> Published_Data (sanitized static JSON + images)
     job: publish (contents: write ONLY here, environment: github-pages)
        -> upload Published_Data + static bundle (dashboard + office built replay-only)
        -> deploy to Pages_Site
                   |
                   v
   GitHub Pages (static, no server, no SSE)
     /                      -> Admin-less landing / dashboard
     /dashboard/            -> Dashboard (reads /data/*.json)
     /office/               -> Virtual Office (Vite build, VITE_AWG_MODE=replay)
     /data/index.json       -> Published runs index
     /data/runs/<id>/...    -> per-run summary + sanitized events + images
```

The **artifact format is identical** across planes: the local `Event_Server` serves the same shapes (`runs`, per-run `events`, `findings`) that the publisher freezes into static JSON. This is what lets the dashboard and office run unchanged in both modes behind a single `dataSource` abstraction.

### Component map

| Layer | Existing (reused) | New / changed in Phase 2 |
|---|---|---|
| Config | `app-config.ts`, `app.config.json`, `page-seed.json` | `Domain_Config` (`config/domains/*.json`), `schedule.json`, extended limits (`maxDiscoveryCount`, `largeScopeThreshold`) |
| Discovery | `discover-candidates.mjs` | `src/agents/discovery-crawler.ts` (BFS), `scope-store.ts` (proposed/approved scope + diff + grouping) |
| Run pipeline | `orchestrator.ts`, `scheduled-trigger.ts`, `evidence-store.ts`, telemetry, safety | Observation_Runner reads approved `Full_Site_Scope`; `test-generator.ts` path fix |
| Local serving | `event-server.ts` (:7788) | unchanged API; office/dashboard point at it in live mode |
| Admin | — | `src/admin/admin-server.ts` (:7787 loopback), `src/admin/schedule.ts`, `src/admin/domain-validate.ts` |
| Reporting | `report.ts`, `dashboard-builder.ts`, `analytics.ts` | New `dashboard/` static app (Chart.js); `dashboard-builder.ts` emits data contract JSON instead of embedding tables |
| Publishing | — | `src/publish/publisher.ts`, `src/publish/sanitizer.ts`, `src/publish/published-data.ts` |
| Office | `virtual-office/` | `office3d/` overhaul: `OfficeStateMachine`, `DeskManager`, procedural `Human`, `Door`, `IntroCinematic`, `CommandCenter` scene; `dataSource` abstraction |
| Cloud | — | `.github/workflows/guardian.yml`, `.gitignore` secret patterns |
| Verification | `verify.mjs` | extended invariants (sanitization, loopback-admin, no-fabricated-characters, static-no-network) |

### Request/pacing guarantees preserved

Both discovery (new BFS crawler) and observation (`runGuardian`) continue to honor `requestSpacingMs >= 1000` (1 req/s/host). The crawler reuses `domain-guard.ts` (`isApprovedDomain`) for the approved-domain boundary and off-domain-redirect skip. No forms, no load testing — the crawler only issues `GET`/navigation.

---

## Components and Interfaces

### 1. Dashboard (Requirement 1, 11.3)

The dashboard becomes a small static app under `dashboard/` deployed both to the Pages site and openable locally. It renders exclusively from a **data contract** (static JSON) so it behaves identically whether that JSON came from the publisher or from a thin local shim that proxies the `Event_Server`.

**Files**

```
dashboard/
  index.html            # <canvas> chart containers + empty-state region
  app.js                # loads data contract, builds Chart.js charts, applies AI labelling
  style.css             # layout; chart area >= 50% of page on 1440x900
  vendor/chart.umd.min.js  # pinned Chart.js v4 UMD (MIT), committed
  data-source.js        # resolves live vs static data contract
```

**Data contract (what the dashboard reads).** Produced by `dashboard-builder.ts` (static) and equivalently assembled from the `Event_Server` (live). See Data Models → `DashboardData`.

**`data-source.js` interface**

```ts
type DashboardMode = "static" | "live";
interface DashboardDataSource {
  mode: DashboardMode;
  load(): Promise<DashboardData>;   // static: fetch ./data/dashboard.json (relative, same-origin)
                                     // live:   fetch 127.0.0.1:7788 endpoints and assemble
}
function resolveDataSource(): DashboardDataSource; // build flag first, then /idle probe
```

**Rendering rules**

- Charts: `runHealthTrend` (line, chronological, ≥10 most recent or all), `findingsByPage` (bar), `findingsBySeverity` (doughnut/bar), `a11yNewVsRecurring` (stacked bar). Combined `<canvas>` area occupies ≥50% of the 1440×900 viewport via CSS grid (enforced by a layout test).
- **Empty state (1.7):** if `data.runs.length === 0`, render a single visible "No run data available" panel and *no* chart `<canvas>` elements (no blank/broken containers).
- **AI labelling (1.8, 1.9, 11.3):** every AI-assisted element carries `data-ai="true"`, a persistent CSS class `.ai-assisted` (distinct border/background matching the existing orange `.ai` treatment), and a visible "not a deterministic fact" badge. Deterministic evidence elements carry `.deterministic` and never `.ai-assisted`. A render-time assertion walks AI elements; if any lacks the label or carries the deterministic treatment, the app throws and shows the empty-state message instead of the unlabelled element (fail-closed).
- **No network on static (1.5):** in static mode only relative `./data/*.json` fetches occur; the `Event_Server` is never contacted. Verified by a test that asserts `app.js` issues no absolute/`127.0.0.1` requests when `mode==="static"`.

**`dashboard-builder.ts` evolution.** Today it embeds HTML tables. It changes to emit `artifacts/dashboard-data.json` (the `DashboardData` contract) from `computeAnalytics()` + per-run findings, and to copy the static `dashboard/` app alongside. `report.ts` keeps producing the per-run `report/index.html` (unchanged responsibility), but absolute `file:///` evidence links are replaced with run-relative paths so the report is publishable.

### 2. Virtual Office overhaul + intro cinematic (Requirements 2, 3, 11.3)

The office is rebuilt around an **event-driven state machine** and a **desk manager**, with procedural humans that walk in/out. Component tree (replacing/extending `office3d/*`):

```
App.tsx
  <DataSourceProvider>            # live (SSE) vs replay (static JSON) — see below
    <IntroCinematic onReveal/>    # clouds over NZ + title; skippable; purely visual
    <CommandCenter>               # room shell: screens, dynamic lights, atmosphere
      <OfficeFloor/> <Door/>
      {characters.map(c => <Human key=c.id {...c.appearance} state=c.phase>
                              <BillboardLabel text=c.labelText/>
                           </Human>)}
      <Controls>                  # orbit + first-person walk (retained)
    </CommandCenter>
```

**Office state machine (`office/stateMachine.ts`).** Pure function over the event list, replacing/extending `deriveSnapshot`. It maps genuine agent-status events to *character lifecycles*, not to fixed desks.

```ts
type CharPhase = "entering" | "waiting" | "seated" | "working" | "leaving" | "gone";
interface OfficeCharacter {
  id: string;            // stable per (agentName, run occurrence)
  agentName: string;     // genuine name from event.data.agentName
  role: "deterministic" | "ai" | "coordinator" | "human";
  appearance: HumanAppearance;   // derived deterministically from agentName (seed)
  phase: CharPhase;
  deskId: string | null; // assigned dynamically; null while waiting/entering/leaving
  labelText: string;     // agent name truncated to 24 chars + "…"
}
interface OfficeModel {
  characters: OfficeCharacter[];
  idle: boolean;
  runId?: string;
}
function reduceOffice(prev: OfficeModel, event: GEvent, desks: DeskManager): OfficeModel;
function deriveOffice(events: GEvent[], desks: DeskManager): OfficeModel; // fold reduceOffice
```

**Event → lifecycle mapping (honesty, 2.11–2.13, 3.5–3.6):**

- `agent.started` / `agent.working` for an agent with no present character → create a character in `entering`; `DeskManager.acquire()`; if a desk is free → assign and transition toward `seated`→`working`; if none free → `waiting` at the door until a desk frees.
- `agent.completed` / `agent.failed` → the agent's character transitions to `leaving`; on exit, `DeskManager.release(deskId)` marks the desk available.
- **Malformed/absent events** (missing `kind`, missing `data.agentName` where required, unknown kind) → ignored; no character created; current honest state retained.
- If no event indicates active work → `idle === true`, zero working characters (honest idle).
- The cinematic never injects characters; office state during and after the cinematic derives only from events.

**`DeskManager` (`office/deskManager.ts`) — dynamic availability (2.2–2.5):**

```ts
interface DeskManager {
  readonly desks: { id: string; position: [number,number,number]; rotationY: number }[];
  firstAvailable(): string | null;     // not assigned and not occupied
  acquire(charId: string): string | null; // assign first available, else null (caller -> waiting)
  release(deskId: string): void;        // mark available
  assignmentOf(charId: string): string | null;
}
```

No agent is bound to a fixed desk. A desk is "available" iff not currently assigned to or occupied by any character. When a desk frees, the oldest `waiting` character is seated within 1–3 s (animation timing lives in the `Human` component; the model just flips `waiting→entering/seated`).

**Procedural `Human` (`office3d/Human.tsx`).** `HumanAppearance` is derived deterministically from the agent name so the same agent always looks the same, and concurrent agents differ by ≥2 of {body, clothing color, hair}:

```ts
interface HumanAppearance {
  gender: "male" | "female";
  bodyScale: [number, number, number]; // torso/limb proportions
  skinTone: string; hairStyle: "short"|"bun"|"long"|"bald"; hairColor: string;
  shirtColor: string; trouserColor: string;
}
function appearanceFor(agentName: string): HumanAppearance; // hash(agentName) -> params
```

The mesh is built from primitives (`<capsuleGeometry>`, `<sphereGeometry>`, `<boxGeometry>`) plus simple walk/sit animation via `useFrame`. No external model files.

**`BillboardLabel` (2.7, 2.8).** Uses drei `<Billboard>` + `<Text>` parented to the moving `Human` group (above the head, not above a desk). drei's `<Billboard>` re-orients every frame, so it faces the active camera within one frame (<100 ms) of any camera move. Label text = full agent name, truncated to 24 chars with trailing `…` when longer.

**Command-center scene (2.1).** `CommandCenter` adds large emissive screen planes on the back wall (showing run id / phase text), dynamic point/spot lights with subtle color keyed to overall run state, a dark reflective floor, and atmospheric fog + ambient glow — clearly beyond the old static desk grid.

**Cameras (2.9, 2.10, 3.3).** `Spawn_Camera` at top-back corner framing the whole room on load and after the cinematic reveal. `Controls` retains orbit + first-person walk.

**Intro cinematic (`office3d/IntroCinematic.tsx`, Requirement 3).** A full-screen overlay scene: a stylized New Zealand landmass (simple extruded/again procedural shape) under a volumetric-ish cloud layer (instanced soft sprites/noise), with the app title text set among the clouds. On load it plays, then the clouds part/dissolve (opacity + displacement tween) to reveal the command center, completing within 2–6 s, then hands control to `Spawn_Camera` via `onReveal`. A visible **Skip** button calls `onReveal` immediately. It is purely visual and sets no agent/run state (3.5); office state continues to derive only from events (3.6).

**Live vs replay data source (`office/dataSource.ts`, 6.10, 6.11).**

```ts
type OfficeMode = "live" | "replay" | "historical";
interface OfficeDataSource { mode: OfficeMode; subscribe(cb:(events:GEvent[])=>void): () => void; }
function resolveOfficeMode(): OfficeMode; // VITE_AWG_MODE flag first, then /idle probe
```

- **Live:** keeps the existing `useLive` SSE against `:7788`.
- **Replay/static (Pages):** reads `/data/runs/<id>/events.json` (published, sanitized) and feeds events through the same `deriveOffice` reducer — the identical honesty guarantees apply. No SSE, no trigger.

### 3. Admin GUI (Requirements 4, 10)

A tiny Node HTTP service bound to loopback only, serving a small static control page plus a JSON API. It never does work itself — it launches browsers, spawns the existing run pipeline, reads the `Event_Server`/artifacts, and edits config.

**`src/admin/admin-server.ts`**

```ts
function startAdminServer(opts?: { port?: number }): http.Server; // binds 127.0.0.1 ONLY (default 7787)
```

**API (all loopback-only; GET read, POST actions):**

| Method · Path | Purpose | Notes |
|---|---|---|
| `GET /` | Serve admin control page | launches office/dashboard via links/buttons |
| `GET /api/domain` | Current `Guarded_Domain` from `Domain_Config` | never hard-codes `assurity.nz` (4.6) |
| `GET /api/runs` | Runs newest-first with status + summary (4.3) | reads `artifacts/runs` + `daily-summary`/findings |
| `GET /api/schedule` | Current schedule | from `schedule.json` |
| `POST /api/schedule` | Persist schedule change (4.4) | validates `HH:mm`/interval; writes `schedule.json`; updates `guardian-task.ps1` registration on Windows |
| `POST /api/run` | Trigger a single manual run (4.5, 10.2) | lockfile-guarded; rejects if `.guardian.lock` present (409) |
| `POST /api/open/office` · `/api/open/dashboard` | Launch views (4.1) | opens local URLs |
| `POST /api/domain` (future) | Edit `Guarded_Domain` (10.3–10.6) | runs `validateDomainSubmission` first; rejects SSRF/internal/non-approved |

**Safety (Requirement 10):**

- **Loopback bind (10.1):** `server.listen(port, "127.0.0.1")`. A test asserts it is not reachable on a non-loopback interface.
- **Single run / no concurrency (10.2):** `POST /api/run` checks `artifacts/.guardian.lock`; if present → `409 Conflict`, no new run. Reuses the existing lockfile protocol from `scheduled-trigger.ts` so manual, scheduled, and cloud runs share one mutex semantics.
- **Domain validation (`src/admin/domain-validate.ts`, 10.3–10.6):**

```ts
interface DomainValidation { ok: boolean; reason?: string; }
function validateDomainSubmission(input: string, approvedSet: string[]): DomainValidation;
// rejects: non-http(s) scheme; IP literals; hosts resolving to private/loopback/link-local
//          ranges (10/8, 172.16/12, 192.168/16, 127/8, ::1, 169.254/16, fc00::/7);
//          hosts/schemes outside the approved set. Preserves the approved-domain boundary (10.6).
```

**Schedule editing (`src/admin/schedule.ts`, 4.4).** Canonical schedule lives in `config/schedule.json` (`{ "intervalHours": 24, "dailyAt": "09:00", "enabled": true }`). On Windows, the admin writes the file and then re-registers the Task Scheduler entry by invoking `guardian-task.ps1 install <HH:mm>`; `guardian-task.ps1` is parameterized to read from `schedule.json` so the PS1 and the JSON never drift. The cloud schedule is defined in the workflow `cron` (documented as the ≥daily guarantee independent of the laptop).

### 4. Full-site coverage (Requirement 5)

**`src/agents/discovery-crawler.ts` — BFS same-domain crawler.**

```ts
interface CrawlParams {
  startUrl: string; approvedDomain: string;
  maxDiscoveryCount: number;   // default 500 (Domain_Config)
  requestSpacingMs: number;    // >= 1000 (1 req/s/host)
  navTimeoutMs: number;
}
interface DiscoveredPage { url: string; depth: number; discoveredFrom: string; }
interface CrawlResult {
  scope: DiscoveredPage[];              // Full_Site_Scope (same-domain, <= max)
  offDomainRedirectsSkipped: { from: string; to: string }[]; // (5.8)
  truncatedAtMax: boolean;
}
async function crawlSite(p: CrawlParams, browser: Browser): Promise<CrawlResult>;
```

- BFS queue, `visited` set, enqueues only `isApprovedDomain` links; stops at `maxDiscoveryCount`.
- Conservative pacing: `await sleep(requestSpacingMs)` before each navigation (5.3).
- **Off-domain redirect (5.8):** after `page.goto`, compare the final URL's host; if it left the approved domain, exclude the target, keep already-discovered pages, and record it in `offDomainRedirectsSkipped`.
- No forms, GET/navigation only.

**`src/agents/scope-store.ts` — proposed/approved scope + diff + grouping.**

```ts
interface ScopeFile { domain: string; generatedAt: string; pages: string[]; }      // sorted, normalized
interface ScopeDifference { added: string[]; removed: string[]; unchanged: string[]; }
interface ScopeGroup { segment: string; pages: string[]; }                          // grouped by first path segment
function writeProposedScope(domain: string, pages: string[]): string;  // artifacts/pending-review/scope/<domain>.proposed.json
function readApprovedScope(domain: string): ScopeFile | null;          // config/scope/<domain>.approved.json
function diffScope(approved: ScopeFile | null, proposed: ScopeFile): ScopeDifference; // (5.5)
function groupByPathSegment(pages: string[]): ScopeGroup[];            // used when > largeScopeThreshold (5.6)
function approveScope(domain: string, pages: string[]): string;       // HUMAN-gated CLI; writes approved file + audit record
```

- The crawler writes `*.proposed.json` into `artifacts/pending-review/scope/` and **never** touches the authoritative `config/scope/<domain>.approved.json` (5.4). A human runs an approve command (`node dist/index.js approve-scope <domain>`), which writes the approved file and appends an append-only audit record (no self-approval).
- When `proposed.pages.length > largeScopeThreshold` (default 25), the approval presentation groups by first URL path segment so a human can approve at the group level (5.6).
- **Observation consumption (5.7):** `runGuardian` / `loadSeed` evolve to prefer `config/scope/<domain>.approved.json` when present, falling back to the legacy `page-seed.json`. The approved scope replaces the hard 10-page cap for approved domains (the `pages > 10` config guard is relaxed to a configurable `maxApprovedPages` while keeping a sane upper bound and the conservative pacing).

### 5. Publishing + sanitization (Requirements 6, 8, 11)

**`src/publish/published-data.ts` — the static contract builder.** Converts `artifacts/runs/*` into the `Published_Data` tree (see Data Models). Produces `data/index.json` (runs index newest-first), `data/dashboard.json` (the `DashboardData` contract), and `data/runs/<id>/{summary.json, events.json, findings.json}` plus sanitized screenshots under `data/runs/<id>/screenshots/`.

**`src/publish/sanitizer.ts` — fail-closed scrubber (Requirement 8).**

```ts
interface SanitizeReport { ok: boolean; withheld: string[]; reasons: Record<string,string>; }
function sanitizeJson(value: unknown): unknown;        // reuse redactor + path stripping
function stripPaths(value: unknown): unknown;          // remove absolute/internal fs paths (8.2)
function sanitizeRun(runDir: string, outDir: string): SanitizeReport; // (8.1-8.5)
```

- Reuses the existing `redactor.ts` for secrets/tokens/PII (8.1) and adds a path stripper that removes absolute/internal filesystem paths (8.2): matches `C:\...`, `/Users/...`, `/home/...`, UNC paths, and the repo root, replacing with run-relative references or `[path removed]`.
- **Known fix (8.2):** `test-manifest.json` currently embeds absolute `specPath` (`resolve(outDir)` in `test-generator.ts`). Phase 2 changes `writeTestManifest` to store repo-relative paths (`tests/generated/<slug>...`), and the sanitizer strips any residual absolute path as defense-in-depth. This is recorded as a migration (Requirement 11.8): existing runs' manifests are left as-is on disk but are sanitized at publish time.
- Excludes sensitive logs (8.3) from `Published_Data` (traces, raw console logs, otel dumps are not published).
- Screenshots publish only after sanitization of their metadata/filenames (8.4).
- **Fail-closed (8.5):** if a file cannot be confirmed clean (sanitizer throws or a disallowed pattern remains after scrubbing), the publisher **withholds** that file, records the reason in `SanitizeReport.withheld/reasons`, and continues publishing the rest; the run's summary notes withheld items.

**`src/publish/publisher.ts` — orchestrates publish.**

```ts
interface PublishResult { ok: boolean; publishedRunId?: string; withheld: string[]; reason?: string; }
async function publish(opts: { runsRoot: string; outDir: string; latestOnly?: boolean }): Promise<PublishResult>;
```

- Builds `Published_Data`, copies the static `dashboard/` and the replay-only office build into the Pages output.
- On success locally, publishing happens via the same workflow path or a local `gh`/git push to the Pages branch (documented; publishing itself is the Action's job in cloud).
- **Atomic-ish publish (6.8, 6.9):** the publisher writes to a staging dir and only the deploy step swaps it in; if the run failed or exceeded 30 min, or if publish fails, the previous `Published_Data` on Pages is left unchanged (the deploy job simply doesn't run / doesn't replace).

### 6. GitHub Actions Cloud_Runner (Requirements 6, 9, 13)

**`.github/workflows/guardian.yml` (design-level structure):**

```yaml
name: guardian
on:
  schedule: [{ cron: "0 17 * * *" }]   # >= once/24h, independent of the laptop (6.3, 6.4)
  workflow_dispatch: {}                 # manual on-demand (6.5)
permissions:
  contents: read                        # least-privilege default (9.2)
concurrency: { group: guardian, cancel-in-progress: false }  # no overlapping cloud runs
jobs:
  run:
    runs-on: ubuntu-latest
    timeout-minutes: 30                  # (6.8) hard cap
    if: github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository  # fork-PR guard (9.4)
    permissions: { contents: read }      # read-only token for the run job (9.2)
    steps:
      - uses: actions/checkout@<pinned-sha>            # pin to SHA (9.1)
      - uses: actions/setup-node@<pinned-sha>          # node-version from .nvmrc / package engines (6.2)
      - run: npm ci                                    # pinned via package-lock (12.1)
      - run: npx playwright install --with-deps chromium  # CI browser install (6.2)
      - run: npm run build
      - run: node dist/index.js run                    # deterministic, zero-token (6.2, 13.3)
      - run: node dist/publish/build-published-data.js # sanitize -> Published_Data
      - uses: actions/upload-pages-artifact@<pinned-sha>  # staged artifact
  publish:
    needs: run
    runs-on: ubuntu-latest
    permissions: { pages: write, id-token: write }     # write scoped to publish only (9.3)
    environment: { name: github-pages }
    steps:
      - uses: actions/deploy-pages@<pinned-sha>         # deploy to Pages (6.6)
```

- **Hardening (Requirement 9):** every third-party action pinned to a commit SHA (9.1); default and run-job token read-only (9.2); write permission (`pages: write`) granted only to the publish job (9.3); fork-PR privileged execution blocked via the `if` guard and by not using `pull_request_target` (9.4); no step interpolates untrusted event input into a shell — inputs are only used as data, never `run: ${{ github.event.* }}` (9.5).
- **Failure handling (6.8):** on run failure or the 30-min timeout, the `run` job fails, `publish` (which `needs: run`) does not execute, and the existing Pages content is preserved. The Actions run status records the failure.
- **Zero-token (6.2, 13.3):** the CI run executes the same `runGuardian` path with no LLM calls.

### Cloud-to-local synchronization (Requirement 7)

Cloud runs must reach the laptop with **full fidelity** (not just the sanitized `Published_Data` that feeds the Pages site). The Pages publish plane carries only sanitized, Pages-sized JSON/images; the raw per-run artifacts (`events.jsonl`, `findings.json`, `results.json`, screenshots, traces, accessibility, report) are instead committed to a dedicated **`Run_Data_Branch`** and pulled down on demand by **`Cloud_Sync`**. This keeps `main` free of large binaries while letting the local `Event_Server`, dashboard, and office replay cloud runs exactly as if they had run locally.

**`Run_Data_Branch` strategy (`runs-data`, Req 7.1, 7.2).** After a successful run **and** publish, the `Cloud_Runner` commits that run's full raw artifact directory — `artifacts/runs/<id>/` (`events.jsonl`, `findings.json`, `results.json`, `screenshots/`, `traces/`, `accessibility/`, `report/`) — to a dedicated orphan/data branch named **`runs-data`**, never to `main`. Main stays free of large run binaries. The workflow does this in the `publish` job (the only job with `contents: write`) using a scoped token and a **path-scoped** add of only `artifacts/runs/<id>/` for the current run id. The commit is **additive**: it appends one run directory and never rewrites, rebases, or force-updates history for other runs already on `runs-data`, so prior cloud runs on the branch are preserved untouched.

```yaml
# publish job (contents: write), after a successful run:
- name: Commit raw artifacts to runs-data
  run: |
    git fetch origin runs-data || true
    git checkout runs-data 2>/dev/null || git switch --orphan runs-data
    git add -- "artifacts/runs/${RUN_ID}/"   # path-scoped: only this run
    git commit -m "runs-data: add ${RUN_ID} (origin=cloud)"
    git push origin runs-data                 # additive; no force, no history rewrite
```

**Admin API addition (`Cloud_Sync`, Req 7.3–7.8).** The `admin-server` gains two endpoints:

| Method · Path | Purpose | Notes |
|---|---|---|
| `POST /api/sync` | Run `Cloud_Sync`: fetch `runs-data` and import cloud runs not present locally (4-step: fetch → enumerate → copy new → index) | **read-only w.r.t. cloud** (fetch only; no push, no branch modification); **non-destructive locally** (never overwrites/deletes existing runs, evidence, baselines, or audit history) |
| `GET /api/sync/status` | Report last sync outcome: `{ ok, added[], skipped[], reason?, at }` | reflects the most recent `cloudSync` result; failure leaves local state unchanged |

`POST /api/sync` performs a **read-only fetch** of the `runs-data` branch (`git fetch` plus a checkout/export of only the run folders not already present locally) into the local `artifacts/runs` store. It is **non-destructive**: it never overwrites or deletes existing local runs, evidence, baselines, or audit history. If the machine is offline or any step errors, it **reports the failure and leaves local state byte-for-byte unchanged** (Req 7.6). It performs no push and no modification of `runs-data` (Req 7.8).

**Run origin labelling (Req 7.7).** Each published/committed run summary carries an `origin: "local" | "cloud"` field so the `Admin_GUI` can display, for the most recent run, whether it came from a local run or the `Cloud_Runner`. The `Cloud_Runner` sets `origin=cloud` in CI via an env marker (`AWG_RUN_ORIGIN=cloud`) that the run pipeline records into the run summary; local runs default to `origin=local` when that marker is absent. `origin` is part of the run summary and the runs-index data model (see Data Models → `RunSummary`/`RunsIndex`), so both planes and `Cloud_Sync` preserve it unchanged.

**Function-signature sketch (`src/admin/cloud-sync.ts`).**

```ts
async function cloudSync(opts: {
  repoDir: string;     // repo working copy used only for a read-only fetch of runs-data
  branch: string;      // "runs-data"
  runsRoot: string;    // local artifacts/runs store
}): Promise<{ added: string[]; skipped: string[]; ok: boolean; reason?: string }>;
// 1. git fetch origin <branch>           (read-only; no push, no branch edit)
// 2. enumerate run-id directories present on the fetched branch (artifacts/runs/<id>/)
// 3. a run-id is "not already present locally" iff no directory of that run-id name
//    exists under runsRoot; only such run-ids are exported/copied in (added[])
// 4. run-ids whose directory name already exists locally are skipped[] (never touched)
// On offline/error: resolve { ok:false, reason, added:[], skipped:[] } and leave runsRoot unchanged.
```

"Not already present locally" is decided purely by **run-id directory name** under `runsRoot`: if `artifacts/runs/<id>/` already exists, that run is skipped; otherwise its directory is copied in whole.

**Conflict / safety note.** `Cloud_Sync` only **adds** new run-id directories. If a run-id already exists locally it is **skipped, never overwritten**, which preserves local fidelity and the append-only audit guarantee (the audit log and existing runs are inputs to sync, never outputs of it). The resulting local run set is exactly the union of what was already local and the new cloud run-ids.

### 7. Config: `Domain_Config` and schedule (Requirements 4.6, 4.7, 5, 10.6)

```ts
interface DomainConfig {
  domain: string;                 // e.g. "assurity.nz" (data, never hard-coded)
  baseUrl: string;                // "https://assurity.nz"
  approvedSchemes: string[];      // ["https"]
  maxDiscoveryCount: number;      // 500
  largeScopeThreshold: number;    // 25
  requestSpacingMs: number;       // 1000
  scopeFile: string;              // "config/scope/assurity-nz.approved.json"
}
interface ScheduleConfig { enabled: boolean; intervalHours: number; dailyAt: string; }
function loadDomainConfig(domain?: string): DomainConfig; // from config/domains/<domain>.json; default = single configured domain
function listDomains(): string[];
```

`config/domains/assurity-nz.json` is the initial single domain. The system is multi-domain-ready (directory of domain files) but operates against the one configured domain (4.7). `app-config.ts` gains `maxDiscoveryCount`/`largeScopeThreshold` and a `domain` pointer; the legacy `pages>10` guard is replaced by `maxApprovedPages`.

---

## Data Models

### Published_Data (static Pages tree)

```
data/
  index.json                 # RunsIndex: runs newest-first with status + summary
  dashboard.json             # DashboardData contract (below)
  runs/
    <runId>/
      summary.json           # RunSummary (pages, failedChecks, a11y, visual, status)
      findings.json          # sanitized findings (pages[] shape, unchanged schema)
      events.json            # sanitized event list (for office replay)
      screenshots/*.png      # sanitized screenshots
```

```ts
interface RunsIndex {
  generatedAt: string;
  domain: string;
  runs: {
    runId: string; finishedAt?: string; status: string; pages: number;
    failedChecks: number; pendingReview: boolean;
    origin: "local" | "cloud";   // where the run executed (Req 7.7); defaults "local"
  }[]; // newest-first
}

interface RunSummary {
  runId: string; finishedAt?: string; status: string;
  pages: number; failedChecks: number;
  origin: "local" | "cloud";     // "cloud" when produced by the Cloud_Runner (AWG_RUN_ORIGIN=cloud), else "local"
  // ...existing a11y/visual/status fields unchanged
}
```

**`origin` field (Req 7.7).** Both `RunSummary` (per-run `summary.json`) and each entry of `RunsIndex` carry `origin: "local" | "cloud"`. The `Cloud_Runner` sets it to `"cloud"` via the `AWG_RUN_ORIGIN` env marker; local runs default to `"local"`. `Cloud_Sync` imports run directories verbatim, so a synced cloud run keeps `origin: "cloud"` locally, letting the `Admin_GUI` label the most recent run's provenance.

### Run_Data_Branch layout (`runs-data`)

The dedicated `runs-data` branch mirrors the local raw store one directory per run, so a fetched run drops straight into `artifacts/runs/`:

```
(runs-data branch)
artifacts/
  runs/
    <runId>/
      events.jsonl       # raw event stream
      findings.json      # raw findings (pages[] shape)
      results.json       # raw per-page results
      screenshots/*.png  # raw screenshots
      traces/            # raw Playwright traces
      accessibility/     # raw a11y output
      report/            # per-run report
```

This is the raw, unsanitized counterpart to the sanitized `Published_Data` tree above; `Cloud_Sync` copies whole `<runId>/` directories from this branch into the local `artifacts/runs/` store.

### DashboardData contract (read by the dashboard in both modes)

```ts
interface DashboardData {
  generatedAt: string;
  domain: string;
  runHealthTrend: { runId: string; finishedAt?: string; failedChecks: number; health: "healthy"|"attention"|"failing"; }[]; // chronological, >=10 or all (1.3)
  findingsByPage: { page: string; count: number }[];        // (1.2)
  findingsBySeverity: Record<string, number>;               // critical/serious/moderate/minor (1.2)
  a11yNewVsRecurring: { new: number; recurring: number };   // (1.2)
  aiItems: { agent: string; label: string; text: string; relatedFindingId: string; classification: string }[]; // always .ai-assisted (1.8)
  empty: boolean;                                           // true when no runs (1.7)
}
```

### Scope files

- `artifacts/pending-review/scope/<domain>.proposed.json` → `ScopeFile` (proposed; not authoritative).
- `config/scope/<domain>.approved.json` → `ScopeFile` (authoritative; human-approved; version-controlled).
- `ScopeDifference` carried in the approval UI/CLI output and audited.

### Office model

`OfficeCharacter`, `OfficeModel`, `HumanAppearance`, `CharPhase` as defined above. Derived purely from `GEvent[]`; no persisted office state.

### Backward-compatible / migrated artifacts

- `findings.json` keeps the existing `{ runId, correlationId, awaitingReview, pages: [...] }` shape — unchanged, so existing runs render in the new dashboard and verify checks still pass.
- `test-manifest.json` **migration (11.8):** new runs store repo-relative `specPath`; existing manifests are untouched on disk and sanitized at publish. The migration is recorded as an audit/event note.
- Existing `artifacts/runs/*`, baselines, and `audit.jsonl` are preserved; no destructive change.

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

We apply property-based testing to the **pure, input-varying logic** introduced in this phase: the dashboard-data assembly and trend selection, the office state reducer and desk manager, the procedural appearance generator, the label truncation, the crawler boundary/bounding, the scope diff and grouping, the sanitizer (secrets and paths), and the admin domain validation. UI layout, animation timing, camera placement, library/licensing policy, workflow YAML hardening, SSE wiring, and the lockfile concurrency rule are covered by example, edge-case, integration, or smoke tests in the Testing Strategy instead (they do not have meaningful "for all inputs" statements).

### Property 1: Dashboard breakdown counts conserve and partition totals

*For any* set of run findings, the dashboard-data assembly SHALL produce breakdowns such that the sum of per-page counts equals the total number of findings, the severity buckets partition the accessibility findings (every a11y finding falls in exactly one severity bucket and the bucket sizes sum to the a11y total), and `a11yNewVsRecurring.new + a11yNewVsRecurring.recurring` equals the total count of accessibility findings classified as new or recurring.

**Validates: Requirements 1.2**

### Property 2: Trend selection is the most-recent chronological suffix

*For any* list of runs, the `runHealthTrend` SHALL contain the minimum of (all available runs) and (at least the 10 most recent when 10 or more exist), SHALL be ordered chronologically (non-decreasing finish time), and SHALL be exactly the most-recent subset of the runs (no older run appears while a newer run is omitted).

**Validates: Requirements 1.3**

### Property 3: AI elements are always labelled and visually distinct; deterministic elements never are

*For any* mix of AI-assisted items and deterministic evidence items, every rendered AI-assisted element SHALL carry the "not a deterministic fact" label and the persistent `.ai-assisted` visual treatment, and no deterministic evidence element SHALL carry the `.ai-assisted` treatment.

**Validates: Requirements 1.8, 11.3**

### Property 4: Office honesty — every present character is backed by a genuine event, and the cinematic adds none

*For any* list of run events (optionally interleaved with the intro cinematic being active), every `OfficeCharacter` in the derived model that is `entering`, `seated`, or `working` SHALL correspond to a genuine agent work event in that input, and when the input contains no agent work events the model SHALL be idle with zero working characters. The intro cinematic SHALL NOT introduce any character not derivable from the events alone.

**Validates: Requirements 2.11, 2.12, 3.5, 3.6**

### Property 5: Malformed or absent events never change the honest state

*For any* valid event list `E` and *any* set of malformed events `M` (missing `kind`, missing required `data.agentName`, or unknown `kind`), `deriveOffice(interleave(E, M))` SHALL produce the same set of characters and the same idle state as `deriveOffice(E)`.

**Validates: Requirements 2.13**

### Property 6: Seating lifecycle — begin seats when a desk is free, holds when full, frees on finish

*For any* event sequence, a character created from an agent-begin event SHALL become `seated` with a non-null assigned desk whenever an available desk exists at or after its creation; if no desk is available it SHALL remain `waiting` with a null desk and SHALL become seated after a desk is released; and a character that receives its agent-finish event SHALL transition to `leaving`/`gone` and its desk SHALL become available again.

**Validates: Requirements 2.2, 2.3, 2.4**

### Property 7: Desk exclusivity — no two present characters ever share a desk

*For any* event sequence, at every step of the derivation, no desk is assigned to or occupied by more than one present `OfficeCharacter`, and desk assignment is determined only by availability at entry time (not bound to agent identity).

**Validates: Requirements 2.5**

### Property 8: Character distinctness by at least two attributes

*For any* two distinct agent names, `appearanceFor` SHALL produce appearances whose `gender` is either "male" or "female" and that differ in at least two of the three attribute groups {body (bodyScale), clothing (shirtColor/trouserColor), hair (hairStyle/hairColor)}.

**Validates: Requirements 2.6**

### Property 9: Billboard label truncation

*For any* agent name, the Billboard label text SHALL equal the name when the name length is at most 24 characters, and otherwise SHALL be the first 23 characters followed by a single ellipsis, with the resulting label length never exceeding 24 characters.

**Validates: Requirements 2.7**

### Property 10: Admin run list is strictly newest-first with status and summary

*For any* set of runs, the admin run list SHALL be ordered strictly newest-first by finish time (or directory mtime when finish time is absent), and every entry SHALL include a status and a summary.

**Validates: Requirements 4.3**

### Property 11: Crawl output stays within the approved domain and the discovery bound

*For any* link graph reachable from the start URL, the crawl result SHALL contain at most `maxDiscoveryCount` pages and every page SHALL be on the approved domain; no link to a host outside the approved domain SHALL appear in the `Full_Site_Scope`.

**Validates: Requirements 5.1, 5.2**

### Property 12: Scope difference is an exact set partition

*For any* previously approved scope `A` and proposed scope `P`, `diffScope(A, P)` SHALL yield `added = P \ A`, `removed = A \ P`, and `unchanged = A ∩ P`, such that `added ∪ unchanged = P`, `removed ∪ unchanged = A`, and the three sets are pairwise disjoint.

**Validates: Requirements 5.5**

### Property 13: Path-segment grouping is lossless and segment-consistent

*For any* list of discovered pages, `groupByPathSegment` SHALL produce groups whose union of pages equals the input set with no page lost or duplicated, and every page within a group SHALL share that group's first URL path segment.

**Validates: Requirements 5.6**

### Property 14: Off-domain redirects are excluded and recorded, prior discoveries retained

*For any* crawl in which a discovered link redirects to a host outside the approved domain, the redirect target SHALL be absent from the `Full_Site_Scope`, SHALL appear in `offDomainRedirectsSkipped`, and all same-domain pages discovered before the redirect SHALL remain in the scope.

**Validates: Requirements 5.8**

### Property 15: Sanitizer removes secrets

*For any* data object containing embedded secret-shaped values (tokens, bearer credentials, API keys, long opaque strings, PII patterns), the sanitized output SHALL contain none of those secret-pattern substrings.

**Validates: Requirements 8.1**

### Property 16: Sanitizer removes absolute and internal filesystem paths

*For any* data object containing absolute, UNC, or internal filesystem paths (for example `C:\...`, `/Users/...`, `/home/...`, `\\host\share`), the sanitized output SHALL contain no absolute-path pattern.

**Validates: Requirements 8.2**

### Property 17: Domain validation rejects unsafe hosts and schemes

*For any* submitted domain that uses a non-approved scheme, is an IP literal, or resolves to a private/loopback/link-local range (10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, ::1, fc00::/7), or whose host/scheme is outside the approved set, `validateDomainSubmission` SHALL reject it; and *for any* approved-set host over an approved scheme it SHALL accept it. This preserves the approved-domain boundary so a configured domain cannot direct the Guardian to scan arbitrary hosts.

**Validates: Requirements 10.3, 10.4, 10.5, 10.6**

### Property 18: Cloud sync is additive and never overwrites local runs

*For any* set of local run-ids L and any set of cloud run-ids C on the Run_Data_Branch, Cloud_Sync SHALL add to the local store exactly the run-ids in C that are not in L, SHALL leave every pre-existing local run-id in L unchanged, and SHALL remove nothing; the resulting local set equals L ∪ C.

**Validates: Requirements 7.3, 7.5, 7.8**

---

## Error Handling

- **Dashboard, missing/empty data (1.7):** `DashboardData.empty === true` → render one visible empty-state panel and zero chart canvases. A failed fetch in static mode is treated as empty data, never a blank chart.
- **Dashboard, unlabelled AI element (1.9):** a render-time assertion fails closed — the app catches the error and shows the empty-state message rather than the unlabelled element.
- **Office, malformed/absent events (2.13):** the reducer ignores any event missing `kind` or a required `agentName`, or with an unknown kind; no character is created and the prior honest state is retained.
- **Office, no free desk (2.3):** surplus characters wait at the door (deskId null) and are seated when `DeskManager.release` frees a desk; the model never invents a desk.
- **Crawler, navigation failure / off-domain redirect (5.8):** a failed navigation is recorded and skipped without aborting the crawl; an off-domain redirect excludes the target and is recorded in `offDomainRedirectsSkipped` while retaining prior discoveries.
- **Crawler, bound reached (5.1):** stops at `maxDiscoveryCount` and sets `truncatedAtMax`.
- **Admin, concurrent run (10.2):** `POST /api/run` returns `409` and starts no run when `.guardian.lock` exists; the lock is released only by its owner (existing protocol).
- **Admin, invalid domain/schedule (4.4, 10.3–10.5):** invalid submissions are rejected with a reason and no config is written.
- **Publisher, cannot confirm clean (8.5):** the offending file is withheld, the reason recorded in `SanitizeReport`, and the rest of the run still publishes.
- **Cloud run failure / 30-min timeout (6.8):** the `run` job fails, `publish` does not run, Pages content is preserved, and the failure shows in the Actions run status.
- **Publish failure (6.9):** staging is not swapped in; previous `Published_Data` is left byte-for-byte unchanged and the failure is reported.
- **Audit integrity (11.7):** any attempt to alter a completed record raises `IntegrityError`; corrections are appended as new events.
- **Telemetry/OTel export failure:** optional exporters never stop a run (existing behavior retained).

---

## Testing Strategy

A dual approach: **property-based tests** verify the universal properties above across many generated inputs; **unit / edge / integration / smoke tests** cover specific behaviors, boundaries, wiring, and policy that are not input-varying.

### PBT suite (fast-check, already a dev dependency)

- One property-based test per correctness property (Properties 1–18), each running **minimum 100 iterations**. Property 18 (cloud sync) generates arbitrary disjoint/overlapping local and cloud run-id sets and asserts the synced local set equals the union with no pre-existing run mutated.
- Each test is tagged with a comment: `// Feature: guardian-phase2-overhaul, Property {n}: {property text}`.
- We do not implement a PBT framework from scratch; we use the pinned `fast-check@^3.22.0` already in `devDependencies`.
- Generators: arbitrary findings sets (page/severity/state), arbitrary run lists with timestamps, arbitrary event sequences (including malformed events and desk-exhausting sequences), arbitrary agent-name sets, arbitrary URL/link graphs with mixed same/off-domain hosts, arbitrary nested objects seeded with secret/path patterns, and arbitrary host/scheme strings including private-range IPs.
- The office reducer, desk manager, appearance generator, truncation, crawler boundary logic, scope diff/grouping, sanitizer, and domain validator are all pure (or purifiable by injecting the browser/clock), which keeps these properties cheap to run 100+ iterations in-memory with no network.

### Unit / edge-case tests

- Empty-state (1.7), unlabelled-AI fallback (1.9), honest-idle with no work events (2.12), crawler pacing ≥1000 ms between same-host requests (5.3), crawler writes only the proposed scope and leaves the approved file untouched (5.4), publisher preserves previous data on run/publish failure (6.8, 6.9), withhold-on-unconfirmed (8.5), admin concurrent-run rejection (4.5/10.2), and audit integrity rejection (11.7).

### Integration tests

- Dashboard live mode assembles the same `DashboardData` from the `Event_Server` as static mode (1.6); Observation_Runner scans exactly the approved scope on a run (5.7); Billboard labels render via drei and reorient per frame (2.8); Pages/Actions publish retrievable (6.6) observed at the workflow level.

### Example / smoke tests

- Chart area ≥50% at 1440×900 (1.1); static no-network + <3 s render (1.5); replay build exposes no SSE/trigger and issues no loopback fetch (6.10); spawn camera position (2.9); orbit+walk cameras present (2.10); cinematic reveal within 2–6 s (3.2); domain read from `Domain_Config` (4.6); admin loopback bind (10.1); no committed secrets and `.gitignore` secret patterns (7.1–7.4); dependency pinning + vendored Chart.js license recorded (1.4, 12.1, 12.3); zero-token run path (13.3); workflow hardening lint — pinned SHAs, least-privilege token, publish-only write, fork-PR guard, no untrusted-input execution (9.1–9.5).

### Extending `scripts/verify.mjs` (new invariants)

`verify.mjs` grows beyond its current 17 checks with Phase 2 invariants, run after a build + at least two runs + a publish:

- **sanitization-removes-paths:** no file under `Published_Data` contains an absolute/UNC/internal path pattern (asserts the `test-manifest` leak is fixed and the sanitizer worked).
- **sanitization-removes-secrets:** no `Published_Data` file matches secret/token/PII patterns.
- **loopback-only-admin:** the admin server binds `127.0.0.1` and is not reachable on a non-loopback address.
- **no-fabricated-characters:** for the latest published run, every character the office would derive maps to a genuine event in `events.json` (runs the `deriveOffice` honesty check over published events).
- **static-dashboard-no-network:** the static dashboard bundle references only relative `./data/*.json` and contains no `127.0.0.1`/absolute data URLs; the office replay build contains no SSE/trigger endpoints.
- **approved-scope-only:** every page in the latest run is in the approved scope file for the configured domain (generalizes the existing `approved-domain-only` check beyond `assurity.nz`).
- **workflow-hardened:** the workflow YAML pins all `uses:` to SHAs, defaults to `contents: read`, and grants write only in the publish job.
- **deps-pinned:** `package-lock.json` present and the vendored Chart.js version matches the recorded pin.
- **cloud-sync-additive-nondestructive:** simulating a `Cloud_Sync` against a `runs-data` snapshot adds only run-ids absent locally, leaves every pre-existing local run directory byte-for-byte unchanged, removes nothing, and performs no push/branch modification (Property 18 / Req 7.3, 7.5, 7.8).

Existing checks (two-runs-completed, layout, screenshots, findings-json shape, deterministic-vs-AI, awaiting-review, audit-not-editable, baseline-exists, dashboard-exists) are retained unchanged, preserving backward compatibility.

---

## Security

This section consolidates Requirements 7–10 (and the preservation guarantees of Requirement 11).

- **No committed secrets (Req 7).** The repo contains no tokens/keys/credentials. `.gitignore` excludes `.env`, `.env.*`, `*.secret`, `*.pem`, `*.key`, and local credential files so a matching file cannot be tracked. Any value the `Cloud_Runner` needs is referenced only as a GitHub `Action_Secret` (`${{ secrets.* }}`), never read from a committed file. The default `GITHUB_TOKEN` is used for Pages publishing, so no custom PAT is committed.
- **Published-data sanitization (Req 8).** The `sanitizer` runs before every publish and is fail-closed: it removes secrets/tokens/PII (reusing `redactor.ts`), strips absolute/internal/UNC filesystem paths (including the fixed `test-manifest.json` leak), excludes traces/raw logs, publishes only sanitized screenshots, and withholds + records any file it cannot confirm clean. Sanitization is verified by two `verify.mjs` invariants and two property-based tests.
- **Raw artifacts on the `runs-data` branch (Req 7).** The `runs-data` branch holds RAW (unsanitized) run artifacts. This is acceptable **only** because the public repository is the Reviewer's own and those raw artifacts are the Reviewer's own site data; the raw branch is a private-fidelity convenience for `Cloud_Sync`, not a public-facing surface. The PUBLIC-facing exposure (the `Pages_Site`) still serves only sanitized `Published_Data`, and **no secrets are ever committed to any branch**. The sanitization and secret rules in Requirements 8 and 9 still apply in full: the Guardian never writes secrets into run artifacts, so the raw artifacts on `runs-data` must still contain no secrets, and anything public-facing is sanitized before it reaches the `Pages_Site`.
- **GitHub Actions hardening (Req 9).** Third-party actions pinned to commit SHAs; `permissions: contents: read` as the default and for the run job; `pages: write`/`id-token: write` scoped to the publish job only; no `pull_request_target`; a fork-PR guard prevents privileged execution on untrusted forks; untrusted event fields are only ever treated as data, never interpolated into a `run:` shell command; a 30-minute `timeout-minutes` bounds every run; a `concurrency` group prevents overlapping cloud runs.
- **Admin safety (Req 10).** The `Admin_GUI` binds `127.0.0.1` only (never an external interface). The manual-run control starts at most one run per activation and rejects concurrent duplicates via the shared `.guardian.lock`. A future domain-edit validates every submission with `validateDomainSubmission`, rejecting non-approved schemes/hosts and any host resolving to internal/private/loopback/link-local ranges, which preserves the approved-domain boundary and blocks SSRF-style abuse.
- **Preserved guarantees (Req 11).** Pages is read-only (static files, no write endpoint); baselines and scope require human approval with no agent self-approval; deterministic facts stay separate from and labelled distinctly to AI opinion in both the dashboard and the office; crawling and observation stay within the approved domain at the conservative request rate; no forms, no load testing; the append-only tamper-evident audit log is retained and corrections are appended, never overwritten; existing runs, evidence, baselines, and audit history are preserved, and the one required migration (`test-manifest` relative paths) is recorded.
- **Free and zero-token (Req 12, 13).** Dependencies are pinned (`package-lock.json`, vendored Chart.js at an exact version) and preferred libraries are well-known and actively maintained; cost and licensing are recorded in `DEPENDENCIES.md` so any non-free/restrictive dependency is flagged before adoption. Runs make no LLM calls and consume zero AI tokens, in the cloud and locally alike; the only external data sharing is the Reviewer publishing their own results to their own Pages site.
