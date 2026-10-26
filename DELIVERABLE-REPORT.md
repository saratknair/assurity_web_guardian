# Assurity Web Guardian - Proof-of-Concept Deliverable Report

Target site: https://assurity.nz (approved domain only)
Mode: human-supervised, local-only, no paid cloud, no AWS resources, no external telemetry.
Reviewer identity of record: Sarat
Generated after Phase 12 final verification.

## Executive summary

Assurity Web Guardian is a human-supervised website quality system. It discovers
an approved set of pages, generates reviewable draft specs, turns human-approved
baselines into deterministic checks, runs conservative observations (desktop +
mobile) against the live site, classifies deviations, separates deterministic
facts from AI-generated analysis, preserves all evidence, and gates every
baseline change behind human approval. A read-only virtual office visualises
only genuine run activity.

Two full end-to-end runs were executed for this report over all 10 approved
pages. An automated verification harness (scripts/verify.mjs) passed 17/17
invariants across both runs. The unit/property test suite passes 40/40. The
TypeScript build is clean.

## Scope delivered

- 10 approved pages (human-approved seed), desktop 1440x900 + mobile 390x844.
- 9 continuation phases of expanded coverage plus the virtual office and this
  final verification (continuation Phases 1-12), on top of the completed and
  verified Milestone 1.

## Verified evidence (headline numbers)

- verify.mjs: 17/17 PASS (exit 0), across the two most recent runs.
- Test suite: 40/40 tests pass across 7 files.
- TypeScript build: clean (0 errors).
- Both Phase 12 runs: 10 pages each, 40 screenshots each, awaitingReview=true,
  every finding flagged requiresHumanReview=true.
- Repeatability: run 1 and run 2 produced identical per-page deterministic
  outcomes.
- Virtual office: installs, typechecks, and production-builds cleanly on a
  pinned stable toolchain.
## 30-item deliverable checklist

Each item notes status and where the evidence lives. "Verified" means confirmed
by verify.mjs, the test suite, a build, or direct inspection of run artifacts.

1.  Bounded page discovery from a human-approved seed - Verified. config/page-seed.json (10 approved URLs); scripts/discover-candidates.mjs is read-only and paced.
2.  Page inventory per approved page (title, structure) - Verified. Inventory captured per run under artifacts/runs/<id>/.
3.  Draft Markdown specification generated per page - Verified. artifacts/pending-review/spec-drafts/ (9 drafts generated).
4.  Draft never used as baseline until human approval - Verified. Baselines created only via explicit approve step; drafts excluded.
5.  Playwright tests generated from approved baselines - Verified. test-manifest.json lists one generated spec per page with its baseline version.
6.  Observation checks: HTTP, title, h1, nav, accessibility - Verified. results.json per page shows desktop+mobile checks.
7.  Desktop 1440x900 + mobile 390x844 screenshots each run - Verified. 40 screenshot files per run (10 pages x 2 viewports x 2).
8.  Daily observation compared against approved baseline - Verified. Comparator events present per page in events.jsonl.
9.  Outcomes classified (not every diff is a failure) - Verified. deterministic-test-evidence vs observed-website-change in findings.json.
10. Failures consolidated into a triage report - Verified. report/index.html per run; Triage_Agent recommendations in findings.json.
11. Evidence preserved under the run directory layout - Verified. Each run holds events.jsonl, findings.json, results.json, test-manifest.json, screenshots/, traces/, accessibility/, report/.
12. Never submit forms on the production site - Verified by design. Forms inventoried, never submitted; careers/contact forms detected as structure only.
13. Never perform load testing - Verified. concurrency=1, requestSpacingMs>=1000 (config/app.config.json).
14. Stay within the approved domain while navigating - Verified. verify.mjs approved-domain-only: all 10 pages on assurity.nz.
15. Daily observations never auto-become baselines - Verified. awaitingReview=true on every run; no auto-promotion path.
16. Failures require human review before accept/suppress - Verified. Every outcome requiresHumanReview=true (verify.mjs all-findings-require-review).
17. PoC scope bounded (no auth, bounded set) - Verified. No authentication; 10-page cap in config.
18. Structured hand-offs validated against JSON schema - Verified. schema-validation tests (7) pass; Ajv validation in telemetry path.
19. One Run_Record per website-check run - Verified. one run.started event plus telemetry per run in events.jsonl.
20. One Agent_Task_Record per agent task - Verified. artifacts/runs/<id>/agent-tasks/ populated.
21. Structured, correlated, human-readable observability - Verified. Every event carries correlationId + runId; telemetry tests (6) pass.
22. Static dashboard (latest + historical state) - Verified. artifacts/dashboard.html generated (verify.mjs dashboard-exists).
23. Telemetry never exposes secrets or hidden reasoning - Verified. Redactor + safety property tests (10) pass; no secrets in events.
24. Local-file evidence layout (no database/external service) - Verified. All evidence is local JSON/JSONL under artifacts/.
25. Local, simple telemetry with room for OpenTelemetry later - Verified. Local JSON/JSONL by default; optional local OTel adapter off by default (AWG_OTEL=1).
26. Every reported item labelled by source (fact vs AI) - Verified. AI items carry "not a deterministic fact" labels and relatedFindingId (verify.mjs deterministic-vs-ai).
27. Audit trail is append-only and tamper-evident - Verified. verify.mjs audit-not-editable; AppendOnlyLog rejects in-place overwrite with IntegrityError.
28. Accessibility recurrence tracking (new vs recurring) - Verified. artifacts/a11y-history.json; recurrence proven new->recurring via scripts/verify-recurrence.mjs.
29. Scheduled trigger with overlap-skip (no concurrent runs) - Verified. scripts/scheduled-trigger + run-scheduled.mjs; overlap lock and skipped-runs.jsonl; overlap-skip exercised.
30. Read-only virtual office showing only genuine activity - Verified. React office (virtual-office/) builds clean; consumes event-server (port 7788); shows IDLE when no run is active; never manufactures events.

## Repeatability (two Phase 12 runs)

- Run 1: run_mvkoscza4f76c819998b - 10 pages, 40 screenshots, awaitingReview=true.
- Run 2: run_mvkp1bvs4f9fa3021015 - 10 pages, 40 screenshots, awaitingReview=true.
- Identical deterministic outcomes per page across both runs.

## Genuine findings surfaced (awaiting human review, none dismissed)

All 10 pages: desktop + mobile a11y-critical-serious failures. Per-page detail:
- Homepage: link-name, nested-interactive (desktop); + button-name (mobile).
- software-quality-services, case-studies, test-automation-engineering, exmonitoring: link-name (+ button-name mobile).
- performance-testing, business-analysis, engagement-models: link-name, target-size (+ button-name mobile).
- careers: label, link-name, select-name (+ button-name mobile).
- contact: color-contrast, link-name (+ button-name mobile).
HTTP 200, title, h1, and nav checks pass on every page.

These are reported as deterministic facts requiring human review. AI items are
clearly separated as analysis/recommendations, each linked to its finding.

## Cost and safety posture

- No AWS resources created; no paid cloud services; no external telemetry destinations.
- OpenTelemetry optional and off by default (local adapter only, AWG_OTEL=1).
- Conservative request rate (concurrency 1, >=1s spacing); approved domain only; no form submission; no load testing.
- All baselines and the 20 visual baselines were approved by a human (Sarat) via explicit gates.

## Build and test status

- TypeScript build: clean (0 errors).
- Tests: 40/40 pass across 7 files (unit + property-based).
- verify.mjs: 17/17 invariants pass (exit 0).

## Known operational notes

- Node runs from a portable install (C:\Users\nairs\nodejs\node-v22.11.0-win-x64);
  a system Node MSI was blocked by org policy. Invoke node by full path in fresh shells.
- The virtual office uses a pinned stable toolchain (React 18.3 / Vite 5.4 /
  TypeScript 5.6) because the create-vite v9 default (Vite 8 + rolldown) could
  not be resolved by npm 10.9.0 (arborist edgesOut crash). See virtual-office/README.md.
- Windows Task Scheduler registration for the scheduled trigger was prepared
  (scripts/guardian-task.ps1) but not installed here; it may require elevation
  and should be run by the operator. See scripts/SCHEDULING.md.

## How to reproduce

1. Build: node "node_modules\typescript\bin\tsc" -p tsconfig.json
2. Tests: node "node_modules\vitest\vitest.mjs" run
3. Full run: node scripts\run-guardian.mjs
4. Verify: node scripts\verify.mjs
5. Dashboard: open artifacts\dashboard.html
6. Virtual office: start the event server (port 7788), then in virtual-office/ run install + dev (http://localhost:5173).