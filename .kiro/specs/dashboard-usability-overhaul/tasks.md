# Implementation Plan: Dashboard Usability Overhaul

## Overview

Work is split into two phases that each end with a checkpoint where the user is asked before continuing.

- Phase 1 - Dashboard: everything the public Dashboard needs to be useful (capture, publish, present, lifecycle history, accessibility, performance).
- Phase 2 - Admin decisions: Resolve / Ignore / Un-ignore (dispositions module, log, Approval_Gate, Admin GUI, CLI, sync, CI, and the Dashboard's Ignored list, regression label, and trend annotations).
- Virtual Office: out of scope for this spec (Requirement 17.13). It will be a separate later spec. No tasks here touch `virtual-office/`.

Language: TypeScript for Guardian and Publisher code (`src/`), plain ES modules for `dashboard/` (no build step, no framework). Tests use vitest and fast-check (already devDependencies); no new dependency is added.

Phase boundary decision (dashboard vs admin): Phase 1 makes the Dashboard and Publisher schema-ready for decisions so Phase 2 needs no rework of data shapes.
- In Phase 1: the Publisher already emits `ignored: []`, `totals.ignored: 0`, `decisions: { status: "not-applicable", ... }`, per-finding `ignoredNodeCount: 0`, and `hasImages`; the Dashboard treats missing `ignored[]`, `decisions`, `hasImages` as empty/not-applicable (backward compatible); the route format already includes `scope=active|ignored`; the lifecycle chart already draws the `regression` series (zero until Phase 2); `imageUnavailableText` is done.
- In Phase 2 (UI that has nothing to show until decisions exist): Ignored KPI card, Ignored list, ignored/regression banners in the Finding_Detail_View, "(+N ignored)" page-row text, trend chart annotations, and the decisions-unavailable notice.

Project constraints that apply to every task: zero AI tokens, free services only, no `innerHTML` (use `textContent`), all files ASCII-only (no em-dashes, smart quotes, arrows), sanitized published output, additive git pushes only (never force, never rebase), Dashboard stays read-only with no form or POST. Every implementation task must leave `npm run build` (tsc) and `npm test` green.

## Tasks

### PHASE 1 - DASHBOARD

- [x] 1. Shared finding model
  - [x] 1.1 Create `src/core/finding-model.ts`
    - Export types `Severity`, `FindingKind`, `Lifecycle`, `RunFindingCore`
    - Implement `findingKey` (`pageUrl|viewport|ruleId`), `findingId` (`rf_`/`cf_`/`vf_` + sha1(runId#key) first 12 hex), and a light `buildRunFindingSet(runDir)` that lists keys from raw axe files plus failed checks and visual flags
    - Pure except for the file read in `buildRunFindingSet`; no clock, no randomness
    - _Requirements: 2.1, 2.3, 13.3_

- [x] 2. Evidence sanitization and caps
  - [x] 2.1 Create `src/publish/evidence.ts` and export `hasResidualPath` from `src/publish/sanitizer.ts`
    - Define `PublishCaps` (10 nodes, 500 html chars, 300 target, 600 failureSummary, 8 MB json, 64 MB run, 8 MB image, 100 guidance)
    - Implement `sanitizeEvidenceText` in the design's order (coerce, `sanitizeJson`, strip control chars, truncate on code point boundary, residual-path re-scan, fail closed to `[withheld]`)
    - Implement `buildViolationEvidence` (rule metadata, `nodeCount`, `omittedNodeCount`, `truncated`, `withheld`, iframe/shadow targets joined with ` >> `, only html/target/failureSummary published)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.8, 1.10, 1.12, 17.6_
  - [x]* 2.2 Write property test for evidence cleanliness
    - File `tests/property/evidence-sanitize.test.ts`; generator `arbAxeNode` with injected emails, tokens, drive/UNC/POSIX paths, control chars, non-ASCII
    - **Property 1: Published element evidence is clean**
    - **Validates: Requirements 1.4, 1.8, 1.10, 17.6**
  - [x]* 2.3 Write property test for evidence caps and counts
    - Same file; violations with 0 to 60 nodes and very long html
    - **Property 2: Evidence caps and counts are exact**
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.5, 1.6**

- [x] 3. Run findings builder (per-rule severity)
  - [x] 3.1 Create `src/publish/run-findings.ts`
    - Implement `loadRawRunInputs(runDir)` (thin I/O; tolerates missing/corrupt files, records `parseError`) and pure `buildRunFindings(inputs, { caps })`
    - One `a11y-rule` Finding per (page, viewport, rule) with severity equal to axe impact (`unrated` for null/unknown); `check` and `visual` Findings `unrated`; `suppressedBy` for suppressed visual differences; legacy mode (`detailLevel: "legacy"`, severity `not-recorded`) when no raw axe file
    - Emit `totals` (`all`, `bySeverity` with six keys, `byLifecycle`, `ignored: 0`, `detected`), `pages[].counts`, `ignored: []`, `decisions: { status: "not-applicable" }`, `ignoredNodeCount: 0`; join `lifecycle.json` when present else lifecycle `not-recorded`
    - Active list equals detected list in this phase (the disposition overlay is added in task 21.2)
    - Record omissions (`raw-axe-unreadable`) and keep going on bad input
    - _Requirements: 2.1, 2.3, 2.6, 2.8, 2.9, 1.9, 4.2, 4.5, 12.4, 12.5, 13.9, 13.10, 17.9_
  - [x]* 3.2 Write property tests for findings and counts
    - File `tests/property/run-findings.test.ts`; generator `arbRunInputs`
    - **Property 3: One Finding per rule violation with its real Impact**
    - **Property 4: Counts are conserved**
    - **Property 23: Suppressed visual Findings name the failing rules**
    - **Validates: Requirements 2.1, 2.3, 2.4, 2.6, 2.9, 4.2, 4.5, 12.6, 12.9, 14.7**

- [x] 4. Visual measure persistence, derivation, and baseline publishing
  - [x] 4.1 Persist the visual measure at run time
    - `src/agents/visual-compare.ts`: add `baselineHash` (first 16 hex of sha256 of the baseline PNG) to `VisualResult`; no behaviour change
    - `src/core/orchestrator.ts`: write sanitized `pages[].visual` (no file paths) into `findings.json`, additive; write the `trigger` marker from `AWG_RUN_TRIGGER`
    - Existing tests stay green
    - _Requirements: 4.3, 4.4, 4.7, 17.1_
  - [x] 4.2 Create `src/publish/visual.ts`
    - `buildVisualItems` (`recorded` measure from `findings.json`, else `derived-from-diff-image` via `deriveDiffMeasure`, else `null`)
    - `deriveDiffMeasure(diffPng)` using `pngjs` (already a dependency); baseline copied only for pairs with `differs: true` from `AWG_VISUAL_BASELINES` (default `baselines-visual`); missing baseline gives `images.baseline = null` with a reason; provenance `approvedAt` / `sourceRunId` published as `null`
    - _Requirements: 4.1, 4.3, 4.4, 4.7, 5.1, 5.2, 5.7_
  - [x]* 4.3 Write property tests for baselines and derived measure
    - File `tests/property/visual-publish.test.ts`; images up to 16x16, `pixelmatch` with the project's options
    - **Property 18: Baselines are published exactly for differing pairs**
    - **Property 19: Derived difference measure equals the comparer's count**
    - **Validates: Requirements 4.3, 4.4, 5.1, 5.2, 5.7**

- [x] 5. Size budget and image retention
  - [x] 5.1 Create `src/publish/size-budget.ts`
    - `selectWithinBudget` (JSON first, then diff/baseline/current of differing pages, then others; drop images over `maxImageBytes`; record every drop with reason `run-cap`, `image-cap`, or `image-retention`)
    - `runsWithImages(runsNewestFirst, n)`: N most recent by `finishedAt` desc then `runId` desc; handles ties and missing dates; N from `AWG_IMAGE_RETENTION_RUNS`, default 10
    - _Requirements: 1.11, 5.8, 16.8, 16.9, 16.10, 16.12_
  - [x]* 5.2 Write property test for the size budget
    - File `tests/property/size-budget.test.ts`
    - **Property 17: Published size never exceeds the cap and every drop is recorded**
    - **Validates: Requirements 1.11, 5.8**

- [x] 6. Deterministic Automated_Guidance
  - [x] 6.1 Create `src/publish/guidance.ts`
    - `buildGuidance(run, visual, caps)` with fixed templates by kind and severity; each item has `findingId`, `pageUrl`, `checkId`, `severity`, text naming page + rule + severity, `reviewerDecision` for visual/check items, no `confidence`; cap `maxGuidancePerRun` with an `omitted` count
    - `isGenericGuidance(text)`; `src/agents/ai-agents.ts` stays untouched and exported
    - Built from Active_Findings only
    - _Requirements: 7.3, 7.4, 7.5, 7.7, 7.9, 7.10_
  - [x]* 6.2 Write property test for publisher guidance
    - File `tests/property/guidance-publish.test.ts`
    - **Property 22: Automated guidance is specific, linked, and honest** (publisher half)
    - **Validates: Requirements 7.3, 7.4, 7.5, 7.7, 7.9**

- [x] 7. Page aggregates and Published_Data wiring
  - [x] 7.1 Create `src/publish/pages.ts`
    - `pageGroupOf`, `buildPageHistory(slug, runs)`, `buildDashboardAggregates(runs)` (one `runs[]` row per run with totals, `hasRunData`, `hasImages`, `decisions`, `ignored` defaults)
    - _Requirements: 8.1, 8.2, 9.5, 10.1, 16.5_
  - [x] 7.2 Extend `src/publish/published-data.ts` (and `build-published-data.ts` only if needed)
    - Per run: `loadRawRunInputs` -> `buildRunFindings` -> `buildVisualItems` -> `buildGuidance` -> `selectWithinBudget` -> write `run-findings.json`, `evidence/<slug>.<viewport>.json`, `visual.json`, `guidance.json` (every object through `sanitizeJson` + residual-path check, fail closed) -> copy kept images
    - Apply image retention before the budget; record `image-retention` omissions; publish `imageRetentionRuns` in `index.json`
    - After all runs: `pages/<slug>.json`, extended `dashboard.json` (legacy fields keep names, now describe the latest run and Active_Findings; `aiItems: []`; new `runs[]` and `latest`), additive `index.json` fields
    - Replace `copyScreenshots` with the budget-aware copy; legacy published files and field names unchanged
    - _Requirements: 1.7, 1.9, 1.11, 5.1, 5.2, 5.8, 9.5, 13.9, 16.5, 16.8, 16.9, 16.10, 17.5, 17.6, 17.14_
  - [x]* 7.3 Write property tests for published structure
    - Files `tests/property/run-findings.test.ts` (extend) and `tests/property/dashboard-pages.test.ts` (publisher side of grouping)
    - **Property 25: Page history agrees with run data**
    - **Property 26: The aggregate file does not depend on element detail**
    - **Property 27: Published data is genuine, valid, and stable JSON**
    - **Property 15: Page groups partition the pages** (TypeScript `pageGroupOf` half)
    - **Validates: Requirements 8.1, 8.2, 9.5, 16.5, 17.5, 17.14**
  - [x]* 7.4 Write integration test with a fixture run
    - File `tests/unit/publisher-fixture.test.ts` and fixture `tests/fixtures/run-sample/` (accessibility files, findings with and without `visual`, results, screenshots, a baseline, one corrupt axe file)
    - Assert legacy file names and fields kept, corrupt input degrades without failing, no absolute paths or secrets in the output tree, second run is byte-identical
    - _Requirements: 1.7, 1.9, 9.12, 17.6_
  - [x]* 7.5 Write property test for image retention
    - File `tests/property/image-retention.test.ts`
    - **Property 40: Images are published only for the latest N runs and every omission is recorded**
    - **Validates: Requirements 16.8, 16.9, 16.10, 16.11, 16.12**
  - [x] 7.6 Make publishing fast enough for CI (30-minute job cap)
    - Measured: `build-published-data` takes about 1 to 1.5 minutes per run (about 1 hour for 31 runs); CI restores about 23 runs and has `timeout-minutes: 30`, so publishing would time out
    - Profile `src/publish/published-data.ts`, `src/publish/visual.ts` and `src/publish/run-findings.ts` on the local `artifacts/runs` to find the hot spots (expected: full-page PNG decode in `deriveDiffMeasure`, pixelmatch re-run in `baselineReproducesDiff`, repeated file reads)
    - For runs outside the image-retention window, skip baseline verification and image work entirely (images are not published); still publish the difference measure when it is recorded or cheaply available
    - Cache derived per-run results that never change (for example a `visual-measure.json` written next to the raw run on first derivation, or an in-memory cache keyed by file size + mtime) so repeat publishes do not recompute them; never change published output content because of the cache
    - Target: full publish of the local runs completes in under 5 minutes; record before/after timings
    - Add a unit or integration test that guards the behaviour (no baseline verification or PNG decode for runs outside the retention window), keeping all existing tests green
    - _Requirements: 16.1, 16.8, 16.9, 17.1, 17.2_

- [x] 8. Lifecycle module, history v2, and orchestrator integration
  - [x] 8.1 Create `src/agents/a11y-lifecycle.ts` (pure)
    - `nextState`, `applyRun` (idempotent by run id, append-only), `migrateV1`, `emptyHistory`, types `HistoryV2`, `HistoryEntry`, `RunObservation`, `LifecycleSnapshot`
    - Follow the transition table; skipped/unscanned page+viewport leaves state unchanged; `unavailable` status never fabricates state
    - _Requirements: 12.10, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.12, 13.13_
  - [x] 8.2 Update `src/agents/a11y-history-store.ts` and its consumers
    - `loadA11yHistory` returns `{ status, history }` (parse failure is `unavailable`, not `{}`); `saveA11yHistory` writes a temp file then renames; add `readHistoryFindings` returning the v1-style `Record<string, TrackedFinding>` view for v1 and v2
    - Switch `src/agents/analytics.ts` and `dashboard-data.ts` to the compat reader; `tests/unit/analytics.test.ts` stays green
    - _Requirements: 13.8, 13.11, 17.9, 17.10_
  - [x] 8.3 Integrate lifecycle into `src/core/orchestrator.ts`
    - After findings/results/accessibility are written: build the run observation, call `applyRun`, write `artifacts/runs/<id>/lifecycle.json` (including `historyStatus` from `artifacts/a11y-history.status.json`), save history atomically, emit `a11y.history.unavailable` event when unavailable, write a `migration` audit entry via `tel.audit` on v1 to v2 conversion
    - Replace `mergeRunIntoHistory` usage with the v2 store; do not modify or create the history file when unavailable
    - _Requirements: 13.2, 13.8, 13.9, 13.10, 13.11, 17.10, 17.11_
  - [x]* 8.4 Write property tests for lifecycle and history
    - File `tests/property/a11y-lifecycle.test.ts`; generators `arbHistory`, `arbObservation` built from reachable states; include the `findingKey` equality assertion
    - **Property 7: Lifecycle transitions follow the table**
    - **Property 8: History application is idempotent**
    - **Property 9: History only grows**
    - **Property 10: Lifecycle is deterministic**
    - **Property 11: Unavailable history never fabricates state**
    - **Property 12: Resolved items are complete and scoped**
    - **Validates: Requirements 12.5, 12.10, 13.3 to 13.13**
  - [x]* 8.5 Write unit tests for the history store
    - File `tests/unit/a11y-history-store.test.ts`: v1 to v2 migration (state mapping, collapsing duplicate keys, migration audit entry), unparseable file leaves file unchanged and reports `unavailable`, atomic write failure keeps previous bytes
    - _Requirements: 13.8, 13.11, 17.10_

- [x] 9. CI: persist A11y_History across runs
  - [x] 9.1 Edit `.github/workflows/guardian.yml` (additive, keep pinned SHAs and per-job permissions)
    - run job: "Restore a11y history" step immediately before "Run Guardian" (writes `artifacts/a11y-history.status.json` with `restored|first-run|unavailable`); `AWG_RUN_TRIGGER: ${{ github.event_name }}` on the Guardian step; "Upload a11y history" step after the raw-runs upload
    - commit-runs-data job: "Download a11y history" (`continue-on-error: true`); stage `artifacts/a11y-history.json` unless status is `unavailable`; restructure the early "No raw run artifacts" exit so a history-only change is still committed; push stays non-forced
    - _Requirements: 13.1, 13.2, 13.8, 13.14, 17.2_
  - [x]* 9.2 Write workflow smoke test
    - File `tests/unit/guardian-workflow.test.ts` (text assertions): restore step precedes "Run Guardian", commit job adds the history file, no `--force`/`push -f`/`--force-with-lease`, action SHAs still 40 hex
    - _Requirements: 13.1, 13.2, 13.14_

- [x] 10. Dashboard pure modules (`dashboard/lib/*.js`, `dashboard/rule-catalogue.js`)
  - [x] 10.1 Create `dashboard/lib/severity.js` and `dashboard/lib/route.js`
    - `SEVERITY_ORDER`, `rank`, `label` ("Not rated", "Severity not recorded for this run"), `symbol`
    - `parseRoute`, `formatRoute`, `normalizeRoute` for overview, run, findings, page, finding, visual; params `run,q,sev,state,has,sort,dir,group,rule,page,scope` (`scope=active|ignored`, default `active`); drop unknown params and invalid enum values; dedupe + sort lists; `encodeURIComponent` everywhere
    - No `window`/`document` at import time
    - _Requirements: 2.7, 8.9, 9.7, 9.12, 11.8, 19.8_
  - [x] 10.2 Create `dashboard/lib/findings.js` and `dashboard/lib/legacy.js`
    - `normalizeRun` (treat missing `ignored[]`, `decisions`, `hasImages`, `ignoredNodeCount` as empty / `not-applicable` / published-if-path-exists / 0), `countBySeverity`, `countByLifecycle` (present-state series sum to total; `resolved` separate; "State not recorded" group), `filterFindings`, `sortFindings`, `sameRuleOtherPages`, `decisionEffectText`
    - `normalizeLegacyRun`: never throws, severity and lifecycle `not-recorded`, original `detail` kept, no inference from text
    - _Requirements: 2.2, 2.4, 2.5, 2.8, 3.12, 11.2, 12.4, 12.5, 12.6, 12.9, 14.7, 17.9_
  - [x] 10.3 Create `dashboard/lib/pages.js`
    - `groupOfUrl` (same algorithm as TypeScript `pageGroupOf`), `buildPageRows` (precomputed lowercase `searchKey`), `filterPages`, `sortPages` (stable), `groupPages`, highest-severity per row
    - _Requirements: 8.1, 8.2, 8.4 to 8.7, 8.12, 8.13_
  - [x] 10.4 Create `dashboard/lib/summary.js`, `guidance.js`, `captions.js`
    - `plainEnglishSummary` (catalogue templates; unknown rule falls back to published description + help + scope sentence only; "showing X of Y" text)
    - `isGenericGuidance` (mirror of the TypeScript version), `visibleGuidance` (drop unknown `findingId`, generic text, any `confidence`)
    - `evidenceCaption`, `imageAlt`, `imageUnavailableText(reason, retentionRuns)` ("Images not kept for this run (only the latest N runs keep images)"); missing run id/date renders `Run not recorded`
    - _Requirements: 3.2, 3.6, 3.8, 4.7, 5.6, 5.9, 6.1 to 6.6, 7.5, 7.8, 7.9, 16.11_
  - [x] 10.5 Create `dashboard/rule-catalogue.js`
    - Human-authored entries (`what`, `who`, `fix`, `scope`) for the axe rules seen in repo data (`link-name`, `nested-interactive`, `color-contrast`, `image-alt`, `button-name`, `label`, `heading-order`, `region`, and the common remainder); ASCII only; no bare leading pronoun; no placeholders left unresolved
    - _Requirements: 3.2, 3.7, 3.8, 3.14_
  - [x]* 10.6 Write property test for routes
    - File `tests/property/dashboard-route.test.ts`; generator `arbRoute` with unicode, `&`, `#`, `%`
    - **Property 13: Deep links round-trip**
    - **Validates: Requirements 3.13, 8.9, 9.7, 9.12, 11.8**
  - [x]* 10.7 Write property tests for page lists
    - File `tests/property/dashboard-pages.test.ts` (extend); `arbPageRows` up to 500 rows
    - **Property 14: Search and filters only narrow the page list**
    - **Property 15: Page groups partition the pages** (JavaScript half and TS/JS cross-check)
    - **Property 16: Row severity and sort order are correct**
    - **Property 28: Page filtering stays within the latency budget**
    - **Validates: Requirements 8.1, 8.2, 8.5, 8.6, 8.7, 8.12, 8.13, 16.3**
  - [x]* 10.8 Write property tests for dashboard counts
    - File `tests/property/dashboard-counts.test.ts`
    - **Property 4: Counts are conserved** (dashboard side)
    - **Property 5: Every view of a run's counts agrees**
    - **Property 6: Legacy runs are never given inferred values**
    - **Property 24: Same-rule-on-other-pages count is exact**
    - **Validates: Requirements 2.4, 2.5, 2.8, 3.12, 10.11, 11.10, 12.3, 12.9, 14.2, 14.7, 17.9**
  - [x]* 10.9 Write property tests for text helpers and catalogue
    - Files `tests/property/dashboard-text.test.ts`, `tests/unit/rule-catalogue.test.ts`
    - **Property 20: Captions and alt text always carry their facts**
    - **Property 21: Plain-English summaries are complete and never invented**
    - **Property 22: Automated guidance is specific, linked, and honest** (`visibleGuidance` half and `isGenericGuidance` cross-check)
    - Catalogue unit test: ASCII, non-empty fields, no leading pronoun, no placeholders, scope enum
    - **Validates: Requirements 3.2, 3.6, 3.8, 3.14, 4.7, 5.6, 5.9, 6.2 to 6.6, 7.5, 7.8, 7.9**

- [x] 11. Dashboard shell, data access, and styling
  - [x] 11.1 Update `dashboard/data-source.js`, `dashboard/index.html`, `dashboard/app.js`
    - `loadPublished(relPath)` with relative URLs only, errors naming the failing file; state object with promise caches (`runCache`, `evidenceCache`, `pageCache`)
    - `index.html`: skip link, header, `<nav aria-label="Primary">`, `<main id="view" tabindex="-1">`, footer with the honest WCAG-goal statement, `#sr-status` (`role="status"`) and `#sr-alert` (`role="alert"`) live regions, `<dialog id="lightbox">`; remove the old `#page-detail` aside and overlay
    - `app.js`: boot loads only `index.json` and `dashboard.json`; single `popstate` listener; `pushState` navigation, `replaceState` of `{ scrollY, focusKey }`, `history.scrollRestoration = "manual"`; render dispatcher lazy-loads view modules by route via `import()` and catches errors into a visible error panel (a view module that does not exist yet shows that panel, so the shell stays safe while later tasks add views); focus moves to the view heading on view change
    - Keep Replay/static behaviour and the existing live-mode notice (detail views need the published site)
    - _Requirements: 9.6, 9.7, 9.8, 9.10, 9.11, 15.6, 15.7, 16.1, 16.6, 16.7, 17.3, 17.8_
  - [x] 11.2 Rewrite `dashboard/style.css`
    - Design tokens with contrast-checked pairs (muted `minor` text lightened), `:focus-visible` 3px outline, 24px minimum targets, reflow at 320px, `overflow-wrap: anywhere`, table scroll regions, reduced-motion media query, pattern classes for severity/lifecycle, Automated guidance block with dashed border
    - _Requirements: 15.2, 15.3, 15.4, 15.8, 15.9, 15.10, 7.6_
  - [x]* 11.3 Write data-source and contrast unit tests
    - Files `tests/unit/data-source-static.test.ts` (only relative URLs, never `127.0.0.1` in static mode, errors name the file) and `tests/unit/dashboard-contrast.test.ts` (parse `style.css` custom properties and assert 4.5:1 text, 3:1 large text and UI)
    - _Requirements: 15.2, 15.3, 16.6, 17.8_

- [x] 12. Overview and interactive charts
  - [x] 12.1 Create `dashboard/views/charts.js`
    - Trend (one point per run from `dashboard.json runs[]`; hollow point and "Run data not published" for `hasRunData: false`), severity doughnut, lifecycle stacked bar (series `new`, `recurring`, `existing-unresolved`, `regression`, "State not recorded", plus separate labelled `resolved`)
    - `onClick` via `getElementsAtEventForMode` routes through `formatRoute`; pointer cursor on hover; canvas `role="img"` + `aria-label`; visible summary line; `<details>` with a real data table whose rows hold the same actions (keyboard equivalent); canvas pattern fills; HTML legend with label + count; reduced-motion handling; tooltip shows Run_ID, date, count; Chart.js load failure falls back to the tables
    - _Requirements: 10.1, 10.2, 10.8, 10.9, 10.10, 11.1, 11.2, 11.6, 11.7, 12.1, 12.2, 12.3, 12.7, 12.8, 15.4, 15.5, 15.9_
  - [x] 12.2 Create `dashboard/views/common.js` and `dashboard/views/overview.js`
    - Run selector (`<select>` labelled "Run"), non-latest-run notice with "Back to latest run", KPI cards (Health, Runs tracked, Total findings, Findings by severity buttons, Pages scanned) as buttons routing to `#/findings?...`, each with a visible label and `aria-describedby` definition; duplicated "Issues found" card removed
    - Page explorer: group header buttons (`aria-expanded`), only expanded groups rendered, collapsed by default at 100+ pages, search coalesced with `requestAnimationFrame` + `replaceState`, filters in `<fieldset><legend>`, sort `<select>`, "No pages match" + clear control, result count to live region, row names `url, N findings, highest severity X`
    - Error banner naming the failed file and fallback to the latest run that loaded; only `textContent` for dynamic text
    - _Requirements: 8.2 to 8.11, 10.5, 10.6, 10.7, 14.1 to 14.6, 15.1, 15.6, 15.7, 16.2, 16.3_
  - [x]* 12.3 Write view-model unit tests
    - File `tests/unit/dashboard-viewmodels.test.ts`: "Not rated" label, KPI list has no duplicate meaning, trigger "not recorded", run change text, fallback to latest loaded run, legacy run without new fields renders
    - _Requirements: 2.7, 2.8, 10.4, 14.4, 14.6, 17.9_

- [x] 13. Run view and filtered findings
  - [x] 13.1 Create `dashboard/views/run-view.js`
    - Run_ID, date and time, trigger (`not recorded` when absent), origin, pages scanned, counts by severity, change versus previous run (`+3`, `-2`, `no change`, "no earlier run"), shared findings list; "Run data not published" runs never open an empty view
    - _Requirements: 10.2, 10.3, 10.4, 10.10_
  - [x] 13.2 Create `dashboard/views/filtered-findings.js`
    - `<ul>` list (page URL, viewport, rule/check, Plain_English_Summary, link), removable filter chips, "Showing N findings" count, controls for Severity, Lifecycle_State, Page_Group, rule id; "No findings match these filters" with clear control; blocks of 100 with "Show more"; filters recorded in the Deep_Link; default `scope=active`
    - _Requirements: 11.2 to 11.5, 11.8, 11.9, 14.5_

- [x] 14. Page detail and finding detail
  - [x] 14.1 Create `dashboard/views/page-detail.js`
    - Full-width layout; heading with URL, highest severity, counts, findings grouped by viewport (severity badge, summary, link), evidence with captions and Visual_Comparison link, history table from `pages/<slug>.json` (lazy), back-to-list control restoring search/filters/sort/scroll, unknown item message "That item is not in the published data" with Overview link
    - _Requirements: 9.1 to 9.5, 9.9, 9.11_
  - [x] 14.2 Create `dashboard/views/finding-detail.js`
    - Heading, severity text badge, Plain_English_Summary, scope ("whole page" vs N elements), facts (rule id, WCAG tags, help link with `rel="noopener noreferrer"`, page, viewport, Run_ID, run date, lifecycle), "How to fix", affected elements (`<pre><code>` via `textContent`, target, failure summary, "Showing 10 of 27 (17 not shown)"), screenshot with caption, "Same rule on other pages" link, Automated guidance block (labelled, distinct, `data-guidance="true"`)
    - Visual Findings: baseline statement, suppression reason naming failing rules, difference measure + provenance, "Not rated - visual changes need human review", link to Visual_Comparison
    - No element detail: "No element detail was recorded for this finding" plus legacy `detail`; unknown rule: published description/help only
    - _Requirements: 3.1 to 3.13, 4.1 to 4.7, 7.1 to 7.4, 7.6, 7.10, 17.9_

- [x] 15. Visual comparison and lightbox
  - [x] 15.1 Create `dashboard/views/visual-comparison.js` and `dashboard/views/lightbox.js`
    - Three `<figure>` elements (Approved baseline, Current run, Difference highlight) in an auto-fit grid, baseline/current in-place switch (`role="switch"`, Space/Enter), no baseline means no baseline figure plus an honest reason, tall images in a scrollable labelled region, lazy images via the captioned helper, `imageUnavailableText` instead of broken images, "Image could not be loaded" on error
    - Lightbox: native `<dialog>` `showModal()`, Close button gets focus, Escape closes, focus returns to the opener, not a route
    - _Requirements: 5.3 to 5.7, 5.9, 5.10, 6.1, 6.7, 15.1, 16.4, 16.11_

- [x] 16. Accessibility finishing and self-scan
  - [x]* 16.1 Write dashboard source-scan smoke test
    - File `tests/unit/dashboard-source-scan.test.ts`: no `innerHTML`/`outerHTML`/`insertAdjacentHTML`/`document.write`; no `<form`, POST/PUT/DELETE fetch; no "Large-language-model" or "AI-assisted analysis"; no WCAG conformance claim wording; lazy loading present; all `dashboard/` and new `src/` files ASCII-only
    - _Requirements: 3.11, 6.1, 7.1, 15.12, 16.4, 17.4, 17.7_
  - [x] 16.2 Create `scripts/scan-dashboard.mjs` and wire CI
    - Serve built `_site` from a Node `http` server on `127.0.0.1` (no new dependency), open Overview, a Run_View, a Page_Detail_View, a Finding_Detail_View, and the Visual_Comparison with Playwright + `@axe-core/playwright` (tags `wcag2a`, `wcag2aa`, `wcag22aa`), write `_site/data/self-scan.json`, append a table to `$GITHUB_STEP_SUMMARY`, exit 0 (non-blocking)
    - `guardian.yml`: add "Self-scan dashboard" step after "Add static dashboard to site"; Dashboard footer reads `self-scan.json` and shows the self-check notice separate from site totals
    - Document in the script header that loopback-only scanning of the Dashboard is exempt from the SiteGateway; Approved_Domain handling for site scans is untouched
    - _Requirements: 15.11, 15.12, 17.11_
  - [x]* 16.3 Write unit test for self-scan result shaping
    - File `tests/unit/self-scan-shape.test.ts` (pure aggregation function of `scripts/scan-dashboard.mjs`)
    - _Requirements: 15.11_

- [x] 17. Performance and error-handling hardening
  - [x] 17.1 Harden loading and failure paths in `dashboard/app.js` and `dashboard/views/common.js`
    - Loading indicator in the `role="status"` region while a per-run, evidence, page, visual, or guidance file loads; section-level error with file name, HTTP status, and Retry; promise caches shared by concurrent opens; unexpected view exceptions announced via `#sr-alert` with a link to Overview; verify only expanded groups create DOM rows and search stays under the 200 ms budget for 500 pages
    - _Requirements: 8.10, 16.1, 16.2, 16.3, 16.6, 16.7_

- [x] 18. Phase 1 checkpoint - Dashboard
  - Run `npm run build` (tsc, no errors) and the full `npm test` (vitest run from the repo root); confirm all pre-existing tests (`analytics`, `classification`, `safety`, `schema-validation`) still pass
  - Run `node --check` on every file in `dashboard/` ending in `.js` (excluding `dashboard/vendor/`)
  - Build a local preview the same way CI does: `node dist/publish/build-published-data.js ./_site`, then copy `dashboard/.` into `./_site/` (equivalent of `cp -r dashboard/. ./_site/`), then serve `./_site` from a local static server and open Overview, a Run_View, a Page_Detail_View, a Finding_Detail_View, and the Visual_Comparison; confirm `_site` is not staged for commit
  - Ensure all tests pass, ask the user if questions arise, and ask the user whether to continue to Phase 2 (Admin decisions) before starting it.

  - [-] 18.1 Pre-release fixes and publish Phase 1
    - Static mode on Pages: stop the `data-source.js` probe of `http://127.0.0.1:7788/idle` on the published site (for example a tiny `dashboard/config.js` setting `window.AWG_MODE = "static"`, loaded before `app.js`, written by the CI "Add static dashboard to site" step or shipped in `dashboard/` with local dev still able to use live mode); no console error on any view
    - Visual comparison: remove the duplicated diff legend (caption and separate paragraph)
    - Revert the regenerated `tests/generated/assurity-nz.baseline-v2.spec.ts` to the committed version (git checkout), unless it is required by a passing test
    - Re-run tsc, the full vitest suite and `node --check` on dashboard JS
    - Commit Phase 1 to `main` with a clear message (stage files explicitly; exclude `_site`, scratch files and secrets) and push additively (no force); report the commit SHA
    - _Requirements: 15.6, 16.6, 17.2, 17.8_

### PHASE 2 - ADMIN DECISIONS (RESOLVE / IGNORE / UN-IGNORE)

- [ ] 19. Dispositions pure module
  - [ ] 19.1 Create `src/core/dispositions.ts` (part 1: entries and log)
    - Types, `normalizePageUrl`, `canonicalMatcher`, `entryId` (`dsp_` + 16 hex of sha256 of canonical JSON), `validateNewEntry` (reason 1..500, reviewer 1..80 after trim, scope pairing, control characters removed, `unignore` must name an existing un-undone `ignore`), `parseLog` (recompute ids, reject mismatches into `rejected`), `serializeLog` (stable order, non-ASCII escaped, trailing newline), `mergeLogs` (union by id), `effectiveEntries(log, runFinishedAt)` (Effective_From)
    - No I/O, no clock, no randomness
    - _Requirements: 18.3 to 18.6, 18.11, 19.1, 20.1, 20.2, 20.3, 20.4, 20.14_
  - [ ] 19.2 Add `applyDispositions` to `src/core/dispositions.ts`
    - Ignore test (element/page-rule/site-rule matching; element accounting with `ignoredNodeCount` and reduced `nodeCount`; ignore beats resolve), regression test (latest applicable `resolve`, ties by id), resolved list filtering (`humanResolved`), disjoint `active`/`ignored` sets; un-ignore restores from its own time onward
    - _Requirements: 19.4, 19.5, 19.9, 19.11, 19.12, 19.13, 19.14, 19.15, 19.16, 19.17, 19.18, 19.19, 19.24_
  - [ ]* 19.3 Write property tests for matcher and overlay
    - File `tests/property/dispositions-matcher.test.ts`
    - **Property 29: Matcher scope correctness**
    - **Property 30: Element-scope ignores account for nodes exactly**
    - **Property 31: Ignored Findings are excluded from every active count and nothing is lost**
    - **Validates: Requirements 19.4, 19.5, 19.6, 19.11, 19.15, 19.16, 19.17, 19.18, 20.3**
  - [ ]* 19.4 Write property tests for log merge and validation
    - File `tests/property/dispositions-log.test.ts`
    - **Property 35: Log merge is a lossless, commutative, idempotent union**
    - **Property 37: Decision input validation and entry integrity**
    - **Validates: Requirements 18.3 to 18.6, 18.11, 20.1, 20.2, 20.4, 20.8, 20.14, 20.16**

- [ ] 20. Disposition store and Approval_Gate integration
  - [ ] 20.1 Create `src/core/disposition-store.ts`
    - `readLog` (unreadable/invalid file reports `unavailable` and is never overwritten), `writeLogAtomic` (temp file then rename) inside a read-merge-write step so concurrent CLI/GUI writes lose nothing, `artifacts/dispositions.sync.json` bookkeeping (`syncedIds`, `lastSyncedAt`)
    - _Requirements: 20.1, 20.4, 20.6, 20.14_
  - [ ] 20.2 Extend `src/approval/approval-gate.ts`
    - `disposeFinding` accepts an optional `detail` object (scope, matcher, `undoes`) copied into the audit entry; callers without `detail` behave as today; decision mapping `ignore -> dismissed`, `resolve -> accepted`, `unignore -> rejected`, `findingId = "disposition:" + id`; agent identities and empty reviewers still rejected
    - _Requirements: 18.9, 18.10, 17.11_
  - [ ]* 20.3 Write unit tests for store and gate
    - File `tests/unit/disposition-store.test.ts`: atomic write keeps previous bytes on failure, unreadable log never overwritten, concurrent writers keep both entries; gate `detail` appears in audit, gate rejection leaves log empty
    - _Requirements: 18.9, 18.10, 20.1_

- [ ] 21. Guardian freeze and Publisher overlay
  - [ ] 21.1 Freeze applied dispositions in `src/core/orchestrator.ts`
    - At run finalisation (after `lifecycle.json`): read `artifacts/dispositions.json` and `artifacts/dispositions.status.json` once, call `effectiveEntries(log, finishedAt)`, write `artifacts/runs/<id>/dispositions-applied.json` (`status` `applied` or `unavailable`, `logDigest` 16 hex, entries); record detection of ignored Findings in the A11y_History unchanged
    - _Requirements: 19.1, 19.2, 19.14, 20.9_
  - [ ] 21.2 Apply the overlay in `src/publish/run-findings.ts` and `src/publish/published-data.ts`
    - Read each run's frozen file only (never the live log); missing file means `not-applicable`
    - Publish `findings[]` as Active_Findings only, `ignored[]` with `disposition`, `regression` info, `ignoredNodeCount`, reduced `nodeCount` and evidence built from remaining nodes, `totals.ignored`/`detected` (`all + ignored = detected`), `decisions` (`status`, `appliedCount`, `newThisRun`, `ignoredNewThisRun`, `unignoredNewThisRun`, `resolvedNewThisRun`) compared with the previous run's applied ids, `humanResolved` on resolved items
    - Pass reviewer names and reasons through `sanitizeJson`, the control-character filter, and the residual-path check (`[withheld]` with recorded reason when not confirmed clean); compute guidance, `pages/<slug>.json`, `dashboard.json runs[]` from Active_Findings only
    - _Requirements: 19.2, 19.3, 19.4, 19.5, 19.6, 19.9, 19.11, 19.12, 19.15, 19.16, 19.20, 19.22, 20.12_
  - [ ]* 21.3 Write timeline property tests
    - File `tests/property/dispositions-timeline.test.ts` (generated run sequences with generated logs)
    - **Property 32: Decisions never change runs that finished before them**
    - **Property 33: Resolved then reappears is a regression**
    - **Property 34: Un-ignore restores from its own time onward**
    - **Property 36: Application of dispositions is deterministic and order independent**
    - **Property 39: Decision effect counts are exact** (publisher half)
    - **Validates: Requirements 10.12, 18.11, 18.12, 19.1, 19.2, 19.3, 19.9 to 19.14, 19.19, 19.20, 19.21, 19.24**
  - [ ]* 21.4 Write property test for published decision text
    - File `tests/property/dispositions-log.test.ts` (extend); reuse evidence-text generators
    - **Property 38: Published decision text is clean**
    - **Validates: Requirements 17.6, 20.12**

- [ ] 22. Admin GUI: local guard, API, and UI
  - [ ] 22.1 Add `checkLocalRequest` and apply it to existing POST routes
    - New pure module `src/admin/local-guard.ts` exporting `checkLocalRequest({ host, origin, contentType, secFetchSite }, port)` (Host `127.0.0.1:<port>` or `localhost:<port>`; Origin absent or same loopback origin, `null` rejected; Sec-Fetch-Site not `cross-site`/`same-site`; JSON content type)
    - In `src/admin/admin-server.ts` apply it to the existing `POST /api/schedule`, `/api/run`, `/api/open/*`, `/api/sync` routes (403 with no detail on failure); existing GET behaviour and loopback bind unchanged
    - _Requirements: 20.10, 20.11_
  - [ ] 22.2 Create `src/admin/dispositions-api.ts` (testable without sockets)
    - `listFindings(run)` (uses `loadRawRunInputs` + `buildRunFindings`; up to 50 sanitized node targets; per-scope match counts; run-relative paths only), `listDispositions()` (derived `undone`, `syncState`), `createDisposition(input)` (order: validate, `ApprovalGate.disposeFinding`, append to local log; server sets `at` and id; 201 / 200 duplicate / 400 per-field errors / 403 gate rejection / 409 / 500 with an audit line); body limit 8 KB
    - _Requirements: 18.1, 18.3 to 18.11, 18.13, 18.15_
  - [ ] 22.3 Add endpoints and UI to the Admin GUI
    - `GET /api/findings`, `GET /api/dispositions`, `POST /api/dispositions` in `src/admin/admin-server.ts`, all state-changing routes behind `checkLocalRequest`
    - Control page: Findings panel with "Mark resolved" and "Ignore" per Active_Finding and "Un-ignore" per Ignored_Finding; native `<dialog>` form with scope radio group, live "matches N findings" text, required Reason (max 500) and Reviewer (max 80, remembered in `localStorage`), the notice "Reason and reviewer name are published on the public Dashboard", and "Takes effect from the next run. Earlier runs keep their original counts."; Decisions panel lists every entry (including undone) with scope, reason, reviewer, date, and sync state; `textContent` only; keyboard operable
    - _Requirements: 18.1, 18.3, 18.4, 18.8, 18.12, 18.13, 20.13_
  - [ ]* 22.4 Write property test for the local guard
    - File `tests/property/admin-local-guard.test.ts`
    - **Property 41: Only same-origin loopback requests may change decisions**
    - **Validates: Requirements 20.10, 20.11**
  - [ ]* 22.5 Write unit tests for the dispositions API and page
    - File `tests/unit/admin-dispositions-api.test.ts` (temp dir, fake gate): 201 flow writes one audit entry and one log entry, gate rejection leaves the log empty, duplicate is idempotent, blocked requests 403, page HTML contains the publication notice and "takes effect from the next run" text
    - _Requirements: 18.9, 18.10, 18.12, 20.11, 20.13_

- [ ] 23. CLI parity
  - [ ] 23.1 Extend `approve` in `src/index.ts`
    - Add `--decision ignore|resolve|unignore`, `--scope element|page-rule|site-rule`, `--page`, `--viewport`, `--rule`, `--target`, `--undoes` alongside existing `--reviewer` and `--reason`; build the same input and call the same `dispositions-api` function; print the entry id; existing `accepted|rejected|dismissed` usage for specification drafts unchanged
    - _Requirements: 18.14_

- [ ] 24. Synchronisation to `runs-data`
  - [ ] 24.1 Create `src/admin/disposition-sync.ts`
    - Push path: `git fetch origin runs-data`, temporary detached worktree in the OS temp dir (Reviewer's branch, index, and working tree untouched), union with the remote file via `mergeLogs`, additive commit `dispositions: add N entries`, `git push origin HEAD:refs/heads/runs-data` without force; on non-fast-forward refetch and recreate from the union (max 3 attempts, no rebase); always remove the worktree; on failure keep local log and report "Not yet synced" with a reason
    - `pullDispositions` merges the remote log into the local log as a union
    - _Requirements: 20.4, 20.5, 20.6, 20.8_
  - [ ] 24.2 Wire sync into the Admin GUI
    - `POST /api/dispositions/sync` (202, 409 if running), `GET /api/dispositions/sync/status`; existing `POST /api/sync` also runs `pullDispositions` after `cloudSync`; Decisions panel shows "Synced" / "Not yet synced" with "Sync now" / "Retry"
    - _Requirements: 18.13, 20.5, 20.6_
  - [ ]* 24.3 Write sync integration tests
    - File `tests/unit/disposition-sync.test.ts` (local bare git repos in a temp dir): additive commit on the `runs-data` tip, competing commit leads to refetch + union + second push with no `--force` argument (spy on the git runner), offline remote yields "Not yet synced" and keeps the local log, Reviewer's branch/index/working tree unchanged, temporary worktree removed
    - _Requirements: 20.5, 20.6_

- [ ] 25. CI: restore dispositions and protect the log
  - [ ] 25.1 Edit `.github/workflows/guardian.yml`
    - "Restore dispositions" step immediately before "Run Guardian" (fetch, `git show` of `artifacts/dispositions.json`, validate `schemaVersion` 1 with a `node -e` one-liner, write `artifacts/dispositions.status.json` as `restored|first-run|unavailable`; an invalid file is removed from the workspace only)
    - commit-runs-data: never stage `artifacts/dispositions.json`; push retry becomes push, on rejection `git fetch`, `git merge --no-edit FETCH_HEAD`, push again, max 3 attempts; no force, no rebase
    - _Requirements: 20.7, 20.8, 20.9_
  - [ ]* 25.2 Extend workflow smoke test
    - File `tests/unit/guardian-workflow.test.ts` (extend): "Restore dispositions" precedes "Run Guardian", no `git add` line names `dispositions`, push retry uses `git merge` and never `--force`, `-f`, `--force-with-lease`, or `rebase`
    - _Requirements: 20.7, 20.8_

- [ ] 26. Dashboard: Ignored list, regressions, and trend annotations
  - [ ] 26.1 Update `dashboard/views/overview.js`, `filtered-findings.js`, `finding-detail.js`, `page-detail.js`, `dashboard/lib/captions.js`
    - "Ignored" KPI card (separate from the Active total) linking to `#/findings?run=<id>&scope=ignored`; Ignored list grouped by decision (scope in words, reason, "Ignored by <reviewer> on <date>", decision id, covered Findings with links, number of pages for site-wide groups); "Ignored" filter with default scope excluding ignored
    - Finding_Detail_View: ignored banner, "N elements ignored", Regression block prefixed "Regression:" with a symbol and the label "Reappeared after being marked resolved on <date> by <reviewer>" plus the original reason; resolved items show "Marked resolved by <reviewer> on <date>"; page rows show "(+N ignored)" text outside any count; footer sentence that ignored issues are listed on the Ignored page and reasons/reviewers are published as entered
    - Dashboard stays read-only: no link, form, or call to the Admin GUI, `/api/dispositions`, or issue creation
    - _Requirements: 14.8, 17.7, 18.2, 19.4, 19.7, 19.8, 19.10, 19.11, 19.23_
  - [ ] 26.2 Update `dashboard/views/charts.js`, `dashboard/views/run-view.js`, `dashboard/lib/findings.js`
    - Trend chart: larger triangle point style, tooltip, run-table cell, and a visible line under the chart using `decisionEffectText(decisions)` (for example "12 issues ignored from this run"); `decisions.status === "unavailable"` shows "Decisions could not be loaded for this run; counts may include issues that were ignored"; run table lists the Ignored count
    - _Requirements: 10.12, 19.21, 19.22_
  - [ ]* 26.3 Extend dashboard view-model and source-scan tests
    - Files `tests/unit/dashboard-viewmodels.test.ts` and `tests/unit/dashboard-source-scan.test.ts` (extend): Ignored list grouping and wording, regression label text, trend effect text, decisions-unavailable notice, retention message, legacy run without `ignored`/`decisions`; `dashboard/**` has no reference to `/api/dispositions`, `127.0.0.1:7787`, `method: "POST"`/`PUT`/`DELETE`, `<form`, or `issues/new`
    - **Property 39: Decision effect counts are exact** (`decisionEffectText` half)
    - **Property 38: Published decision text is clean** (Dashboard text helpers return plain strings)
    - **Validates: Requirements 10.12, 17.7, 18.2, 19.7, 19.10, 19.21, 19.22, 20.12**

- [ ] 27. Phase 2 checkpoint - Admin decisions
  - Run `npm run build` (tsc, no errors) and the full `npm test` (vitest run from the repo root); confirm Phase 1 tests and pre-existing tests still pass
  - Run `node --check` on every `dashboard/**/*.js` file (excluding `dashboard/vendor/`)
  - Build the local preview the same way CI does (`node dist/publish/build-published-data.js ./_site`, copy `dashboard/.` into `./_site/`, serve `./_site`); with a sample local dispositions log containing one ignore, one resolve, and one un-ignore, confirm the Ignored list, regression label, and trend annotation render, and that runs finished before each decision keep their counts
  - Manually confirm in the Admin GUI that a cross-origin or wrong-Host POST returns 403 and that Sync now pushes additively (against a scratch remote, never the real `runs-data` without the user's go-ahead)
  - Ensure all tests pass, ask the user if questions arise. The Virtual Office remains out of scope and is not started here.

## Notes

- Tasks marked with `*` are optional (test sub-tasks) and can be skipped for a faster MVP; they are listed so every Correctness Property (1 to 41) has a home.
- Each task references specific requirements for traceability; checkpoint tasks (18, 27) are not in the dependency graph.
- Property tests use fast-check with at least 100 iterations and carry the tag comment `// Feature: dashboard-usability-overhaul, Property N: <title>`.
- Property placement: P1-2 (2.2, 2.3); P3, P4, P23 (3.2); P4-P6, P24 dashboard side (10.8); P7-P12 (8.4); P13 (10.6); P14-P16, P28 (10.7); P15 TS side (7.3); P17 (5.2); P18-P19 (4.3); P20-P22 (10.9, 6.2); P25-P27 (7.3); P29-P31 (19.3); P32-P34, P36, P39 (21.3, 26.3); P35, P37 (19.4); P38 (21.4, 26.3); P40 (7.5); P41 (22.4).
- Sequencing risks: (1) `src/core/orchestrator.ts` is edited by 4.1, 8.3, and 21.1; `src/publish/run-findings.ts` and `published-data.ts` by 3.1/7.2 and 21.2; `guardian.yml` by 9.1, 16.2, 25.1; `admin-server.ts` by 22.1, 22.3, 24.2. These are placed in separate waves and must not run in parallel. (2) The Phase 1 shell dispatches views by lazy `import()`, so views land after 11.1 without touching `app.js`. (3) Phase 1 emits `ignored: []` and `decisions: not-applicable`; if a later schema change renames these, Phase 1 output must be republished. (4) `analytics.test.ts` reads the real `artifacts/a11y-history.json`; the compat reader in 8.2 must be in place before any v2 history file is written locally.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "5.1", "8.1", "9.1", "10.1", "10.5", "11.2"] },
    { "id": 1, "tasks": ["2.2", "3.1", "4.1", "5.2", "8.2", "8.4", "9.2", "10.2", "10.3", "10.4", "10.6"] },
    { "id": 2, "tasks": ["2.3", "3.2", "4.2", "7.1", "8.3", "8.5", "10.7", "10.8", "10.9", "11.1"] },
    { "id": 3, "tasks": ["4.3", "6.1", "11.3", "12.1"] },
    { "id": 4, "tasks": ["6.2", "7.2", "12.2"] },
    { "id": 5, "tasks": ["7.3", "7.4", "7.5", "7.6", "12.3", "13.1", "13.2", "14.1", "14.2", "15.1"] },
    { "id": 6, "tasks": ["16.1", "16.2", "17.1"] },
    { "id": 7, "tasks": ["16.3", "18.1"] },
    { "id": 8, "tasks": ["19.1", "20.2", "22.1"] },
    { "id": 9, "tasks": ["19.2", "22.4"] },
    { "id": 10, "tasks": ["19.3", "19.4", "20.1"] },
    { "id": 11, "tasks": ["20.3", "21.1", "21.2", "24.1"] },
    { "id": 12, "tasks": ["21.3", "21.4", "22.2", "25.1", "26.1", "26.2"] },
    { "id": 13, "tasks": ["22.3", "23.1", "25.2", "26.3"] },
    { "id": 14, "tasks": ["22.5", "24.2"] },
    { "id": 15, "tasks": ["24.3"] }
  ]
}
```
