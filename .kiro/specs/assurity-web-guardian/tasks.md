# Implementation Plan: Assurity Web Guardian

## Overview

This plan converts the approved design into a series of incremental, code-only tasks organized into 14 sequential **implementation phases**. Each phase builds on the previous one, is independently **executable and verifiable**, and ends by wiring its output into the growing system so there is no orphaned code.

The implementation language is **TypeScript (Node.js, ESM)** per the design Technology Stack — the design uses TypeScript throughout (interfaces, data models, schemas), so no implementation-language selection is required. Tooling: Playwright Test (Chromium only; desktop 1440×900 + mobile 390×844), `@axe-core/playwright`, Ajv (JSON Schema 2020-12), `pixelmatch` + `pngjs`, Vitest + `fast-check`, and static HTML reporting. Local filesystem only — no database, no server, no scheduler, no OpenTelemetry Collector.

Phases follow the architecture's hard boundaries: all network access flows through the **SiteGateway** safety layer, and the **Approval_Gate** is a structural boundary (drafts before it, approved baselines after it). The milestone-one vertical slice (Req 28) is proven early (Phase 2) and hardened progressively.

### How to read a phase

Every phase below records:
- **Implements** — the requirements and design components it delivers.
- **Depends on** — which phases must complete first.
- **Completion check** — an objective command/test that must pass to call the phase done.

Tasks marked with `*` are optional test sub-tasks (unit / property / integration) and can be skipped for a faster path; core implementation sub-tasks are never optional. Property test sub-tasks reference the specific design Correctness Property and the requirement clause each validates.

## Tasks

- [ ] 1. Phase 1 — Project Foundation & Config
  - **Implements:** Req 16 (scope: Chromium-only, no DB, no auth), Req 16.4/16.5/16.6, Req 28.10 (begin with one page), Req 20.14/24.6 (retention limit), design "Technology Stack", "Configuration model", "Repository Structure".
  - **Depends on:** nothing (foundation).
  - **Completion check:** `npm run build` (tsc, ESM) compiles with no errors and `npx playwright --version` prints a Chromium-capable version.

  - [ ] 1.1 Scaffold the TypeScript ESM project and tooling
    - Create `package.json` (type: module, scripts: `build`, `test`, `test:unit`, `test:property`, `run`, `approve`, `report`), `tsconfig.json` (ESM, `moduleResolution: nodenext`, strict), `.gitignore` (ignore `artifacts/`, keep `baselines/` and `tests/generated/`).
    - Add dependencies: `playwright`/`@playwright/test`, `@axe-core/playwright`, `ajv`, `ajv-formats`, `pixelmatch`, `pngjs`, and dev deps `typescript`, `vitest`, `fast-check`.
    - Create the empty source directory tree from the design Repository Structure (`src/core`, `src/browser`, `src/agents`, `src/safety`, `src/approval`, `src/telemetry`, `src/reporting`, `src/schemas`, `tests/unit`, `tests/property`, `tests/generated`, `baselines/`, `config/`).
    - _Requirements: 16.1, 16.2, 16.3, 25.2_

  - [ ] 1.2 Create the `playwright.config.ts` with Chromium desktop + mobile projects
    - Define exactly two projects, both Chromium: `desktop` (viewport 1440×900) and `mobile` (viewport 390×844). No Safari/Firefox/extra devices.
    - Enable trace capture and configure the HTML reporter output under the run directory convention.
    - _Requirements: 16.4, 16.5, 7.1, 7.2_

  - [ ] 1.3 Implement the `AppConfig` model and `Configurable_Limit` defaults
    - Create `src/config/app-config.ts` with the `AppConfig` interface and a loader that reads `config/app.config.json`, applying first-milestone defaults: `pages=10`, `crawlDepth=2`, `concurrency=1`, `requestSpacingMs=1000`, `retries=2`, `navTimeoutMs=30000`, `runTimeoutMs=600000`, retention `{ maxRuns, maxAgeDays }`, and the fixed viewports (desktop 1440×900, mobile 390×844).
    - All limits must be overridable from config without code changes.
    - _Requirements: 16.6, 1.2, 1.5, 1.8, 1.9, 1.10, 12.1, 12.3, 12.4, 12.5, 12.6, 20.14, 24.6_

  - [ ] 1.4 Author `config/app.config.json` and `config/page-seed.json`
    - Write `config/app.config.json` with `approvedDomain: "assurity.nz"`, `baseUrl: "https://assurity.nz"`, `seedFilePath`, and the default limits/viewports/retention.
    - Write `config/page-seed.json` as the `Page_Seed_File` containing only the homepage (`https://assurity.nz/`) to start, with a documented max of 10 URLs.
    - _Requirements: 1.1, 1.2, 28.10, 16.6_

  - [ ]* 1.5 Write smoke/config unit tests
    - Assert config loads with all `Configurable_Limit` values present and defaults applied; assert the seed file has ≤ 10 URLs and the Playwright config exposes exactly one Chromium browser with two viewport projects.
    - _Requirements: 16.5, 16.6, 25.2_

- [ ] 2. Phase 2 — Homepage Deterministic Check Foundation (Vertical Slice)
  - **Implements:** Req 6 (quality checks), Req 7 (screenshots), Req 12/13 (basic safety at request level), Req 16, Req 28 (milestone-one vertical slice), design "Milestone-One Vertical Slice", "Playwright_Test", minimal `SiteGateway`.
  - **Depends on:** Phase 1.
  - **Completion check:** a single command (`npm run run` / the `run` CLI) executes a Playwright Test against the approved homepage on desktop + mobile end-to-end, producing desktop+mobile screenshots, Playwright traces, and the Playwright HTML report; no form is submitted and no external navigation occurs.

  - [ ] 2.1 Implement a minimal `SiteGateway.navigate` + domain guard for the slice
    - Create `src/core/site-gateway.ts` with `guardUrl()` (allow only `Approved_Domain`/subdomains) and `navigate(url, viewport)` applying `navTimeoutMs`. External targets throw. (Full rate limiter/retry/guards come in Phase 3.)
    - _Requirements: 13.1, 13.2, 12.5, 12.7_

  - [ ] 2.2 Implement the homepage Playwright Test check spec (desktop + mobile)
    - Create `src/browser/playwright-test.ts` + a homepage spec that, for both viewports, verifies: successful document HTTP response, non-empty `<title>`, a visible `<h1>`, presence of primary navigation, failed-image detection, browser-console error monitoring, failed same-domain request monitoring, and page-error monitoring.
    - Restrict link/image checks to the Approved_Domain; record (never navigate) external links.
    - _Requirements: 6.1, 6.2, 6.3, 6.5, 6.6, 6.11, 6.12, 7.1, 7.2, 28.2, 28.3_

  - [ ] 2.3 Add the Axe WCAG 2.2 AA accessibility scan to the homepage check
    - Integrate `@axe-core/playwright` to run on both viewports and collect violations with their reported impact; record the "automated checks do not establish full WCAG conformance" disclaimer.
    - _Requirements: 6.7, 6.10, 28.3_

  - [ ] 2.4 Capture evidence: screenshots, traces, Playwright HTML report
    - Capture desktop (1440×900) and mobile (390×844) screenshots and Playwright traces for the homepage run; ensure the Playwright HTML report is produced.
    - _Requirements: 7.1, 7.2, 7.3, 28.4, 28.8_

  - [ ] 2.5 Wire a single `run` command that executes the homepage slice end-to-end
    - Create `src/index.ts` CLI with a `run` subcommand that loads config, reads the homepage seed, runs the Playwright Test checks on both viewports, and emits the Playwright HTML report. No form submission; no external navigation.
    - _Requirements: 28.1, 28.2, 28.7, 29.1_

  - [ ]* 2.6 Write integration test asserting the slice produces evidence
    - Against a local/mocked page, assert the command yields desktop+mobile screenshots, a trace per viewport, and the Playwright HTML report, and that no submit action was invoked.
    - _Requirements: 28.4, 28.7, 28.8_

- [ ] 3. Phase 3 — Core Safety Layer (SiteGateway)
  - **Implements:** Req 11 (no form submit / no PII), Req 12 (no load testing: rate/concurrency/retries/timeouts), Req 13 (domain boundary / external nav), design "SiteGateway + Safety Layer", "Safety Enforcement Points".
  - **Depends on:** Phase 1 (config), Phase 2 (initial gateway).
  - **Completion check:** `npm run test:unit` and `npm run test:property` pass for domain guard, rate-limiter spacing ≥ `requestSpacingMs`, concurrency ≤ 1, retry bound ≤ `retries+1`, and form-submit blocking.

  - [ ] 3.1 Implement `RateLimiter` (spacing + concurrency)
    - Create `src/core/rate-limiter.ts` with `acquire(signal)` that resolves no sooner than `requestSpacingMs` after the previous acquire and never allows more than `concurrency` in flight; accept an injectable clock for deterministic tests.
    - _Requirements: 12.1, 12.2, 1.8_

  - [ ]* 3.2 Write property test for request spacing and concurrency
    - **Property 3: Request spacing and concurrency honor the configured limits**
    - **Validates: Requirements 1.8, 12.1, 12.2**

  - [ ] 3.3 Implement `RetryPolicy` (retry-with-backoff)
    - Create `src/core/retry-policy.ts` that retries transient failures up to `retries` (default 2) with backoff, stops on success, and does not retry non-transient errors.
    - _Requirements: 1.9, 12.4_

  - [ ]* 3.4 Write property test for the retry bound
    - **Property 4: Transient failures are retried within the configured bound**
    - **Validates: Requirements 1.9, 12.4**

  - [ ] 3.5 Implement the domain guard and external-link classification
    - Extend `src/safety/domain-guard.ts` + `SiteGateway.guardUrl()`/`isExternal()` to allow only Approved_Domain, block off-domain navigation, and classify External_Links (recorded, never navigated). No load/stress/perf code path exists.
    - _Requirements: 13.1, 13.2, 13.3, 12.7, 12.8_

  - [ ]* 3.6 Write property tests for domain boundary and MCP parity
    - **Property 2: Requests never leave the approved domain**
    - **Validates: Requirements 1.4, 6.11, 6.12, 12.7, 13.1, 13.2, 13.3**

  - [ ] 3.7 Implement the `GuardedPage` no-form-submit and no-PII guards
    - Create `src/safety/form-guard.ts` and a `GuardedPage` wrapper that blocks submit / submit-style clicks and blocks any field populate carrying PII; every block records a `blocked-action` audit event (audit sink injected; finalized in Phase 4).
    - _Requirements: 11.1, 11.2, 11.3, 11.4_

  - [ ] 3.8 Apply navigation and run timeouts through the gateway/orchestrator seam
    - Enforce `navTimeoutMs` per navigation in `SiteGateway`; expose a run-level `AbortSignal` hook (consumed by the Orchestrator in Phase 12) for `runTimeoutMs`.
    - _Requirements: 12.5, 12.6_

  - [ ]* 3.9 Write unit tests for guards and blocked-action auditing
    - Assert form-submit blocked+audited, PII populate blocked+audited, off-domain navigation blocked+audited, navigation timeout enforced.
    - _Requirements: 11.2, 11.4, 12.2, 13.2_

- [ ] 4. Phase 4 — ID Model & Telemetry Core
  - **Implements:** Req 18 (run telemetry), Req 19 (agent telemetry), Req 20 (observability, correlation, app-level append-only, redaction), Req 22 (sensitive-data safety), Req 23 (event-schema stability), Req 24.5 (append-only integrity), Req 25 (local telemetry + exporter interface), design "Telemetry", "Data Models", "Audit Model".
  - **Depends on:** Phase 1.
  - **Completion check:** `npm run test:unit`/`test:property` pass showing schema-valid telemetry is written, append-only integrity rejects overwrite with an integrity error, and redaction removes secret/PII values.

  - [ ] 4.1 Implement the identifier model and ID minting
    - Create `src/core/ids.ts` minting prefixed, sortable IDs: `run_`, `cor_`, `task_`, `chk_`, `fnd_`, `evd_`, `rev_`; every child entity references the parent `correlationId`.
    - _Requirements: 20.3, 20.4_

  - [ ] 4.2 Implement the `Redactor`
    - Create `src/safety/redactor.ts` as a pure function that replaces tokens/credentials/PII/secrets with a placeholder across nested records before any write.
    - _Requirements: 20.13, 22.1, 22.2_

  - [ ]* 4.3 Write property test for redaction / no-PII-in-telemetry
    - **Property 6: Recorded inventory and telemetry never contain PII or secrets**
    - **Validates: Requirements 2.5, 11.3, 11.4, 20.13, 22.1, 22.2**

  - [ ] 4.4 Implement the append-only JSONL audit + event log writer
    - Create `src/telemetry/audit-log.ts` that only appends to `events.jsonl`/`audit.jsonl`; any attempt to modify/overwrite an existing entry is rejected/halted, surfaces an integrity error, preserves existing content, and records an `edit-rejected` event.
    - _Requirements: 20.7, 20.8, 20.9, 24.5_

  - [ ]* 4.5 Write property test for append-only log integrity
    - **Property 11: Audit and event logs are append-only**
    - **Validates: Requirements 20.7, 20.8, 20.9, 24.5**

  - [ ] 4.6 Implement the `TelemetryExporter` interface and `FileExporter`
    - Create `src/telemetry/exporter.ts` (OTel-ready interface) and `src/telemetry/exporters/file-exporter.ts` writing JSON/JSONL locally, with no Collector/cloud/DB.
    - _Requirements: 20.12, 25.1, 25.2, 25.3, 23.2_

  - [ ] 4.7 Implement the `TelemetryEmitter` with `RunRecord` and `AgentTaskRecord`
    - Create `src/telemetry/telemetry-emitter.ts` producing `TelemetryEvent` (plain-language, no chain-of-thought), `RunRecord` (all Req 18 fields), and `AgentTaskRecord` (all Req 19 fields incl. truthful agent status: `queued`/`working`/`completed`/`failed`/`awaiting-review` and human-decision fields); routes every record through `Redactor` then the exporter.
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7, 18.8, 18.9, 18.10, 18.11, 18.12, 18.13, 18.14, 18.15, 18.16, 18.17, 19.1, 19.2, 19.3, 19.4, 19.5, 19.6, 19.7, 19.8, 19.9, 19.10, 19.11, 19.12, 19.13, 19.14, 19.15, 19.16, 19.17, 20.1, 20.2, 20.11, 22.3, 22.4_

  - [ ]* 4.8 Write property test for correlation-ID linkage
    - **Property 12: Every child entity references the parent correlation ID**
    - **Validates: Requirements 20.3, 20.4**

  - [ ] 4.9 Record the milestone-one immutability disclaimer
    - Ensure the audit subsystem records (in docs/telemetry metadata) that append-only is application-level only and the local files remain technically modifiable; no claim of cryptographic/regulatory immutability.
    - _Requirements: 20.10_

- [ ] 5. Phase 5 — Evidence Store & Run Directory Layout
  - **Implements:** Req 7.3 (screenshot storage invariant), Req 10.1/10.2 (preserve evidence + audit), Req 10.5/24.6 (retention never deletes runs awaiting review), Req 24 (local run directory layout + test manifest), design "Evidence_Store", "Repository Structure".
  - **Depends on:** Phase 4 (telemetry writers).
  - **Completion check:** a run produces the complete `artifacts/runs/<run-id>/` layout and every evidence reference resolves to an existing file.

  - [ ] 5.1 Implement the `EvidenceStore` run-directory creation and atomic writes
    - Create `src/core/evidence-store.ts` that creates `artifacts/runs/<run-id>/` with `run.json`, `events.jsonl`, `results.json`, `findings.json`, `audit.jsonl`, `test-manifest.json`, and subdirs `screenshots/`, `traces/`, `accessibility/`, `agent-tasks/`, `report/`; writes JSON atomically (temp + fsync + rename).
    - _Requirements: 24.1, 24.2, 24.3, 24.4_

  - [ ] 5.2 Implement the pending-review and baselines areas
    - Create/initialize `artifacts/pending-review/{discoveries,spec-drafts}/` and `baselines/<page-slug>/` location helpers.
    - _Requirements: 1.6, 4.2, 10.3_

  - [ ] 5.3 Implement `EvidenceRef` minting and persistence of run evidence
    - Store screenshots/traces/accessibility/agent-tasks with `evidenceId`-keyed references in `run.json`/`results.json`; guarantee every captured screenshot is stored with its page + run reference.
    - _Requirements: 7.3, 10.1, 10.2, 24.4, 24.7_

  - [ ] 5.4 Implement the `Retention_Policy` cleanup that protects runs awaiting review
    - Create a retention routine honoring `maxRuns`/`maxAgeDays` that never deletes or modifies the complete run directory for any run awaiting human review.
    - _Requirements: 10.5, 24.6, 20.14_

  - [ ]* 5.5 Write unit/integration tests for the directory layout and retention
    - Assert the full layout is created, evidence references resolve, and retention skips runs awaiting review.
    - _Requirements: 24.2, 24.3, 24.4, 10.5_

- [ ] 6. Phase 6 — JSON Schemas & Hand-off Validation
  - **Implements:** Req 17 (structured hand-offs + validation), Req 1.12 (reject valid-but-incomplete discovery hand-off), Req 8.9 (comparison hand-off), Req 2.6 (inventory hand-off), design "Agent_Handoff Schemas", "Data Models".
  - **Depends on:** Phase 4 (audit log for rejection recording).
  - **Completion check:** `npm run test:unit` schema tests pass — sample valid hand-offs validate, and invalid or incomplete hand-offs are rejected and audited.

  - [ ] 6.1 Author the hand-off and record JSON Schemas (draft 2020-12)
    - Create `src/schemas/*.json`: `discovery.handoff`, `inventory.handoff` (form fields have no `value`), `comparison.handoff`, `run-record`, `agent-task-record`, `finding`, `human-decision`, `telemetry-event`.
    - _Requirements: 17.1, 2.6, 8.9, 26.1_

  - [ ] 6.2 Implement the Ajv validator and receiver rejection logic
    - Create `src/schemas/validate.ts` using Ajv + `ajv-formats`; on validation failure OR on a discovery hand-off that validates but omits a required page set, the receiver rejects it and appends a `handoff-rejected` audit event.
    - _Requirements: 17.1, 17.2, 1.11, 1.12_

  - [ ]* 6.3 Write property test for hand-off round-trip and rejection
    - **Property 5: Agent hand-offs round-trip and are rejected when invalid or incomplete**
    - **Validates: Requirements 1.11, 1.12, 8.4, 17.1, 17.2**

  - [ ]* 6.4 Write unit tests for each schema accept/reject case
    - Craft valid and invalid samples per schema (including a discovery hand-off missing an approved/review page) and assert accept/reject + audit entry.
    - _Requirements: 17.1, 17.2, 1.12_

- [ ] 7. Phase 7 — Discovery & Deterministic Inventory
  - **Implements:** Req 1 (discovery), Req 2 (inventory), Req 30 (MCP vs Test roles; read-only MCP assist), Req 31.2/31.3 (deterministic crawler + mixed inventory), design "Discovery_Agent", "Inventory_Agent", "Playwright_MCP vs Playwright_Test".
  - **Depends on:** Phase 3 (SiteGateway), Phase 4 (telemetry), Phase 5 (evidence), Phase 6 (schemas).
  - **Completion check:** discovery and inventory hand-offs validate against their schemas and a homepage inventory (both viewports) is produced; a same-domain non-seed page is written to pending-review.

  - [ ] 7.1 Implement the `Discovery_Agent` crawler
    - Create `src/agents/discovery-agent.ts`: read `Page_Seed_File`, crawl to `crawlDepth` via `SiteGateway`, keep only Approved_Domain pages in `approvedPages` (≤ `pages`), list same-domain non-seed pages in `pagesRequiringReview` (written to pending-review), record external links without navigating, and emit a schema-valid discovery hand-off.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 13.3_

  - [ ]* 7.2 Write property test for discovery scope containment
    - **Property 1: Discovery never expands the approved scope**
    - **Validates: Requirements 1.2, 1.6, 1.7, 16.6**

  - [ ] 7.3 Implement the read-only `Playwright_MCP` explorer (optional assist)
    - Create `src/browser/playwright-mcp.ts` providing read-only exploration/inventory snapshots routed through `SiteGateway` (never the sole repeatable mechanism; same safety boundary as all requests).
    - _Requirements: 30.1, 30.3, 30.4, 30.5_

  - [ ]* 7.4 Write property test for MCP safety parity
    - **Property 22: MCP-driven requests obey the same safety boundary as all other requests**
    - **Validates: Requirements 30.4, 30.5**

  - [ ] 7.5 Implement the `Inventory_Agent` deterministic extraction (both viewports)
    - Create `src/agents/inventory-agent.ts`: render desktop 1440×900 and mobile 390×844, extract title, headings, links, images, buttons, and form structure (fields + buttons) deterministically; never submit forms; exclude PII; on single-viewport render success produce a partial hand-off recording which viewport failed; emit a schema-valid inventory hand-off.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 31.3_

  - [ ]* 7.6 Write unit tests for inventory extraction and partial hand-off
    - Assert all element categories captured on both viewports, PII structurally absent, and partial hand-off produced when one viewport fails.
    - _Requirements: 2.4, 2.5_

- [ ] 8. Phase 8 — Specification Agent & Pending-Review / Baseline Workflow *(HUMAN APPROVAL GATE)*
  - **Implements:** Req 3 (draft specs), Req 4 (human approval → baseline), Req 10.3/10.4 (baseline-change review), Req 14 (no auto-promote), Req 15 (no auto-approve/suppress), Req 31.4/31.5 (orchestrator/agents never self-approve), design "Spec_Generator", "Approval_Gate".
  - **Depends on:** Phase 5 (pending-review/baselines areas), Phase 7 (inventory).
  - **Completion check:** a draft spec is written to `pending-review/`; the `approve` CLI atomically promotes it to a versioned baseline with an audit entry; a self-approval attempt is rejected and audited; `list-pending` and `dispose` commands work.
  - **NOTE:** This phase includes a **human approval gate** — baseline promotion requires an explicit human `Human_Decision`; the system never self-approves.

  - [ ] 8.1 Implement the `Spec_Generator` (Specification_Agent)
    - Create `src/agents/spec-generator.ts`: turn an inventory into a Markdown `Draft_Specification` including title, headings, links, images, buttons, forms; mark state `draft`; write to `pending-review/spec-drafts/` and the Evidence_Store.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 4.2_

  - [ ]* 8.2 Write property test for draft spec fidelity and non-baseline state
    - **Property 17: A draft specification reflects its inventory and is never a baseline until approved**
    - **Validates: Requirements 3.2, 3.3, 4.1, 4.4**

  - [ ] 8.3 Implement the `pending-store` and `Approval_Gate` with atomic promotion
    - Create `src/approval/pending-store.ts` and `src/approval/approval-gate.ts`: `approveSpecification`/`updateBaseline`/`disposeFinding`; atomic promote (temp → fsync → rename → append audit) so the success audit exists iff promotion succeeded; a failed promotion records a failed-attempt event and no success event; only this gate writes to `baselines/`.
    - _Requirements: 4.3, 4.5, 4.7, 10.3, 10.4, 14.2, 15.5, 27.5_

  - [ ]* 8.4 Write property test for atomic, truthful baseline promotion
    - **Property 8: Baseline promotion is atomic and truthfully audited**
    - **Validates: Requirements 4.3, 4.7, 10.4**

  - [ ] 8.5 Implement the no-self-approval and human-identity enforcement
    - In `approval-gate.ts`, reject any decision whose approver is the agent/process that produced the artifact; require a human `reviewer` identity; record the rejected attempt.
    - _Requirements: 4.6, 10.6, 15.4, 31.4, 31.5_

  - [ ]* 8.6 Write property test for no-self-approval
    - **Property 7: No agent can approve its own output**
    - **Validates: Requirements 4.6, 10.6, 15.4**

  - [ ] 8.7 Implement the approval CLI (`approve` / `list-pending` / `dispose`)
    - Create `src/approval/cli.ts` and wire subcommands into `src/index.ts`, capturing reviewer name, timestamp, decision, reason, spec version, and affected baseline/finding IDs in the audit trail.
    - _Requirements: 4.3, 4.5, 10.3, 10.4, 15.3_

  - [ ]* 8.8 Write integration test for the pending-review → approval flow
    - Against the real filesystem: draft written to pending-review, `approve` promotes to `baselines/<slug>/baseline.v1.md` with an audit entry, self-approval rejected.
    - _Requirements: 4.3, 4.6, 10.3_

- [ ] 9. Phase 9 — Test Generation From Approved Baseline
  - **Implements:** Req 5 (generate Playwright tests from approved baselines), Req 24.7/24.8 (test manifest; evidence not sole source), Req 16.8 (deterministic generation, not autonomous AI authoring), design "Test_Generator".
  - **Depends on:** Phase 8 (approved baseline).
  - **Completion check:** a generated `.spec.ts` references the approved baseline version, is written under version-controlled `tests/generated/`, and runs under Playwright Test (desktop + mobile); a run records a `test-manifest.json`.

  - [ ] 9.1 Implement the `Test_Generator`
    - Create `src/agents/test-generator.ts`: generate Playwright specs from an approved `Baseline` only (non-baseline specs excluded), exercising desktop 1440×900 + mobile 390×844 Chromium, writing to `tests/generated/` with each file recording the source baseline version.
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [ ] 9.2 Record the test-suite manifest and keep source out of Evidence_Store sole-location
    - Write `artifacts/runs/<run-id>/test-manifest.json` snapshotting exactly which tests executed; keep the generated source in the repo, never as the sole copy in the Evidence_Store.
    - _Requirements: 5.5, 24.7, 24.8_

  - [ ]* 9.3 Write unit tests for test generation and baseline-version referencing
    - Assert generated spec references baseline vN, both viewports are exercised, and a non-approved spec is excluded from generation.
    - _Requirements: 5.2, 5.3, 5.4_

- [ ] 10. Phase 10 — Comparator & Outcome Classification
  - **Implements:** Req 8 (classified comparison), Req 26 (classification + strict precedence), Req 27 (visual comparison), design "Comparator", "Outcome Classification", "Strict Classification Precedence", "classification.ts".
  - **Depends on:** Phase 6 (comparison schema), Phase 9 (observations from generated tests feed comparison inputs).
  - **Completion check:** `npm run test:unit`/`test:property` pass for classification, visual-finding suppression, and strict precedence.

  - [ ] 10.1 Implement `classification.ts` (taxonomy + strict precedence)
    - Create `src/reporting/classification.ts` with the single precedence resolver `human-decision > agent-recommendation > ai-generated-analysis > observed-website-change > deterministic-test-evidence`, used by every surface.
    - _Requirements: 26.1, 26.2, 26.5_

  - [ ]* 10.2 Write property test for single classification by precedence
    - **Property 21: Exactly one classification is assigned by strict precedence**
    - **Validates: Requirements 26.5**

  - [ ] 10.3 Implement the `Comparator` outcome classification
    - Create `src/agents/comparator.ts`: compare observation vs baseline; a violated explicit expectation → `Failed_Check` (deterministic-test-evidence); a difference without a violated expectation → `Observed_Website_Change` (observed-website-change, never a Failed_Check); never use observations as baselines; emit a schema-valid comparison hand-off.
    - _Requirements: 8.1, 8.2, 8.3, 8.8, 8.9_

  - [ ]* 10.4 Write property test for observed-change-not-a-failure
    - **Property 19: A difference without a violated explicit expectation is never a Failed_Check**
    - **Validates: Requirements 8.2, 8.3**

  - [ ] 10.5 Implement the visual diff (pixelmatch) and Visual_Finding with suppression
    - Using `pixelmatch` + `pngjs`, store baseline + current + diff images as evidence; create a `Visual_Finding` (observed-website-change) requiring review; never auto-fail on pixel percentage; when a deterministic rule is violated in the same comparison, record only the `Failed_Check` and suppress the Visual_Finding; never discard the visual evidence; never auto-update a screenshot baseline.
    - _Requirements: 8.4, 27.1, 27.2, 27.3, 27.4, 27.5_

  - [ ]* 10.6 Write property tests for visual comparison and suppression
    - **Property 16: Visual comparison never auto-fails on pixel percentage** — **Validates: Requirements 27.1, 27.2, 27.3**
    - **Property 20: A Visual_Finding is suppressed when a deterministic rule is violated in the same comparison** — **Validates: Requirements 8.4, 27.2, 27.4**

  - [ ] 10.6a Implement accessibility impact → severity mapping
    - Map Axe impact to severity: critical/serious → failed check requiring human review; moderate/minor → finding requiring human review without auto-block; record a missing image only after its image check ran.
    - _Requirements: 6.8, 6.9, 6.5_

  - [ ]* 10.7 Write property tests for a11y severity and missing-image ordering
    - **Property 14: Accessibility impact maps deterministically to severity** — **Validates: Requirements 6.8, 6.9**
    - **Property 15: A missing image is only recorded after its image check runs** — **Validates: Requirements 6.5**

- [ ] 11. Phase 11 — AI-Assisted Agents (Quality Analysis, Visual Explanation, Triage)
  - **Implements:** Req 8.5/8.6 (AI interpretation / recommendation records), Req 26 (labeling + never-as-fact), Req 31.1 (AI-assisted classification), design "AI-assisted vs Deterministic", "Quality_Analysis_Agent", "Visual_Explanation_Agent", "Triage_Agent".
  - **Depends on:** Phase 10 (classification + comparator outputs).
  - **Completion check:** `npm run test:unit`/`test:property` pass showing AI outputs are separate records linked by `relatedFindingId`, classified `ai-generated-analysis`/`agent-recommendation`, always visibly labeled, and never overwriting a deterministic finding's classification.

  - [ ] 11.1 Implement the `Quality_Analysis_Agent`
    - Create `src/agents/quality-analysis-agent.ts`: interpret a comparison outcome and record an `ai-generated-analysis` item linked to the original deterministic finding via `relatedFindingId`, never replacing its classification.
    - _Requirements: 8.5, 26.4, 31.1_

  - [ ] 11.2 Implement the `Visual_Explanation_Agent`
    - Create `src/agents/visual-explanation-agent.ts`: produce human-readable explanations of Visual_Findings as `ai-generated-analysis` records linked via `relatedFindingId`.
    - _Requirements: 8.5, 26.4, 31.1_

  - [ ] 11.3 Implement the `Triage_Agent` consolidation proposal
    - Create `src/agents/triage-agent.ts`: propose a consolidated triage interpretation classified `agent-recommendation`, linked to the underlying findings, never presented as deterministic fact.
    - _Requirements: 8.6, 26.4, 31.1_

  - [ ]* 11.4 Write property test for classification integrity and AI-not-as-fact
    - **Property 13: Every reported item has exactly one classification and AI analysis is never shown as fact**
    - **Validates: Requirements 26.1, 26.2, 26.3, 26.4, 26.5, 21.14, 21.15**

- [ ] 12. Phase 12 — Orchestrator & Run Trigger
  - **Implements:** Req 28 (vertical slice coordination), Req 29 (manual run interface, scheduling deferred), Req 31.4/31.5 (coordinates but never approves), design "Orchestrator", "RunTrigger / Execution Interface".
  - **Depends on:** Phases 3–11 (all pipeline stages and safety).
  - **Completion check:** one command runs the full homepage workflow end-to-end under a single `correlationId`, enforces the run timeout, emits truthful agent-status events, and never approves findings/baselines.

  - [ ] 12.1 Implement the `RunTrigger` interface and `ManualTrigger`
    - Create `src/core/run-trigger.ts` with `RunTrigger` (`kind: "manual" | "scheduled"`) and a single `ManualTrigger`; shape the interface so a future `ScheduledTrigger` needs no change to telemetry content or run layout. No scheduler built.
    - _Requirements: 29.1, 29.2, 29.3, 16.7_

  - [ ] 12.2 Implement the `Orchestrator`
    - Create `src/core/orchestrator.ts`: mint `runId`/`correlationId`, construct the per-run `TelemetryEmitter` + `SiteGateway`, sequence Discovery → Inventory → Spec (pause at Approval_Gate when no approved baseline) → Test_Generator → Observation → Comparator → AI agents → reporting; wrap the run in an `AbortController` tied to `runTimeoutMs`; emit truthful agent-status events; never approve any finding/baseline. Operates on the single homepage and expands incrementally.
    - _Requirements: 28.1, 28.5, 31.4, 31.5, 12.6, 28.10, 19.7_

  - [ ]* 12.3 Write property tests for no-auto-baseline and unreviewed-stays-open
    - **Property 9: Observations, differences, and failures never auto-change a baseline** — **Validates: Requirements 8.3, 14.1, 14.2, 15.5, 27.5**
    - **Property 10: Unreviewed failures stay open and cannot be auto-disposed** — **Validates: Requirements 15.1, 15.2**

  - [ ]* 12.4 Write integration test for the orchestrated homepage run
    - Assert one command drives the full pipeline under one `correlationId`, the run timeout aborts cleanly while preserving evidence, and no approval happens inside the Orchestrator.
    - _Requirements: 28.1, 12.6, 31.5_

- [ ] 13. Phase 13 — Triage Report (HTML) & Static Dashboard
  - **Implements:** Req 9 (consolidated triage report), Req 21 (static dashboard), Req 26 (deterministic vs AI visually distinct), design "Triage_Reporter", "Static Dashboard", "Deterministic vs AI-Generated Separation".
  - **Depends on:** Phase 10/11 (findings), Phase 12 (run lifecycle).
  - **Completion check:** the HTML triage report and static dashboard open in a browser and show the run — website health, per-agent state, findings by severity/type, awaiting-review, history/trends, and evidence drill-down — with deterministic vs AI items visually separated; a dashboard-regeneration failure halts/fails the run.

  - [ ] 13.1 Implement the `Triage_Reporter` (consolidated HTML report + findings.json)
    - Create `src/reporting/triage-reporter.ts` + `templates/`: consolidate Failed_Checks, Observed_Website_Changes, and Visual_Findings into one `report/index.html` per run and `findings.json`; associate each item with page, check type, classification, and run id; keep unreviewed failures open.
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 15.1_

  - [ ]* 13.2 Write property test for triage consolidation association
    - **Property 18: Triage consolidation preserves every failure's association**
    - **Validates: Requirements 9.1, 9.2**

  - [ ] 13.3 Implement the `Static_Dashboard` generator
    - Create `src/reporting/dashboard.ts` reading `run.json`/`events.jsonl`/`findings.json`/`agent-tasks/` to render `report/index.html` + top-level `artifacts/dashboard.html`: website health, per-agent state + current task + duration/progress, findings by severity/type, awaiting-review, history/trends, and evidence drill-down links.
    - _Requirements: 21.1, 21.3, 21.6, 21.7, 21.8, 21.9, 21.10, 21.11, 21.12, 21.13_

  - [ ] 13.4 Implement deterministic-vs-AI visual distinction and dashboard-regeneration guard
    - Render each `Finding_Classification` with fixed badges/captions (AI items carry "not a deterministic fact", no pass/fail glyph); regenerate the dashboard during and at end of run; if regeneration fails both times, halt/fail the run rather than continue with a stale dashboard.
    - _Requirements: 21.2, 21.14, 21.15, 26.3, 26.4, 21.16_

  - [ ]* 13.5 Write snapshot tests for report/dashboard sections and classification badges
    - Assert required sections exist, the latest `run.json` is reflected, and classification badges/captions render with correct visual treatment.
    - _Requirements: 21.6, 21.14, 26.3_

- [ ] 14. Phase 14 — End-to-End Verification & Repeatability
  - **Implements:** Req 28 (milestone success criteria 1–8), full-document integration, design "Testing Strategy", "Correctness Properties".
  - **Depends on:** Phases 1–13.
  - **Completion check:** the complete PoC runs twice successfully and all 12 verification checks below pass.

  - [ ] 14.1 Implement an end-to-end repeatability harness
    - Add a test/script that runs the complete homepage PoC twice and asserts both runs complete and produce independent run directories.
    - _Requirements: 28.1, 28.9, 28.10_

  - [ ]* 14.2 Write the 12-point verification suite
    - Assert, across the two runs: (1) run completes end-to-end; (2) desktop+mobile checked; (3) Req 6 checks executed; (4) screenshots+traces captured; (5) structured telemetry written and JSON validates against schemas; (6) HTML report + dashboard regenerated and open in a browser; (7) no form submitted; (8) evidence inspectable + references resolve; (9) deterministic distinct from AI; (10) baseline changes require human approval; (11) audit events not editable via the app; (12) agent states reflect real activity.
    - _Requirements: 28.2, 28.3, 28.4, 28.5, 28.6, 28.7, 28.8, 28.9, 26.3, 20.9, 14.2, 23.3_

  - [ ]* 14.3 Verify full property-suite coverage and manifest reproducibility
    - Run the complete `fast-check` property suite (≥ 100 iterations each) and confirm `test-manifest.json` reproduces the exact executed tests.
    - _Requirements: 24.7, 17.1_

## Notes

- Tasks marked with `*` are optional test sub-tasks (unit / property / integration) and can be skipped for a faster MVP; core implementation sub-tasks are never optional and are always implemented.
- Each task references specific requirement sub-clauses for traceability, and each property sub-task names the exact design Correctness Property it validates.
- Phases are sequential and each produces an executable, verifiable artifact; the milestone-one vertical slice (Phase 2) is proven early and hardened by later phases.
- The Approval_Gate (Phase 8) is a structural human boundary — nothing downstream can auto-promote a baseline or auto-dispose a finding.
- `fast-check` property tests run a minimum of 100 iterations each; timing-sensitive properties (3, 4) use an injected fake clock.
- No task performs deployment, scheduling, load testing, or any non-coding activity; all tasks are code-only.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "1.4", "1.5"] },
    { "id": 1, "tasks": ["2.1", "2.2", "2.3", "2.4", "2.5", "2.6"] },
    { "id": 2, "tasks": ["3.1", "3.3", "3.5", "3.7", "3.8", "4.1", "4.2", "4.4", "4.6"] },
    { "id": 3, "tasks": ["3.2", "3.4", "3.6", "3.9", "4.3", "4.5", "4.7", "4.9"] },
    { "id": 4, "tasks": ["4.8", "5.1", "5.2", "6.1"] },
    { "id": 5, "tasks": ["5.3", "5.4", "6.2"] },
    { "id": 6, "tasks": ["5.5", "6.3", "6.4", "7.1", "7.3", "7.5"] },
    { "id": 7, "tasks": ["7.2", "7.4", "7.6", "8.1"] },
    { "id": 8, "tasks": ["8.2", "8.3", "8.5", "8.7"] },
    { "id": 9, "tasks": ["8.4", "8.6", "8.8", "9.1"] },
    { "id": 10, "tasks": ["9.2", "9.3", "10.1", "10.3", "10.5", "10.6a"] },
    { "id": 11, "tasks": ["10.2", "10.4", "10.6", "10.7", "11.1", "11.2", "11.3"] },
    { "id": 12, "tasks": ["11.4", "12.1", "12.2"] },
    { "id": 13, "tasks": ["12.3", "12.4", "13.1", "13.3", "13.4"] },
    { "id": 14, "tasks": ["13.2", "13.5", "14.1"] },
    { "id": 15, "tasks": ["14.2", "14.3"] }
  ]
}
```
