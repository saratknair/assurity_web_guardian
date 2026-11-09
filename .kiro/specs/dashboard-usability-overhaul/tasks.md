# Implementation Plan: Dashboard Usability Overhaul

## Overview

Work is split into two phases that each end with a checkpoint where the user is asked before continuing.

- Phase 1 - Dashboard: everything the public Dashboard needs to be useful (capture, publish, present, lifecycle history, accessibility, performance).
- Phase 2 - Admin console: the Resolve / Ignore / Un-ignore decisions (dispositions module, log, Approval_Gate, CLI, sync, CI, and the Dashboard's Ignored list, regression label, and trend annotations) plus the guarded local console (central request guard, Setup_Activity_Log, domain-driven discovery, Approved URLs with the fixed cap of 10, new-domain wizard, local visual capture and baseline approval, Config_Publish through git plumbing, workflow push trigger, schedule edit, run details and logs, and the Dashboard `domain` label with a trend break).
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

  - [x] 18.1 Pre-release fixes and publish Phase 1
    - Static mode on Pages: stop the `data-source.js` probe of `http://127.0.0.1:7788/idle` on the published site (for example a tiny `dashboard/config.js` setting `window.AWG_MODE = "static"`, loaded before `app.js`, written by the CI "Add static dashboard to site" step or shipped in `dashboard/` with local dev still able to use live mode); no console error on any view
    - Visual comparison: remove the duplicated diff legend (caption and separate paragraph)
    - Revert the regenerated `tests/generated/assurity-nz.baseline-v2.spec.ts` to the committed version (git checkout), unless it is required by a passing test
    - Re-run tsc, the full vitest suite and `node --check` on dashboard JS
    - Commit Phase 1 to `main` with a clear message (stage files explicitly; exclude `_site`, scratch files and secrets) and push additively (no force); report the commit SHA
    - _Requirements: 15.6, 16.6, 17.2, 17.8_

  - [x] 18.2 Fix issues found on the first live CI run
    - Lifecycle key set: visual Findings recorded in `findings.json` `pages[].visual[viewport].differs: true` without a diff image (for example `dimensionsChanged`) are counted by `src/publish/run-findings.ts` but missing from `buildRunFindingSet` in `src/core/finding-model.ts`, so they show "State not recorded"; make both use the same visual key rule so every detected Finding gets a lifecycle state; add a test that the two key sets are equal for the same run
    - Screenshot size changes stay counted as visual Findings (user decision); the Finding_Detail_View and Visual_Comparison must state plainly that the screenshot size changed and a new baseline may need approval
    - Run origin: the CI publish step labels cloud runs "local" because `AWG_RUN_ORIGIN` is only set on the Run Guardian step; persist an `origin` marker file in the run dir at run time (from `AWG_RUN_ORIGIN`) and/or set the env on the "Build published data" step, keeping the existing marker precedence; add a test
    - Charts: the severity doughnut renders very small and the lifecycle bars look empty on the live overview; reproduce with Playwright against the local preview, fix sizing/height in `dashboard/views/charts.js` and/or `dashboard/style.css`, and confirm both charts render with visible data via screenshots
    - Re-run tsc, the full vitest suite and `node --check` on dashboard JS; commit to `main` (explicit staging, no secrets, no `_site`) and push additively; report the SHA
    - _Requirements: 4.1, 12.1, 12.2, 12.4, 12.6, 13.9, 15.4, 17.1_

### PHASE 2 - ADMIN CONSOLE (DECISIONS, SETUP, PUBLISH, RUNS)

- [x] 19. Dispositions pure module
  - [x] 19.1 Create `src/core/dispositions.ts` (part 1: entries and log)
    - Types, `normalizePageUrl`, `canonicalMatcher`, `entryId` (`dsp_` + 16 hex of sha256 of canonical JSON), `validateNewEntry` (reason 1..500, reviewer 1..80 after trim, scope pairing, control characters removed, `unignore` must name an existing un-undone `ignore`), `parseLog` (recompute ids, reject mismatches into `rejected`), `serializeLog` (stable order, non-ASCII escaped, trailing newline), `mergeLogs` (union by id), `effectiveEntries(log, runFinishedAt)` (Effective_From)
    - No I/O, no clock, no randomness
    - _Requirements: 18.3 to 18.6, 18.11, 19.1, 20.1, 20.2, 20.3, 20.4, 20.14_
  - [x] 19.2 Add `applyDispositions` to `src/core/dispositions.ts`
    - Ignore test (element/page-rule/site-rule matching; element accounting with `ignoredNodeCount` and reduced `nodeCount`; ignore beats resolve), regression test (latest applicable `resolve`, ties by id), resolved list filtering (`humanResolved`), disjoint `active`/`ignored` sets; un-ignore restores from its own time onward
    - _Requirements: 19.4, 19.5, 19.9, 19.11, 19.12, 19.13, 19.14, 19.15, 19.16, 19.17, 19.18, 19.19, 19.24_
  - [x]* 19.3 Write property tests for matcher and overlay
    - File `tests/property/dispositions-matcher.test.ts`
    - **Property 29: Matcher scope correctness**
    - **Property 30: Element-scope ignores account for nodes exactly**
    - **Property 31: Ignored Findings are excluded from every active count and nothing is lost**
    - **Validates: Requirements 19.4, 19.5, 19.6, 19.11, 19.15, 19.16, 19.17, 19.18, 20.3**
  - [x]* 19.4 Write property tests for log merge and validation
    - File `tests/property/dispositions-log.test.ts`
    - **Property 35: Log merge is a lossless, commutative, idempotent union**
    - **Property 37: Decision input validation and entry integrity**
    - **Validates: Requirements 18.3 to 18.6, 18.11, 20.1, 20.2, 20.4, 20.8, 20.14, 20.16**

- [x] 20. Disposition store and Approval_Gate integration
  - [x] 20.1 Create `src/core/disposition-store.ts`
    - `readLog` (unreadable/invalid file reports `unavailable` and is never overwritten), `writeLogAtomic` (temp file then rename) inside a read-merge-write step so concurrent CLI/GUI writes lose nothing, `artifacts/dispositions.sync.json` bookkeeping (`syncedIds`, `lastSyncedAt`)
    - _Requirements: 20.1, 20.4, 20.6, 20.14_
  - [x] 20.2 Extend `src/approval/approval-gate.ts` (decisions)
    - `disposeFinding` accepts an optional `detail` object (scope, matcher, `undoes`) copied into the audit entry; callers without `detail` behave as today; decision mapping `ignore -> dismissed`, `resolve -> accepted`, `unignore -> rejected`, `findingId = "disposition:" + id`; agent identities and empty reviewers still rejected
    - _Requirements: 18.9, 18.10, 17.11_
  - [ ]* 20.3 Write unit tests for store and gate
    - File `tests/unit/disposition-store.test.ts`: atomic write keeps previous bytes on failure, unreadable log never overwritten, concurrent writers keep both entries; gate `detail` appears in audit, gate rejection leaves log empty
    - _Requirements: 18.9, 18.10, 20.1_

- [x] 21. Guardian freeze and Publisher overlay
  - [x] 21.1 Freeze applied dispositions in `src/core/orchestrator.ts`
    - At run finalisation (after `lifecycle.json`): read `artifacts/dispositions.json` and `artifacts/dispositions.status.json` once, call `effectiveEntries(log, finishedAt)`, write `artifacts/runs/<id>/dispositions-applied.json` (`status` `applied` or `unavailable`, `logDigest` 16 hex, entries); record detection of ignored Findings in the A11y_History unchanged
    - _Requirements: 19.1, 19.2, 19.14, 20.9_
  - [x] 21.2 Apply the overlay in `src/publish/run-findings.ts` and `src/publish/published-data.ts`
    - Read each run's frozen file only (never the live log); missing file means `not-applicable`
    - Publish `findings[]` as Active_Findings only, `ignored[]` with `disposition`, `regression` info, `ignoredNodeCount`, reduced `nodeCount` and evidence built from remaining nodes, `totals.ignored`/`detected` (`all + ignored = detected`), `decisions` (`status`, `appliedCount`, `newThisRun`, `ignoredNewThisRun`, `unignoredNewThisRun`, `resolvedNewThisRun`) compared with the previous run's applied ids, `humanResolved` on resolved items
    - Pass reviewer names and reasons through `sanitizeJson`, the control-character filter, and the residual-path check (`[withheld]` with recorded reason when not confirmed clean); compute guidance, `pages/<slug>.json`, `dashboard.json runs[]` from Active_Findings only
    - _Requirements: 19.2, 19.3, 19.4, 19.5, 19.6, 19.9, 19.11, 19.12, 19.15, 19.16, 19.20, 19.22, 20.12_
  - [x]* 21.3 Write timeline property tests
    - File `tests/property/dispositions-timeline.test.ts` (generated run sequences with generated logs)
    - **Property 32: Decisions never change runs that finished before them**
    - **Property 33: Resolved then reappears is a regression**
    - **Property 34: Un-ignore restores from its own time onward**
    - **Property 36: Application of dispositions is deterministic and order independent**
    - **Property 39: Decision effect counts are exact**
    - **Validates: Requirements 10.12, 18.11, 18.12, 19.1, 19.2, 19.3, 19.9 to 19.14, 19.19, 19.20, 19.21, 19.24**
  - [ ]* 21.4 Write property test for published decision text
    - File `tests/property/dispositions-log.test.ts` (extend); reuse evidence-text generators
    - **Property 38: Published decision text is clean**
    - **Validates: Requirements 17.6, 20.12**

- [x] 22. Console core: pure API layer, central guard, adapter, and UI shell
  - [x] 22.1 Create the shared console helpers in `src/admin/`
    - `local-guard.ts`: `checkLocalRequest({ host, origin, contentType, secFetchSite }, port)` (Host `127.0.0.1:<port>` or `localhost:<port>`; Origin absent or the same loopback origin, `null` rejected; Sec-Fetch-Site not `cross-site`/`same-site`; Content-Type `application/json`) and `checkHostOnly` for read routes
    - `scrub.ts`: `scrubForDisplay` (credential URLs, token shapes, project root to `<project>`, home to `<home>`, other absolute paths removed, `redact`, control characters dropped, lines capped at 2000, 40-hex commit SHAs protected, idempotent)
    - `atomic-file.ts`: `atomicWriteText` (temp file then rename, EOL style and final newline preserved, no BOM), `resolveInside(root, ...segments)`, slug / capture id / run id patterns; `validateReviewerName` (trim, 1..80, "Reviewer name is missing")
    - Pure or port-based; no socket, no clock, no randomness
    - _Requirements: 20.10, 20.11, 22.15, 22.16, 26.11, 29.6, 30.6, 30.9_
  - [x]* 22.2 Write property test for the local guard
    - File `tests/property/admin-local-guard.test.ts`
    - **Property 41: Only same-origin loopback requests may change decisions**
    - **Validates: Requirements 20.10, 20.11**
  - [x]* 22.3 Write property test for display scrubbing
    - File `tests/property/admin-scrub.test.ts`; generators for Windows, UNC, and POSIX paths, credential URLs, token shapes, `Bearer` headers, control characters, and long lines
    - **Property 62: Anything shown from outside the console is scrubbed**
    - **Validates: Requirements 26.11, 29.6, 30.9**
  - [x] 22.4 Create the console router and ports
    - `console-deps.ts` (ports: `ProjectFs`, `GitPort`, `JobPort`, `ApprovalPort`, `Clock`, and the production `realDeps()`), `console-routes.ts` (the list of route groups; each later task adds its group here), `console-router.ts` with `createConsole(deps)`: `preflight` and `handle` (guard first for every non-GET route including unknown ones, `checkHostOnly` on every GET, then 404 / 405, per-route `maxBodyBytes` 413 on byte length, JSON parse and per-field validation, in-process `projectLock`), `RouteDef.mutating` true for every POST
    - Read routes `GET /api/status` (domain, "N of 10 used", unpublished changes, running job, last publish, latest run; fields whose providers land later are `null`) and `GET /api/domain`
    - _Requirements: 21.1, 22.2, 22.16, 23.9, 24.8, 26.6, 26.12, 27.7, 28.6, 30.5, 30.6, 30.7_
  - [x] 22.5 Extend `src/approval/approval-gate.ts` (setup actions)
    - Add `authorizeSetupAction({ reviewer, action, detail })` (runs `assertHuman`, appends `config-change-authorized`) and `approveVisualBaseline({ reviewer, slug, viewport, source, sha16 })` (appends `visual-baseline-approved` or `visual-baseline-updated` with the same keys as `scripts/approve-visual-baselines.mjs` plus `source` and `sha16`); `approveSpecification` accepts a `baselinesRoot` for staging; existing callers unaffected; the console uses `AppendOnlyLog` only, never `TelemetryEmitter`
    - _Requirements: 21.5, 22.12, 24.4, 24.7, 25.4_
  - [x] 22.6 Turn `src/admin/admin-server.ts` into the thin HTTP adapter
    - Build a `ConsoleRequest`, call `preflight`, stream the body with the route ceiling (stop reading and close on overflow), call `handle`, write the response with `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and the CSP (`frame-ancestors 'none'`) on HTML; serve `admin-ui/` assets from a fixed whitelist (including `/assets/sections/<name>.js` for known section names); `listen(port, "127.0.0.1")` only; no `Access-Control-*` headers
    - The existing `POST /api/open/*` routes move into the route table and take the central guard; existing loopback bind unchanged
    - _Requirements: 20.10, 20.11, 30.5, 30.6, 30.7_
  - [x] 22.7 Create the console UI shell in `admin-ui/`
    - `index.html`, `console.css`, `console.js` (skip link, labelled `nav` with in-page links, section loader that lazy-imports `sections/<name>.js` for a fixed list and shows a visible error panel when a section is missing, `role="status"` region throttled to every 5 seconds apart from start and end, `role="alert"` region), `lib/shell.js` (`usedText`, `stepLabel`), and the Overview section (domain, "N of 10 used", unpublished badge, running job, last published commit, latest run, the sentence "This console has no AI. Every action is a button.")
    - `textContent` only; visible focus rings, targets of at least 24 by 24 CSS pixels, `prefers-reduced-motion` respected, no information by colour alone
    - _Requirements: 21.1, 22.2, 26.6, 30.4_
  - [x]* 22.8 Write property test for oversized bodies
    - File `tests/property/admin-body-limit.test.ts` (router with spies on the filesystem, git, job, approval, and setup log ports; multi-byte bodies)
    - **Property 61: Oversized bodies are rejected without side effects**
    - **Validates: Requirements 30.7**

- [x] 23. Setup_Activity_Log
  - [x] 23.1 Create `src/admin/setup-log.ts` and the `GET /api/setup-log` route
    - Append-only JSONL at `artifacts/admin/setup-activity.jsonl` (timestamp, Reviewer name, action, counts), every non-ASCII character escaped, reader returns newest first with `limit` and `before`, no edit / truncate / delete operation exposed; never written under `artifacts/runs/`, never through `TelemetryEmitter`; register the route group in `console-routes.ts`
    - _Requirements: 25.1, 25.2, 25.4, 25.7, 25.8_
  - [ ]* 23.2 Write property test for the setup log
    - File `tests/property/setup-log.test.ts`; strings with surrogate pairs, control characters, quotes, and newlines
    - **Property 52: The setup log is append-only, ASCII-only, and round-trips**
    - **Validates: Requirements 25.1, 25.2, 25.7, 25.8**
  - [x] 23.3 Create `admin-ui/sections/setup-activity.js`
    - Setup activity table (caption, `th scope`), newest first, "Show earlier entries"; plain text only
    - _Requirements: 25.1, 25.2_

- [x] 24. Dispositions API, Admin console section, and CLI parity
  - [x] 24.1 Create `src/admin/dispositions-api.ts` (testable without sockets) and register its routes
    - `listFindings(run)` (uses `loadRawRunInputs` + `buildRunFindings`; up to 50 sanitized node targets; per-scope match counts; run-relative paths only), `listDispositions()` (derived `undone`, `syncState`), `createDisposition(input)` (order: validate, `ApprovalGate.disposeFinding`, append to local log; server sets `at` and id; 201 / 200 duplicate / 400 per-field errors / 403 gate rejection / 409 / 500 with an audit line); body limit 8 KB
    - Routes `GET /api/findings`, `GET /api/dispositions`, `POST /api/dispositions` in the route table (central guard applies; no per-route guard code)
    - _Requirements: 18.1, 18.3 to 18.11, 18.13, 18.15, 20.11_
  - [x] 24.2 Create `admin-ui/sections/findings.js` ("Findings and decisions")
    - Findings panel with "Mark resolved" and "Ignore" per Active_Finding and "Un-ignore" per Ignored_Finding; native `<dialog>` form with scope radio group, live "matches N findings" text, required Reason (max 500) and Reviewer (max 80, remembered in `localStorage`), the notice "Reason and reviewer name are published on the public Dashboard", and "Takes effect from the next run. Earlier runs keep their original counts."; Decisions panel lists every entry (including undone) with scope, reason, reviewer, date, and sync state; `textContent` only; keyboard operable; focus returns to the trigger
    - _Requirements: 18.1, 18.3, 18.4, 18.8, 18.12, 18.13, 20.13_
  - [x] 24.3 CLI parity: extend `approve` in `src/index.ts`
    - Add `--decision ignore|resolve|unignore`, `--scope element|page-rule|site-rule`, `--page`, `--viewport`, `--rule`, `--target`, `--undoes` alongside existing `--reviewer` and `--reason`; build the same input and call the same `dispositions-api` function; print the entry id; existing `accepted|rejected|dismissed` usage for specification drafts unchanged
    - _Requirements: 18.14_
  - [ ]* 24.4 Write unit tests for the dispositions API and section
    - File `tests/unit/admin-dispositions-api.test.ts` (temp dir, fake gate): 201 flow writes one audit entry and one log entry, gate rejection leaves the log empty, duplicate is idempotent, blocked requests 403 through the router, section source contains the publication notice and "takes effect from the next run" text
    - _Requirements: 18.9, 18.10, 18.12, 20.11, 20.13_

- [x] 25. Synchronisation of decisions to `runs-data`
  - [x] 25.1 Create `src/admin/disposition-sync.ts`
    - Push path: `git fetch origin runs-data`, temporary detached worktree in the OS temp dir (Reviewer's branch, index, and working tree untouched), union with the remote file via `mergeLogs`, additive commit `dispositions: add N entries`, `git push origin HEAD:refs/heads/runs-data` without force; on non-fast-forward refetch and recreate from the union (max 3 attempts, no rebase); always remove the worktree; on failure keep local log and report "Not yet synced" with a reason (scrubbed)
    - `pullDispositions` merges the remote log into the local log as a union
    - _Requirements: 20.4, 20.5, 20.6, 20.8_
  - [x] 25.2 Register the sync routes and show the state in the Findings section
    - `POST /api/dispositions/sync` (202, 409 if running), `GET /api/dispositions/sync/status`; `POST /api/sync` ("Pull runs from GitHub", guarded) also runs `pullDispositions` after `cloudSync`; Decisions panel in `admin-ui/sections/findings.js` shows "Synced" / "Not yet synced" with "Sync now" / "Retry"
    - _Requirements: 18.13, 20.5, 20.6, 30.1_
  - [ ]* 25.3 Write sync integration tests
    - File `tests/unit/disposition-sync.test.ts` (local bare git repos in a temp dir): additive commit on the `runs-data` tip, competing commit leads to refetch + union + second push with no `--force` argument (spy on the git runner), offline remote yields "Not yet synced" and keeps the local log, Reviewer's branch/index/working tree unchanged, temporary worktree removed
    - _Requirements: 20.5, 20.6_

- [x] 26. CI: restore dispositions and protect the log
  - [x] 26.1 Edit `.github/workflows/guardian.yml` (restore step and push retry)
    - "Restore dispositions" step immediately before "Run Guardian" (fetch, `git show` of `artifacts/dispositions.json`, validate `schemaVersion` 1 with a `node -e` one-liner, write `artifacts/dispositions.status.json` as `restored|first-run|unavailable`; an invalid file is removed from the workspace only)
    - commit-runs-data: never stage `artifacts/dispositions.json`; push retry becomes push, on rejection `git fetch`, `git merge --no-edit FETCH_HEAD`, push again, max 3 attempts; no force, no rebase
    - _Requirements: 20.7, 20.8, 20.9_
  - [ ]* 26.2 Extend workflow smoke test
    - File `tests/unit/guardian-workflow.test.ts` (extend): "Restore dispositions" precedes "Run Guardian", no `git add` line names `dispositions`, push retry uses `git merge` and never `--force`, `-f`, `--force-with-lease`, or `rebase`
    - _Requirements: 20.7, 20.8_

- [x] 27. Approved URLs: view, add, edit, remove, Update project
  - [x] 27.1 Create `src/admin/workspace.ts`, `host-validate.ts`, and `url-set.ts` (pure)
    - `Workspace` roots (`project` or `draft`) so the same URL, discovery, and baseline code serves the console and the wizard; `validateNewHost` (syntax only: lower-cased ASCII host, `baseUrl` `https://<host>`, slug; rejects IP literals, `localhost`, reserved local suffixes, non-https scheme, user info, port, path, malformed labels; independent of any allow-list)
    - `normaliseApprovedUrl` (in-domain, normalised), `projectUrls`, `applyUrlOps`; slug collision rejected with the colliding URL named; ordered set, add is idempotent, new URLs append; fixed maximum `Math.min(seed.maxUrls, cfg.limits.pages)` (10 today) with `"N of M used"` text; edit = remove + add as one unit flagged `requiresReapproval`
    - _Requirements: 21.4, 21.5, 22.2 to 22.6, 22.10, 22.11, 22.17, 22.19_
  - [ ]* 27.2 Write property test for Approved_URL sets
    - File `tests/property/url-set.test.ts`; arbitrary URL strings and operation sequences
    - **Property 42: Approved URL sets are idempotent, in-domain, and bounded**
    - **Validates: Requirements 22.2, 22.3, 22.4, 22.5, 22.6, 22.13, 22.17, 22.19**
  - [ ]* 27.3 Write property test for host validation
    - File `tests/property/host-validate.test.ts`
    - **Property 45: Host validation is syntactic, total, and independent of any allow-list**
    - **Validates: Requirements 21.4, 21.5**
  - [x] 27.4 Create `src/admin/urls-api.ts` and register its routes
    - `GET /api/urls`, `POST /api/urls/add|remove|edit` (stage in the pending file for `current`, write to the draft for `draft`), `GET /api/project/pending`, `POST /api/project/update` ("Update project": apply staged operations to the seed only, preserving `maxUrls`, unknown fields, remaining order, and EOL style; no git write); Reviewer name required for remove / edit / Update project via the Approval_Gate; setup log entries with Reviewer name and counts; no route accepts a new maximum; remove keeps baseline files and run history; if an approved-scope file exists, URL edits are disabled with an explanation
    - _Requirements: 22.1 to 22.18, 25.1, 26.2_
  - [x] 27.5 Create `admin-ui/sections/urls.js` ("Approved URLs")
    - Table with caption (URL, readiness, pending badge, Remove, Edit), add box, "Update project" button with the line "Update project saves your changes on this computer only", staged-changes list, scope-file notice, error text in a `role="alert"` region
    - _Requirements: 22.1, 22.2, 22.3, 22.4, 22.7, 22.10, 22.18_
  - [ ]* 27.6 Write property test for remove and edit
    - File `tests/property/url-baselines.test.ts` (temp project trees)
    - **Property 43: Remove and edit keep baselines and history, and edit requires re-approval**
    - **Validates: Requirements 22.8, 22.9, 22.10, 22.11**
  - [ ]* 27.7 Write property test for Update project
    - File `tests/property/update-project.test.ts`; seeds with arbitrary extra fields, LF and CRLF; git port spy
    - **Property 44: Update project writes only local files and changes the seed minimally**
    - **Validates: Requirements 22.15, 22.18, 26.2**

- [x] 28. Domain-driven discovery and local discovery runner
  - [x] 28.1 Make discovery domain-driven
    - Move the ten assurity.nz probe paths from `scripts/discover-candidates.mjs` into `config/domains/assurity-nz.json` unchanged; the script reads probe paths for the configured domain (workspace and output path from environment, same defaults as today) and a domain without a probe list probes `/` only
    - _Requirements: 23.1, 23.2, 23.10_
  - [ ]* 28.2 Write unit tests for domain-driven discovery
    - File `tests/unit/discovery-domain.test.ts`: assurity.nz probe list is unchanged, a new domain probes `/` only, output path comes from the environment, no probe path remains hard-coded in the script
    - _Requirements: 23.2, 23.10_
  - [x] 28.3 Create `src/admin/job-runner.ts`
    - Single-flight `JobPort` over `spawn` with argument arrays and `shell: false`, fixed script whitelist, timeout kill with state `timed-out`, `busy` refusal without spawning, sanitised output tail (at most 200 lines or 64 KB, passed through `scrubForDisplay`), progress for `GET /api/jobs/status`
    - _Requirements: 23.2, 23.8, 24.1_
  - [ ]* 28.4 Write property test for the job runner
    - File `tests/property/job-runner.test.ts` (fake spawner: success, failure, hang)
    - **Property 50: The job runner is single-flight, time-bounded, and its output is sanitised**
    - **Validates: Requirements 23.2, 23.8, 24.1**
  - [x] 28.5 Create `src/admin/discovery-api.ts` and register its routes
    - `POST /api/discovery/run` (starts the local Discovery_Crawler job against the Guarded_Domain, no GitHub), `GET /api/jobs/status`, `GET /api/discovery/candidates` (each marked already approved or not yet approved), `POST /api/discovery/approve` (each selected URL must be in the validated candidates file, approvable, pass normalisation, collision, and cap checks; any failure rejects the whole request with per-URL reasons; one setup log entry with Reviewer name, discovered count, approved count); running discovery alone never changes the seed, pending file, or draft; a failed or empty crawl leaves the set unchanged
    - _Requirements: 23.1 to 23.10, 25.1_
  - [ ]* 28.6 Write property test for candidate approval
    - File `tests/property/discovery-approve.test.ts`; candidate files with other domains, non-success statuses, duplicates, and out-of-domain entries
    - **Property 49: Candidate pages enter the approved set only by explicit approval**
    - **Validates: Requirements 23.4, 23.5, 23.6, 23.7, 23.8**
  - [x] 28.7 Create `admin-ui/sections/discovery.js` ("Discovery")
    - "Find pages" button, progress in the status region, candidate table with checkboxes (already approved shown as text, not colour only), "Approve selected", outcome text for failed or empty crawls
    - _Requirements: 23.1, 23.2, 23.4, 23.5, 23.8_

- [x] 29. Local visual capture, baseline production, and baseline approval
  - [x] 29.1 Create `src/agents/screenshot.ts` and use it in `src/core/orchestrator.ts`
    - `takeScreenshot(page, path)` holds the one screenshot call (same options as today); the orchestrator calls it with no change in behaviour; existing tests stay green
    - _Requirements: 24.1, 17.2_
  - [x] 29.2 Create the standalone local capture step (`scripts/capture-baselines.mjs`)
    - Reuses `takeScreenshot` and the same viewports; fetches only Approved_URLs of the Guarded_Domain through the same SiteGateway checks as the Guardian; writes proposals under `artifacts/admin/captures/<captureId>/` (or the draft staging folder) with a manifest (`slug`, `viewport`, `sha16`, size, capture time); never writes under `artifacts/runs/`, `baselines-visual/`, or any run record; a capture is not a monitoring run
    - _Requirements: 24.1, 24.2, 24.7, 25.5_
  - [x] 29.3 Make `scripts/make-all-drafts.mjs` domain-driven and environment-configurable
    - Same default behaviour for the current domain; seed, output root, and domain from the workspace; drafts written as proposals only
    - _Requirements: 24.1, 24.2_
  - [x] 29.4 Create `src/admin/baselines-api.ts` and register its routes
    - `GET /api/baselines` (per-URL readiness: Spec_Baseline, Visual_Baseline per viewport, proposals present, total size of `baselines-visual/`), `POST /api/baselines/spec/draft` and `/visual/capture` (start jobs), `GET /api/baselines/proposals`, `GET /api/baselines/image` (ids validated against manifests, PNG bytes), `POST /api/baselines/approve`
    - Approval: Reviewer name required, Approval_Gate (`approveVisualBaseline` / `approveSpecification`), atomic promotion into `baselines-visual/<slug>/<viewport>.png` and `baselines/<slug>/baseline.v{N}.md`, unchanged bytes skipped, item refused when its file no longer matches `sha16`, audit entry per promoted item only after the rename succeeds, one setup log entry with Reviewer name, page count, and viewport count; no baseline is approved except by explicit human approval
    - _Requirements: 24.1 to 24.8, 25.1_
  - [ ]* 29.5 Write property test for baseline promotion
    - File `tests/property/baseline-promotion.test.ts`; manifests and selections; example test for the audit entry shape against `scripts/approve-visual-baselines.mjs`
    - **Property 51: Baseline promotion is idempotent and audited like the existing script**
    - **Validates: Requirements 24.2, 24.3, 24.4, 24.6, 24.7**
  - [x] 29.6 Create `admin-ui/sections/baselines.js` ("Baselines")
    - Per-URL readiness table, "Write specification drafts", "Capture screenshots on this computer", proposal review (draft text, side-by-side images with alt text), Reviewer name field, "Approve selected", size of the pending change and of `baselines-visual/`
    - _Requirements: 24.1, 24.2, 24.3, 24.4, 24.5_

- [x] 30. Config_Publish through git plumbing
  - [x] 30.1 Create `src/admin/publish-paths.ts` and `publish-delta.ts` (pure)
    - `CONFIG_PATHSPECS` (domain and app configuration, `config/page-seed.json`, `config/domains/**`, `baselines/**`, `baselines-visual/**`, `.github/workflows/guardian.yml`; nothing under `artifacts/`), `isConfigPath` (rejects `..`, absolute paths, backslashes), `computeDelta(local, remote)` by blob id, `canPublish` (`nothing-to-publish` when empty)
    - _Requirements: 26.3, 26.4, 26.5, 26.6, 25.6_
  - [x]* 30.2 Write property test for the publish selection
    - File `tests/property/publish-delta.test.ts`; generated tracked, untracked, staged, modified, deleted, ignored, and non-configuration files
    - **Property 54: Publish stages exactly the configuration delta and nothing else**
    - **Validates: Requirements 26.3, 26.4, 26.11**
  - [x]* 30.3 Write property test for the empty delta
    - File `tests/property/publish-empty.test.ts` (git port spy)
    - **Property 55: An empty delta disables publishing and creates no commit**
    - **Validates: Requirements 26.5, 26.6, 27.3, 30.4**
  - [ ]* 30.4 Write canary and source-scan test for setup activity
    - File `tests/property/setup-activity-isolation.test.ts`: canary in the setup log, audit log, draft, and manifests; `buildPublishedData` and replay inputs over a tree containing `artifacts/admin/`; source scan of `src/publish/`, `src/reporting/`, `src/core/`, `scripts/build-office-replay.mjs`, `virtual-office/src/`, and `dashboard/` for `setup-activity`, `artifacts/admin`, `SetupEntry`; no console route writes inside `artifacts/runs/`; `CONFIG_PATHSPECS` has no `artifacts` entry
    - **Property 53: Setup activity never reaches published data**
    - **Validates: Requirements 25.3, 25.4, 25.5, 25.6**
  - [x] 30.5 Create `src/admin/git-port.ts` and `git-feedback.ts`
    - `GitPort` over `execFile` with argument arrays and `shell: false`; whitelisted subcommands; rejects `--force`, `-f`, `--force-with-lease`, `+` refspecs, `rebase`, `merge`, `pull`, `checkout`, `stash`, `reset --hard`; commit message on stdin; Git_Feedback records (operation, success or failure, branch, remote, files, SHA, timestamp) passed through `scrubForDisplay`
    - _Requirements: 26.4, 26.10, 26.11, 30.1, 30.2, 30.8, 30.9_
  - [x] 30.6 Create `src/admin/publish-api.ts` and register its routes
    - `GET /api/publish/status` (delta, sizes, `canPublish`, reason), `POST /api/publish` (`purpose` `publish` or `trigger`): Reviewer name and Approval_Gate, fetch `origin/main`, build one commit from the remote tree plus the configuration delta (`hash-object`, temporary index, `commit-tree`, additive push to `main`), retry once when the remote advanced on a non-configuration path, stop with files listed when it advanced on a configuration path, keep the commit at `refs/awg/last-publish-attempt` when the push fails (retry control), realign the local branch only when provably safe; response and `GET /api/git/feedback` carry the 40-character SHA and push timestamp; 409 when the delta is empty; setup log entry with Reviewer name and summary
    - Trigger a run is this same action; the console states that a run starts only when real changes are published and that a stored token is not used; it creates no run record or status
    - _Requirements: 26.3 to 26.10, 26.12, 27.2 to 27.7, 30.1 to 30.4, 25.1_
  - [ ]* 30.7 Write integration tests for publishing
    - File `tests/unit/publish-git.test.ts` (temporary bare remote and clone): one new commit with the previous tip as only parent, tree differs only in configuration paths, branch / index / unrelated edits unchanged, SHA and timestamp match, second attempt after a non-configuration advance with no merge, rebase, or force argument, stop on a configuration advance, failed push retry succeeds, recorded git invocations never contain forbidden arguments
    - **Property 56: Publishing is additive and reports honestly**
    - **Validates: Requirements 26.4, 26.7, 26.9, 26.10, 30.2, 30.3, 30.8**
  - [x] 30.8 Create `admin-ui/sections/publish.js` ("Publish")
    - Delta list with sizes, the notice "Your name appears in the commit message on GitHub, which is public", "Publish to GitHub" and "Publish and start a run" (disabled with the reason when nothing to publish), the sentence about why no run starts without a change, Git_Feedback_View (plain text), retry control, unpublished-changes badge; copy "Publish to GitHub sends the configuration files to GitHub so the daily run uses them"
    - _Requirements: 26.1, 26.5, 26.6, 26.7, 26.9, 26.10, 27.3, 27.4, 27.5, 30.3, 30.4_

- [x] 31. Workflow push trigger and run-source markers
  - [x] 31.1 Edit `.github/workflows/guardian.yml` (additive; keep pinned SHAs and per-job permissions)
    - Add `push` to `on:` for branch `main` only with exactly the paths `config/**`, `!config/schedule.json`, `baselines/**`, `baselines-visual/**`, `.github/workflows/guardian.yml`; no `runs-data` under any trigger, no `pull_request_target`, no wildcard branch, no `workflow_run`
    - Add run-source markers to the run job (the GitHub-controlled `GITHUB_RUN_ID`, `GITHUB_SHA`, and `GITHUB_EVENT_NAME`) so the console can map a publish to a cloud run; keep or add `concurrency` so a push-triggered run cannot overlap a scheduled one; `AWG_RUN_TRIGGER` keeps its meaning for the push event
    - _Requirements: 27.1, 27.2, 27.6, 29.1_
  - [ ]* 31.2 Write workflow text test for the push trigger
    - File `tests/unit/guardian-workflow.test.ts` (extend) plus a hand-written glob matcher helper in the test: every `CONFIG_PATHSPECS` sample matches the push patterns, samples under `src/`, `dashboard/`, `.kiro/`, `tests/`, and `artifacts/` do not
    - **Property 59: The push trigger cannot loop and covers every publish path**
    - **Validates: Requirements 27.1, 27.2, 27.4, 27.6**

- [x] 32. Schedule: cron validation, workflow edit, and Schedule section
  - [x] 32.1 Create `src/admin/cron.ts` (pure, hand-written)
    - `parseCron` (five fields; ranges, lists, steps; rejects wrong field count, out-of-range values, descending ranges, zero steps, unsupported symbols, macros, and any gap under 5 minutes, always with a reason), `formatCron`, `describeCron` (plain ASCII English), `minGapMinutes`
    - _Requirements: 28.2_
  - [ ]* 32.2 Write property test for cron validation
    - File `tests/property/cron.test.ts`; generated five-field ASTs and arbitrary strings
    - **Property 57: Cron validation round-trips and always explains rejections**
    - **Validates: Requirements 28.2**
  - [x] 32.3 Create `src/admin/workflow-schedule.ts`
    - `readSchedule` and `editSchedule` over the text of `.github/workflows/guardian.yml`: change only the characters of the one cron value, preserve quote style, indentation, comments, EOL style, final newline, pinned SHAs, `permissions:`, and `concurrency:`; refuse when there are zero or several cron entries; atomic write
    - _Requirements: 28.1, 28.3, 28.5_
  - [ ]* 32.4 Write property test for the schedule edit
    - File `tests/property/workflow-schedule.test.ts`; generated workflow text with LF and CRLF
    - **Property 58: A schedule edit changes one value and nothing else**
    - **Validates: Requirements 28.3, 28.4, 28.5**
  - [x] 32.5 Create `src/admin/schedule-api.ts` and register its routes
    - `GET /api/schedule` (`cron`, summary, value on GitHub), `POST /api/schedule { cron, reviewer, publish }`: reviewer check, `parseCron` and the 5-minute rule (400 with the reason, nothing recorded), Approval_Gate, atomic edit of the working-tree workflow file, setup log entry `schedule-changed` with the new value; when `publish` is true run Config_Publish after the confirmation listing every changed configuration file; no separate local schedule
    - _Requirements: 28.1 to 28.7, 25.1_
  - [x] 32.6 Create `admin-ui/sections/schedule.js` ("Schedule")
    - Current cron, plain-English summary, facts as plain text (cron is UTC; a new schedule takes effect when the workflow reaches `main`; GitHub may pause scheduled workflows after about 60 days without repository activity), edit form with label, "On GitHub" value, publish confirmation `<dialog>`
    - _Requirements: 28.1, 28.2, 28.3, 28.4_
  - [ ]* 32.7 Write property test for reviewer checks across approval routes
    - File `tests/property/reviewer-required.test.ts` (router with fake ports; staged URL changes, Update project, candidate approval, baseline approval, domain confirm, schedule edit, publish)
    - **Property 48: Every approval needs a human reviewer name**
    - **Validates: Requirements 21.5, 22.12, 22.13, 23.7, 24.4, 24.5, 24.7, 28.4**

- [x] 33. Run details and logs
  - [x] 33.1 Write the run-source marker in `src/core/orchestrator.ts`
    - Persist `artifacts/runs/<id>/run-source.json` (trigger, and the GitHub-controlled run id, commit SHA, and event name when present) next to the existing markers; additive; absent outside CI
    - _Requirements: 29.1_
  - [x] 33.2 Create `src/admin/runs-api.ts` and register its routes
    - `GET /api/runs` (Run_ID, date, trigger, origin), `GET /api/runs/:id` (details from `run.json`, `results.json`, `findings.json`, `run-source.json`; a missing or corrupt source is reported while other sections still return `ok: true`), `GET /api/runs/:id/log?file=events|audit&before=<byteOffset>` (run id `^run_[a-z0-9]{6,40}$`, two-name whitelist, resolved path inside `artifacts/runs/<id>/`, at most 128 KB, partial first line dropped, `totalBytes` / `startOffset` / `truncated`, each line through `scrubForDisplay` and capped at 2000 characters); the Actions run page is shown as plain text when mapped
    - _Requirements: 29.1 to 29.6_
  - [ ]* 33.3 Write property test for the run viewer
    - File `tests/property/runs-api.test.ts`; traversal, absolute, and encoded ids / file names; log files of any size; runs with one source missing
    - **Property 63: The run viewer stays inside the runs folder, is bounded, and isolates failures**
    - **Validates: Requirements 29.1, 29.2, 29.4, 29.5, 29.6**
  - [x] 33.4 Create `admin-ui/sections/runs.js` ("Runs and logs")
    - Run table (latest first, any earlier run selectable), details, log viewer in a labelled `<pre>` with "Showing the last N lines of M. Show earlier lines.", "Pull runs from GitHub", per-source error text keeping the rest usable; `textContent` only
    - _Requirements: 29.1, 29.2, 29.3, 29.4, 29.5_

- [x] 34. New-domain wizard
  - [x] 34.1 Create `src/admin/domain-setup-api.ts` (draft part) and register its routes
    - `GET /api/domain/draft`, `POST /api/domain/draft` (host through `validateNewHost`; refuse a host that resolves to a private address; draft created under `artifacts/admin/new-domain/`, project files untouched), `POST /api/domain/draft/cancel` (removes the draft file and staging folder), discard of drafts untouched for 7 days at console start (setup log entry `domain-draft-discarded`); the wizard steps (enter domain, build Approved_URL list, produce baselines, confirm and publish) reuse the URL, discovery, and baseline APIs through `Workspace` scope `draft` with the Approval_Gate pointed at the staging `baselinesRoot`; no free-text domain change outside the wizard
    - _Requirements: 21.2, 21.3, 21.4, 21.7, 21.8, 21.9, 21.11, 21.12_
  - [x] 34.2 Add the confirm transaction to `src/admin/domain-setup-api.ts`
    - `POST /api/domain/confirm`: require at least one in-domain URL within the maximum, every URL with an approved Spec_Baseline and Visual_Baseline, and a typed host that matches; list active `site-rule` Dispositions; `authorizeSetupAction` before the first write; back up `config/app.config.json` and `config/page-seed.json`; apply in order (promote staged baselines as new files only, write `config/domains/<slug>.json` if absent, write the seed with `maxUrls` preserved, write `config/app.config.json` last with `approvedDomain`, `baseUrl`, `domain`, `limits` preserved); on any error restore the backups, delete created paths, keep the draft, return a scrubbed 500; on success delete the draft, append `domain-changed` naming previous and new domain, and optionally run Config_Publish (a publish failure does not undo the local change); no validation against an existing allow-list
    - _Requirements: 21.5, 21.6, 21.7, 21.10, 21.12, 25.1_
  - [x]* 34.3 Write property test for draft isolation
    - File `tests/property/domain-draft.test.ts`; sequences of wizard actions without a successful confirm
    - **Property 46: A new-domain draft changes nothing until it is confirmed**
    - **Validates: Requirements 21.2, 21.3, 21.7, 21.8, 21.9, 21.11**
  - [ ]* 34.4 Write fault-injection test for confirm
    - File `tests/property/domain-confirm.test.ts` (failure injected after each step of the transaction)
    - **Property 47: Confirm is atomic and leaves a consistent configuration**
    - **Validates: Requirements 21.5, 21.6, 21.10, 21.12**
  - [x] 34.5 Create `admin-ui/sections/domain.js` ("Domain")
    - Current domain, "Change domain" opens the four-step wizard (ordered list with `aria-current="step"`), validation errors in a `role="alert"` region with focus on the field, confirm screen listing files changed and active site-wide ignores, cancel; no free-text domain control outside the wizard
    - _Requirements: 21.1, 21.2, 21.3, 21.4, 21.8, 21.9_

- [x] 35. Published `domain` field, "Different site" label, and trend break
  - [x] 35.1 Add the optional `domain` field in `src/publish/published-data.ts` and fix the domain label source
    - Derived domain of a run: recorded domain when present, else the single host shared by all its page URLs, else absent; additive optional `domain` in `index.json` and `dashboard.json runs[]`; `schemaVersion` unchanged; no existing field changes; the Publisher domain label comes from the run data instead of the fixed value; A11y_History and Disposition_Log entries untouched
    - _Requirements: 21.6, 29.1_
  - [x] 35.2 Show "Different site" and break the trend in the Dashboard
    - New pure helper `dashboard/lib/domain.js` (`isDifferentSite(run, latest)`, `trendGaps`); label in the run selector, run table, Run_View heading, and Overview notice; `dashboard/views/charts.js` breaks the trend line between adjacent runs of different known domains with a visible note; runs with unknown domain are unlabelled; Dashboard stays read-only
    - Files: `dashboard/views/common.js`, `overview.js`, `run-view.js`, `charts.js`
    - _Requirements: 21.6, 29.1_
  - [ ]* 35.3 Write property test for domain labelling
    - File `tests/property/domain-label.test.ts` (TypeScript derivation and `dashboard/lib/domain.js` cross-check)
    - **Property 64: Runs from a different domain are labelled and never rewritten**
    - **Validates: Requirements 21.6, 29.1**

- [x] 36. Dashboard: Ignored list, regressions, and trend annotations
  - [x] 36.1 Update `dashboard/views/overview.js`, `filtered-findings.js`, `finding-detail.js`, `page-detail.js`, `dashboard/lib/captions.js`
    - "Ignored" KPI card (separate from the Active total) linking to `#/findings?run=<id>&scope=ignored`; Ignored list grouped by decision (scope in words, reason, "Ignored by <reviewer> on <date>", decision id, covered Findings with links, number of pages for site-wide groups); "Ignored" filter with default scope excluding ignored
    - Finding_Detail_View: ignored banner, "N elements ignored", Regression block prefixed "Regression:" with a symbol and the label "Reappeared after being marked resolved on <date> by <reviewer>" plus the original reason; resolved items show "Marked resolved by <reviewer> on <date>"; page rows show "(+N ignored)" text outside any count; footer sentence that ignored issues are listed on the Ignored page and reasons/reviewers are published as entered
    - Dashboard stays read-only: no link, form, or call to the Admin console, `/api/dispositions`, or issue creation
    - _Requirements: 14.8, 17.7, 18.2, 19.4, 19.7, 19.8, 19.10, 19.11, 19.23_
  - [x] 36.2 Update `dashboard/views/charts.js`, `dashboard/views/run-view.js`, `dashboard/lib/findings.js`
    - Trend chart: larger triangle point style, tooltip, run-table cell, and a visible line under the chart using `decisionEffectText(decisions)` (for example "12 issues ignored from this run"); `decisions.status === "unavailable"` shows "Decisions could not be loaded for this run; counts may include issues that were ignored"; run table lists the Ignored count; keep the "Different site" label and trend break from task 35.2
    - _Requirements: 10.12, 19.21, 19.22_
  - [ ]* 36.3 Extend dashboard view-model and source-scan tests
    - Files `tests/unit/dashboard-viewmodels.test.ts` and `tests/unit/dashboard-source-scan.test.ts` (extend): Ignored list grouping and wording, regression label text, trend effect text, decisions-unavailable notice, retention message, legacy run without `ignored`/`decisions`; Dashboard text helpers return plain strings for reviewer and reason text; `decisionEffectText` returns the exact counts it is given; `dashboard/**` has no reference to `/api/dispositions`, `127.0.0.1:7787`, `method: "POST"`/`PUT`/`DELETE`, `<form`, or `issues/new`
    - _Requirements: 10.12, 17.7, 18.2, 19.7, 19.10, 19.21, 19.22, 20.12_

- [x] 37. Optional "use the cloud run's screenshots" baseline action
  - [x] 37.1 Add `POST /api/baselines/adopt-cloud` to `src/admin/baselines-api.ts` and the control to `admin-ui/sections/baselines.js`
    - Lists screenshots from a synced cloud run (run id validated, files read only from `artifacts/runs/<id>/`), proposes them as baselines with `source` `cloud-run:<id>` and their `sha16`, and approves only the selected items through the same Reviewer name, Approval_Gate, atomic promotion, audit, and setup log path as local approval; works for pages that already have a baseline; button "Use the cloud run's screenshots" disabled with the reason until a cloud run has been pulled
    - _Requirements: 24.1, 24.2, 24.3, 24.4, 24.6, 24.7_
  - [ ]* 37.2 Write unit tests for adopting cloud screenshots
    - File `tests/unit/baselines-adopt-cloud.test.ts`: unknown run id rejected, traversal rejected, unchanged bytes skipped, audit `source` recorded, empty Reviewer name rejected with nothing written
    - _Requirements: 24.3, 24.4, 24.5, 24.7_

- [x] 38. Retire old stubs and finish console hardening
  - [x] 38.1 Retire the old controls in the route table
    - `POST /api/run` returns 410 `{ "error": "retired", "use": "POST /api/publish" }` after the guard and never spawns a process; the old schedule body (`enabled`, `intervalHours`, `dailyAt`) is rejected with 400 and writes nothing; `config/schedule.json` and `src/admin/schedule.ts` stay for CLI users but are no longer exposed; remove every inline placeholder ("wired up in a later step") from the UI; no route handler references `run-scheduled`, `schedule.json`, or `schtasks`
    - _Requirements: 26.1, 27.6, 28.5_
  - [ ]* 38.2 Write example tests for retired controls
    - File `tests/unit/admin-retired.test.ts` (router with spies on the job and filesystem ports; source scan of `src/admin/` and `admin-ui/`)
    - **Property 65: Retired and replaced controls do nothing**
    - **Validates: Requirements 26.1, 27.6, 28.5**
  - [x]* 38.3 Write property test for the guard over the route table
    - File `tests/property/admin-route-guard.test.ts`; generated headers and bodies over every route of the final table (retired and Section I routes included); source scan forbids `0.0.0.0`, `::`, and a `listen` call without a host
    - **Property 60: The local-request guard covers every state-changing route**
    - **Validates: Requirements 22.16, 23.9, 24.8, 26.12, 27.7, 28.6, 30.5, 30.6**
  - [ ]* 38.4 Write console UI view-model and source-scan tests
    - Files `tests/unit/admin-ui-viewmodels.test.ts` (`usedText`, `stepLabel`, delta and job text helpers) and `tests/unit/admin-ui-source-scan.test.ts` (no `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, `new Function` under `admin-ui/`; every input has a label; tables have captions; all `admin-ui/` and new `src/admin/` files are ASCII-only; no large-language-model wording; no stored token or PAT handling)
    - _Requirements: 21.12, 23.10, 24.7, 26.13, 28.7, 30.8, 30.10_

- [x] 39. Phase 2 checkpoint - Admin console
  - Run `npm run build` (tsc, no errors) and the full `npm test` (vitest run from the repo root); confirm Phase 1 tests and pre-existing tests still pass
  - Run `node --check` on every `dashboard/**/*.js` and `admin-ui/**/*.js` file (excluding `dashboard/vendor/`)
  - Build the local preview the same way CI does (`node dist/publish/build-published-data.js ./_site`, copy `dashboard/.` into `./_site/`, serve `./_site`); with a sample local dispositions log containing one ignore, one resolve, and one un-ignore, confirm the Ignored list, regression label, and trend annotation render, that runs finished before each decision keep their counts, and that a run from another domain shows "Different site" with a trend break
  - Start the console locally and confirm that a cross-origin or wrong-Host POST returns 403, a GET with a wrong Host returns 403, `POST /api/run` returns 410, and Publish is disabled when there is nothing to publish; run Publish, Sync now, and the wizard only against a scratch remote, never the real `main` or `runs-data` without the user's go-ahead
  - Ensure all tests pass, ask the user if questions arise. The Virtual Office remains out of scope and is not started here.

- [x] 40. Console polish after first browser review
  - [x] 40.1 Restyle `admin-ui/console.css` and shell to match the Dashboard theme
    - Read `dashboard/style.css` and reuse its design language (colour tokens, fonts, header, nav, card, button, table, and badge styles) so the console looks like the same product: same palette and typography, a styled header showing the product name, card-style panels, consistent buttons and tables, and a responsive layout
    - Status badges always carry text and never rely on colour alone
    - Keep every accessibility property: visible 3px focus rings, 24px minimum target size, contrast-checked colour pairs, reduced-motion support, 320px reflow, and the skip link
    - CSS-only changes plus minimal markup and class changes in `admin-ui/index.html`, `admin-ui/console.js`, and `admin-ui/sections/*.js` as needed; no inline styles or scripts (the CSP forbids them); no new dependency and no font download (system fonts only)
    - Add a unit test (for example `tests/unit/console-contrast.test.ts`) that parses the custom properties in `admin-ui/console.css` and asserts every text/background pair meets 4.5:1, reusing the approach of `tests/unit/dashboard-contrast.test.ts`
    - _Requirements: 15.2, 15.3, 15.4, 15.8, 15.9, 15.10, 30.8_

  - [x] 40.2 Show the publish target and a file preview in the Publish section
    - `GET /api/publish/status` in `src/admin/publish-api.ts` gains the remote display name (`owner/repo` taken from `origin`, credentials stripped) and the target branch
    - The Publish section (`admin-ui/sections/publish.js`) shows "Will push to <owner/repo>, branch main" prominently above the button, and lists the files to publish (added, modified, deleted) before the user confirms
    - The Overview section also shows the publish target
    - Add a note that the push to `main` starts a GitHub run
    - Update the affected tests (publish API status shape, Publish section view-model, and the source-scan tests)
    - _Requirements: 26.5, 26.7, 30.1, 30.2_

  - [x] 40.3 Stop tests opening real browser tabs and open the new Dashboard from the console
    - (a) Make `openInBrowser` in `src/admin/open-routes.ts` injectable through a module-level hook (for example `setBrowserLauncher(fn)` and `resetBrowserLauncher()`) or a ConsoleDeps-style port; it never launches a real browser when running under vitest (`process.env.VITEST` set) or when env `AWG_NO_BROWSER=1`; the default behaviour for the real console is unchanged
    - (b) Every test that exercises `POST /api/open/office` and `POST /api/open/dashboard` installs the stub launcher so no browser is launched: this includes the property tests in `tests/property/admin-route-guard.test.ts` and `tests/property/admin-oversized-body.test.ts`, and any unit test that sends valid requests to every mutating route
    - Add a unit test asserting the launcher is not called under test without a guarded request, and is called exactly once (via the stub) for a guarded valid request
    - (c) The local Dashboard button opens the NEW Dashboard instead of the legacy `artifacts/dashboard.html`, which is no longer opened. Choose the smaller safe option and document the choice in a code comment and in the Notes below:
      - Preferred small option: `POST /api/open/dashboard` opens the already-built `artifacts/published/index.html` when it exists; otherwise it returns a plain-words message telling the user how to build it (run `node dist/publish/build-published-data.js` and copy the `dashboard/` assets into `artifacts/published`) and launches nothing
      - Larger option, only if the small one proves unworkable: a guarded `POST /api/local-site/build` that runs the build in a background job into `artifacts/local-site`, plus a read-only whitelist-only static route `GET /local-dashboard/` on the loopback server (no directory listing, no path traversal, fixed file allow-list)
    - Update the Dashboard button label and result message in `admin-ui/sections/overview.js` (or the section that hosts the button) and the affected tests
    - _Requirements: 4.1, 17.8, 30.3, 30.4_

  - [x] 40.4 Fix the Overview publish target and name the unpublished files
    - (a) Bug: `GET /api/status` returns `publishTarget.remote` as null (the Overview shows "Publishes to: Not available yet") even though the `origin` remote exists, because `publishOverview` in `src/admin/publish-api.ts` uses `gt.remoteDisplay` from `gather(deps, false)`, which is empty on the no-fetch path. Read the remote with `git remote get-url origin` (credentials stripped via `remoteDisplayName`) independent of the fetch path, so the Overview shows the target whether or not a fetch ran
    - Add a unit test using a temp local git repo with an `origin` remote that asserts `publishTarget.remote` is the credential-free display name on the no-fetch path
    - (b) The Overview (`admin-ui/sections/overview.js`) lists the names of the unpublished changed files under the "Unpublished changes" row: an Added, Changed, or Deleted label plus the path for each file, at most 10, followed by "and N more" when there are more, with a link to the Publish section
    - `GET /api/status` gains a new `unpublishedFiles` array built from the same delta that produces the unpublished-changes count, so the count and the list always agree
    - Update the affected tests for `GET /api/status` and the Overview section (list of at most 10 with "and N more", labels, link to the Publish section, empty list when nothing is unpublished)
    - _Requirements: 26.5, 30.1_

## Notes

- Tasks marked with `*` are optional (test sub-tasks) and can be skipped for a faster MVP; they are listed so every Correctness Property (1 to 65) has a home.
- Each task references specific requirements for traceability; checkpoint tasks (18, 39) are not in the dependency graph.
- Property tests use fast-check with at least 100 iterations and carry the tag comment `// Feature: dashboard-usability-overhaul, Property N: <title>`.
- Property placement: P1-2 (2.2, 2.3); P3, P4, P23 (3.2); P4-P6, P24 dashboard side (10.8); P7-P12 (8.4); P13 (10.6); P14-P16, P28 (10.7); P15 TS side (7.3); P17 (5.2); P18-P19 (4.3); P20-P22 (10.9, 6.2); P25-P27 (7.3); P29-P31 (19.3); P32-P34, P36, P39 (21.3); P35, P37 (19.4); P38 (21.4); P40 (7.5); P41 (22.2); P42 (27.2); P43 (27.6); P44 (27.7); P45 (27.3); P46 (34.3); P47 (34.4); P48 (32.7); P49 (28.6); P50 (28.4); P51 (29.5); P52 (23.2); P53 (30.4); P54 (30.2); P55 (30.3); P56 (30.7); P57 (32.2); P58 (32.4); P59 (31.2); P60 (38.3); P61 (22.8); P62 (22.3); P63 (33.3); P64 (35.3); P65 (38.2).
- Sequencing risks: (1) `src/core/orchestrator.ts` is edited by 4.1, 8.3, 29.1, 21.1, and 33.1; `src/publish/run-findings.ts` and `published-data.ts` by 3.1/7.2, 21.2, and 35.1; `guardian.yml` by 9.1, 16.2, 26.1, and 31.1; `src/admin/console-routes.ts` by 23.1, 24.1, 27.4, 25.2, 28.5, 29.4, 30.6, 32.5, 33.2, 34.1, and 38.1; `src/approval/approval-gate.ts` by 20.2 and 22.5; `admin-ui/sections/findings.js` by 24.2 and 25.2; `admin-ui/sections/baselines.js` and `baselines-api.ts` by 29.x and 37.1; `src/admin/domain-setup-api.ts` by 34.1 and 34.2; Dashboard shared views (`overview.js`, `run-view.js`, `charts.js`, `common.js`) by 35.2, 36.1, and 36.2. Each is placed in its own wave and must not run in parallel with the others. (2) The Phase 1 shell dispatches views by lazy `import()`, and the console shell loads `admin-ui/sections/<name>.js` the same way, so sections land without touching `console.js`. (3) Phase 1 emits `ignored: []` and `decisions: not-applicable`; if a later schema change renames these, Phase 1 output must be republished. (4) `analytics.test.ts` reads the real `artifacts/a11y-history.json`; the compat reader in 8.2 must be in place before any v2 history file is written locally. (5) The adapter rewrite in 22.6 replaces the old inline page and routes; the console shell (22.7) and the retired-route handling (38.1) follow, so between those tasks the console is incomplete but builds and tests stay green. (6) Task 35.1 is the only Phase 1 published-data change in Phase 2 and is additive (one optional `domain` field); the Dashboard must tolerate its absence. (7) `push` in 31.1 starts a full scan for every matching push, so the path filters must stay exactly as listed and never include `runs-data` or `src/**`.

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
    { "id": 7, "tasks": ["16.3", "18.1", "18.2"] },
    { "id": 8, "tasks": ["19.1", "20.2", "22.1", "26.1", "27.1", "28.1", "29.1", "30.1", "32.1"] },
    { "id": 9, "tasks": ["19.2", "22.2", "22.3", "22.4", "22.5", "26.2", "27.2", "27.3", "28.2", "28.3", "29.2", "29.3", "30.2", "30.3", "30.5", "32.2", "32.3"] },
    { "id": 10, "tasks": ["19.3", "19.4", "20.1", "22.6", "23.1", "28.4", "31.1", "32.4"] },
    { "id": 11, "tasks": ["20.3", "21.1", "22.7", "22.8", "23.2", "24.1", "30.4", "31.2"] },
    { "id": 12, "tasks": ["21.2", "23.3", "24.2", "24.3", "25.1", "27.4", "33.1"] },
    { "id": 13, "tasks": ["21.3", "21.4", "24.4", "25.2", "27.5", "27.6", "27.7", "35.1"] },
    { "id": 14, "tasks": ["25.3", "28.5", "35.2"] },
    { "id": 15, "tasks": ["28.6", "28.7", "29.4", "35.3", "36.1"] },
    { "id": 16, "tasks": ["29.5", "29.6", "30.6", "36.2"] },
    { "id": 17, "tasks": ["30.7", "30.8", "32.5", "36.3"] },
    { "id": 18, "tasks": ["32.6", "33.2"] },
    { "id": 19, "tasks": ["33.3", "33.4", "34.1"] },
    { "id": 20, "tasks": ["34.2", "34.3", "37.1", "38.1"] },
    { "id": 21, "tasks": ["32.7", "34.4", "34.5", "37.2", "38.2", "38.3"] },
    { "id": 22, "tasks": ["38.4"] },
    { "id": 23, "tasks": ["40.1"] },
    { "id": 24, "tasks": ["40.2"] },
    { "id": 25, "tasks": ["40.3"] },
    { "id": 26, "tasks": ["40.4"] }
  ]
}
```
