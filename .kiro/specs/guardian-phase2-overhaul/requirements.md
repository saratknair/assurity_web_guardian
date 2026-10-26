# Requirements Document

## Introduction

Guardian Phase 2 Overhaul is the next major phase of the existing Assurity Web Guardian (AWG), a human-supervised website quality monitoring system for the public website at https://assurity.nz. AWG is deterministic automation, not autonomous AI: its "agents" are named TypeScript code modules with single responsibilities that consume zero AI tokens and make no large-language-model calls at runtime. A human reviewer ("Sarat") approves all baselines, scope, and findings. This phase preserves every existing guarantee of the current system — read-only public exposure, human-in-control approvals, separation and labelling of deterministic facts versus AI-assisted opinion, approved-domain-only crawling, conservative request pacing, no form submission, no load testing, and a tamper-evident append-only audit log — while delivering six areas of new capability.

The six areas are: (1) a redesigned, professional static Dashboard with larger, clearer charts of run health, trends, and findings breakdowns; (2) a Virtual Office overhaul into a NASA-control-center / sci-fi command-center experience where human-looking characters dynamically enter through a door, occupy any available desk only when a real event requires work, and leave when finished, with billboarded name labels floating above the moving character; (3) a new local Admin GUI control panel that launches the Dashboard and Virtual Office, shows the guarded domain and the run list newest-first, and lets the operator change the schedule and trigger a manual run; (4) full-site page coverage that discovers and scans all pages of the configured domain while preserving the approved-domain boundary, conservative crawling, and meaningful human approval of scope; (5) a hybrid, entirely free cloud deployment using a public GitHub repository, GitHub Actions as a cloud runner that executes scheduled and manually dispatched runs when the local machine is off, and GitHub Pages as the always-on public read-only historical site; and (6) security and robustness treated as first-class requirements across all of the above.

Everything in this phase MUST remain free: no paid cloud services, no paid hosting, and no external data sharing beyond the operator publishing their own run results to their own GitHub Pages site. Runs remain deterministic and zero-token at runtime. The phase MUST remain backward compatible with existing runs, evidence, and baselines where feasible, and MUST record any migration that is required.

## Glossary

Terms defined by the existing Assurity Web Guardian specification (for example Web_Guardian, Discovery_Agent, Inventory_Agent, Observation_Runner, Comparator, Baseline, Evidence_Store, Approved_Domain, Audit_Record, Correlation_ID, Run_ID) retain their existing meanings. The following terms are introduced or refined for this phase.

- **Agent**: A named deterministic TypeScript code component with a single responsibility that runs as part of an Orchestration_Run. An Agent is NOT a token-consuming or large-language-model AI agent; it makes no AI calls at runtime and consumes zero AI tokens. "AI-assisted" Agents (Specification_Agent, Quality_Analysis_Agent, Visual_Explanation_Agent, Triage_Agent) emit templated text that is explicitly labelled as not a deterministic fact, and are architected so a real LLM could be substituted later without being present now.
- **Deterministic_Agent**: An Agent whose output depends only on its inputs: Discovery_Agent (crawler), Inventory_Agent, Test_Generator, Observation_Runner, and Comparator.
- **Orchestrator**: The coordinator Agent that sequences Agents during an Orchestration_Run.
- **Dashboard**: The static HTML+JavaScript artifact (artifacts/dashboard.html and supporting assets) that presents run health, trends, and findings breakdowns, and that functions with no server when hosted on GitHub Pages.
- **Charting_Library**: A free, openly licensed JavaScript library used by the Dashboard to render charts.
- **Virtual_Office**: The React + Vite + Three.js (react-three-fiber + drei) 3D application that visualizes genuine run activity as a command-center environment.
- **Office_Character**: A human-looking 3D model (male or female, with distinguishing personality) representing an Agent that is actively working.
- **Billboard_Label**: Floating text (an Agent name or status) that always faces the active camera.
- **Spawn_Camera**: The initial Virtual_Office camera placed at the top back corner of the room to show the whole office on load.
- **Admin_GUI**: The local web control panel that launches the Dashboard and Virtual_Office, displays the Guarded_Domain and run list, changes the schedule, and triggers manual runs.
- **Intro_Cinematic**: The opening transition shown when the Virtual_Office first loads: a cloud scene positioned above a depiction of New Zealand with the application title text set among the clouds, which then parts/dissolves to reveal the command-center office beneath.
- **Guarded_Domain**: The single domain currently configured as the scope of monitoring. Initially `assurity.nz`. Stored as configuration, never hard-coded in a way that blocks future domains.
- **Domain_Config**: The configuration record that defines the Guarded_Domain and its crawl parameters.
- **Full_Site_Scope**: The complete set of same-domain pages discovered for the Guarded_Domain and proposed as the scope of record.
- **Scope_Approval**: A Reviewer decision that approves a discovered Full_Site_Scope (or a delta against the previously approved scope) as the authoritative page list.
- **Cloud_Runner**: The GitHub Actions workflow that installs Node and Playwright and executes the Guardian on a schedule or on manual dispatch in GitHub's cloud.
- **Pages_Site**: The GitHub Pages static site that serves the Dashboard and the Virtual_Office in historical/replay mode from published static JSON, with no live server.
- **Published_Data**: The static JSON, HTML, and image artifacts published to the Pages_Site after a run.
- **Run_Data_Branch**: A dedicated git branch in the public repository (for example `runs-data`) to which the Cloud_Runner commits full raw run artifacts (events.jsonl, findings.json, results.json, screenshots, traces, accessibility, report) so the local machine can retrieve complete run fidelity, keeping the main branch free of large binary run artifacts.
- **Cloud_Sync**: The operation by which the local machine retrieves cloud-produced runs from the Run_Data_Branch into the local artifacts store so the local Event_Server, Dashboard, and Virtual_Office can show them as historical runs.
- **Workflow_Dispatch**: GitHub's manual "Run workflow" trigger for the Cloud_Runner.
- **Event_Server**: The existing local read-only HTTP+SSE server (src/reporting/event-server.ts, port 7788) that serves run data and live events to the local control center.
- **Live_Mode**: The local experience, available when the laptop is on, with live SSE in the Virtual_Office, manual runs, scheduling, and the Admin_GUI.
- **Replay_Mode**: The read-only historical experience on the Pages_Site, reconstructed from Published_Data with no live SSE and no manual trigger.
- **Loopback_Interface**: The network interface 127.0.0.1 / ::1, reachable only from the local machine.
- **Action_Secret**: A sensitive value stored exclusively as a GitHub Actions encrypted secret and never committed to the repository.
- **Reviewer**: The human operator (Sarat) who approves scope, baselines, and findings.

## Requirements

### Requirement 1: Redesigned Dashboard

**User Story:** As the Reviewer, I want a polished, professional dashboard with large, clear charts, so that I can understand run health, trends, and findings at a glance.

#### Acceptance Criteria

1. THE Dashboard SHALL present run health, trends over time, and findings breakdowns using chart visualizations, and the combined chart area SHALL occupy at least 50 percent of the rendered page area on the Desktop_Viewport (1440x900).
2. THE Dashboard SHALL render a findings breakdown by Approved_Page, a findings breakdown by severity, and a breakdown distinguishing new accessibility issues from recurring accessibility issues, with each breakdown showing a count per category.
3. THE Dashboard SHALL render a trend view that plots run health in chronological order across the most recent available runs, displaying at least the 10 most recent runs when 10 or more runs exist, or all available runs when fewer than 10 exist.
4. THE Dashboard SHALL use only Charting_Libraries that are free and openly licensed.
5. WHEN the Dashboard is opened as a static file served by the Pages_Site with no running server, THE Dashboard SHALL render every chart from Published_Data alone, issue no requests to the Event_Server or any other server, and complete initial render within 3 seconds on the Desktop_Viewport.
6. WHERE run data is available locally through the Event_Server, THE Dashboard SHALL render the same views as the static-file mode from that local data source.
7. IF no run data is available from the active data source, THEN THE Dashboard SHALL display a visible empty-state message indicating that no run data is available and SHALL NOT display blank or broken chart containers.
8. THE Dashboard SHALL display a visible label indicating "not a deterministic fact" on every AI-assisted analysis element, and SHALL visually distinguish deterministic test evidence from AI-assisted analysis using a persistent visual treatment applied to all AI-assisted elements and to no deterministic test evidence element.
9. IF an AI-assisted analysis element is rendered without its "not a deterministic fact" label or with the deterministic visual treatment, THEN THE Dashboard SHALL treat this as a render error and SHALL display the empty-state message rather than present the unlabelled element.

### Requirement 2: Virtual Office Command-Center Overhaul

**User Story:** As the Reviewer, I want the Virtual Office to look like a sci-fi command center with human characters that come and go with real work, so that the visualization is impressive and honestly reflects actual activity.

#### Acceptance Criteria

1. THE Virtual_Office SHALL render a command-center environment that includes screen surfaces, dynamic lighting, and atmospheric elements beyond the current static desk grid.
2. WHEN a real run event indicates that an Agent has begun work AND at least one available desk exists, THE Virtual_Office SHALL cause an Office_Character to enter through a door, walk to an available desk, and sit, completing the entry animation within 1.0 to 3.0 seconds of the event being received.
3. IF a real run event indicates that an Agent has begun work AND no available desk exists, THEN THE Virtual_Office SHALL hold the Office_Character in a waiting state at the door and SHALL seat it within 1.0 to 3.0 seconds of a desk becoming available.
4. WHEN a real run event indicates that an Agent has finished work, THE Virtual_Office SHALL cause the corresponding Office_Character to leave the desk and exit within 1.0 to 3.0 seconds of the event being received, and SHALL mark that desk as available upon exit.
5. THE Virtual_Office SHALL define an available desk as a desk that is not currently assigned to or occupied by any Office_Character, SHALL assign desks dynamically at the time an Office_Character enters, and SHALL NOT bind any Agent to a fixed desk.
6. THE Virtual_Office SHALL render each Office_Character as a human-looking model that is identifiably male or female and visually distinct from every other concurrently present Office_Character by at least two of the following attributes: body model, clothing color, and hair, replacing the current blocky placeholders.
7. THE Virtual_Office SHALL display each Agent's name as a Billboard_Label positioned above the moving Office_Character rather than above a desk, showing the full Agent name truncated to a maximum of 24 characters with a trailing ellipsis when the name exceeds 24 characters.
8. WHILE the camera angle changes, THE Virtual_Office SHALL keep every Billboard_Label oriented to face the active camera, updating its orientation within 100 milliseconds of each camera movement.
9. WHEN the Virtual_Office loads, THE Spawn_Camera SHALL be positioned at the top back corner of the room so that the whole office is visible.
10. THE Virtual_Office SHALL provide both an orbit camera and a first-person walk camera.
11. THE Virtual_Office SHALL display an Office_Character as entering, present, or working only when a corresponding genuine run event exists in the source run data, and SHALL NOT fabricate, simulate, or synthesize any Office_Character activity that is not backed by a genuine run event.
12. IF no run event indicates active work, THEN THE Virtual_Office SHALL present an honest idle state with no Office_Character fabricated as working.
13. IF a run event is malformed or absent, THEN THE Virtual_Office SHALL ignore that event, SHALL NOT render any Office_Character for it, and SHALL retain the current honest state without fabricating agent activity.

### Requirement 3: Virtual Office Intro Cinematic

**User Story:** As the Reviewer, I want an opening cinematic of clouds over New Zealand that parts to reveal the office, so that entering the Virtual Office feels polished and sets the scene.

#### Acceptance Criteria

1. WHEN the Virtual_Office first loads, THE Virtual_Office SHALL display the Intro_Cinematic showing a cloud scene above a depiction of New Zealand with the application title text positioned among the clouds, before revealing the office.
2. WHEN the Intro_Cinematic has displayed the cloud scene, THE Virtual_Office SHALL animate the clouds parting or dissolving to reveal the command-center office beneath, completing the reveal within 2.0 to 6.0 seconds of load.
3. WHEN the Intro_Cinematic reveal completes, THE Virtual_Office SHALL place the camera at the Spawn_Camera position (top back corner) showing the whole office.
4. THE Virtual_Office SHALL allow the Reviewer to skip the Intro_Cinematic and proceed directly to the office view.
5. THE Intro_Cinematic SHALL be a purely visual loading transition and SHALL NOT represent or imply any Agent activity or run state.
6. WHILE the Intro_Cinematic is playing, THE Virtual_Office SHALL continue to derive office state only from genuine run events, so that the state shown after the reveal is honest and not fabricated by the cinematic.

### Requirement 4: Admin GUI Control Panel

**User Story:** As the Reviewer, I want a local control panel, so that I can see the guarded domain and recent runs and can launch views, change the schedule, and trigger runs on demand.

#### Acceptance Criteria

1. THE Admin_GUI SHALL provide controls that launch the Virtual_Office and the Dashboard.
2. THE Admin_GUI SHALL display the Guarded_Domain currently configured for monitoring.
3. THE Admin_GUI SHALL display the list of runs ordered newest first, each with its status and summary.
4. WHEN the Reviewer submits a schedule change through the Admin_GUI, THE Admin_GUI SHALL persist the new schedule to the system configuration.
5. WHEN the Reviewer triggers a manual run through the Admin_GUI, THE Admin_GUI SHALL initiate a single Orchestration_Run for the configured Guarded_Domain.
6. THE Admin_GUI SHALL read the Guarded_Domain from Domain_Config and SHALL NOT hard-code `assurity.nz` in any way that prevents configuring a different domain in future.
7. WHILE a single Guarded_Domain is configured, THE Admin_GUI SHALL operate against that one domain and SHALL run the configured page list for whichever domain is configured.

### Requirement 5: Full-Site Page Coverage

**User Story:** As the Reviewer, I want the Guardian to discover and scan all pages of the configured domain, so that coverage is complete while I still approve the scope.

#### Acceptance Criteria

1. WHEN discovery runs, THE Discovery_Agent SHALL discover same-domain pages of the Guarded_Domain beyond the previous fixed set of ten pages, up to a configurable Maximum_Discovery_Count (default 500 pages), and SHALL propose the discovered pages as the Full_Site_Scope.
2. WHILE discovering pages, THE Discovery_Agent SHALL restrict navigation to the Approved_Domain and SHALL NOT follow links to any host outside the Approved_Domain.
3. WHILE discovering pages, THE Discovery_Agent SHALL observe the Conservative_Request_Rate, issuing no more than one request per second per host (configurable, default 1 request/second) with a minimum crawl delay of 1000 milliseconds between consecutive requests to the same host.
4. THE Discovery_Agent SHALL present the discovered Full_Site_Scope to the Reviewer for Scope_Approval and SHALL NOT add any discovered page to the authoritative scope until Scope_Approval is granted.
5. WHEN discovery runs again after a prior Scope_Approval, THE Discovery_Agent SHALL present the Scope_Difference, comprising the set of newly discovered pages not in the previously approved scope and the set of previously approved pages no longer discoverable, so that Scope_Approval remains meaningful across many pages.
6. WHEN the number of discovered pages exceeds a configurable Large_Scope_Threshold (default 25 pages), THE Discovery_Agent SHALL present the Full_Site_Scope grouped by URL path segment so that the Reviewer can grant Scope_Approval at the group level without reviewing each page individually.
7. WHEN Scope_Approval is granted, THE Observation_Runner SHALL scan the approved Full_Site_Scope on subsequent runs.
8. IF a discovered link redirects to a host outside the Approved_Domain, THEN THE Discovery_Agent SHALL exclude the redirect target from the Full_Site_Scope, retain the pages already discovered within the Approved_Domain, and record an indication that an off-domain redirect was skipped.

### Requirement 6: Hybrid Cloud Deployment on Free Services

**User Story:** As the Reviewer, I want the Guardian to run in the cloud when my laptop is off and to be viewable from anywhere, so that monitoring continues and results are always available without paying for hosting.

#### Acceptance Criteria

1. THE Guardian codebase SHALL reside in a public GitHub repository that is editable from Kiro on the web.
2. WHEN a scheduled trigger fires, THE Cloud_Runner SHALL install the project-pinned versions of Node and Playwright and then execute exactly one Orchestration_Run in GitHub Actions without any AI token usage.
3. THE Cloud_Runner SHALL fire the scheduled trigger at a fixed interval of at least once every 24 hours.
4. WHILE the local machine is off, THE Cloud_Runner SHALL still execute scheduled Orchestration_Runs with no dependency on the local machine being powered on or reachable.
5. WHEN the Reviewer activates the Workflow_Dispatch control in the GitHub Actions UI, THE Cloud_Runner SHALL execute a single on-demand Orchestration_Run.
6. WHEN an Orchestration_Run completes successfully in the Cloud_Runner, THE Cloud_Runner SHALL publish the resulting Published_Data and the Dashboard to the Pages_Site such that the updated files are retrievable from the Pages_Site within 10 minutes of run completion.
7. WHEN an Orchestration_Run completes successfully on the local machine, THE Guardian SHALL publish the resulting Published_Data and the Dashboard to the Pages_Site.
8. IF an Orchestration_Run in the Cloud_Runner terminates with a failure or exceeds a run time limit of 30 minutes, THEN THE Cloud_Runner SHALL end the run, record a failure indication in the GitHub Actions run status, and preserve the previously published Published_Data on the Pages_Site unchanged.
9. IF publishing Published_Data or the Dashboard to the Pages_Site fails, THEN THE publishing agent SHALL report a failure indication in the GitHub Actions run status and SHALL leave the previously published Published_Data on the Pages_Site unchanged.
10. THE Pages_Site SHALL serve the Dashboard and the Virtual_Office in Replay_Mode from Published_Data as static files with no live server, no live SSE, and no manual run trigger.
11. WHILE the local machine is on, THE Live_Mode experience SHALL provide live SSE in the Virtual_Office, manual runs, scheduling, and the Admin_GUI.
12. THE deployment SHALL use only free GitHub features and SHALL NOT require any paid cloud service or paid hosting.

### Requirement 7: Cloud-to-Local Run Synchronization

**User Story:** As the Reviewer, I want my laptop to pick up runs that happened in the cloud while it was off, so that the local office and dashboard show the latest results with full fidelity.

#### Acceptance Criteria

1. WHEN an Orchestration_Run completes successfully in the Cloud_Runner, THE Cloud_Runner SHALL commit the run's full raw artifacts to the Run_Data_Branch.
2. THE Cloud_Runner SHALL commit raw run artifacts only to the Run_Data_Branch and SHALL NOT commit raw run artifacts to the repository main branch.
3. WHEN the Reviewer activates the Cloud_Sync control in the Admin_GUI, THE Admin_GUI SHALL retrieve the runs present on the Run_Data_Branch that are not already present locally and SHALL place them in the local artifacts store.
4. WHEN Cloud_Sync completes, THE local Event_Server, Dashboard, and Virtual_Office SHALL be able to display the synced cloud runs as historical runs.
5. WHILE performing Cloud_Sync, THE Admin_GUI SHALL NOT overwrite or delete existing local runs, evidence, baselines, or audit history.
6. IF Cloud_Sync fails or no network is available, THEN THE Admin_GUI SHALL report the failure and SHALL leave the local artifacts store unchanged.
7. THE Admin_GUI SHALL display, for the most recent run, whether it originated locally or from the Cloud_Runner.
8. THE Cloud_Sync operation SHALL be read-only with respect to cloud data, retrieving runs without modifying the Run_Data_Branch.

### Requirement 8: No Secrets In The Public Repository

**User Story:** As the Reviewer, I want no secrets in the public repo, so that the public codebase cannot leak credentials.

#### Acceptance Criteria

1. THE Guardian repository SHALL NOT contain committed tokens, keys, or credentials.
2. WHERE a sensitive value is required by the Cloud_Runner, THE Guardian SHALL reference that value only as an Action_Secret and SHALL NOT read it from a committed file.
3. THE repository SHALL include a .gitignore configuration that excludes local secret and environment files from version control.
4. IF a commit would introduce a file matching a known secret or environment pattern, THEN the ignore configuration SHALL prevent that file from being tracked.

### Requirement 9: Published-Data Sanitization

**User Story:** As the Reviewer, I want published data scrubbed of sensitive content, so that the public site exposes nothing it should not.

#### Acceptance Criteria

1. BEFORE publishing to the Pages_Site, THE Guardian SHALL remove secrets, tokens, and credentials from all Published_Data.
2. BEFORE publishing to the Pages_Site, THE Guardian SHALL remove absolute and internal filesystem paths from all Published_Data.
3. BEFORE publishing to the Pages_Site, THE Guardian SHALL exclude sensitive content captured in logs from the Published_Data.
4. WHEN a screenshot or page capture is published, THE Guardian SHALL publish only content that has passed sanitization.
5. IF Published_Data cannot be confirmed free of the disallowed content categories, THEN THE Guardian SHALL withhold that data from publication and SHALL record the reason.

### Requirement 10: GitHub Actions Hardening

**User Story:** As the Reviewer, I want the cloud workflows hardened, so that the public repository's automation cannot be abused.

#### Acceptance Criteria

1. THE Cloud_Runner SHALL pin every third-party action to a specific version or commit SHA.
2. THE Cloud_Runner SHALL request read-only GITHUB_TOKEN permissions for all jobs except the publish step.
3. WHERE a job publishes to the Pages_Site, THE Cloud_Runner SHALL grant contents write permission only to that publishing step.
4. THE Cloud_Runner SHALL NOT execute privileged workflows triggered by untrusted fork pull requests.
5. THE Cloud_Runner SHALL NOT execute untrusted input as commands during a workflow.

### Requirement 11: Admin GUI Safety

**User Story:** As the Reviewer, I want the admin control panel to be safe, so that it cannot be reached or abused from outside my machine and cannot scan disallowed addresses.

#### Acceptance Criteria

1. THE Admin_GUI SHALL bind only to the Loopback_Interface and SHALL NOT listen on externally reachable interfaces.
2. WHEN the manual-run control is activated, THE Admin_GUI SHALL initiate at most one Orchestration_Run per activation and SHALL reject concurrent duplicate manual runs.
3. WHERE the Reviewer edits the Guarded_Domain in a future domain-edit feature, THE Admin_GUI SHALL validate the submitted value before accepting it.
4. IF a submitted domain resolves to an internal, private, or loopback address, THEN THE Admin_GUI SHALL reject the submission.
5. IF a submitted domain uses a scheme or host outside the approved set, THEN THE Admin_GUI SHALL reject the submission.
6. THE Admin_GUI SHALL preserve the approved-domain boundary so that a configured domain cannot direct the Guardian to scan arbitrary or non-approved hosts.

### Requirement 12: Preserve Existing Guarantees

**User Story:** As the Reviewer, I want all existing guarantees preserved, so that phase 2 strengthens rather than weakens the system.

#### Acceptance Criteria

1. THE Pages_Site SHALL expose run data as read-only and SHALL NOT accept write operations from the public.
2. THE Guardian SHALL require Human_Decision approval before any Baseline is created or changed, and no Agent SHALL approve its own output.
3. THE Dashboard and Virtual_Office SHALL keep deterministic facts separate from AI-assisted opinion and SHALL label AI-assisted content as not a deterministic fact.
4. THE Guardian SHALL crawl and navigate only within the Approved_Domain.
5. THE Guardian SHALL NOT submit forms and SHALL NOT perform load or stress testing.
6. THE Guardian SHALL observe the Conservative_Request_Rate during discovery and observation.
7. THE Guardian SHALL maintain the append-only tamper-evident Audit_Record, recording corrections as new events and rejecting attempts to alter completed records.
8. THE Guardian SHALL preserve existing runs, evidence, baselines, and audit history, and WHERE a data migration is required THE Guardian SHALL record the migration.

### Requirement 13: Dependency Safety

**User Story:** As the Reviewer, I want dependencies controlled, so that new libraries do not introduce risk or hidden cost.

#### Acceptance Criteria

1. THE Guardian SHALL pin dependency versions rather than allowing unbounded version ranges.
2. WHEN a new dependency is introduced, THE Guardian SHALL prefer a well-known, actively maintained library.
3. WHEN a new dependency is introduced, THE Guardian SHALL record the dependency's cost and licensing so that any non-free or restrictively licensed dependency is flagged before adoption.

### Requirement 14: Free And Zero-Token Global Constraints

**User Story:** As the Reviewer, I want the whole phase to stay free and deterministic, so that it remains a viable no-cost proof of concept.

#### Acceptance Criteria

1. THE Guardian SHALL operate using only free services and SHALL NOT require paid cloud services or paid hosting.
2. THE Guardian SHALL NOT share data externally beyond publishing the Reviewer's own run results to the Reviewer's own Pages_Site.
3. WHILE an Orchestration_Run executes, THE Guardian SHALL make no large-language-model calls and SHALL consume zero AI tokens.
