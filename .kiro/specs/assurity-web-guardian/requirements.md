# Requirements Document

## Introduction

Assurity Web Guardian is a human-supervised website quality system, built as a proof-of-concept, that monitors the public https://assurity.nz website. The system discovers an approved, bounded set of same-domain pages, inventories their structure, and produces draft Markdown specifications for human review. Once a human approves a draft, the specification becomes a baseline. The system generates Playwright tests from approved baselines and runs manually initiated observations that check HTTP responses, navigation, critical content, broken links, missing images, console errors, and basic accessibility, while capturing desktop and mobile screenshots. For the first milestone a complete run is manually initiated; the execution interface is designed so that scheduled daily runs can be added later, but no scheduler is required in the first milestone. Observations are compared against approved baselines, comparison outcomes are classified rather than treated uniformly as failures, failed checks and items requiring human review are consolidated into a structured triage report, and run evidence is preserved. A human-in-the-loop approval model governs every transition that would change an approved baseline, and the system maintains a clear audit trail throughout.

This proof-of-concept is intentionally bounded: a maximum of ten approved pages, no authentication, no form submissions, no database access, no Jira integration, and no performance, load, or stress testing. The approved test scope for the first milestone is sourced from a manually approved Page_Seed_File, and newly discovered same-domain pages are never added to scope automatically but are listed for human review. The system operates at a conservative request rate and exercises pages on desktop Chromium at 1440 x 900 and a single mobile Chromium profile based on a 390 x 844 viewport. Chromium is the only browser engine in the first milestone; Safari, Firefox, and additional mobile devices are deferred until the first test suite is stable. All numeric limits — page count, crawl depth, concurrency, request spacing, retries, navigation timeout, overall run timeout, and retention — are configurable, with first-milestone defaults of 10 pages, crawl depth 2, concurrency 1, at least 1 second between discovery-page requests, 2 retries for transient failures, a 30-second navigation timeout, and a 10-minute overall run timeout.

The technical foundation is TypeScript with Playwright for browser automation, Axe for accessibility checks, JSON schemas for agent hand-offs, Markdown for human-readable specifications, HTML for reporting, and a modular architecture that supports a clear audit trail. Playwright Test provides the deterministic, repeatable website checks, while Playwright MCP provides controlled, read-only, agent-driven site exploration, accessibility snapshots, page inventory, and test-authoring support; Playwright MCP is never the sole daily or repeatable test mechanism. The system distinguishes AI-assisted agents (Specification Agent, Quality Analysis Agent, Visual Explanation Agent, Triage Agent) from deterministic components (discovery crawler, Playwright Test runner, Axe accessibility scanner, screenshot comparison, telemetry emitter, evidence storage, HTML report generator, and approval command). Generated Playwright test source is stored in the version-controlled repository and references the approved baseline version; the Evidence_Store retains execution evidence but is never the sole location of test source code.

To make every run transparent and reviewable, the system also emits structured telemetry for each website-check run and each agent task, maintains correlation across the orchestration run, agent tasks, website checks, findings, evidence, and human decisions under one shared correlation identifier, and produces a human-readable run report alongside an append-only audit record. For the first milestone, telemetry and evidence are stored as local JSON files plus an append-only JSONL event log under the Evidence_Store, without a database, an OpenTelemetry Collector, a cloud telemetry service, distributed infrastructure, real-time messaging, or the virtual office; a Telemetry_Exporter interface preserves room to add OpenTelemetry later. Immutability in the first milestone means completed audit events are append-only, corrections are recorded as new events, and attempts to alter completed records are rejected and logged; the system does not claim cryptographic or regulatory-grade immutability. A static HTML dashboard, regenerated during and at the end of each run and showing the latest recorded state on refresh, surfaces current website health, per-agent activity, findings by severity, items awaiting human review, and historical trends, while clearly distinguishing deterministic test evidence, observed website changes, AI-generated analysis, agent recommendations, and human decisions. AI-generated conclusions are never presented as deterministic facts. Human approval is file-based: draft discoveries and proposed baseline changes are written to a pending-review area, and a human must explicitly approve a baseline through a controlled command or dashboard action. No agent may approve its own output, and no failed check, detected difference, or screenshot comparison may automatically update an approved baseline. The event design anticipates a future virtual office visualization that is explicitly out of scope for the first implementation milestone.

## Glossary

- **Web_Guardian**: The overall human-supervised website quality system described by this document.
- **Discovery_Agent**: The component that discovers approved same-domain pages.
- **Inventory_Agent**: The component that extracts a structured inventory of page elements (titles, headings, links, images, buttons, forms).
- **Spec_Generator**: The component that generates a draft Markdown specification for a page.
- **Approval_Gate**: The human-in-the-loop control that must approve a transition before a draft specification becomes a baseline or before a baseline is changed.
- **Test_Generator**: The component that generates Playwright tests from approved baselines.
- **Observation_Runner**: The component that executes generated tests and records daily observations.
- **Comparator**: The component that compares daily observations against approved baselines.
- **Triage_Reporter**: The component that consolidates failures into a structured triage report.
- **Evidence_Store**: The storage location where run evidence (screenshots, observations, reports, logs) is preserved.
- **Target_Site**: The public website at https://assurity.nz.
- **Approved_Domain**: The domain `assurity.nz`, within which crawling and navigation are permitted.
- **Approved_Page**: A same-domain page that a human has explicitly approved for inclusion in scope.
- **Draft_Specification**: A machine-generated Markdown specification for a page that has not yet received human approval.
- **Baseline**: A human-approved specification that defines the expected state of an Approved_Page.
- **Daily_Observation**: A recorded set of measurements captured during a single run against an Approved_Page. In the first implementation milestone a run is manually initiated; the name is retained for continuity and does not imply automatic daily scheduling in the first milestone.
- **Desktop_Viewport**: The desktop Chromium viewport used for rendering and screenshots, sized at 1440 x 900 pixels.
- **Mobile_Viewport**: The single mobile Chromium profile used for rendering and screenshots, based on a 390 x 844 pixel viewport.
- **Reviewer**: The human operator who reviews drafts, observations, failures, and baseline changes.
- **Audit_Trail**: The ordered, preserved record of actions, approvals, and baseline changes.
- **Agent_Handoff**: A structured JSON payload exchanged between components, validated against a JSON schema.
- **Conservative_Request_Rate**: A bounded request rate that limits concurrency and spacing of requests to the Target_Site, defined by Configurable_Limits with first-milestone defaults of maximum concurrency 1 and at least 1 second between discovery-page requests.
- **Telemetry_Event**: A single structured JSON record emitted by the Web_Guardian that describes an observable occurrence during an orchestration run, an agent task, or a website check.
- **Run_Record**: The structured telemetry record that captures the inputs, measurements, and outcome of a single website-check run.
- **Agent_Task_Record**: The structured telemetry record that captures the inputs, activity, outputs, and outcome of a single task performed by an agent during a run.
- **Correlation_ID**: An identifier that links together the orchestration run, agent tasks, website checks, and evidence that belong to the same logical run.
- **Run_Report**: A human-readable HTML report that summarizes a completed run for Reviewer inspection.
- **Audit_Record**: An application-level, append-only record of a completed run. The application exposes no edit operation for completed events; corrections are appended as new events. The underlying local files remain technically modifiable by anyone with filesystem access, so the Audit_Record is not described as cryptographically immutable or impossible to alter at the storage level.
- **Dashboard**: The interface that displays current website health, per-agent activity, findings, items awaiting human review, and historical trends.
- **Virtual_Office**: A future visualization that depicts real orchestration activity as an office environment, explicitly out of scope for the first implementation milestone.
- **Retention_Policy**: The configurable policy that governs how long screenshots, traces, and reports are preserved in the Evidence_Store.
- **Telemetry_Emitter**: The component that produces Telemetry_Events, Run_Records, and Agent_Task_Records in structured JSON form.
- **Orchestration_Run**: A single end-to-end execution of the Web_Guardian that coordinates agent tasks and website checks under one Correlation_ID.
- **Agent**: A named component acting in a defined role during an Orchestration_Run.
- **Human_Decision**: A Reviewer disposition recorded against a finding or baseline change, one of accepted, rejected, dismissed, or baseline-update-approved.
- **Page_Seed_File**: A manually maintained file listing the explicitly approved Approved_Domain URLs that define the starting test scope for the first implementation milestone.
- **Pending_Review_Area**: A designated location under the Evidence_Store where draft discoveries and proposed baseline changes are written for a Reviewer to inspect and approve before taking effect.
- **Visual_Difference**: A recorded measure of the difference between a baseline screenshot and a current screenshot for the same Approved_Page and viewport.
- **External_Link**: A link on an Approved_Page whose target resolves to a domain other than the Approved_Domain.
- **Telemetry_Exporter**: A modular interface through which Telemetry_Events can be exported, designed so that an OpenTelemetry integration can be added later without changing the recorded telemetry content.
- **Finding_Classification**: The category assigned to each item presented in a report or on the Dashboard, one of deterministic-test-evidence, observed-website-change, ai-generated-analysis, agent-recommendation, or human-decision.
- **Finding**: A recorded observation, deviation, or issue produced during an Orchestration_Run that may require Reviewer attention.
- **Run_ID**: The identifier of a complete Orchestration_Run.
- **Correlation_ID**: An identifier shared across a complete Orchestration_Run that links the run, its agent tasks, its website checks, its findings, its evidence, and its human decisions.
- **Task_ID**: The unique identifier of a single agent task or workflow task, which references the parent Correlation_ID.
- **Check_ID**: The unique identifier of a single deterministic website check, which references the parent Correlation_ID.
- **Finding_ID**: The unique identifier of a single Finding, which references the parent Correlation_ID.
- **Evidence_ID**: The unique identifier of a single evidence item, which references the parent Correlation_ID.
- **Review_ID**: The unique identifier of a single Human_Decision, which references the parent Correlation_ID.
- **Configurable_Limit**: A numeric limit whose value is defined in configuration and can be changed without code modification, applied to crawl depth, concurrency, request spacing, retries, timeouts, page count, and retention.
- **Static_Dashboard**: A Dashboard rendered as static HTML that is regenerated during and at the end of each Orchestration_Run and that shows the latest recorded state when refreshed.
- **Playwright_MCP**: The Model Context Protocol integration of Playwright used for controlled, read-only, agent-driven site exploration, accessibility snapshots, page inventory, and test-authoring support. Playwright_MCP is never the sole daily or repeatable test mechanism and operates under the same restrictions as every other component: Approved_Domain only, no form submissions, no external navigation, no load testing, and approved rate and crawl limits.
- **Playwright_Test**: The Playwright test runner used to execute deterministic, repeatable website checks derived from approved Baselines.
- **Specification_Agent**: The AI-assisted agent that generates draft Markdown specifications from page inventories. The existing Spec_Generator term refers to the same role as the Specification_Agent.
- **Quality_Analysis_Agent**: The AI-assisted agent that analyzes comparison results and quality signals and proposes interpretations for human review. The existing Comparator term refers to the deterministic comparison component whose results the Quality_Analysis_Agent interprets.
- **Visual_Explanation_Agent**: The AI-assisted agent that produces human-readable explanations of visual findings for Reviewer review.
- **Triage_Agent**: The AI-assisted agent that proposes a consolidated triage interpretation. The existing Triage_Reporter term refers to the deterministic component that assembles and stores the triage report that the Triage_Agent helps interpret.
- **Orchestrator**: The component that coordinates agent tasks, website checks, and their dependencies under one Correlation_ID, and that does not approve Findings or Baseline changes.
- **Observed_Website_Change**: A newly observed difference between a Daily_Observation and the approved Baseline for which no explicit deterministic Baseline expectation has been violated, recorded as requiring human review rather than as a failed check.
- **Failed_Check**: A comparison or check outcome in which an explicit deterministic Baseline expectation is violated, classified as deterministic-test-evidence.
- **Visual_Finding**: A screenshot difference recorded as requiring human review, unless an explicit deterministic rule is violated, in which case the outcome is a Failed_Check.
- **Milestone_One_Vertical_Slice**: The first implementation milestone's minimal end-to-end capability, defined in Requirement 28.

## Requirements

### Requirement 1: Discover Approved Same-Domain Pages

**User Story:** As a Reviewer, I want the system to discover same-domain pages within an approved, bounded set, so that I can control exactly which pages are monitored.

#### Acceptance Criteria

1. THE Discovery_Agent SHALL source the approved test scope for the first implementation milestone from a manually approved Page_Seed_File that lists the explicitly approved Approved_Domain URLs.
2. THE Discovery_Agent SHALL limit the Page_Seed_File to a maximum of 10 Approved_Domain URLs, where the maximum is a Configurable_Limit with a first-milestone default of 10.
3. WHEN the Discovery_Agent performs controlled discovery, THE Discovery_Agent SHALL identify only pages that resolve to the Approved_Domain.
4. IF a discovered link resolves to a domain other than the Approved_Domain, THEN THE Discovery_Agent SHALL exclude the link from the discovered set.
5. WHEN the Discovery_Agent performs controlled discovery, THE Discovery_Agent SHALL limit crawl depth to a Configurable_Limit with a first-milestone default of 2.
6. WHEN the Discovery_Agent identifies a same-domain page that is not listed in the Page_Seed_File, THE Discovery_Agent SHALL list the page in the Pending_Review_Area as requiring human review and SHALL exclude the page from the Approved_Page set.
7. THE Discovery_Agent SHALL exclude any newly discovered page from the Approved_Page set until a Reviewer explicitly approves the page through the Approval_Gate.
8. WHEN the Discovery_Agent issues requests to the Target_Site, THE Discovery_Agent SHALL issue requests at the Conservative_Request_Rate such that the spacing between consecutive discovery-page requests is at least the configured minimum request-spacing Configurable_Limit, where the configured minimum has a first-milestone initial default of 1 second, and SHALL apply a maximum concurrency Configurable_Limit with a first-milestone default of 1.
9. WHEN a request to the Target_Site fails with a transient failure, THE Discovery_Agent SHALL retry the request up to a Configurable_Limit with a first-milestone default of 2 retries.
10. WHEN the Discovery_Agent navigates to a page, THE Discovery_Agent SHALL apply a navigation timeout defined by a Configurable_Limit with a first-milestone default of 30 seconds.
11. THE Discovery_Agent SHALL produce an Agent_Handoff that lists each Approved_Page and each page requiring human review and SHALL validate the Agent_Handoff against the discovery JSON schema.
12. IF the Agent_Handoff passes discovery JSON schema validation but omits any Approved_Page or any page requiring human review, THEN THE receiving component SHALL reject the Agent_Handoff and SHALL record the rejection in the Audit_Trail.

### Requirement 2: Produce a Structured Page Inventory

**User Story:** As a Reviewer, I want a structured inventory of each page's elements, so that I have a complete and consistent record of page structure.

#### Acceptance Criteria

1. WHEN the Inventory_Agent processes an Approved_Page, THE Inventory_Agent SHALL record the page title.
2. WHEN the Inventory_Agent processes an Approved_Page, THE Inventory_Agent SHALL record the headings, links, images, buttons, and forms present on the page.
3. WHERE a form is present on an Approved_Page, THE Inventory_Agent SHALL record the form structure, including the form fields and buttons, without submitting the form.
4. THE Inventory_Agent SHALL render each Approved_Page on the Desktop_Viewport at 1440 x 900 pixels and on the Mobile_Viewport at 390 x 844 pixels using Chromium when extracting the inventory, and IF rendering succeeds on only one of the Desktop_Viewport and the Mobile_Viewport, THEN THE Inventory_Agent SHALL produce a partial Agent_Handoff using the data from the successfully rendered viewport and SHALL record which viewport failed to render.
5. WHEN the Inventory_Agent records a form field, THE Inventory_Agent SHALL exclude any value that constitutes personal information from the recorded inventory.
6. THE Inventory_Agent SHALL produce an Agent_Handoff containing the inventory and SHALL validate the Agent_Handoff against the inventory JSON schema.

### Requirement 3: Generate Draft Markdown Specifications

**User Story:** As a Reviewer, I want a draft Markdown specification generated for each page, so that I have a reviewable description of expected page behavior.

#### Acceptance Criteria

1. WHEN the Spec_Generator receives an inventory for an Approved_Page, THE Spec_Generator SHALL generate a Draft_Specification in Markdown format for that Approved_Page.
2. WHENEVER the Spec_Generator produces or checks a Draft_Specification, THE Spec_Generator SHALL include the page title, the headings, the links, the images, the buttons, and the forms from the inventory in the Draft_Specification.
3. THE Spec_Generator SHALL mark each generated specification with the state "draft".
4. THE Spec_Generator SHALL store each Draft_Specification in the Evidence_Store.

### Requirement 4: Require Human Approval to Establish a Baseline

**User Story:** As a Reviewer, I want to approve a draft before it becomes a baseline, so that only human-reviewed specifications govern monitoring.

#### Acceptance Criteria

1. WHILE a specification is in the "draft" state, THE Web_Guardian SHALL exclude the specification from use as a Baseline.
2. WHEN the Spec_Generator produces a Draft_Specification, THE Web_Guardian SHALL write the Draft_Specification to the Pending_Review_Area for human review.
3. WHEN a Reviewer approves a Draft_Specification through a controlled command or a Dashboard action, THE Approval_Gate SHALL promote the Draft_Specification to a Baseline and SHALL record the approval in the Audit_Trail as a single atomic operation, such that the Audit_Trail entry for the promotion is written only if the promotion to Baseline completes successfully.
4. IF a Draft_Specification has not been approved through the Approval_Gate, THEN THE Web_Guardian SHALL exclude the Draft_Specification from Baseline status.
5. WHEN the Approval_Gate promotes a Draft_Specification to a Baseline, THE Approval_Gate SHALL record the Reviewer-supplied name or identifier, the review timestamp, the decision, the reason, the specification version, and the affected Baseline and Finding identifiers in the Audit_Trail.
6. IF an Agent attempts to approve its own output, THEN THE Approval_Gate SHALL reject the approval and SHALL record the rejected attempt in the Audit_Trail.
7. IF the promotion of a Draft_Specification to a Baseline does not complete successfully, THEN THE Approval_Gate SHALL NOT record a successful promotion in the Audit_Trail and SHALL record the failed promotion attempt in the Audit_Trail.

### Requirement 5: Generate Playwright Tests From Approved Baselines

**User Story:** As a Reviewer, I want Playwright tests generated from approved baselines, so that monitoring reflects only human-approved expectations.

#### Acceptance Criteria

1. WHEN the Test_Generator processes a Baseline, THE Test_Generator SHALL generate Playwright tests derived from that Baseline.
2. IF a specification is not an approved Baseline, THEN THE Test_Generator SHALL exclude the specification from test generation.
3. THE Test_Generator SHALL generate tests that exercise each Approved_Page on the Desktop_Viewport at 1440 x 900 pixels and on the Mobile_Viewport at 390 x 844 pixels using Chromium.
4. THE Test_Generator SHALL store the generated Playwright test source in the version-controlled repository, and THE generated Playwright test source SHALL reference the approved Baseline version.
5. THE Web_Guardian SHALL exclude the Evidence_Store from being the sole location of the generated Playwright test source code.

### Requirement 6: Check Page Quality During Observations

**User Story:** As a Reviewer, I want each manually initiated run to check responses, navigation, content, links, images, console output, and accessibility, so that I can detect regressions in page quality.

#### Acceptance Criteria

1. WHEN the Observation_Runner runs against an Approved_Page, THE Observation_Runner SHALL record the HTTP response status for the Approved_Page.
2. WHEN the Observation_Runner runs against an Approved_Page, THE Observation_Runner SHALL verify navigation to the Approved_Page completes and SHALL record the navigation outcome.
3. WHEN the Observation_Runner runs against an Approved_Page, THE Observation_Runner SHALL verify whether the critical content defined in the Baseline is present and SHALL record the result whether the critical content is present or absent, recording an absence result as a failure result when the critical content is absent.
4. WHEN the Observation_Runner runs against an Approved_Page, THE Observation_Runner SHALL check each link defined in the Baseline and SHALL record any link that returns a non-success HTTP response status as a broken link.
5. WHEN the Observation_Runner runs against an Approved_Page, THE Observation_Runner SHALL perform an image check for each image defined in the Baseline, and WHERE the image check has been performed for an image, IF that image fails to load, THEN THE Observation_Runner SHALL record that image as a missing image, so that the Observation_Runner records a missing image only after the image check for that image has been performed.
6. WHEN the Observation_Runner runs against an Approved_Page, THE Observation_Runner SHALL record console errors emitted by the Approved_Page.
7. WHEN the Observation_Runner runs against an Approved_Page, THE Observation_Runner SHALL perform an automated WCAG 2.2 Level AA accessibility check using Axe where supported by the tooling and SHALL record the reported accessibility violations with their reported impact.
8. IF an automated accessibility violation has a reported impact of critical or serious, THEN THE Observation_Runner SHALL record the violation as a failed check requiring human review.
9. IF an automated accessibility violation has a reported impact of moderate or minor, THEN THE Observation_Runner SHALL record the violation as a Finding requiring human review and SHALL exclude the violation from causing an automatic blocking failure.
10. THE Observation_Runner SHALL record that automated accessibility testing does not establish full WCAG conformance and that manual accessibility testing remains necessary.
11. WHEN the Observation_Runner checks links on the Target_Site, THE Observation_Runner SHALL restrict link checks to the Approved_Domain.
12. WHEN the Observation_Runner encounters an External_Link on an Approved_Page, THE Observation_Runner SHALL record the External_Link and SHALL exclude the External_Link from navigation during the browser-discovery workflow.

### Requirement 7: Capture Desktop and Mobile Screenshots

**User Story:** As a Reviewer, I want desktop and mobile screenshots captured each run, so that I have visual evidence of page state.

#### Acceptance Criteria

1. WHEN the Observation_Runner runs against an Approved_Page, THE Observation_Runner SHALL capture a screenshot on the Desktop_Viewport at 1440 x 900 pixels using Chromium.
2. WHEN the Observation_Runner runs against an Approved_Page, THE Observation_Runner SHALL capture a screenshot on the Mobile_Viewport at 390 x 844 pixels using Chromium.
3. THE Observation_Runner SHALL always store each captured screenshot in the Evidence_Store together with its reference to the Approved_Page and the run identifier, such that every captured screenshot and its reference are preserved as an invariant of each run.

### Requirement 8: Compare Daily Observations Against Approved Baselines

**User Story:** As a Reviewer, I want daily observations compared against approved baselines and their outcomes classified, so that deviations are surfaced correctly without treating every difference as a failure.

#### Acceptance Criteria

1. WHEN a Daily_Observation for an Approved_Page is available, THE Comparator SHALL compare the Daily_Observation against the approved Baseline for the same Approved_Page.
2. IF a Daily_Observation violates an explicit deterministic Baseline expectation, THEN THE Comparator SHALL record the outcome as a Failed_Check with the Finding_Classification deterministic-test-evidence.
3. IF a Daily_Observation exhibits a difference from the approved Baseline for which no explicit deterministic Baseline expectation is violated, THEN THE Comparator SHALL record the outcome as an Observed_Website_Change requiring human review with the Finding_Classification observed-website-change, and THE Comparator SHALL exclude the Observed_Website_Change from being recorded as a Failed_Check.
4. IF a screenshot difference is detected, THEN THE Comparator SHALL record the outcome as a Visual_Finding requiring human review with the Finding_Classification observed-website-change, UNLESS an explicit deterministic rule is violated in the same comparison, in which case THE Comparator SHALL record only a Failed_Check with the Finding_Classification deterministic-test-evidence and SHALL suppress the Visual_Finding entirely so that no Visual_Finding is recorded for that comparison.
5. WHERE the Quality_Analysis_Agent or the Visual_Explanation_Agent produces an interpretation of a comparison outcome, THE Web_Guardian SHALL record the interpretation with the Finding_Classification ai-generated-analysis.
6. WHERE an Agent proposes an action in response to a comparison outcome, THE Web_Guardian SHALL record the proposal with the Finding_Classification agent-recommendation.
7. WHEN a Reviewer records a disposition for a comparison outcome, THE Web_Guardian SHALL record the disposition with the Finding_Classification human-decision.
8. THE Comparator SHALL exclude any Daily_Observation from use as a Baseline.
9. THE Comparator SHALL produce an Agent_Handoff containing the comparison result and SHALL validate the Agent_Handoff against the comparison JSON schema.

### Requirement 9: Consolidate Failures Into a Triage Report

**User Story:** As a Reviewer, I want failures consolidated into a structured triage report, so that I can review all deviations in one place.

#### Acceptance Criteria

1. WHEN the Comparator records one or more Failed_Checks, Observed_Website_Changes, or Visual_Findings for a run, THE Triage_Reporter SHALL consolidate the Failed_Checks and the items requiring human review into a single triage report for that run.
2. THE Triage_Reporter SHALL associate each item in the triage report with the Approved_Page, the check type, the Finding_Classification, and the run identifier.
3. THE Triage_Reporter SHALL produce the triage report in HTML format.
4. THE Triage_Reporter SHALL store the triage report in the Evidence_Store.

### Requirement 10: Preserve Evidence and Require Human Review for Baseline Changes

**User Story:** As a Reviewer, I want run evidence preserved and baseline changes gated by human review, so that every change to an approved baseline is deliberate and auditable.

#### Acceptance Criteria

1. WHEN a run completes, THE Evidence_Store SHALL preserve the Daily_Observations, screenshots, comparison results, and triage report for that run under the run directory layout defined in Requirement 24.
2. WHEN a run completes, THE Web_Guardian SHALL record the run identifier, the timestamp, and the evidence references in the Audit_Trail.
3. WHEN a Reviewer proposes a change to an existing Baseline, THE Web_Guardian SHALL write the proposed baseline change to the Pending_Review_Area and THE Approval_Gate SHALL require Reviewer approval through a controlled command or a Dashboard action before the Baseline is changed.
4. WHEN the Approval_Gate approves a change to a Baseline, THE Approval_Gate SHALL record the Reviewer-supplied name or identifier, the review timestamp, the decision, the reason, the resulting Baseline version, and the affected Baseline and Finding identifiers in the Audit_Trail.
5. WHEN the Retention_Policy performs cleanup, THE Web_Guardian SHALL exclude from deletion and modification all evidence for any run that is awaiting human review.
6. IF an Agent attempts to approve a baseline change it produced, THEN THE Approval_Gate SHALL reject the approval and SHALL record the rejected attempt in the Audit_Trail.

### Requirement 11: Safety Constraint — Never Submit Production Forms

**User Story:** As a Reviewer, I want the system to never submit forms on the production site, so that monitoring cannot trigger real-world actions.

#### Acceptance Criteria

1. WHERE a form is present on the Target_Site, THE Web_Guardian SHALL detect and inventory the form, the form fields, and the form buttons without submitting the form.
2. IF a component attempts to submit a form on the Target_Site, THEN THE Web_Guardian SHALL block the submission and SHALL record the blocked attempt in the Audit_Trail.
3. THE Web_Guardian SHALL exclude personal information from any form field it populates during observation.
4. IF a component attempts to populate a form field with personal information, THEN THE Web_Guardian SHALL block the action and SHALL record the blocked attempt in the Audit_Trail, with no exception, such that every attempt to populate a form field with personal information is always both blocked and recorded and any unblocked or unrecorded attempt is a defect.

### Requirement 12: Safety Constraint — Never Perform Load Testing

**User Story:** As a Reviewer, I want the system to never perform load testing, so that monitoring cannot stress the production site.

#### Acceptance Criteria

1. THE Web_Guardian SHALL issue requests to the Target_Site at the Conservative_Request_Rate, applying a maximum concurrency Configurable_Limit with a first-milestone default of 1 and a minimum request spacing Configurable_Limit with a first-milestone default of at least 1 second between discovery-page requests.
2. IF a requested operation would exceed the Conservative_Request_Rate, THEN THE Web_Guardian SHALL reject the operation and SHALL record the rejection in the Audit_Trail.
3. THE Web_Guardian SHALL limit controlled discovery to a crawl depth defined by a Configurable_Limit with a first-milestone default of 2.
4. THE Web_Guardian SHALL retry a transient failure up to a Configurable_Limit with a first-milestone default of 2 retries.
5. THE Web_Guardian SHALL apply a navigation timeout defined by a Configurable_Limit with a first-milestone default of 30 seconds.
6. THE Web_Guardian SHALL apply an overall run timeout defined by a Configurable_Limit with a first-milestone default of 10 minutes.
7. THE Web_Guardian SHALL restrict all requests to same-domain URLs within the Approved_Domain.
8. THE Web_Guardian SHALL exclude load testing, stress testing, and performance testing from every Orchestration_Run.

### Requirement 13: Safety Constraint — Never Leave the Approved Domain

**User Story:** As a Reviewer, I want the system to stay within the approved domain while crawling, so that monitoring is confined to the intended site.

#### Acceptance Criteria

1. WHILE crawling or navigating, THE Web_Guardian SHALL restrict requests to the Approved_Domain.
2. IF a navigation target resolves outside the Approved_Domain, THEN THE Web_Guardian SHALL block the navigation and SHALL record the blocked target in the Audit_Trail.
3. WHEN the Web_Guardian encounters an External_Link, THE Web_Guardian SHALL record the External_Link and SHALL exclude the External_Link from navigation during the browser-discovery workflow.
4. WHERE a separate link-status check for External_Links is introduced in a future milestone, THE Web_Guardian SHALL perform the link-status check only after explicit Reviewer approval through the Approval_Gate.

### Requirement 14: Safety Constraint — Never Auto-Promote a Daily Observation to a Baseline

**User Story:** As a Reviewer, I want daily observations to never become baselines automatically, so that baselines reflect only human approval.

#### Acceptance Criteria

1. THE Web_Guardian SHALL treat each Daily_Observation as evidence only.
2. IF a process attempts to promote a Daily_Observation to a Baseline without approval through the Approval_Gate, THEN THE Web_Guardian SHALL block the promotion and SHALL record the blocked attempt in the Audit_Trail.

### Requirement 15: Safety Constraint — Never Approve or Suppress a Failure Without Human Review

**User Story:** As a Reviewer, I want failures to require human review before being accepted or suppressed, so that no deviation is dismissed automatically.

#### Acceptance Criteria

1. WHILE a failure has not been reviewed by a Reviewer, THE Web_Guardian SHALL retain the failure in the triage report as open.
2. IF a process attempts to accept or suppress a failure without Reviewer review through the Approval_Gate, THEN THE Web_Guardian SHALL block the action and SHALL record the blocked attempt in the Audit_Trail.
3. WHEN a Reviewer accepts or suppresses a failure through a controlled command or a Dashboard action, THE Approval_Gate SHALL record the Reviewer-supplied name or identifier, the review timestamp, the decision, the reason, and the affected Baseline and Finding identifiers in the Audit_Trail.
4. IF an Agent attempts to accept, suppress, or otherwise dispose of its own output, THEN THE Approval_Gate SHALL reject the action and SHALL record the rejected attempt in the Audit_Trail.
5. IF a failed check or a detected difference would update an approved Baseline without Reviewer approval through the Approval_Gate, THEN THE Web_Guardian SHALL block the update and SHALL record the blocked attempt in the Audit_Trail.

### Requirement 16: Scope Constraints for the Proof-of-Concept

**User Story:** As a Reviewer, I want the proof-of-concept scope bounded, so that the system stays within agreed limits.

#### Acceptance Criteria

1. THE Web_Guardian SHALL operate without authentication against the Target_Site.
2. THE Web_Guardian SHALL operate without database access.
3. THE Web_Guardian SHALL operate without Jira integration.
4. THE Web_Guardian SHALL exercise Approved_Pages on the Desktop_Viewport at 1440 x 900 pixels and on a single Mobile_Viewport at 390 x 844 pixels.
5. THE Web_Guardian SHALL use Chromium as the only browser engine for the first implementation milestone and SHALL exclude Safari, Firefox, and additional mobile devices until the first test suite is stable.
6. THE Web_Guardian SHALL limit the monitored set to a maximum of 10 Approved_Pages, where the maximum is a Configurable_Limit with a first-milestone default of 10.
7. THE Web_Guardian SHALL support a manually initiated complete run for the first implementation milestone and SHALL exclude any requirement for a scheduler in the first implementation milestone.
8. THE first implementation milestone SHALL exclude from scope automatic daily scheduling, OpenTelemetry infrastructure, live Dashboard updates, the Virtual_Office, multiple browsers, external-link navigation, production form completion, automatic test-code generation by autonomous agents, and autonomous Baseline approval.

### Requirement 17: Structured Agent Hand-Offs and Audit Trail

**User Story:** As a Reviewer, I want structured hand-offs and a clear audit trail, so that component interactions and human decisions are traceable.

#### Acceptance Criteria

1. WHEN a component produces an Agent_Handoff, THE component SHALL format the Agent_Handoff as JSON and SHALL validate the Agent_Handoff against its JSON schema.
2. IF an Agent_Handoff fails JSON schema validation, THEN THE receiving component SHALL reject the Agent_Handoff and SHALL record the rejection in the Audit_Trail.
3. WHEN the Approval_Gate records an approval, a rejection, or a blocked action, THE Approval_Gate SHALL append the event to the Audit_Trail with the Reviewer identity, the timestamp, and the affected item.
4. THE Web_Guardian SHALL preserve the Audit_Trail for the duration of the proof-of-concept.

### Requirement 18: Telemetry for Website-Check Runs

**User Story:** As a Reviewer, I want every website-check run to emit a structured telemetry record, so that I can inspect exactly what each run did and why it reached its outcome.

#### Acceptance Criteria

1. WHEN an Orchestration_Run executes a website-check run, THE Telemetry_Emitter SHALL produce one Run_Record for that website-check run.
2. THE Telemetry_Emitter SHALL record a unique run identifier in the Run_Record.
3. THE Telemetry_Emitter SHALL record the run start timestamp and the run finish timestamp in the Run_Record.
4. THE Telemetry_Emitter SHALL record the target environment and the base URL in the Run_Record.
5. THE Telemetry_Emitter SHALL record the browser and the viewport in the Run_Record.
6. THE Telemetry_Emitter SHALL record the approved Baseline version in the Run_Record.
7. THE Telemetry_Emitter SHALL record the test-suite version in the Run_Record.
8. THE Telemetry_Emitter SHALL record the pages requested in the Run_Record.
9. THE Telemetry_Emitter SHALL record the HTTP response status and the response duration for each requested page in the Run_Record.
10. THE Telemetry_Emitter SHALL record the redirects observed during the website-check run in the Run_Record.
11. THE Telemetry_Emitter SHALL record the failed network requests observed during the website-check run in the Run_Record.
12. THE Telemetry_Emitter SHALL record the missing assets and missing images observed during the website-check run in the Run_Record.
13. THE Telemetry_Emitter SHALL record the browser console errors and console warnings observed during the website-check run in the Run_Record.
14. THE Telemetry_Emitter SHALL record the accessibility findings observed during the website-check run in the Run_Record.
15. THE Telemetry_Emitter SHALL record the screenshot results and the visual-comparison results in the Run_Record.
16. THE Telemetry_Emitter SHALL record the test result in the Run_Record as one of passed, failed, skipped, or requires-human-review.
17. THE Telemetry_Emitter SHALL record links to the screenshots, traces, and other evidence for the website-check run in the Run_Record.

### Requirement 19: Telemetry for Agent Tasks

**User Story:** As a Reviewer, I want every agent task to emit a structured telemetry record, so that I can trace what each agent did, what it produced, and what decisions it made.

#### Acceptance Criteria

1. WHEN an Agent performs a task during an Orchestration_Run, THE Telemetry_Emitter SHALL produce one Agent_Task_Record for that task.
2. THE Telemetry_Emitter SHALL record a unique task identifier in the Agent_Task_Record.
3. THE Telemetry_Emitter SHALL record the parent run identifier in the Agent_Task_Record.
4. THE Telemetry_Emitter SHALL record the agent name and the agent role in the Agent_Task_Record.
5. THE Telemetry_Emitter SHALL record the task assigned to the Agent in the Agent_Task_Record.
6. THE Telemetry_Emitter SHALL record the task start timestamp and the task finish timestamp in the Agent_Task_Record.
7. THE Telemetry_Emitter SHALL record the current task status in the Agent_Task_Record.
8. THE Telemetry_Emitter SHALL record the input artefacts and their versions in the Agent_Task_Record.
9. THE Telemetry_Emitter SHALL record the output artefacts in the Agent_Task_Record.
10. THE Telemetry_Emitter SHALL record the tools used by the Agent in the Agent_Task_Record.
11. THE Telemetry_Emitter SHALL record the agent hand-offs associated with the task in the Agent_Task_Record.
12. THE Telemetry_Emitter SHALL record the decisions and recommendations produced by the Agent in the Agent_Task_Record.
13. WHERE the Agent produces a confidence value for a decision, THE Telemetry_Emitter SHALL record the confidence value in the Agent_Task_Record.
14. THE Telemetry_Emitter SHALL record the errors, retries, and timeouts encountered during the task in the Agent_Task_Record.
15. THE Telemetry_Emitter SHALL record whether the task requires human review in the Agent_Task_Record.
16. WHEN a Reviewer records a Human_Decision for the task, THE Telemetry_Emitter SHALL record the Human_Decision as one of accepted, rejected, dismissed, or baseline-update-approved in the Agent_Task_Record.
17. WHEN a Reviewer records a Human_Decision for the task, THE Telemetry_Emitter SHALL record the reason for the Human_Decision in the Agent_Task_Record.

### Requirement 20: Observability of Runs

**User Story:** As a Reviewer, I want structured, correlated, and human-readable observability output, so that even a beginner can follow what the system did and trust the record.

#### Acceptance Criteria

1. WHEN the Telemetry_Emitter emits a Telemetry_Event, THE Telemetry_Emitter SHALL format the Telemetry_Event as structured JSON.
2. THE Telemetry_Emitter SHALL produce logs that identify the run, the agent, the task, and the outcome in plain language suitable for a beginner to inspect.
3. THE Telemetry_Emitter SHALL assign one Correlation_ID shared across the complete Orchestration_Run that links the run, the Agent_Task_Records, the website checks, the Findings, the evidence, and the human decisions for the same logical run.
4. THE Telemetry_Emitter SHALL assign to each child entity a unique identifier that references the parent Correlation_ID, comprising a Run_ID for the complete run, a Task_ID for each agent or workflow task, a Check_ID for each deterministic website check, a Finding_ID for each Finding, an Evidence_ID for each evidence item, and a Review_ID for each Human_Decision.
5. WHEN an Orchestration_Run completes, THE Web_Guardian SHALL produce a Run_Report in HTML format for that Orchestration_Run.
6. WHEN an Orchestration_Run completes, THE Web_Guardian SHALL preserve an Audit_Record for that Orchestration_Run.
7. WHEN the Web_Guardian records completed audit events, THE Web_Guardian SHALL provide application-level append-only behavior by appending the audit events to the audit log and SHALL exclude any application edit operation for completed audit events.
8. WHEN a correction to a completed record is required, THE Web_Guardian SHALL record the correction as a new audit event rather than altering the existing record.
9. IF a process attempts to alter or modify a completed Audit_Record or completed audit event through the application, THEN THE Web_Guardian SHALL reject the attempt and SHALL record the rejected attempt in the Audit_Trail.
10. THE Web_Guardian SHALL record that the append-only guarantee is application-level only, that the underlying local audit files remain technically modifiable by anyone with filesystem access, and SHALL exclude any claim of cryptographic immutability or regulatory-grade immutability for the audit record in the first implementation milestone.
11. THE Telemetry_Emitter SHALL record concise decision summaries and supporting evidence and SHALL exclude hidden reasoning and internal chain-of-thought from all telemetry, logs, reports, and audit records.
12. THE Telemetry_Emitter SHALL expose telemetry through the Telemetry_Exporter interface that supports adding OpenTelemetry integration later without changing the recorded telemetry content.
13. IF a Telemetry_Event, log entry, Run_Report, or Audit_Record would contain a token, a credential, personal data, or a secret, THEN THE Telemetry_Emitter SHALL redact the value before the record is written.
14. THE Web_Guardian SHALL apply a configurable Retention_Policy, defined by a Configurable_Limit, that governs how long screenshots, traces, and reports are preserved in the Evidence_Store.

### Requirement 21: Monitoring Dashboard

**User Story:** As a Reviewer, I want a static dashboard that shows the latest and historical run state, so that I can understand current website health and agent activity at a glance.

#### Acceptance Criteria

1. THE Dashboard SHALL be delivered as a Static_Dashboard rendered as static HTML for the first implementation milestone.
2. WHILE an Orchestration_Run is executing, THE Web_Guardian SHALL regenerate the Static_Dashboard during the run and at the end of the run.
3. WHEN a Reviewer refreshes the Static_Dashboard, THE Static_Dashboard SHALL display the latest recorded state.
4. THE first implementation milestone SHALL exclude real-time Dashboard updates from scope.
5. THE Telemetry_Event interface SHALL be designed so that a live Dashboard can be added in a future milestone without changing the Telemetry_Event schema.
6. THE Dashboard SHALL display the latest overall website health.
7. THE Dashboard SHALL display each Agent in one of the states queued, working, completed, failed, or awaiting-review.
8. THE Dashboard SHALL display the task currently assigned to each Agent.
9. THE Dashboard SHALL display the execution duration and the progress for each Agent.
10. THE Dashboard SHALL display findings grouped by severity and by type.
11. THE Dashboard SHALL display the findings awaiting human review.
12. THE Dashboard SHALL display historical runs and trends.
13. WHEN a Reviewer selects a finding on the Dashboard, THE Dashboard SHALL open the supporting screenshots, traces, and logs for that finding.
14. THE Dashboard SHALL display each item with its Finding_Classification and SHALL visually distinguish deterministic test evidence, observed website changes, AI-generated analysis, agent recommendations, and human decisions.
15. THE Dashboard SHALL exclude presenting any AI-generated conclusion as a deterministic fact.
16. IF the Web_Guardian fails to regenerate the Static_Dashboard both during the Orchestration_Run and at the end of the Orchestration_Run, THEN THE Web_Guardian SHALL halt the Orchestration_Run or mark the Orchestration_Run as failed and SHALL exclude continuing the Orchestration_Run with a stale Static_Dashboard.

### Requirement 22: Safety Constraint — Protect Sensitive Data and Reasoning in Telemetry

**User Story:** As a Reviewer, I want telemetry to never expose secrets or hidden reasoning, so that observability does not create a data-leak or trust risk.

#### Acceptance Criteria

1. THE Telemetry_Emitter SHALL exclude tokens, credentials, personal data, and secrets from every Telemetry_Event, log entry, Run_Report, and Audit_Record.
2. IF a value identified as a token, a credential, personal data, or a secret would be written to telemetry, THEN THE Telemetry_Emitter SHALL block the write of the raw value and SHALL substitute a redacted placeholder.
3. THE Telemetry_Emitter SHALL exclude internal chain-of-thought and hidden reasoning from every Telemetry_Event, log entry, Run_Report, and Audit_Record.
4. WHERE a decision requires explanation, THE Telemetry_Emitter SHALL record a concise decision summary and the supporting evidence in place of internal chain-of-thought.

### Requirement 23: Future Virtual Office Visualization (Deferred — Out of Scope for First Milestone)

**User Story:** As a Reviewer, I want telemetry designed to later support a virtual office visualization that shows only real activity, so that a future view cannot misrepresent the system as working when it is idle.

#### Acceptance Criteria

1. THE first implementation milestone SHALL exclude the Virtual_Office visualization from scope and SHALL deliver reliable event capture, Correlation_ID linkage, and reporting.
2. THE Telemetry_Emitter SHALL emit Telemetry_Events, and THE Telemetry_Emitter SHALL emit those Telemetry_Events in a form that supports a future Virtual_Office visualization without requiring changes to the recorded telemetry content.
3. WHERE the Virtual_Office is implemented in a future milestone, THE Virtual_Office SHALL display only real Telemetry_Events produced by the orchestration system.
4. IF no task is running, THEN the future Virtual_Office SHALL display an idle state and SHALL exclude any simulated agent activity.
5. IF the future Virtual_Office receives no real Telemetry_Event for an Agent, THEN the future Virtual_Office SHALL exclude any simulated successful activity for that Agent.

### Requirement 24: Local Evidence Storage and Run Directory Layout

**User Story:** As a Reviewer, I want each run's telemetry and evidence stored as local files in a predictable layout, so that I can inspect any run without a database or external service.

#### Acceptance Criteria

1. THE Web_Guardian SHALL store telemetry and evidence for the first implementation milestone as local JSON files together with an append-only JSONL event log under the Evidence_Store.
2. WHEN an Orchestration_Run executes, THE Web_Guardian SHALL create a run directory at `artifacts/runs/<run-id>/` under the Evidence_Store for that run.
3. THE Web_Guardian SHALL store the run metadata in `run.json`, the append-only event log in `events.jsonl`, the deterministic results in `results.json`, the findings in `findings.json`, and the append-only audit log in `audit.jsonl` within the run directory.
4. THE Web_Guardian SHALL store screenshots under `screenshots/`, traces under `traces/`, accessibility results under `accessibility/`, agent task records under `agent-tasks/`, and the run report at `report/index.html` within the run directory.
5. WHEN the Web_Guardian writes an entry to `events.jsonl` or `audit.jsonl`, THE Web_Guardian SHALL append the entry without modifying existing entries, and IF an attempted write to `events.jsonl` or `audit.jsonl` would modify or overwrite an existing entry instead of purely appending, THEN THE Web_Guardian SHALL reject or halt the write, SHALL surface an integrity error, and SHALL preserve the existing log content unchanged.
6. WHEN the Retention_Policy performs cleanup, THE Web_Guardian SHALL exclude from deletion and modification the complete run directory for any run that is awaiting human review.
7. THE Evidence_Store SHALL retain, for each run, the test-suite version, the execution result, the traces, the screenshots, and the reports, together with a manifest or snapshot identifying the exact tests executed where needed to reproduce the run.
8. THE Web_Guardian SHALL store the generated Playwright test source in the version-controlled repository, and THE Web_Guardian SHALL exclude the Evidence_Store from being the sole location of the generated Playwright test source code.

### Requirement 25: Local, Beginner-Friendly Telemetry Implementation

**User Story:** As a Reviewer, I want the first telemetry implementation to be local and simple, so that the proof-of-concept runs without infrastructure while leaving room for OpenTelemetry later.

#### Acceptance Criteria

1. THE Web_Guardian SHALL implement telemetry for the first implementation milestone using structured JSON files and JSONL files on the local file system.
2. THE Web_Guardian SHALL operate without a database, without an OpenTelemetry Collector, without a cloud telemetry service, without distributed infrastructure, without real-time messaging, and without the Virtual_Office in the first implementation milestone.
3. THE Telemetry_Emitter SHALL provide the Telemetry_Exporter interface so that an OpenTelemetry integration can be added in a future milestone without changing the recorded telemetry content.

### Requirement 26: Finding Classification in Reports and Dashboard

**User Story:** As a Reviewer, I want every reported item labeled by its source, so that I never mistake AI-generated analysis for a deterministic fact.

#### Acceptance Criteria

1. WHEN the Web_Guardian records an item in a report, on the Dashboard, or in telemetry, THE Web_Guardian SHALL assign the item a Finding_Classification of deterministic-test-evidence, observed-website-change, ai-generated-analysis, agent-recommendation, or human-decision.
2. THE Web_Guardian SHALL classify a Failed_Check as deterministic-test-evidence, an Observed_Website_Change as observed-website-change, a Visual_Finding as observed-website-change, an AI interpretation as ai-generated-analysis, an Agent proposal as agent-recommendation, and a Reviewer disposition as human-decision, consistent with Requirement 8 and Requirement 27.
3. THE Web_Guardian SHALL distinguish deterministic test evidence, observed website changes, AI-generated analysis, agent recommendations, and human decisions in every Run_Report and on the Dashboard.
4. THE Web_Guardian SHALL exclude presenting any AI-generated conclusion as a deterministic fact in any Run_Report, on the Dashboard, or in telemetry.
5. IF an item qualifies as more than one Finding_Classification source type, THEN THE Web_Guardian SHALL assign the single Finding_Classification determined by the strict precedence order human-decision over agent-recommendation over ai-generated-analysis over observed-website-change over deterministic-test-evidence, such that human-decision overrides agent-recommendation, agent-recommendation overrides ai-generated-analysis, ai-generated-analysis overrides observed-website-change, and observed-website-change overrides deterministic-test-evidence.

### Requirement 27: Visual Comparison and Screenshot Baselines

**User Story:** As a Reviewer, I want visual differences surfaced for human review rather than auto-failing a run, so that screenshot comparison does not produce false failures or silently change a baseline.

#### Acceptance Criteria

1. WHEN the Comparator compares a current screenshot against a baseline screenshot for the same Approved_Page and viewport, THE Comparator SHALL calculate a Visual_Difference and SHALL store the baseline screenshot and the current screenshot in the Evidence_Store.
2. WHEN the Comparator records a Visual_Difference, THE Comparator SHALL create a Visual_Finding requiring human review with the Finding_Classification observed-website-change, consistent with Requirement 8.
3. THE Comparator SHALL exclude failing a run solely because a pixel difference exceeds a percentage threshold.
4. IF a deterministic rule detects a missing element, overlapping content, or an unavailable critical call-to-action, THEN THE Comparator SHALL record a Failed_Check with the Finding_Classification deterministic-test-evidence.
5. THE Web_Guardian SHALL exclude automatically updating any screenshot baseline, and a screenshot baseline SHALL change only through Reviewer approval via the Approval_Gate.

### Requirement 28: Milestone-One Vertical Slice

**User Story:** As a Reviewer, I want a minimal end-to-end vertical slice for the first milestone, so that the system proves the full flow on one page before expanding.

#### Acceptance Criteria

1. WHEN a Reviewer manually initiates one command that checks the approved homepage, THE Web_Guardian SHALL execute the complete run for the homepage.
2. THE Web_Guardian SHALL check the homepage on the Desktop_Viewport at 1440 x 900 pixels and on the Mobile_Viewport at 390 x 844 pixels.
3. WHEN the Web_Guardian checks the homepage, THE Web_Guardian SHALL execute the deterministic checks defined in Requirement 6.
4. WHEN the Web_Guardian checks the homepage, THE Web_Guardian SHALL capture screenshots and traces.
5. WHEN the Web_Guardian checks the homepage, THE Web_Guardian SHALL write structured telemetry for the run.
6. WHEN the run completes, THE Web_Guardian SHALL produce an HTML Run_Report and regenerate the Static_Dashboard.
7. WHILE the run executes, THE Web_Guardian SHALL submit no form on the Target_Site.
8. WHEN the run completes, THE Web_Guardian SHALL preserve the evidence in a form that a human can inspect.
9. THE Web_Guardian SHALL consider the first implementation milestone successful WHEN all of Requirement 28 acceptance criteria 1 through 8 hold.
10. THE Web_Guardian architecture MAY support up to 10 Approved_Pages, and THE first implementation MUST begin with one Approved_Page and expand incrementally.

### Requirement 29: Manually Initiated Run Execution Interface

**User Story:** As a Reviewer, I want runs to be manually initiated with room to add scheduling later, so that the first milestone needs no scheduler while remaining extensible.

#### Acceptance Criteria

1. WHERE the Web_Guardian provides a manual run execution interface, WHEN a Reviewer manually triggers the run through that interface, THE Web_Guardian SHALL initiate a complete run.
2. THE Web_Guardian SHALL exclude any requirement for an automatic scheduler in the first implementation milestone.
3. THE execution interface SHALL be designed so that scheduled daily runs can be added in a future milestone without changing the recorded telemetry content or the run directory layout.

### Requirement 30: Playwright MCP and Playwright Test Roles

**User Story:** As a Reviewer, I want the roles of Playwright MCP and Playwright Test clearly separated and constrained, so that controlled exploration never replaces deterministic, repeatable checks.

#### Acceptance Criteria

1. THE Web_Guardian SHALL use Playwright_MCP for controlled, read-only, agent-driven site exploration, accessibility snapshots, page inventory, and test-authoring support.
2. THE Web_Guardian SHALL use Playwright_Test for deterministic, repeatable website checks.
3. THE Web_Guardian SHALL exclude Playwright_MCP from being the sole daily or repeatable test mechanism.
4. WHEN Playwright_MCP accesses the Target_Site, THE Web_Guardian SHALL restrict Playwright_MCP to the Approved_Domain, SHALL exclude form submissions, SHALL exclude external navigation, SHALL exclude load testing, and SHALL apply the approved Conservative_Request_Rate and crawl Configurable_Limits.
5. WHILE Playwright_MCP performs site exploration, THE Web_Guardian SHALL restrict Playwright_MCP to read-only operations.

### Requirement 31: AI-Assisted Agents and Deterministic Components

**User Story:** As a Reviewer, I want AI-assisted agents clearly separated from deterministic components, so that I can trust which outputs are objective and which require human judgement.

#### Acceptance Criteria

1. THE Web_Guardian SHALL classify the Specification_Agent, the Quality_Analysis_Agent, the Visual_Explanation_Agent, and the Triage_Agent as AI-assisted agents.
2. THE Web_Guardian SHALL classify the discovery crawler, the Playwright_Test runner, the Axe accessibility scanner, the screenshot comparison, the Telemetry_Emitter, the Evidence_Store, the HTML report generator, and the approval command as deterministic components.
3. WHERE the Inventory_Agent uses Playwright_MCP, THE Inventory_Agent SHALL extract objective page elements deterministically where possible.
4. THE Orchestrator SHALL coordinate agent tasks, website checks, and their dependencies.
5. THE Orchestrator SHALL exclude approving any Finding and SHALL exclude approving any Baseline change.
