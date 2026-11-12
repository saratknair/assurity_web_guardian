# Requirements Document

## Introduction

Virtual Office Replay replaces the current Assurity Web Guardian (AWG) Virtual Office with a new, orbitable 3D "diorama" that replays how the automated steps of a genuine GitHub Actions run worked. AWG is deterministic automation, not autonomous AI: it consumes zero AI tokens, makes no large-language-model calls, and uses free services only (GitHub Actions, GitHub Pages, and the runs-data git branch). The public site is served at `https://saratknair.github.io/assurity_web_guardian/`, with the Dashboard at `/` and the Virtual Office at `/office/`.

The Virtual Office is the future of reporting for this project. The Dashboard shows WHAT was found (the results). The Virtual Office shows HOW the work was done (the process and telemetry behind those results), so that viewers can see how the automated steps did the work that the Dashboard then displays. The two views together are the report. For that reason this feature includes two-way traceability between the Dashboard and the Virtual Office, a telemetry panel, a swimlane timeline, evidence shown at Stations, and a consistency check between the totals of the two views.

The current Virtual Office (`virtual-office/`, React 18 and Vite 5) is built in CI by `scripts/build-office-replay.mjs`, which runs `npm ci` and `vite build` into `_site/office` with `VITE_AWG_MODE=replay`. It loads `data/index.json` and the latest run's `events.json` and reveals one event every 900 ms on a loop. It does not work for the user and is to be REPLACED, not patched.

Review of the current data found that the office cannot tell a real story:

- Each run's `events.json` is an ordered list of `{ts, correlationId, runId, kind, data}`. Agent events (`agent.working`, `agent.completed`) carry only `agentName`, `agentRole`, and `status`. They carry no page, viewport, step, or result, so a replay cannot show what was checked or what was found.
- At the start of every run, "Discovery crawler", "Inventory_Agent", and "Specification_Agent" (role "ai") go from working to completed instantly. They are re-validation placeholders; their real work happens in the local admin console setup, not in the run.
- Quality_Analysis_Agent and Triage_Agent (role "ai") produce FIXED TEMPLATE text, not AI output, yet the role "ai" implies otherwise.
- A real CI run takes about 95 seconds for 10 pages and 2 viewports. The bulk of that time is the Observation_Runner (navigate, screenshot, visual compare against baseline, axe accessibility scan), which the current events do not time.

The following decisions are locked:

- The office becomes an orbitable 3D diorama: a 3D office the viewer can rotate, zoom, and pan around with mouse, touch, and keyboard, and click a station to fly the camera to it. There is no first-person walking in this feature.
- Agents are shown as figures that move between six Stations; station screens show the current page, viewport, and the individual Step_Name.
- The office replays only genuine published run data. Setup and admin-console agents are removed from the run and from the office.
- The office never labels anything AI, model output, or autonomous agent intelligence. Template steps are labelled as automated template steps.
- The office never invents events, pages, timings, or findings. When data is missing (older runs without enriched events) it shows a coarser replay and states what is not recorded. Enriched detail is never reconstructed for older runs.
- The solution is free and deterministic. A 3D library is allowed only if it has a free open licence (three.js, MIT) and is vendored as a static ES module like Chart.js, with no CDN and no npm build step for the office. Any 3D models are procedural or free CC0 assets with licences recorded.
- The office is plain static files (ES modules) served from `/office/`. CI no longer needs `npm ci` and Vite for the office. `scripts/build-office-replay.mjs` and the React app are retired.
- Fixed size caps apply: each published Run_Events file is capped at 256 KB, and the office's own files plus the vendored three.js stay under 1.5 MB in total.
- A synchronized plain-text transcript beside the 3D view is the accessible equivalent. Controls are keyboard operable, the office supports reduced motion and works without WebGL. WCAG 2.2 AA is a goal, and this document states honestly that full conformance requires manual testing with assistive technologies and expert review.
- The Dashboard link to the Virtual Office is mandatory. Specific keyboard shortcuts are decided in the design.

Out of scope for this feature: first-person walking (a possible later extension), a live mode that streams from a local Event_Server, any admin console activity (discovery, baseline capture, approvals, publish), and CI-level steps around the run (restore history, build published data, deploy Pages, commit runs-data) as recorded telemetry. That last item is a possible later extension and would require CI to record its own step timings.

## Glossary

Terms defined by the existing specifications (for example Guardian, Dashboard, Published_Data, Pages_Site, Run_Data_Branch, Run_ID, Publisher, Sanitizer, Reviewer, Finding_Detail_View, Run_View, Page_Detail_View, Visual_Comparison, Active_Findings, Image_Retention_Window, Deep_Link) retain their existing meanings. In this document the Image_Retention_Window means the latest 10 runs for which the Dashboard publishes images, and a Deep_Link means a Dashboard hash-route link. The following terms are introduced or refined for this feature.

- **Virtual_Office**: The static, read-only page served at `/office/` on the Pages_Site that replays a published run as a Diorama together with a Transcript.
- **Diorama**: The 3D scene of the Virtual_Office, rendered with three.js, containing Stations and Agent_Figures that the viewer can orbit, zoom, and pan.
- **Renderer_Library**: The vendored three.js ES module (MIT licence) loaded by the Virtual_Office from its own files.
- **Station**: One of exactly six named locations in the Diorama, each representing a group of real Step_Names, with a screen that shows the current page, viewport, and individual Step_Name. The six Stations are "Test plan desk", "Browser bay", "Visual check", "Accessibility check", "Review desk", and "Records room".
- **Station_Mapping**: The fixed mapping from Step_Names and components to Stations: "Test plan desk" holds the Test_Generator test plan per page; "Browser bay" holds `load` and `screenshot`; "Visual check" holds `visual-compare`; "Accessibility check" holds `accessibility-scan`; "Review desk" holds `compare`, `notes`, and `triage`; "Records room" holds `history` and `decisions`. The "Records room" holds run-level steps that have no page or viewport.
- **Agent_Figure**: A 3D figure that represents one automated Guardian component (for example Test_Generator, Observation_Runner, Comparator, Quality_Analysis_Agent, Triage_Agent) and moves between Stations. An Agent_Figure does not represent an AI.
- **Automated_Template_Step**: A run step whose output is produced from a fixed text template with no AI involvement, specifically the notes step (Quality_Analysis_Agent) and the triage step (Triage_Agent).
- **Run_Events**: The `events.json` file published for a run, an ordered list of events.
- **Enriched_Event**: A Run_Events entry that carries, in addition to the existing fields, the page URL and slug, viewport, step name, start and end timestamps, a result summary, and, for finding-producing steps, the identity fields of the Finding_Key.
- **Legacy_Run**: A published run whose Run_Events contain no Enriched_Events (agent-only events).
- **Step_Name**: One of `test-plan`, `load`, `screenshot`, `visual-compare`, `accessibility-scan`, `compare`, `notes`, `triage`, `history`, `decisions`.
- **Result_Summary**: The recorded outcome of a step: HTTP status, finding counts by severity, visual difference yes or no, or a page-skipped flag with its reason.
- **Finding_Key**: The deterministic identity of a finding, the string `pageUrl|viewport|ruleId` as already used by the Publisher, where `ruleId` is the accessibility rule id or the check name. A finding id recorded by the Publisher MAY be recorded in addition.
- **Replay_Timeline**: The ordered, deterministic, renderer-independent model built from Run_Events that lists timeline entries with real relative timing.
- **Timeline_Entry**: One item of the Replay_Timeline, holding an identifier, the Step_Name or event kind, the Station, the page, viewport, agent, relative start and end times in milliseconds, the Finding_Keys it produced, and the Result_Summary.
- **Producing_Entry**: The Timeline_Entry whose recorded Finding_Keys include the Finding_Key of a given Dashboard finding.
- **Not_Recorded_Notice**: Text shown by the Virtual_Office stating which details (page, viewport, step, timing, result, producing step) were not recorded for a run.
- **Playback_State**: The current playback position, play or pause status, and speed.
- **Speed**: The playback multiplier, one of 1x, 2x, 5x, or 10x.
- **Transcript**: A plain-text, ordered list of Timeline_Entries rendered as HTML text next to the Diorama, synchronized with Playback_State, and usable without the Diorama.
- **Telemetry_Panel**: The panel that shows running totals, durations, and the time breakdown derived from the Replay_Timeline and synchronized with Playback_State.
- **Swimlane_View**: A 2D timeline view with one lane per Station in which each Timeline_Entry is a bar along real time, with a playback position marker.
- **Evidence_Item**: A screenshot thumbnail, a list of accessibility rule ids and counts, or a visual-difference result that the Virtual_Office shows at a Station or in the Inspector for a page and viewport, taken from Published_Data.
- **Inspector**: The panel that shows what a selected Agent_Figure or Station did in the run up to the current position.
- **Camera_Focus**: The Diorama camera state after a Station is selected, in which the camera transitions to frame that Station.
- **Camera_Bounds**: The limits on camera distance, pan range, and vertical angle that keep the Diorama in view.
- **Run_Index**: The file `data/index.json`, the newest-first list of published runs.
- **Office_Deep_Link**: A URL of the form `/office/#/run/<runId>?t=<ms>`, optionally followed by `&station=<id>`, where `<runId>` is a Run_ID, `<ms>` is the playback position in milliseconds, and `<id>` is a Station identifier. It uses a hash route like the Dashboard and restores that view when opened directly.
- **Reduced_Motion**: The user preference reported by `prefers-reduced-motion: reduce`.
- **Fallback_Mode**: The Virtual_Office state when WebGL is unavailable or fails to initialise, in which the Diorama is replaced by a message and the Transcript and controls remain fully usable.
- **Setup_Placeholder_Agent**: One of "Discovery crawler", "Inventory_Agent", or "Specification_Agent" as emitted at the start of a run by `runGuardian`.
- **Asset_Licence_Record**: A file in the repository that lists every vendored library and every non-procedural asset with its name, version, licence, source, and actual size.

## Requirements

### Requirement 1: Enriched Run Events

**User Story:** As a viewer of the Virtual Office, I want each step event to say which page, viewport, step, and result it covers, so that the replay shows what was actually checked and found.

#### Acceptance Criteria

1. WHEN the Guardian executes a step for a page, THE Guardian SHALL emit an Enriched_Event containing the page URL, the page slug, the viewport (where the step is per viewport), the Step_Name, a start timestamp, and an end timestamp.
2. WHEN a step finishes, THE Guardian SHALL include a Result_Summary in the Enriched_Event for that step.
3. WHEN the load step finishes, THE Guardian SHALL record the HTTP status in its Result_Summary.
4. WHEN the accessibility-scan step finishes, THE Guardian SHALL record the finding counts by severity (critical, serious, moderate, minor) in its Result_Summary.
5. WHEN the visual-compare step finishes, THE Guardian SHALL record in its Result_Summary whether a visual difference was detected (yes or no).
6. WHEN a page is skipped, THE Guardian SHALL emit a `page.skipped` event containing the page URL and the skip reason.
7. THE Guardian SHALL emit Enriched_Events for the Step_Names `test-plan`, `load`, `screenshot`, `visual-compare`, `accessibility-scan`, `compare`, `notes`, `triage`, `history`, and `decisions`.
8. THE Guardian SHALL keep every existing event field (`ts`, `correlationId`, `runId`, `kind`, `data`) and every existing event kind unchanged, so that Enriched_Events are an additive extension and existing readers continue to work.
9. THE Guardian SHALL NOT emit `agent.working` or `agent.completed` events for the Setup_Placeholder_Agents.
10. THE Guardian SHALL NOT emit the value "ai" as `agentRole` in any run event.
11. THE Publisher SHALL pass every Enriched_Event field through the Sanitizer before writing Run_Events to Published_Data, so that no secrets or local file paths are published.
12. THE Publisher SHALL cap the published size of each Run_Events file at 256 KB.
13. IF a Run_Events file would exceed 256 KB, THEN THE Publisher SHALL drop the lowest-priority detail fields first, SHALL keep every Timeline_Entry identifier, timestamp, and Finding_Key, and SHALL record a truncation flag in the published file.
14. WHEN an accessibility-scan, visual-compare, or check step produces a finding, THE Guardian SHALL record in the Enriched_Event for that step the identity of that finding: the page URL, the page slug, the viewport, and the rule id or check name, from which the Finding_Key is formed.
15. WHERE the Publisher assigns a finding id to a finding, THE Publisher SHALL record that finding id in the Enriched_Event that produced the finding, in addition to the Finding_Key.

### Requirement 2: Replay Timeline Model

**User Story:** As a developer maintaining the office, I want a pure timeline model independent of the renderer, so that replay logic is deterministic and testable without a browser.

#### Acceptance Criteria

1. WHEN Run_Events are provided, THE Replay_Timeline SHALL produce an ordered list of Timeline_Entries sorted by relative start time and then by original event order.
2. THE Replay_Timeline SHALL compute each relative time as the event timestamp minus the `run.started` timestamp, in milliseconds.
3. WHEN Run_Events contain Enriched_Events, THE Replay_Timeline SHALL use the recorded start and end timestamps as the duration of each Timeline_Entry.
4. WHEN Run_Events are a Legacy_Run, THE Replay_Timeline SHALL produce a coarse list of Timeline_Entries from the agent events only and SHALL produce a Not_Recorded_Notice naming the details that were not recorded.
5. WHEN the same Run_Events are provided twice, THE Replay_Timeline SHALL produce identical output.
6. THE Replay_Timeline SHALL contain only Timeline_Entries that correspond to an event in the supplied Run_Events.
7. THE Replay_Timeline SHALL contain no Timeline_Entry for a Setup_Placeholder_Agent, including when the supplied Run_Events are a Legacy_Run that contains such events.
8. WHEN a supplied event has a timestamp earlier than the `run.started` timestamp, THE Replay_Timeline SHALL clamp its relative time to 0.
9. IF a supplied event has an unknown kind or a missing required field, THEN THE Replay_Timeline SHALL skip that event and SHALL add a line to a list of skipped-event notes.
10. IF Run_Events are empty or contain no `run.started` event, THEN THE Replay_Timeline SHALL return an empty list of Timeline_Entries and an explanatory notice.
11. FOR ALL Replay_Timelines, THE Replay_Timeline SHALL report a position at relative time T by returning the Timeline_Entries whose start is at or before T, and the set returned for T1 SHALL be a subset of the set returned for T2 WHEN T1 is less than or equal to T2.
12. THE Replay_Timeline SHALL assign each Timeline_Entry to exactly one Station according to the Station_Mapping.
13. THE Replay_Timeline SHALL carry the Finding_Keys recorded in each Enriched_Event onto the corresponding Timeline_Entry.
14. WHEN a Finding_Key is supplied, THE Replay_Timeline SHALL return the Producing_Entry whose recorded Finding_Keys include it, and SHALL return no entry WHEN no Timeline_Entry records that Finding_Key.
15. THE Replay_Timeline SHALL NOT reconstruct, infer, or backfill enriched detail for a Legacy_Run.

### Requirement 3: Run Selection and Deep Links

**User Story:** As a viewer, I want to open the latest run by default or choose any published run, so that I can replay a past run and share a link to a moment in it.

#### Acceptance Criteria

1. WHEN the Virtual_Office loads without an Office_Deep_Link, THE Virtual_Office SHALL load the Run_Index and SHALL load the Run_Events of the newest run.
2. THE Virtual_Office SHALL list the runs in the Run_Index in a selectable control, each shown with its date and time and health.
3. WHEN the viewer selects a run, THE Virtual_Office SHALL load that run's Run_Events and SHALL reset Playback_State to position 0 and paused.
4. WHEN the Virtual_Office loads with an Office_Deep_Link, THE Virtual_Office SHALL load the run identified by `<runId>` and SHALL set the playback position to the `t` value in milliseconds.
5. WHEN the viewer selects a run, changes the playback position, or selects a Station, THE Virtual_Office SHALL update the Office_Deep_Link (`#/run/<runId>?t=<ms>` and, WHEN a Station is selected, `&station=<id>`) without reloading the page.
6. IF an Office_Deep_Link names a Run_ID that is not in the Run_Index, THEN THE Virtual_Office SHALL show a message that the run was not found and SHALL load the newest run.
7. IF an Office_Deep_Link names a time position outside the run duration, THEN THE Virtual_Office SHALL clamp the position to the nearest valid time.
8. IF the Run_Index or the selected Run_Events cannot be loaded, THEN THE Virtual_Office SHALL show a message that identifies which file failed to load and SHALL keep the rest of the page usable.
9. WHEN an Office_Deep_Link contains `station=<id>` with a known Station identifier, THE Virtual_Office SHALL set Camera_Focus to that Station and SHALL select it in the Inspector.
10. IF an Office_Deep_Link contains a `station` value that is not a known Station identifier, THEN THE Virtual_Office SHALL ignore the value and SHALL show the default overview.

### Requirement 4: Playback Controls

**User Story:** As a viewer, I want to play, pause, change speed, scrub, and jump through the run, so that I can watch at my own pace and find a specific page or moment.

#### Acceptance Criteria

1. THE Virtual_Office SHALL provide play and pause controls that start and stop advancement of the playback position.
2. THE Virtual_Office SHALL provide a Speed control offering exactly 1x, 2x, 5x, and 10x, with 1x as the default.
3. WHILE Playback_State is playing, THE Virtual_Office SHALL advance the playback position at real recorded time multiplied by the selected Speed.
4. THE Virtual_Office SHALL provide a scrubber that sets the playback position anywhere from 0 to the run duration.
5. THE Virtual_Office SHALL provide a jump-to-page control listing every page that appears in the Replay_Timeline and moving the playback position to the first Timeline_Entry for the chosen page.
6. THE Virtual_Office SHALL provide next-event and previous-event controls that move the playback position to the start of the following or preceding Timeline_Entry.
7. WHEN the playback position reaches the run duration, THE Virtual_Office SHALL pause playback and SHALL NOT loop automatically.
8. THE Virtual_Office SHALL make every playback control operable by keyboard, with visible focus indicators and an accessible name for each control.
9. WHERE the browser supports keyboard shortcuts for playback, THE Virtual_Office SHALL document the shortcuts on the page and SHALL NOT override shortcuts used by the browser or by assistive technology.
10. IF a Legacy_Run is loaded, THEN THE Virtual_Office SHALL disable the jump-to-page control and SHALL state that pages were not recorded for that run.

### Requirement 5: 3D Diorama Scene

**User Story:** As a tech leader, I want to see the automated steps happen in a 3D office, so that I can understand how the Guardian checks the site.

#### Acceptance Criteria

1. THE Diorama SHALL contain exactly six Stations, "Test plan desk", "Browser bay", "Visual check", "Accessibility check", "Review desk", and "Records room", each with a visible text label, and SHALL assign every Step_Name to a Station according to the Station_Mapping.
2. THE Diorama SHALL represent each Guardian component that appears in the Replay_Timeline as an Agent_Figure with its component name as a label.
3. WHEN a Timeline_Entry becomes active, THE Diorama SHALL move the responsible Agent_Figure to the Station given by the Station_Mapping for that entry's Step_Name.
4. WHILE a Timeline_Entry is active, THE Station screen SHALL display the page URL (or slug), the viewport, and the individual Step_Name of that entry, and the Transcript SHALL name the same Step_Name.
5. WHEN a step with a Result_Summary finishes, THE Station screen SHALL display the recorded finding counts by severity, HTTP status, or visual difference result.
6. WHEN the `run.started` position is reached, THE Diorama SHALL show a visual run-started indication, and WHEN the `run.finished` position is reached, THE Diorama SHALL show a run-finished indication that includes the recorded health.
7. THE Diorama SHALL label Automated_Template_Steps as automated template steps.
8. THE Diorama SHALL NOT display the words "AI", "model", "LLM", or "autonomous" as a description of any Station, Agent_Figure, or step.
9. WHEN the playback position is set by scrubbing or jumping, THE Diorama SHALL show the state implied by the Timeline_Entries up to that position without playing intermediate animations.
10. THE Diorama SHALL derive every displayed value from the Replay_Timeline and SHALL NOT display a page, count, duration, or result that is absent from the supplied Run_Events.
11. WHEN a Legacy_Run is loaded, THE Diorama SHALL show only the agents and coarse step order recorded and SHALL show the Not_Recorded_Notice.
12. THE Diorama SHALL build Stations, Agent_Figures, and the office environment procedurally or from CC0 assets listed in the Asset_Licence_Record.
13. WHEN a run-level step (`history` or `decisions`) is active, THE "Records room" Station screen SHALL display the Step_Name without a page or viewport.

### Requirement 6: Camera Interaction

**User Story:** As a viewer, I want to orbit, zoom, pan, and focus on stations with mouse, touch, or keyboard, so that I can explore the office without getting lost.

#### Acceptance Criteria

1. WHEN the viewer drags with the primary mouse button or one finger, THE Diorama SHALL orbit the camera around the scene centre.
2. WHEN the viewer uses the mouse wheel or a two-finger pinch, THE Diorama SHALL zoom the camera.
3. WHEN the viewer drags with the secondary mouse button or two fingers, THE Diorama SHALL pan the camera.
4. WHEN the viewer presses the arrow keys, plus and minus keys, or the documented pan keys while the Diorama has focus, THE Diorama SHALL orbit, zoom, or pan the camera by a fixed step.
5. WHEN the viewer clicks, taps, or keyboard-selects a Station, THE Diorama SHALL set Camera_Focus to that Station and SHALL transition the camera to frame it.
6. THE Virtual_Office SHALL provide a Reset view control that returns the camera to the default overview position.
7. THE Diorama SHALL enforce Camera_Bounds on camera distance, pan range, and vertical angle at all times.
8. WHILE Reduced_Motion is active, THE Diorama SHALL apply camera transitions and Agent_Figure moves instantly with no interpolated motion.
9. THE Virtual_Office SHALL provide a keyboard-operable list of Stations so that every Station can be selected without a pointing device.
10. WHEN the Diorama has keyboard focus, THE Virtual_Office SHALL show a visible focus indicator and SHALL provide a documented way to move focus out of the Diorama.

### Requirement 7: Inspector

**User Story:** As a QA lead, I want to select an agent or station and see what it did in the run so far, so that I can trace results back to the Dashboard.

#### Acceptance Criteria

1. WHEN the viewer selects an Agent_Figure or a Station, THE Inspector SHALL show the name, the plain description of its role, and whether its steps are Automated_Template_Steps.
2. THE Inspector SHALL list the pages handled by the selected Agent_Figure or Station up to the current playback position.
3. THE Inspector SHALL show, for each listed entry, the individual Step_Name, the recorded duration, and the Result_Summary.
4. THE Inspector SHALL provide a link to the corresponding Dashboard view (Deep_Link) for each Result_Summary it shows, for the selected run, page, and findings, WHERE such a Dashboard view exists.
5. WHEN the playback position changes, THE Inspector SHALL update its content to reflect the Timeline_Entries up to the new position.
6. IF a detail is not recorded for the run, THEN THE Inspector SHALL show "not recorded" for that detail.
7. THE Inspector SHALL be reachable and operable by keyboard and SHALL expose its content as text to assistive technology.
8. WHERE an Evidence_Item exists for a listed entry, THE Inspector SHALL show that Evidence_Item according to Requirement 11.

### Requirement 8: Transcript and Accessible Equivalent

**User Story:** As a screen-reader user or a person on a device without WebGL, I want a plain-text transcript of the run, so that I get the same information as the 3D view.

#### Acceptance Criteria

1. THE Virtual_Office SHALL render a Transcript beside or below the Diorama listing every Timeline_Entry in order, each with relative time, agent, Station, page, viewport, individual Step_Name, and Result_Summary where recorded.
2. WHILE Playback_State changes, THE Transcript SHALL highlight the current Timeline_Entry and SHALL mark entries after the playback position as not yet reached.
3. WHEN the viewer activates a Transcript entry, THE Virtual_Office SHALL set the playback position to the start of that entry.
4. THE Transcript SHALL contain the same facts that the Diorama shows for each Timeline_Entry.
5. THE Virtual_Office SHALL announce step changes through a polite live region only WHILE the viewer has enabled announcements, and SHALL default announcements to off.
6. IF WebGL is unavailable or the Renderer_Library fails to initialise, THEN THE Virtual_Office SHALL enter Fallback_Mode, SHALL show a message stating that the 3D view is unavailable, and SHALL keep the Transcript, playback controls, run selection, Telemetry_Panel, Swimlane_View, and Inspector fully usable.
7. WHILE Reduced_Motion is active, THE Virtual_Office SHALL avoid auto-scrolling animations and SHALL scroll the Transcript to the current entry without smooth scrolling.
8. THE Virtual_Office SHALL state on the page that WCAG 2.2 AA is a goal and that full conformance requires manual testing with assistive technologies and expert review.
9. THE Virtual_Office SHALL display the Not_Recorded_Notice in the Transcript WHEN a Legacy_Run is loaded.
10. WHERE a Result_Summary in the Transcript has a corresponding Dashboard finding, page, or run view, THE Transcript SHALL show a link to that view (Deep_Link) next to the Result_Summary.

### Requirement 9: Telemetry Panel

**User Story:** As a QA lead, I want running totals and a time breakdown that follow the playback, so that I can see how the run progressed and where the time went.

#### Acceptance Criteria

1. THE Telemetry_Panel SHALL show, for the current playback position, the number of pages completed out of the total number of pages, the number of findings so far by severity, the number of visual differences so far, and the number of pages skipped.
2. THE Telemetry_Panel SHALL show the duration of each step and the total duration of each Station, and the duration of the whole run.
3. THE Telemetry_Panel SHALL show a "where the time went" breakdown giving the share of the total recorded step time spent in each Station as a percentage, and SHALL separately show the time not attributed to any Station (for example request-spacing waits, browser launch, and file writes) as a duration.
4. WHEN the playback position changes, THE Telemetry_Panel SHALL update its running totals to reflect only the Timeline_Entries at or before the new position.
5. THE Telemetry_Panel SHALL derive every value only from the Replay_Timeline.
6. WHEN a Legacy_Run is loaded, THE Telemetry_Panel SHALL show "not recorded" for every value that the Legacy_Run did not record, and SHALL show only the run duration and Station durations that the coarse Timeline_Entries support.
7. FOR ALL Replay_Timelines, THE Telemetry_Panel SHALL show Station shares, each computed against the total recorded step time, that sum to 100 percent within the rounding of the displayed precision, WHEN the total recorded step time is greater than 0.
8. FOR ALL playback positions T1 less than or equal to T2, THE Telemetry_Panel SHALL show running totals at T1 that are less than or equal to the running totals at T2.
9. THE Telemetry_Panel SHALL be rendered as HTML text and SHALL be reachable and operable by keyboard.

### Requirement 10: Swimlane Timeline View

**User Story:** As a viewer who prefers a 2D overview, I want a swimlane timeline of the run, so that I can see concurrency and gaps at a glance and seek to any step.

#### Acceptance Criteria

1. THE Swimlane_View SHALL show one lane per Station, labelled with the Station name, and SHALL show each Timeline_Entry as a bar positioned along real recorded time within the lane of its Station.
2. THE Swimlane_View SHALL show a marker at the current playback position and SHALL move the marker WHEN the playback position changes.
3. WHEN the viewer clicks, taps, or keyboard-activates a bar, THE Virtual_Office SHALL set the playback position to the start of the corresponding Timeline_Entry.
4. THE Swimlane_View SHALL render each bar as an HTML or SVG element with an accessible name containing the Step_Name, page, viewport, and relative start time, and SHALL NOT be rendered on a canvas alone.
5. THE Swimlane_View SHALL make every bar reachable by keyboard in time order, with a visible focus indicator.
6. THE Swimlane_View SHALL derive bar positions and lengths only from the Replay_Timeline.
7. WHEN a Legacy_Run is loaded, THE Swimlane_View SHALL show the coarse Timeline_Entries recorded and SHALL show the Not_Recorded_Notice.
8. IF Fallback_Mode is active, THEN THE Swimlane_View SHALL remain available as the additional non-3D view.

### Requirement 11: Evidence at Stations

**User Story:** As a QA lead, I want to see the actual screenshot and findings at the Station where they were produced, so that I can judge the evidence without leaving the replay.

#### Acceptance Criteria

1. WHEN the screenshot step for a page and viewport has finished at the playback position and the published screenshot for that page, viewport, and run exists, THE Browser bay screen and THE Inspector SHALL show that screenshot as a thumbnail with a caption naming the page, viewport, run, and image role.
2. WHEN a thumbnail is shown, THE Virtual_Office SHALL provide a link from it to the Dashboard Visual_Comparison for that page and viewport.
3. WHEN the accessibility-scan step for a page and viewport has finished at the playback position, THE Accessibility check Station screen SHALL show the rule ids and counts found for that page and viewport, taken from the published run-findings data.
4. WHEN the visual-compare step for a page and viewport has finished at the playback position, THE Visual check Station screen SHALL show whether a difference was detected and SHALL link to the Dashboard Visual_Comparison for that page and viewport.
5. IF the run is outside the Image_Retention_Window, THEN THE Virtual_Office SHALL state that images are not published for that run and SHALL NOT show any placeholder image as if it were the screenshot.
6. IF the published screenshot for a page and viewport cannot be loaded, THEN THE Virtual_Office SHALL state which image could not be loaded and SHALL NOT show a placeholder image as if it were the screenshot.
7. THE Virtual_Office SHALL request Evidence_Item data and images only from same-origin `/data/` paths.
8. IF the published run-findings data does not list a finding recorded in the Replay_Timeline, THEN THE Virtual_Office SHALL show that the rule ids are not available for that page and viewport.

### Requirement 12: Traceability from Dashboard to Office

**User Story:** As a Dashboard viewer, I want a link from a finding or run to the moment it was found in the replay, so that I can see how the finding was produced.

#### Acceptance Criteria

1. THE Dashboard Finding_Detail_View SHALL show a "See how this was found" link to an Office_Deep_Link.
2. THE Dashboard Run_View SHALL show a "Replay this run" link to an Office_Deep_Link for that run.
3. WHERE it is useful to show the process for a page, THE Dashboard Page_Detail_View SHALL show a link to the Office_Deep_Link at the first Timeline_Entry for that page.
4. WHEN a Dashboard finding has a Producing_Entry, THE "See how this was found" link SHALL open the Office_Deep_Link for the run, at the start time of the Producing_Entry, with `station` set to the Station of the Producing_Entry.
5. THE Publisher SHALL determine the Producing_Entry of a finding by matching the Finding_Key of the finding to the Finding_Keys recorded in the Run_Events, and SHALL NOT guess the match by page, time, or any other proximity.
6. IF a finding has no recorded Producing_Entry, or the run is a Legacy_Run, THEN THE link SHALL open the Office_Deep_Link at the run start (`t=0`), and THE Virtual_Office SHALL state that the producing moment was not recorded.
7. THE Dashboard changes for these links SHALL be limited to read-only links, with no forms, no POST requests, and no new network requests, and THE Dashboard SHALL remain static and read-only.
8. THE Dashboard SHALL show a link to the Virtual_Office on its main navigation.

### Requirement 13: Traceability from Office to Dashboard

**User Story:** As a viewer of the replay, I want each result I see in the Office to link to the matching Dashboard view, so that I can move from process to results.

#### Acceptance Criteria

1. WHERE a Dashboard finding, page, or run view corresponds to a Result_Summary, THE Virtual_Office SHALL show a link (Deep_Link) to that Dashboard view for every Result_Summary shown on a Station screen, in the Inspector, and in the Transcript.
2. WHEN a Result_Summary carries Finding_Keys, THE Virtual_Office SHALL form the Deep_Link to the Dashboard finding from the Finding_Key.
3. IF no Dashboard view exists for a Result_Summary, THEN THE Virtual_Office SHALL show the Result_Summary without a link and SHALL NOT show a link to a view that does not exist.
4. THE Virtual_Office SHALL provide a visible link to the Dashboard run view for the loaded run.

### Requirement 14: Reporting Consistency

**User Story:** As a QA lead, I want the numbers in the Office and the Dashboard to agree for the same run, so that I can trust both views as one report.

#### Acceptance Criteria

1. FOR ALL runs, THE Telemetry_Panel totals at the end of the run SHALL equal the totals that the Dashboard shows for that run (Active_Findings), WHEN the difference between the event stream and the Dashboard is zero.
2. WHEN the Telemetry_Panel totals at the end of the run differ from the Dashboard totals for that run, THE Virtual_Office SHALL state the difference and its reason.
3. WHERE the difference is caused by human dispositions applied by the Publisher overlay, THE Virtual_Office SHALL state the number of findings affected and the reason, for example "N findings were ignored by a reviewer decision and are not counted on the Dashboard".
4. IF the Virtual_Office cannot determine the reason for a difference, THEN THE Virtual_Office SHALL state that the totals differ and that the reason could not be determined, and SHALL NOT hide the difference.
5. THE Virtual_Office SHALL obtain the Dashboard totals for a run only from same-origin `/data/` published files.
6. WHEN the Dashboard totals for a run are not available, THE Virtual_Office SHALL state that the consistency check could not be performed.

### Requirement 15: Theme and Layout

**User Story:** As a user moving between the Dashboard and the Virtual Office, I want them to look consistent, so that the product feels like one site.

#### Acceptance Criteria

1. THE Virtual_Office SHALL use the same colour palette and fonts as the Dashboard by sharing or mirroring the Dashboard's CSS design tokens.
2. THE Virtual_Office SHALL provide a visible link back to the Dashboard.
3. THE Virtual_Office SHALL provide a layout that is usable from a 320 CSS pixel width to a 1920 CSS pixel width, without horizontal scrolling of the page at 320 CSS pixel width.
4. WHEN the viewport width is below a documented breakpoint, THE Virtual_Office SHALL stack the Diorama above the Transcript.
5. THE Virtual_Office SHALL meet a text contrast ratio of at least 4.5:1 for body text and 3:1 for large text and interactive component boundaries.
6. THE Virtual_Office SHALL display a statement that the Guardian uses zero AI tokens and that template steps are automated, not AI.
7. THE Virtual_Office SHALL include a page title, a language attribute, and landmark regions for header, main, and navigation.

### Requirement 16: Performance and Size

**User Story:** As a viewer on a typical laptop or phone, I want the office to load quickly and stay responsive, so that I can use it without waiting or lag.

#### Acceptance Criteria

1. THE Virtual_Office SHALL load as static files with no build step and no runtime request to a third-party origin.
2. THE Asset_Licence_Record SHALL record the actual size of the vendored Renderer_Library and of every other asset.
3. THE Virtual_Office SHALL load only the Renderer_Library module needed for the Diorama and SHALL NOT load unused three.js example add-ons.
4. WHEN the Virtual_Office page loads, THE Virtual_Office SHALL display the Transcript and controls before the Diorama finishes initialising.
5. WHILE the Diorama is not visible in the viewport or the browser tab is hidden, THE Diorama SHALL pause its render loop.
6. WHILE playback is paused and the camera is not moving, THE Diorama SHALL render no new frames.
7. WHERE the device reports low capability (a device pixel ratio above 2, fewer than 4 logical processors, or a failed frame-rate check), THE Diorama SHALL reduce render resolution and disable shadows.
8. THE Virtual_Office SHALL keep the total size of its own files plus the vendored Renderer_Library under 1.5 MB.

### Requirement 17: CI and Publishing

**User Story:** As the maintainer, I want the office published as plain static files, so that CI is simpler and the office needs no build.

#### Acceptance Criteria

1. THE CI workflow SHALL copy the office files as static files into the Pages artifact under `/office/`.
2. THE CI workflow SHALL NOT run `npm ci` or `vite build` for the office.
3. THE repository SHALL retire `scripts/build-office-replay.mjs` and the React and Vite application in `virtual-office/` as part of this feature, and SHALL remove every CI step and package script that references them.
4. THE Virtual_Office SHALL make no network requests other than same-origin requests to `/data/` and to its own files.
5. THE Virtual_Office SHALL be read-only and SHALL NOT send data to any server.
6. IF the total size of the office files plus the vendored Renderer_Library would exceed 1.5 MB, THEN THE CI workflow SHALL fail with a message that names the oversize path.
7. IF a published Run_Events file exceeds 256 KB, THEN THE CI workflow SHALL fail with a message that names the oversize path.
8. THE CI workflow SHALL leave the Dashboard build and the `/data/` publishing steps unchanged, except for the steps needed to publish the Finding_Key and Producing_Entry data required by Requirement 12.

### Requirement 18: Preserved Guarantees

**User Story:** As the product owner, I want the office to keep the product's honesty, cost, and safety guarantees, so that the replacement does not weaken them.

#### Acceptance Criteria

1. THE Virtual_Office and the Guardian event enrichment SHALL consume zero AI tokens and SHALL make no large-language-model call.
2. THE Virtual_Office SHALL depend only on free services and free open-licence libraries.
3. THE Virtual_Office SHALL produce the same display for the same Run_Events and the same Playback_State on every load.
4. THE Virtual_Office source files and the published event files SHALL contain ASCII characters only.
5. THE Virtual_Office source code SHALL NOT use `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, or `eval`, and SHALL insert data into the page only as text.
6. THE Virtual_Office SHALL NOT display setup or admin-console activity, including discovery, baseline capture, approvals, or publish actions.
7. THE Dashboard SHALL remain unchanged except for the mandatory link to the Virtual_Office (Requirement 12.8) and the read-only traceability links (Requirement 12.1 to 12.4).
8. THE Asset_Licence_Record SHALL list the name, version, licence, source, and actual size of every vendored library and every non-procedural asset, and every listed licence SHALL be a free open licence.
9. THE Virtual_Office SHALL keep the coarse replay of every Legacy_Run permanently and SHALL NOT reconstruct enriched detail for any Legacy_Run.
