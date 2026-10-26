# Implementation Plan: Guardian Phase 2 Overhaul

## Overview

This plan extends the existing Assurity Web Guardian (AWG) without rewriting its proven core (`runGuardian`, `EvidenceStore`, append-only audit, read-only `Event_Server`, deterministic/AI agent split, human approval gates). All new code is TypeScript (backend, office, publishing, admin); the vendored dashboard app is plain HTML+JS+CSS per the design; property-based tests use the pinned `fast-check@^3.22.0` already in `devDependencies`.

Tasks are ordered to respect natural dependencies: the config/domain model is foundational; discovery, dashboard data, office data source, admin, and publishing build on it; the GitHub Actions workflow depends on the publisher; property-based tests for Properties 1–18 sit next to the pure logic they validate; and the extended `verify.mjs` invariants plus the final build/verify gate come last. Each task builds on the previous ones and ends by wiring the new code into the existing pipeline so there is no orphaned code.

## Tasks

- [x] 1. Config and domain model foundation
  - [x] 1.1 Add `Domain_Config` loader and types
    - Create `src/config/domain-config.ts` with `DomainConfig`, `ScheduleConfig` interfaces and `loadDomainConfig(domain?)`, `listDomains()`
    - Create `config/domains/assurity-nz.json` (domain, baseUrl, approvedSchemes `["https"]`, `maxDiscoveryCount` 500, `largeScopeThreshold` 25, `requestSpacingMs` 1000, `scopeFile`)
    - Read domain as data; never hard-code `assurity.nz` in a blocking way
    - _Requirements: 4.6, 4.7, 5.1, 5.6, 10.6_

  - [x] 1.2 Extend `app-config.ts` with Phase 2 limits
    - Add `maxDiscoveryCount`, `largeScopeThreshold`, and a `domain` pointer to the app config
    - Replace the legacy `pages > 10` guard with a configurable `maxApprovedPages` (sane upper bound retained)
    - Keep `requestSpacingMs >= 1000` enforced
    - _Requirements: 5.1, 5.7, 12.6_

  - [x] 1.3 Create canonical `schedule.json`
    - Create `config/schedule.json` (`{ enabled, intervalHours, dailyAt }`, default `{ true, 24, "09:00" }`)
    - Document that the cloud `cron` provides the independent ≥daily guarantee
    - _Requirements: 4.4, 6.3_

  - [ ]* 1.4 Write unit tests for domain config loading
    - Test default single-domain load, multi-domain directory listing, and limit defaults
    - _Requirements: 4.6, 4.7_

- [x] 2. Full-site discovery crawler, scope store, and approval flow
  - [x] 2.1 Implement BFS same-domain crawler
    - Create `src/agents/discovery-crawler.ts` with `CrawlParams`, `DiscoveredPage`, `CrawlResult`, `crawlSite(p, browser)`
    - BFS queue + `visited` set; enqueue only `isApprovedDomain` links (reuse `domain-guard.ts`); stop at `maxDiscoveryCount` and set `truncatedAtMax`
    - `await sleep(requestSpacingMs)` before each navigation (≥1000 ms/host); GET/navigation only, no forms
    - Off-domain redirect: compare final URL host after `page.goto`; exclude target, retain prior discoveries, record in `offDomainRedirectsSkipped`
    - _Requirements: 5.1, 5.2, 5.3, 5.8, 12.4, 12.5, 12.6_

  - [ ]* 2.2 Write property test for crawl domain/bound invariant
    - **Property 11: Crawl output stays within the approved domain and the discovery bound**
    - **Validates: Requirements 5.1, 5.2**

  - [ ]* 2.3 Write property test for off-domain redirect handling
    - **Property 14: Off-domain redirects are excluded and recorded, prior discoveries retained**
    - **Validates: Requirements 5.8**

  - [ ]* 2.4 Write unit test for crawler pacing
    - Assert ≥1000 ms between consecutive same-host navigations
    - _Requirements: 5.3_

  - [x] 2.5 Implement scope store (proposed/approved, diff, grouping)
    - Create `src/agents/scope-store.ts` with `ScopeFile`, `ScopeDifference`, `ScopeGroup`
    - `writeProposedScope` → `artifacts/pending-review/scope/<domain>.proposed.json`; `readApprovedScope` ← `config/scope/<domain>.approved.json`
    - `diffScope(approved, proposed)` (added/removed/unchanged); `groupByPathSegment(pages)` used above `largeScopeThreshold`
    - Crawler writes only the proposed file and never touches the approved file
    - _Requirements: 5.4, 5.5, 5.6_

  - [ ]* 2.6 Write property test for scope difference partition
    - **Property 12: Scope difference is an exact set partition**
    - **Validates: Requirements 5.5**

  - [ ]* 2.7 Write property test for path-segment grouping
    - **Property 13: Path-segment grouping is lossless and segment-consistent**
    - **Validates: Requirements 5.6**

  - [ ]* 2.8 Write unit test for proposed-not-authoritative behavior
    - Assert crawler writes `*.proposed.json` and leaves `config/scope/<domain>.approved.json` untouched
    - _Requirements: 5.4_

  - [x] 2.9 Implement human-gated scope approval CLI
    - Add `approveScope(domain, pages)` writing the approved file and appending an append-only audit record (no self-approval)
    - Wire `approve-scope <domain>` subcommand into `src/index.ts`; present grouped view when `> largeScopeThreshold`
    - _Requirements: 5.4, 5.6, 12.2, 12.7_

  - [x] 2.10 Wire approved scope into observation
    - Update `runGuardian` / seed loading to prefer `config/scope/<domain>.approved.json`, falling back to legacy `page-seed.json`
    - Honor `maxApprovedPages` and conservative pacing on the approved scope
    - _Requirements: 5.7, 12.6_

  - [ ]* 2.11 Write integration test for approved-scope observation
    - Assert Observation_Runner scans exactly the approved scope on a run
    - _Requirements: 5.7_

- [x] 3. Checkpoint — config, discovery, and scope approval
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Dashboard data contract and static dashboard app
  - [x] 4.1 Define and emit the `DashboardData` contract
    - Add `DashboardData` type; evolve `dashboard-builder.ts` to emit `artifacts/dashboard-data.json` from `computeAnalytics()` + per-run findings
    - Build `runHealthTrend` (chronological, ≥10 or all), `findingsByPage`, `findingsBySeverity`, `a11yNewVsRecurring`, `aiItems`, `empty`
    - Replace absolute `file:///` evidence links in `report.ts` with run-relative paths
    - _Requirements: 1.2, 1.3, 1.7, 1.8, 11.8_

  - [ ]* 4.2 Write property test for breakdown conservation
    - **Property 1: Dashboard breakdown counts conserve and partition totals**
    - **Validates: Requirements 1.2**

  - [ ]* 4.3 Write property test for trend selection
    - **Property 2: Trend selection is the most-recent chronological suffix**
    - **Validates: Requirements 1.3**

  - [x] 4.4 Vendor Chart.js and scaffold the static dashboard
    - Commit pinned Chart.js v4 UMD bundle to `dashboard/vendor/chart.umd.min.js`
    - Create `dashboard/index.html` (canvas containers + empty-state region) and `dashboard/style.css` (chart area ≥50% at 1440×900 via CSS grid)
    - Record Chart.js version/license in `DEPENDENCIES.md`
    - _Requirements: 1.1, 1.4, 12.1, 12.3, 13.1, 13.2, 13.3_

  - [x] 4.5 Implement dashboard data source resolver
    - Create `dashboard/data-source.js` with `resolveDataSource()`: build flag (`VITE_AWG_MODE`) first, then `/idle` probe fallback
    - Static mode fetches only relative `./data/dashboard.json`; live mode assembles from `Event_Server` endpoints
    - _Requirements: 1.5, 1.6, 6.10_

  - [x] 4.6 Implement dashboard rendering and AI labelling
    - Create `dashboard/app.js`: build the four charts; render single empty-state panel with zero canvases when `data.empty`
    - Apply `data-ai="true"`, `.ai-assisted` treatment, and visible "not a deterministic fact" badge to every AI element; `.deterministic` to evidence
    - Render-time fail-closed assertion: throw and show empty-state if any AI element is unlabelled or carries deterministic treatment
    - _Requirements: 1.1, 1.2, 1.5, 1.6, 1.7, 1.8, 1.9, 11.3_

  - [ ]* 4.7 Write property test for AI labelling distinctness
    - **Property 3: AI elements are always labelled and visually distinct; deterministic elements never are**
    - **Validates: Requirements 1.8, 11.3**

  - [ ]* 4.8 Write unit tests for empty-state and unlabelled-AI fallback
    - Test visible empty-state with no broken canvases (1.7) and fail-closed fallback for unlabelled AI (1.9)
    - _Requirements: 1.7, 1.9_

  - [ ]* 4.9 Write integration test for live/static parity
    - Assert live mode assembles the same `DashboardData` from the `Event_Server` as static mode
    - _Requirements: 1.6_

  - [ ]* 4.10 Write smoke tests for layout, no-network, and render time
    - Chart area ≥50% at 1440×900 (1.1); static mode issues no absolute/`127.0.0.1` requests and renders < 3 s (1.5)
    - _Requirements: 1.1, 1.5_

- [x] 5. Virtual office overhaul
  - [x] 5.1 Implement office data source abstraction
    - Create `office/dataSource.ts` with `OfficeDataSource`, `resolveOfficeMode()` (`VITE_AWG_MODE` first, then `/idle` probe)
    - Live: existing `useLive` SSE against `:7788`; replay: read `/data/runs/<id>/events.json` and feed the same reducer; no SSE/trigger in replay
    - _Requirements: 6.10, 6.11_

  - [x] 5.2 Implement the office state machine reducer
    - Create `office/stateMachine.ts` with `CharPhase`, `OfficeCharacter`, `OfficeModel`, `reduceOffice`, `deriveOffice`
    - Map genuine `agent.started`/`agent.working` → character `entering`→seated/waiting; `agent.completed`/`agent.failed` → `leaving`→`gone`
    - Ignore malformed/absent events (missing `kind`/`agentName`, unknown kind); honest idle when no work events
    - _Requirements: 2.11, 2.12, 2.13, 3.5, 3.6_

  - [ ]* 5.3 Write property test for office honesty
    - **Property 4: Office honesty — every present character is backed by a genuine event, and the cinematic adds none**
    - **Validates: Requirements 2.11, 2.12, 3.5, 3.6**

  - [ ]* 5.4 Write property test for malformed-event invariance
    - **Property 5: Malformed or absent events never change the honest state**
    - **Validates: Requirements 2.13**

  - [ ]* 5.5 Write unit test for honest idle
    - Assert idle state with zero working characters when no work events exist
    - _Requirements: 2.12_

  - [x] 5.6 Implement the dynamic desk manager
    - Create `office/deskManager.ts` with `firstAvailable`, `acquire`, `release`, `assignmentOf`
    - Desk available iff not assigned to or occupied by any character; assign dynamically on entry; no agent bound to a fixed desk; seat oldest waiting character on release
    - _Requirements: 2.2, 2.3, 2.4, 2.5_

  - [ ]* 5.7 Write property test for seating lifecycle
    - **Property 6: Seating lifecycle — begin seats when a desk is free, holds when full, frees on finish**
    - **Validates: Requirements 2.2, 2.3, 2.4**

  - [ ]* 5.8 Write property test for desk exclusivity
    - **Property 7: Desk exclusivity — no two present characters ever share a desk**
    - **Validates: Requirements 2.5**

  - [x] 5.9 Implement procedural appearance generator
    - Create `appearanceFor(agentName)` in `office3d/Human.tsx` (or a helper): hash(agentName) → `HumanAppearance`
    - Guarantee gender is male/female and concurrent agents differ by ≥2 of {body, clothing, hair}; same agent always identical
    - _Requirements: 2.6_

  - [ ]* 5.10 Write property test for character distinctness
    - **Property 8: Character distinctness by at least two attributes**
    - **Validates: Requirements 2.6**

  - [x] 5.11 Implement procedural `Human` component with animation
    - Build mesh from primitives (capsule/sphere/box); walk/sit animation via `useFrame`; phases entering→seated→working→leaving within 1–3 s
    - Replace blocky placeholders; no external model files
    - _Requirements: 2.2, 2.3, 2.4, 2.6_

  - [x] 5.12 Implement billboard label
    - Create `BillboardLabel` using drei `<Billboard>`+`<Text>` parented to the moving `Human` group (above head, not desk)
    - Full agent name truncated to 24 chars with trailing ellipsis; reorient to active camera within one frame
    - _Requirements: 2.7, 2.8_

  - [ ]* 5.13 Write property test for label truncation
    - **Property 9: Billboard label truncation**
    - **Validates: Requirements 2.7**

  - [ ]* 5.14 Write integration test for billboard reorientation
    - Assert labels render via drei and reorient per frame within 100 ms of camera movement
    - _Requirements: 2.8_

  - [x] 5.15 Build the command-center scene and cameras
    - Create `CommandCenter` scene: emissive screen planes (run id/phase), dynamic lights keyed to run state, reflective floor, fog/ambient glow
    - Add `Spawn_Camera` at top-back corner framing the whole room; retain orbit + first-person walk controls
    - _Requirements: 2.1, 2.9, 2.10_

  - [ ]* 5.16 Write smoke tests for scene cameras
    - Assert spawn camera position (2.9) and presence of orbit + walk cameras (2.10)
    - _Requirements: 2.9, 2.10_

  - [x] 5.17 Implement the intro cinematic
    - Create `office3d/IntroCinematic.tsx`: NZ landmass + cloud layer + title text; clouds part/dissolve to reveal office within 2–6 s, then `onReveal` → `Spawn_Camera`
    - Visible Skip button calls `onReveal`; purely visual, sets no agent/run state; office state derives only from events during/after
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [ ]* 5.18 Write smoke test for cinematic reveal timing
    - Assert reveal completes within 2–6 s and hands to spawn camera
    - _Requirements: 3.2, 3.3_

  - [x] 5.19 Wire office App tree together
    - Compose `App.tsx`: `DataSourceProvider` → `IntroCinematic` → `CommandCenter` with characters mapped from `deriveOffice`, `DeskManager`, and `BillboardLabel`
    - _Requirements: 2.1, 2.11, 3.1, 6.10, 6.11_

- [x] 6. Checkpoint — dashboard and virtual office
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Admin GUI server, API, and control page
  - [x] 7.1 Implement loopback admin server
    - Create `src/admin/admin-server.ts` with `startAdminServer(opts?)` binding `127.0.0.1` only (default 7787)
    - Serve the static control page at `GET /`
    - _Requirements: 4.1, 11.1_

  - [ ]* 7.2 Write smoke test for loopback-only bind
    - Assert the admin server is not reachable on a non-loopback interface
    - _Requirements: 11.1_

  - [x] 7.3 Implement read endpoints (domain, runs, schedule)
    - `GET /api/domain` from `Domain_Config` (never hard-coded); `GET /api/runs` newest-first with status + summary; `GET /api/schedule` from `schedule.json`
    - Include `origin: "local" | "cloud"` per run entry
    - _Requirements: 4.2, 4.3, 4.6, 7.7_

  - [ ]* 7.4 Write property test for newest-first run list
    - **Property 10: Admin run list is strictly newest-first with status and summary**
    - **Validates: Requirements 4.3**

  - [x] 7.5 Implement domain validation
    - Create `src/admin/domain-validate.ts` with `validateDomainSubmission(input, approvedSet)`
    - Reject non-http(s) schemes, IP literals, and hosts resolving to private/loopback/link-local ranges (10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, ::1, fc00::/7) or outside the approved set; accept approved host over approved scheme
    - _Requirements: 10.3, 10.4, 10.5, 10.6_

  - [ ]* 7.6 Write property test for domain validation
    - **Property 17: Domain validation rejects unsafe hosts and schemes**
    - **Validates: Requirements 10.3, 10.4, 10.5, 10.6**

  - [x] 7.7 Implement schedule editing and manual run
    - Create `src/admin/schedule.ts`; `POST /api/schedule` validates `HH:mm`/interval, writes `schedule.json`, re-registers `guardian-task.ps1 install <HH:mm>` on Windows
    - Parameterize `guardian-task.ps1` to read `schedule.json` so PS1 and JSON never drift
    - `POST /api/run` lockfile-guarded via `.guardian.lock` (reuse `scheduled-trigger.ts` protocol); returns 409 on concurrency
    - `POST /api/open/office` and `/api/open/dashboard` launch local URLs
    - _Requirements: 4.1, 4.4, 4.5, 10.2_

  - [ ]* 7.8 Write unit tests for schedule validation and concurrent-run rejection
    - Reject invalid schedule without writing config; `POST /api/run` returns 409 and starts no run when `.guardian.lock` exists
    - _Requirements: 4.4, 4.5, 10.2_

  - [x] 7.9 Implement cloud sync (read-only, additive)
    - Create `src/admin/cloud-sync.ts` with `cloudSync(opts)`: fetch `runs-data` → enumerate run-ids → copy only run-ids absent locally → index
    - Non-destructive (never overwrite/delete existing runs, evidence, baselines, audit); read-only w.r.t. cloud (no push/branch edit); on offline/error leave local state unchanged
    - Add `POST /api/sync` and `GET /api/sync/status` to the admin server; preserve synced `origin: "cloud"`
    - _Requirements: 7.3, 7.4, 7.5, 7.6, 7.7, 7.8_

  - [ ]* 7.10 Write property test for additive cloud sync
    - **Property 18: Cloud sync is additive and never overwrites local runs**
    - **Validates: Requirements 7.3, 7.5, 7.8**

  - [ ]* 7.11 Write unit test for cloud-sync failure safety
    - Assert offline/error leaves the local artifacts store byte-for-byte unchanged and performs no push
    - _Requirements: 7.6, 7.8_

- [x] 8. Checkpoint — admin GUI and cloud sync
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Publishing pipeline and sanitization
  - [x] 9.1 Fix the `test-manifest.json` absolute-path leak (migration)
    - Change `writeTestManifest` in `test-generator.ts` to store repo-relative `specPath` (`tests/generated/<slug>...`)
    - Record the migration as an audit/event note; leave existing on-disk manifests untouched (sanitized at publish)
    - _Requirements: 8.2, 11.8_

  - [x] 9.2 Implement the sanitizer
    - Create `src/publish/sanitizer.ts` with `sanitizeJson`, `stripPaths`, `sanitizeRun(runDir, outDir)` returning `SanitizeReport`
    - Reuse `redactor.ts` for secrets/tokens/PII; strip absolute/UNC/internal paths (`C:\...`, `/Users/...`, `/home/...`, UNC, repo root → run-relative or `[path removed]`)
    - Exclude traces/raw logs/otel dumps; sanitize screenshot metadata/filenames; fail-closed withhold + record reason when a file cannot be confirmed clean
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [ ]* 9.3 Write property test for secret removal
    - **Property 15: Sanitizer removes secrets**
    - **Validates: Requirements 8.1**

  - [ ]* 9.4 Write property test for path removal
    - **Property 16: Sanitizer removes absolute and internal filesystem paths**
    - **Validates: Requirements 8.2**

  - [ ]* 9.5 Write unit test for fail-closed withholding
    - Assert an unconfirmed file is withheld with a recorded reason while the rest of the run still publishes
    - _Requirements: 8.5_

  - [x] 9.6 Implement the published-data contract builder
    - Create `src/publish/published-data.ts`: convert `artifacts/runs/*` → `data/index.json` (RunsIndex newest-first with `origin`), `data/dashboard.json` (DashboardData), `data/runs/<id>/{summary.json, events.json, findings.json}` + sanitized screenshots
    - Preserve the existing `findings.json` `pages[]` shape; carry `origin` into `RunSummary` and `RunsIndex`
    - _Requirements: 6.6, 6.7, 7.7, 11.8_

  - [x] 9.7 Implement the publisher orchestrator
    - Create `src/publish/publisher.ts` with `publish(opts)` returning `PublishResult`
    - Build `Published_Data` to a staging dir, copy static `dashboard/` and replay-only office build; swap in only on success
    - On run failure/timeout or publish failure, leave previous `Published_Data` unchanged
    - Add `node dist/publish/build-published-data.js` entry used by CI and local publish
    - _Requirements: 6.6, 6.7, 6.8, 6.9_

  - [ ]* 9.8 Write unit tests for publish failure preservation
    - Assert previous `Published_Data` is preserved on run failure and on publish failure
    - _Requirements: 6.8, 6.9_

- [x] 10. Checkpoint — publishing and sanitization
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. GitHub Actions cloud runner and secret hygiene
  - [x] 11.1 Author the hardened `guardian.yml` workflow
    - Create `.github/workflows/guardian.yml`: `schedule` cron (≥ every 24h) + `workflow_dispatch`; default `permissions: contents: read`; `concurrency` group preventing overlap
    - `run` job (read-only token, 30-min `timeout-minutes`, fork-PR `if` guard): checkout, setup-node (pinned), `npm ci`, `playwright install --with-deps chromium`, build, `node dist/index.js run`, build-published-data, upload Pages artifact
    - `publish` job (`needs: run`, `pages: write`/`id-token: write`, `environment: github-pages`): deploy to Pages
    - Pin every third-party action to a commit SHA; set `AWG_RUN_ORIGIN=cloud`; never interpolate untrusted event input into a `run:` shell
    - _Requirements: 6.2, 6.3, 6.4, 6.5, 6.6, 6.8, 9.1, 9.2, 9.3, 9.4, 9.5, 14.1, 14.3_

  - [x] 11.2 Add the `runs-data` raw-artifact commit step
    - In the publish job, after a successful run, path-scoped `git add -- artifacts/runs/<RUN_ID>/` and push additively to `runs-data` (no force, no history rewrite); never commit raw artifacts to `main`
    - _Requirements: 7.1, 7.2_

  - [x] 11.3 Add secret hygiene and `.gitignore`
    - Create/extend `.gitignore` to exclude `.env`, `.env.*`, `*.secret`, `*.pem`, `*.key`, and local credential files
    - Ensure no tokens/keys/credentials are committed; reference any needed value only as an `Action_Secret`
    - _Requirements: 8.1 (repo), 8.2 (repo), 8.3 (repo), 8.4 (repo)_

  - [ ]* 11.4 Write smoke tests for workflow hardening and secrets
    - Assert pinned SHAs, default `contents: read`, publish-only write, fork-PR guard, no untrusted-input execution (9.1–9.5); assert `.gitignore` secret patterns and no committed secrets (8.1–8.4 of Req 8 "No Secrets")
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

- [x] 12. Extend `verify.mjs` with Phase 2 invariants
  - [x] 12.1 Add sanitization and admin-safety invariants
    - Add `sanitization-removes-paths`, `sanitization-removes-secrets`, and `loopback-only-admin` checks
    - _Requirements: 8.1, 8.2, 11.1_

  - [x] 12.2 Add office-honesty and static-no-network invariants
    - Add `no-fabricated-characters` (runs `deriveOffice` over published `events.json`) and `static-dashboard-no-network` (dashboard references only relative `./data/*.json`; office replay has no SSE/trigger)
    - _Requirements: 1.5, 2.11, 6.10_

  - [x] 12.3 Add scope, workflow, deps, and cloud-sync invariants
    - Add `approved-scope-only` (generalized beyond `assurity.nz`), `workflow-hardened`, `deps-pinned` (package-lock present + vendored Chart.js pin match), and `cloud-sync-additive-nondestructive`
    - Keep all existing checks unchanged
    - _Requirements: 5.7, 7.3, 7.5, 7.8, 9.1, 9.2, 9.3, 12.1, 12.4_

- [x] 13. Final integration, migration notes, and verification
  - [x] 13.1 Wire publishing into local and CI run completion
    - Invoke `publish` on successful local run completion and from the CI `run` job; ensure dashboard/office replay builds are produced with `VITE_AWG_MODE=replay`
    - _Requirements: 6.6, 6.7, 6.10_

  - [x] 13.2 Record migration and dependency ledger
    - Record the `test-manifest` relative-path migration in the audit log; finalize `DEPENDENCIES.md` with Chart.js and any new dependency cost/licensing
    - Confirm existing runs, evidence, baselines, and `audit.jsonl` are preserved
    - _Requirements: 11.8, 12.3, 13.3_

  - [ ]* 13.3 Run full build and the extended verify gate
    - Build the project, run the PBT suite (Properties 1–18, ≥100 iterations each), run `scripts/verify.mjs` after a build + ≥2 runs + a publish, and confirm all existing + new invariants pass
    - _Requirements: 1.1, 1.5, 2.11, 5.7, 6.6, 7.3, 8.1, 8.2, 9.1, 11.1, 12.1_

- [x] 14. Final checkpoint — ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional (tests) and can be skipped for a faster MVP; core implementation tasks are never optional.
- Each task references specific granular requirements for traceability.
- All 18 correctness properties have a dedicated property-based test (fast-check, ≥100 iterations) placed next to the pure logic it validates.
- Checkpoints provide incremental validation at natural workstream boundaries.
- The existing core (`runGuardian`, `EvidenceStore`, audit log, `Event_Server`, agent split, approval gates) is extended, not rewritten; existing `verify.mjs` checks are retained unchanged.
- The one required data migration (`test-manifest.json` repo-relative `specPath`) is recorded in the audit log per Requirement 11.8.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.3"] },
    { "id": 1, "tasks": ["1.2", "1.4", "2.1", "9.1", "11.3"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.4", "2.5", "2.9", "4.1", "5.1", "5.2", "5.6", "5.9", "7.1", "9.2"] },
    { "id": 3, "tasks": ["2.6", "2.7", "2.8", "2.10", "2.11", "4.2", "4.3", "4.4", "5.3", "5.4", "5.5", "5.7", "5.8", "5.10", "5.11", "7.2", "7.3", "7.5", "9.3", "9.4", "9.5", "9.6"] },
    { "id": 4, "tasks": ["4.5", "5.12", "5.15", "5.17", "7.4", "7.6", "7.7", "7.9", "9.7"] },
    { "id": 5, "tasks": ["4.6", "5.13", "5.14", "5.16", "5.18", "5.19", "7.8", "7.10", "7.11", "9.8", "11.1"] },
    { "id": 6, "tasks": ["4.7", "4.8", "4.9", "4.10", "11.2", "11.4"] },
    { "id": 7, "tasks": ["12.1", "12.2", "12.3", "13.1"] },
    { "id": 8, "tasks": ["13.2"] },
    { "id": 9, "tasks": ["13.3"] }
  ]
}
```
