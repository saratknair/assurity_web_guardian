# Implementation Plan: Virtual Office Replay

## Overview

This plan follows the design's Migration and Rollout order so each stage can be released on its own.

- Stage 1 (tasks 1 to 4): Guardian and Publisher record and publish enriched run events. No visible change.
- Stage 2 (tasks 5 to 12): the static `office/` app is built and tested but not yet wired into CI.
- Stage 3 (tasks 13 and 14): CI swap and retirement of the React and Vite office.
- Stage 4 (task 15): Dashboard links to the Virtual Office, shipped after `/office/` is live.

Implementation languages are TypeScript (Guardian, Publisher, scripts tests) and plain browser ES-module JavaScript (office and Dashboard). Tests use vitest and fast-check in `tests/unit` and `tests/property`. Office and Dashboard libs are imported in tests with `// @ts-expect-error plain browser ES module without type declarations`. Each property test file carries the header `// Feature: virtual-office-replay, Property N: <title>` and runs at least 100 iterations. The workspace is Windows, so use PowerShell-safe commands and `node` scripts, not bash-only syntax. Never start dev servers or watchers from a task.

## Tasks

- [x] 1. Step model, step recorder, and telemetry emitter (Stage 1)
  - [x] 1.1 Create the step model and extend telemetry types and emitter
    - Create `src/telemetry/step-model.ts` with `STEP_NAMES` (the ten names including `test-plan`), `STEP_STATION`, `STEP_AGENT`, `STEP_IS_TEMPLATE`, `STATION_IDS` (`test-plan-desk`, `browser-bay`, `visual-check`, `accessibility-check`, `review-desk`, `records-room`), and `isStepName`
    - Add `StepEventData`, `StepResult`, and the documented `"template"` agentRole value to `src/telemetry/types.ts`
    - Add `step(data)` to `src/telemetry/telemetry-emitter.ts` that calls `this.event("step.completed", { data })` so the redactor applies; leave existing methods unchanged
    - _Requirements: 1.1, 1.7, 1.8, 1.10, 5.1_

  - [x] 1.2 Implement the step recorder
    - Create `src/telemetry/step-recorder.ts` with pure `stepTimes(startWallMs, durationMs)`, `createStepSeq()`, `recordStep(tel, meta, work, summarise)`, and a pure `summariseStep` per Step_Name producing the Result_Summary and ruleId list from the design tables
    - Measure with `Date.now()` before and `performance.now()` around the work; on throw emit `result: { failed: true }` and rethrow without error text
    - ruleIds: `check:<name>` for failed checks, every axe violation id (never `check:a11y-critical-serious`), `visual-diff` when `differs`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.14_

  - [ ]* 1.3 Write property test for step timestamps
    - File: `tests/property/step-timestamps.test.ts`
    - **Property 13: Step timestamps are consistent**
    - **Validates: Requirements 1.1, 1.2**

  - [ ]* 1.4 Write property test for finding key format
    - File: `tests/property/finding-key-format.test.ts`
    - **Property 10: Finding key format**
    - **Validates: Requirements 1.14**

  - [ ]* 1.5 Write test for redactor-safe step field names
    - File: `tests/unit/step-fields-redactor.test.ts`; run every emitted `data` and `result` key through the sensitive-key regex and check long URL segments are not redacted
    - **Property 17: Redactor-safe field names**
    - **Validates: Requirements 1.11, 1.14**

- [x] 2. Orchestrator changes (Stage 1)
  - [x] 2.1 Remove placeholders and fix roles in `src/core/orchestrator.ts`
    - Delete the six Setup_Placeholder_Agent `agentStatus` calls (keep `discovery.validated`)
    - Add `replaySchema: 1` to `run.started` data and `slug` to `page.skipped` data
    - Change Quality_Analysis_Agent and Triage_Agent role from `"ai"` to `"template"`; never emit `"ai"`
    - Make `freezeDispositions` return `{ status, entries }`
    - _Requirements: 1.6, 1.8, 1.9, 1.10_

  - [x] 2.2 Wrap real work in `recordStep` and split notes from triage
    - Wrap `test-plan`, `load`, `screenshot`, `visual-compare`, `accessibility-scan`, `compare`, `notes`, `triage`, `history`, `decisions` per the design table
    - Keep the request-spacing `setTimeout` outside every step; keep `agent.*` events and `aiItems` order unchanged
    - Emit `triage` as its own sequential step after `notes`, only when outcomes exist
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.7, 1.8, 1.14_

  - [ ]* 2.3 Write source-scan test for orchestrator honesty
    - File: `tests/unit/orchestrator-honesty.test.ts`; no placeholder `agentStatus` calls and no `"ai"` role in `orchestrator.ts`
    - **Property 30: Orchestrator honesty**
    - **Validates: Requirements 1.9, 1.10**

- [x] 3. Publisher replay publication (Stage 1)
  - [x] 3.1 Implement pure `src/publish/replay-trace.ts`
    - `buildReplayPublication(events, built, runId, opts)` returning `{ eventsText, replay, producedAtById, replayTBySlug }`
    - Classify enriched vs legacy, `addFindingIds` by exact key lookup, `computeProducedAt` by exact key match only, page `replayT`, `toAsciiJson` (compact, `\uXXXX` escaping)
    - `capEvents` with truncation tiers 1 to 5 at 262,144 bytes, always-kept fields, `overCap` flag, and final `replay.meta` event
    - _Requirements: 1.11, 1.12, 1.13, 1.15, 12.5, 18.4_

  - [x] 3.2 Hook replay publication into `src/publish/published-data.ts`
    - Call `finalizeReplay(outRunDir, runId, built)` after `sanitizeRun` and before `publishRunDetail`
    - Rewrite `events.json` compact and ASCII, re-validate with `sanitizeJson` and `hasResidualPath`; on failure delete the file and record it as withheld
    - Add `replay`, per-finding and per-ignored `producedAt`, and per-page `replayT` to `built.runFindings`
    - _Requirements: 1.11, 1.12, 1.13, 1.15, 12.5, 12.6, 18.4_

  - [x] 3.3 Add `replay` pass-through to Dashboard `normalizeRun`
    - Edit `dashboard/lib/findings.js` so `replay` is `{ enriched: r.replay?.enriched === true, durationMs: non-negative integer or null }`
    - _Requirements: 12.4, 12.7_

  - [ ]* 3.4 Write property test for finding ids on producing events
    - File: `tests/property/replay-finding-ids.test.ts`
    - **Property 11: Finding ids on producing events**
    - **Validates: Requirements 1.15**

  - [ ]* 3.5 Write property test for published producedAt
    - File: `tests/property/replay-produced-at.test.ts`
    - **Property 12: Published producedAt equals office lookup**
    - **Validates: Requirements 12.4, 12.5, 12.6**

  - [ ]* 3.6 Write property test for event cap and truncation
    - File: `tests/property/replay-cap.test.ts`
    - **Property 14: Event cap and truncation keep identity**
    - **Validates: Requirements 1.12, 1.13**

  - [ ]* 3.7 Write property test for sanitizer cleanliness
    - File: `tests/property/replay-sanitizer.test.ts`
    - **Property 15: Sanitizer cleanliness of enriched events**
    - **Validates: Requirements 1.11**

  - [ ]* 3.8 Write property test for ASCII round trip
    - File: `tests/property/replay-ascii.test.ts`
    - **Property 16: Published events are ASCII and round-trip**
    - **Validates: Requirements 18.4**

  - [ ]* 3.9 Write publisher end-to-end unit tests and fixtures
    - File: `tests/unit/publisher-replay.test.ts`; add `tests/fixtures/replay/` (`enriched.events.json`, `legacy.events.json`, `truncated.events.json`, `index.json`, `run-findings.json`)
    - Check compact ASCII `events.json`, `replay.meta`, `run-findings.json` fields, Legacy_Run gets `replay.enriched` false and null `producedAt`, and `publisher-fixture.test.ts` still passes
    - _Requirements: 1.8, 1.12, 1.13, 12.6, 18.9_

- [x] 4. Checkpoint - Stage 1 complete
  - Ensure all tests pass, ask the user if questions arise.
  - Run `npx tsc --noEmit` and `npx vitest --run`; confirm the old React office still tolerates the new event kinds.

- [x] 5. Vendored assets and licence record (Stage 2)
  - [x] 5.1 Vendor three.js r169 and OrbitControls
    - Create `office/vendor/three.module.min.js`, `office/vendor/OrbitControls.js`, `office/vendor/three-LICENSE.txt` from three 0.169.0 (copy from `virtual-office/node_modules/three` before it is deleted)
    - Confirm no non-ASCII bytes problem is introduced by tooling and no other add-ons are copied
    - _Requirements: 16.1, 16.3, 18.2, 18.8_

  - [x] 5.2 Write `office/ASSET-LICENCES.md`
    - ASCII table with name, version, licence, source, file, actual size in bytes, and SHA-256 for each vendored file; state there are no other assets (all procedural)
    - _Requirements: 16.2, 18.8, 5.12_

  - [ ]* 5.3 Write licence record unit test
    - File: `tests/unit/office-licences.test.ts`; recompute sizes and hashes, licence allowlist (`MIT`, `CC0-1.0`), every file under `office/vendor/` listed
    - _Requirements: 16.2, 18.8_

- [x] 6. Station map and Replay_Timeline (Stage 2)
  - [x] 6.1 Create base office libs
    - `office/lib/stations.js` (STATIONS with visible names, descriptions, STEP_STATION, STEP_AGENT, template flags), `office/lib/honesty.js` (zero-AI-token and template statements), `office/lib/format.js`, `office/lib/dom.js` (`el()`, text-only insertion)
    - _Requirements: 5.1, 5.7, 5.8, 15.6, 18.5_

  - [ ]* 6.2 Write equality test between `step-model.ts` and `office/lib/stations.js`
    - File: `tests/unit/stations-equality.test.ts`
    - _Requirements: 2.12, 5.1_

  - [x] 6.3 Implement `office/lib/timeline.js`
    - `buildTimeline`, `clampT`, `countAt`, `entriesAt`, `activeAt`, `nextStart`, `prevStart`, `firstEntryForPage`, `producingEntry`, `stateAt`, `officeFindingKey`
    - Enriched and coarse modes, placeholder exclusion, unsupported schema fallback, empty mode, skipped-event notes, no inference for Legacy_Run
    - _Requirements: 2.1 to 2.15, 5.3, 5.4, 5.9, 5.10, 5.11, 5.13_

  - [ ]* 6.4 Write property test for determinism and snapshot purity
    - File: `tests/property/office-timeline-determinism.test.ts`
    - **Property 1: Timeline determinism and snapshot purity**
    - **Validates: Requirements 2.5, 5.9, 18.3**

  - [ ]* 6.5 Write property test for ordering and relative time
    - File: `tests/property/office-timeline-ordering.test.ts`
    - **Property 2: Ordering and relative time**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.8**

  - [ ]* 6.6 Write property test for monotonic position sets
    - File: `tests/property/office-timeline-monotonic.test.ts`
    - **Property 3: Monotonic position sets**
    - **Validates: Requirements 2.11**

  - [ ]* 6.7 Write property test for no fabricated entries
    - File: `tests/property/office-timeline-no-fabrication.test.ts`
    - **Property 4: No fabricated entries**
    - **Validates: Requirements 2.6, 5.10, 9.5**

  - [ ]* 6.8 Write property test for placeholder exclusion
    - File: `tests/property/office-timeline-placeholders.test.ts`
    - **Property 5: Placeholder exclusion**
    - **Validates: Requirements 1.9, 2.7**

  - [ ]* 6.9 Write property test for station mapping totality
    - File: `tests/property/office-timeline-stations.test.ts`
    - **Property 6: Station mapping totality**
    - **Validates: Requirements 2.12, 5.1**

  - [ ]* 6.10 Write property test for Legacy_Run coarse mode
    - File: `tests/property/office-timeline-legacy.test.ts`
    - **Property 7: Legacy runs stay coarse**
    - **Validates: Requirements 2.4, 2.15, 18.9**

  - [ ]* 6.11 Write property test for malformed input
    - File: `tests/property/office-timeline-malformed.test.ts`
    - **Property 8: Malformed input never throws and is reported**
    - **Validates: Requirements 2.9, 2.10**

  - [ ]* 6.12 Write property test for producing-entry lookup
    - File: `tests/property/office-timeline-producing.test.ts`
    - **Property 9: Producing-entry lookup**
    - **Validates: Requirements 2.13, 2.14, 12.5**

- [x] 7. Telemetry and reconciliation (Stage 2)
  - [x] 7.1 Implement `office/lib/telemetry.js`
    - `telemetryAt`, `stationShares` (largest-remainder rounding, share of recorded step time, unattributed time shown separately), `eventTotals`, `reconcile` (match, explained, differs, unavailable)
    - Legacy_Run shows "not recorded" for unsupported values
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 14.1 to 14.6_

  - [ ]* 7.2 Write property test for monotonic running totals
    - File: `tests/property/office-telemetry-monotonic.test.ts`
    - **Property 18: Telemetry running totals are monotonic**
    - **Validates: Requirements 9.1, 9.4, 9.8**

  - [ ]* 7.3 Write property test for station shares
    - File: `tests/property/office-telemetry-shares.test.ts`
    - **Property 19: Station shares sum to 100**
    - **Validates: Requirements 9.3, 9.7**

  - [ ]* 7.4 Write property test for reconciliation
    - File: `tests/property/office-reconcile.test.ts`
    - **Property 20: Totals reconciliation never hides a difference**
    - **Validates: Requirements 14.1, 14.2, 14.3, 14.4, 14.6**

- [x] 8. Route, clock, store, data, links, evidence (Stage 2)
  - [x] 8.1 Implement `office/lib/route.js` and `office/lib/clock.js`
    - `parseOfficeRoute`, `formatOfficeRoute`, `clampT`; `SPEEDS`, `createClockState`, `advance` (100 ms frame cap, pause at end, no loop), `seek`, `play`, `pause`, `setSpeed`
    - _Requirements: 3.4, 3.5, 3.7, 3.9, 3.10, 4.2, 4.3, 4.7_

  - [x] 8.2 Implement `office/lib/store.js` and `office/lib/data.js`
    - Observable store; `dataUrl` (validated, resolved from `import.meta.url`), `loadPublished` with errors naming the file, `imageUrl`, `loadIndex`, `loadEvents`, `loadRunFindings`; `cache: "no-store"`
    - _Requirements: 3.8, 11.7, 14.5, 16.1, 17.4_

  - [x] 8.3 Implement `office/lib/links.js` and `office/lib/evidence.js`
    - Dashboard Deep_Link builders from Finding_Key and ids (no link when no Dashboard view exists); pure `evidenceAt` view-model with `hasImages` gating, named load-failure message, rule ids from run-findings, "not available" fallback
    - _Requirements: 11.1 to 11.8, 13.1, 13.2, 13.3, 13.4_

  - [ ]* 8.4 Write property test for route round trip and clamping
    - File: `tests/property/office-route.test.ts`
    - **Property 21: Office route round trip and clamping**
    - **Validates: Requirements 3.4, 3.5, 3.7, 3.9, 3.10**

  - [ ]* 8.5 Write property test for playback clock
    - File: `tests/property/office-clock.test.ts`
    - **Property 23: Playback clock**
    - **Validates: Requirements 4.2, 4.3, 4.7**

  - [ ]* 8.6 Write property test for same-origin data paths
    - File: `tests/property/office-data-url.test.ts`
    - **Property 25: Same-origin data paths**
    - **Validates: Requirements 11.7, 14.5, 16.1, 17.4**

  - [ ]* 8.7 Write property test for evidence gating
    - File: `tests/property/office-evidence.test.ts`
    - **Property 24: Evidence gating**
    - **Validates: Requirements 11.1, 11.5, 11.6**

- [x] 9. Office page, theme, and 2D views (Stage 2)
  - [x] 9.1 Create `office/index.html`, `office/tokens.css`, `office/office.css`
    - `lang="en"`, title, skip link, banner, nav, main, footer landmarks, inline import map for `three`, Dashboard back link, honesty and WCAG statements
    - `tokens.css` mirrors the Dashboard `:root`; responsive grid stacking below 900 px, no horizontal page scroll at 320 px, visible focus styles
    - _Requirements: 8.8, 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7_

  - [ ]* 9.2 Write theme drift and contrast unit test
    - File: `tests/unit/office-tokens.test.ts`; office `:root` equals `dashboard/style.css` `:root`; contrast pairs meet 4.5:1 and 3:1
    - _Requirements: 15.1, 15.5_

  - [x] 9.3 Implement controls, run picker, and Stations list views
    - `office/views/controls.js`, `run-picker.js`, `stations-list.js`: play/pause, 1x/2x/5x/10x, scrubber with `aria-valuetext`, previous/next event, jump-to-page (disabled with note for Legacy_Run), Reset view, announce toggle default off, keyboard-operable Station list
    - _Requirements: 3.2, 3.3, 4.1 to 4.6, 4.8, 4.10, 6.6, 6.9, 8.5_

  - [x] 9.4 Implement Transcript and notices views
    - `office/views/transcript.js` (ordered list, current entry `aria-current`, not-yet-reached marking, click to seek, Dashboard links, no smooth scroll) and `office/views/notices.js` (Not_Recorded, truncation, skipped events, load errors, unsupported schema, consistency message)
    - _Requirements: 8.1 to 8.4, 8.7, 8.9, 8.10, 13.1, 14.2 to 14.6, 3.6, 3.8_

  - [x] 9.5 Implement Telemetry panel and Swimlane views
    - `office/views/telemetry-panel.js` (HTML text, `dl` and table) and `office/views/swimlane.js` (inline SVG, one lane per Station, focusable bars in time order with accessible names, marker, click to seek)
    - _Requirements: 9.1 to 9.9, 10.1 to 10.8_

  - [x] 9.6 Implement Inspector and help views
    - `office/views/inspector.js` (role description, template flag, entries up to position with duration and Result_Summary, "not recorded", evidence, Dashboard links) and `office/views/help.js` (keyboard shortcut table in `details`)
    - _Requirements: 7.1 to 7.8, 4.9, 11.1 to 11.4, 13.1_

- [x] 10. Diorama (Stage 2)
  - [x] 10.1 Implement capability, render loop, and camera
    - `office/diorama/capability.js` (low-end detection, pixel ratio, shadows off), `loop.js` (render on demand, pause when hidden or off-screen, `data-frame-count`), `camera.js` (OrbitControls with bounds, target clamp, fly-to, keyboard setters, Reduced_Motion instant moves)
    - _Requirements: 6.1 to 6.5, 6.7, 6.8, 16.5, 16.6, 16.7_

  - [x] 10.2 Implement scene and Agent_Figures
    - `office/diorama/scene.js` (six Station bays on a ring, procedural geometry, floor, lights, HTML label overlay with `aria-hidden`) and `figures.js` (pawn figures, template marker, creation only when an entry exists, Bezier moves, snap on scrub)
    - _Requirements: 5.1, 5.2, 5.3, 5.7, 5.8, 5.12_

  - [x] 10.3 Implement Station screens
    - `office/diorama/screens.js`: canvas textures redrawn only on signature change; page, viewport, Step_Name, Result_Summary, template label, screenshot thumbnail on Browser bay, Records room shows Step_Name only
    - _Requirements: 5.4, 5.5, 5.6, 5.13, 11.1, 11.3, 11.4_

  - [x] 10.4 Implement `office/diorama/diorama.js`
    - `createDiorama(host, handlers)` lazy entry: WebGL detection, scene build, Station raycast select, context-loss handling, `dispose()` on `pagehide`
    - _Requirements: 6.5, 8.6, 16.3, 16.4_

- [x] 11. App wiring, accessibility, local console route (Stage 2)
  - [x] 11.1 Implement `office/app.js` bootstrap
    - Boot order: shell and Transcript first, load index and run files, build timeline, render views, then lazy `import("./diorama/diorama.js")`
    - Router with debounced `history.replaceState`, run selection, Office_Deep_Link restore, run-not-found handling, per-view try/catch
    - _Requirements: 3.1 to 3.10, 16.4, 13.4_

  - [x] 11.2 Add keyboard shortcuts, Fallback_Mode, live region, and error handling to `office/app.js`
    - Diorama-scoped shortcuts (arrows, plus/minus, Shift+arrows, 1 to 6, 0, Space, comma/period, Escape), focus not trapped
    - Fallback_Mode message with all non-3D views usable, Reduced_Motion via `matchMedia`, polite throttled live region, inline errors naming the failed file
    - _Requirements: 4.9, 6.4, 6.8, 6.10, 8.5, 8.6, 8.7, 10.8_

  - [x] 11.3 Copy `office/` in the local publish
    - Edit `src/publish/publisher.ts` so the staging bundle includes `artifacts/published/office/` next to `dashboard/`
    - _Requirements: 17.1, 17.4_

  - [x] 11.4 Repoint the console Open Virtual Office route
    - Edit `src/admin/open-routes.ts` to open `http://127.0.0.1:<port>/local-dashboard/office/` when `artifacts/published/office/index.html` exists, else the same run-once message as `openDashboard`; remove `OFFICE_URL`
    - Update `tests/unit/open-routes.test.ts`
    - _Requirements: 17.3, 17.4_

  - [ ]* 11.5 Write source-scan test for honest wording
    - File: `tests/unit/office-honesty-scan.test.ts`; exclude only `office/vendor/` and `office/lib/honesty.js`
    - **Property 27: Honest wording in office sources**
    - **Validates: Requirements 5.7, 5.8, 15.6, 18.1**

  - [ ]* 11.6 Write source-scan test for forbidden APIs and third-party requests
    - File: `tests/unit/office-source-scan.test.ts`; comments stripped, ASCII-only, landmarks, `lang`, title, import map, no inline handlers
    - **Property 28: No forbidden APIs and no third-party requests in office sources**
    - **Validates: Requirements 16.1, 17.4, 17.5, 18.4, 18.5**

  - [x] 11.7 Create `scripts/scan-office.mjs`
    - Serve the site from `127.0.0.1`, open `/office/` with Playwright and axe (`wcag2a`, `wcag2aa`, `wcag22aa`), check Transcript non-empty, deep link restore, idle frame count unchanged, forced Fallback_Mode pass, no horizontal scroll at 320 px; export pure result shaping
    - _Requirements: 8.6, 15.3, 16.6, 17.4_

- [x] 12. Checkpoint - Stage 2 complete
  - Ensure all tests pass, ask the user if questions arise.
  - Run `npx tsc --noEmit` and `npx vitest --run`; the office exists but CI still builds the React app.

- [x] 13. CI swap (Stage 3)
  - [x] 13.1 Create `scripts/check-site-sizes.mjs`
    - Export pure `evaluateSizes({ officeFiles, eventFiles })`; CLI walks `<site>/office` (limit 1,572,864 bytes total, names the largest file) and `<site>/data/runs/*/events.json` (limit 262,144 bytes each), prints oversize paths, exits 1
    - _Requirements: 16.8, 17.6, 17.7_

  - [ ]* 13.2 Write property test for size evaluation
    - File: `tests/property/site-sizes.test.ts`
    - **Property 26: Size evaluation**
    - **Validates: Requirements 16.8, 17.6, 17.7**

  - [x] 13.3 Update `.github/workflows/guardian.yml`
    - Remove the Vite office build step (`npm --prefix virtual-office ci`, `build-office-replay.mjs`, `VITE_AWG_MODE`, `AWG_OFFICE_REQUIRED`)
    - Add `cp -r office/. ./_site/office/`, a blocking `node scripts/check-site-sizes.mjs ./_site` step, and a non-blocking (`continue-on-error`) `node scripts/scan-office.mjs ./_site` step; keep Dashboard and `/data/` steps unchanged
    - _Requirements: 17.1, 17.2, 17.6, 17.7, 17.8_

  - [ ]* 13.4 Write workflow text-scan unit test
    - File: `tests/unit/workflow-office.test.ts`; copy step and size gate present; no `virtual-office`, `build-office-replay`, `npm --prefix`, `AWG_OFFICE_REQUIRED`
    - _Requirements: 17.1, 17.2, 17.3_

- [x] 14. Retire the React office and update checks (Stage 3)
  - [x] 14.1 Delete the retired app and references
    - `git rm -r virtual-office/`, `git rm scripts/build-office-replay.mjs`, remove `build:office:replay` from `package.json`, remove `virtual-office/dist/` and `virtual-office-src/` lines from `.gitignore`, update stale comments in `src/core/orchestrator.ts`
    - _Requirements: 17.3_

  - [x] 14.2 Update `scripts/verify.mjs`
    - Check 15 reads `office/lib/data.js` (contains `../../data/`, no `EventSource`, no `http` literal); add a step-events-well-formed check alongside check 14
    - _Requirements: 1.7, 17.4, 17.5_

  - [x] 14.3 Update `DEPENDENCIES.md`
    - Remove the React and Vite table; add three.js r169 with a pointer to `office/ASSET-LICENCES.md`
    - _Requirements: 16.2, 18.2, 18.8_

  - [ ]* 14.4 Write verify script unit test
    - File: `tests/unit/verify-office.test.ts`
    - _Requirements: 17.4, 17.5_

- [x] 15. Dashboard traceability links (Stage 4)
  - [x] 15.1 Create `dashboard/lib/office-link.js`
    - Pure `officeRunLink`, `officeFindingLink`, `officePageLink` producing `./office/#/run/<enc runId>?t=<ms>[&station=<id>]`; `t=0` and no station when `producedAt` is null
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.6_

  - [x] 15.2 Add links to Dashboard views and navigation
    - `dashboard/index.html`: "Virtual Office" link in `#primary-nav`
    - `finding-detail.js`: "See how this was found" (also for ignored findings; muted "moment was not recorded" note on fallback); `run-view.js`: "Replay this run"; `page-detail.js`: link only when `replay.enriched` and numeric `replayT`
    - Plain anchors built with `createElement` and `textContent`; no `fetch`, forms, or POST
    - _Requirements: 12.1 to 12.8, 18.7_

  - [ ]* 15.3 Write property test for Dashboard link round trip
    - File: `tests/property/dashboard-office-link.test.ts`
    - **Property 22: Dashboard link round trip and legacy fallback**
    - **Validates: Requirements 12.1, 12.2, 12.4, 12.6**

  - [ ]* 15.4 Write source-scan test for read-only Dashboard additions
    - File: `tests/unit/dashboard-office-links.test.ts`; also render the three views with and without `producedAt`
    - **Property 29: Dashboard additions are read-only links**
    - **Validates: Requirements 12.7, 12.8, 18.7**

- [x] 16. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.
  - Run `npx tsc --noEmit`, `npx vitest --run`, and `node scripts/verify.mjs`.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP.
- Each stage is independently releasable: Stage 1 is invisible, Stage 2 is not wired into CI, Stage 3 swaps the office, and Stage 4 adds Dashboard links after `/office/` is live.
- Every property from design.md has its own test sub-task placed beside the code it validates; each uses its own test file so tasks can run in parallel.
- Agent roles: `"template"` replaces `"ai"`; the office never labels anything AI.
- Manual review is still needed for 3D visual quality, real device frame rate, and assistive-technology conformance; automated checks cannot verify these.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "5.1", "6.1"] },
    { "id": 1, "tasks": ["1.2", "2.1", "3.1", "5.2", "6.2", "6.3", "8.1", "9.1"] },
    { "id": 2, "tasks": ["1.3", "1.4", "1.5", "2.2", "3.2", "3.3", "5.3", "6.4", "6.5", "6.6", "6.7", "6.8", "6.9", "6.10", "6.11", "6.12", "7.1", "8.2", "8.3", "8.4", "8.5", "9.2", "10.1", "10.2"] },
    { "id": 3, "tasks": ["2.3", "3.4", "3.5", "3.6", "3.7", "3.8", "3.9", "7.2", "7.3", "7.4", "8.6", "8.7", "9.3", "9.4", "9.5", "9.6", "10.3", "11.3", "11.4"] },
    { "id": 4, "tasks": ["10.4", "11.1"] },
    { "id": 5, "tasks": ["11.2"] },
    { "id": 6, "tasks": ["11.5", "11.6", "11.7"] },
    { "id": 7, "tasks": ["13.1"] },
    { "id": 8, "tasks": ["13.2", "13.3", "14.2"] },
    { "id": 9, "tasks": ["13.4", "14.1", "14.3", "14.4"] },
    { "id": 10, "tasks": ["15.1"] },
    { "id": 11, "tasks": ["15.2", "15.3"] },
    { "id": 12, "tasks": ["15.4"] }
  ]
}
```
