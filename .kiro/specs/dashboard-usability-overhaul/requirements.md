# Requirements Document

## Introduction

Dashboard Usability Overhaul is a focused follow-on to the existing Assurity Web Guardian (AWG) specifications (`assurity-web-guardian` and `guardian-phase2-overhaul`). AWG is deterministic automation, not autonomous AI: it consumes zero AI tokens, makes no large-language-model calls at runtime, and is supervised by a human Reviewer. The public Dashboard is a static showcase hosted on GitHub Pages for tech leaders, QA leads, and developers.

Review of the current Dashboard found that it reports findings but does not explain them. A finding such as `desktop:a11y-critical-serious: link-name, nested-interactive` does not tell the viewer what is wrong, whether the whole page or a single element is affected, which element, or where to see evidence. Other problems found:

- Severity is derived by substring-matching the finding detail text, and every accessibility summary contains "a11y-critical-serious", so serious issues are shown as critical.
- "AI-assisted analysis" items are a fixed template (`Likely impact: a failing deterministic check (...) may affect users; recommend human review.`) that names no page, no problem, and no evidence, and the Dashboard labels them "Large-language-model commentary", which is inaccurate.
- A "Screenshot difference with a violated deterministic rule (visual finding suppressed; evidence attached)" finding gives no explanation and no baseline to compare against, because only the current and diff images are published.
- The page list is a flat list of URLs and does not scale to 100 or more pages; the page detail opens in a narrow left-side panel that leaves half the screen unused.
- The trend chart dots, the severity donut slices, and the new-versus-recurring bars cannot be clicked.
- The new-versus-recurring chart is wrong: CI never persists `artifacts/a11y-history.json`, so every finding appears "new", and locally the `existing-unresolved` state is not plotted at all.
- Evidence screenshots carry no caption, do not say which run they came from, and include an unexplained diff overlay.

The raw run artifacts already hold the data needed to fix most of this: axe-core results per page and viewport (rule id, impact, description, help text, help URL, WCAG tags, and per-node html, CSS target, and failure summary) are stored under `artifacts/runs/<id>/accessibility/` but are not published. This feature publishes sanitized element-level evidence and baseline images, corrects severity, adds a finding detail view, makes navigation scalable, makes the charts interactive, persists accessibility history across CI runs, and holds the Dashboard itself to WCAG 2.2 AA as a goal.

Everything in this feature MUST remain free, deterministic, zero-token, honest (only genuine run data), and sanitized (no secrets or local paths). The Dashboard MUST remain plain HTML, JavaScript, and CSS with the vendored Chart.js and no build step. The Virtual Office is out of scope for this feature.

Two further needs were added after the first review. First, to stay under the GitHub Pages size limit, images are published only for the 10 most recent runs, while Findings and evidence JSON are kept for every run. Second, the Reviewer needs to mark an issue as resolved or ignore it so that it is not flagged again. Those human decisions are made only in the local Admin_GUI (loopback only), pass through the existing Approval_Gate, are stored in an append-only Disposition_Log, and are applied from the decision onward: runs that finished before a decision keep their original counts. The public Dashboard stays read-only and static; it only shows the effect of decisions and lists ignored issues openly.

## Glossary

Terms defined by the existing specifications (for example Guardian, Dashboard, Published_Data, Pages_Site, Run_Data_Branch, Run_ID, Reviewer, Baseline, Evidence_Store, Approved_Domain, Replay_Mode) retain their existing meanings. The following terms are introduced or refined for this feature.

- **Dashboard**: The static HTML, JavaScript, and CSS application in `dashboard/` (`index.html`, `app.js`, `style.css`, `data-source.js`) with vendored Chart.js 4.4.6 and no build step, served from the Pages_Site.
- **Publisher**: The Guardian component that builds Published_Data from raw run artifacts (`src/publish/build-published-data.ts` and `src/publish/published-data.ts`).
- **Sanitizer**: The combination of `src/publish/sanitizer.ts` and `src/safety/redactor.ts` that removes secrets, local file paths, and other disallowed content from Published_Data.
- **Raw_Axe_Result**: The per-page, per-viewport axe-core JSON stored at `artifacts/runs/<Run_ID>/accessibility/<slug>.<desktop|mobile>.json`.
- **Rule_Violation**: One axe-core violation within a Raw_Axe_Result, identified by rule id, with an impact, description, help text, help URL, WCAG tags, and a list of affected nodes.
- **Impact**: The per-rule axe-core severity value, one of `critical`, `serious`, `moderate`, or `minor`.
- **Severity**: The severity of a Finding as shown in the Dashboard. For accessibility Findings, Severity equals the Impact of the Rule_Violation.
- **Affected_Element**: One node of a Rule_Violation, with a sanitized HTML snippet, a CSS target selector, and a failure summary.
- **Element_Evidence**: The published, sanitized, size-capped list of Affected_Elements for a Finding.
- **Finding**: A single reported quality issue for one page, one viewport, and one rule or check, as published in `findings.json`.
- **Finding_Detail_View**: The Dashboard view that explains a single Finding in plain English with its element, reason, remediation, and evidence.
- **Plain_English_Summary**: A deterministic, template-based sentence that states what is wrong, who is affected, and whether the problem affects the whole page or specific elements, written from Rule_Violation data and a fixed rule-explanation catalogue.
- **Rule_Catalogue**: A static, human-authored mapping from axe rule id to Plain_English_Summary text, user-impact statement, and how-to-fix guidance, with a generic fallback for rule ids not in the catalogue.
- **Page_Group**: A named collection of pages derived deterministically from the URL path (for example the first path segment) used to organise the page list.
- **Page_Detail_View**: The large Dashboard view that shows everything known about one page, including its Findings, evidence, and history.
- **Run_View**: The Dashboard view that shows one run: its metadata, totals, and Findings.
- **Deep_Link**: A URL (hash or query based) that restores a specific Dashboard view, including selection and filters, when opened directly.
- **Filtered_Findings_View**: A list of Findings narrowed by one or more filters, for example severity, lifecycle state, run, page, or Page_Group.
- **Lifecycle_State**: The state of a Finding relative to prior runs: `new`, `recurring`, `existing-unresolved`, `regression`, or `resolved`. A Finding that is an Ignored_Finding has no Lifecycle_State bucket in any chart.
- **A11y_History**: The persisted record of accessibility Findings and their Lifecycle_State across runs, stored in `artifacts/a11y-history.json`.
- **Visual_Comparison**: A view showing the approved baseline image, the current image, and the difference image for the same page and viewport.
- **Baseline_Image**: The approved baseline screenshot for a page and viewport.
- **Diff_Image**: The generated image that highlights pixel differences between the Baseline_Image and the current screenshot.
- **Evidence_Caption**: Text attached to an evidence image stating the page, viewport, Run_ID, run date and time, and what the image shows.
- **Automated_Guidance**: Deterministic, template-or-heuristic advice shown for a Finding. It is not produced by a large language model and is labelled as automated guidance.
- **Published_Cap**: A fixed upper limit on published data size, for example a maximum number of Affected_Elements per Rule_Violation, a maximum HTML snippet length, and a maximum file size.
- **Image_Retention_Window**: The N most recent published runs (by run finish time) for which screenshots, Diff_Images, and Baseline_Images are published. N is configurable and defaults to 10.
- **Admin_GUI**: The local control panel served by `src/admin/admin-server.ts` on `http://127.0.0.1:7787`, bound to the loopback interface only.
- **Approval_Gate**: The existing human approval component (`src/approval/approval-gate.ts`) that records human decisions, rejects agent identities, and writes the audit log.
- **Disposition**: A human decision about a Finding, one of `ignore`, `resolve`, or `unignore`, with a matcher, a required reason, a required reviewer name, and a timestamp.
- **Disposition_Log**: The versioned, append-only record of all Dispositions, stored at `artifacts/dispositions.json` locally and on the Run_Data_Branch. Undoing a Disposition adds an `unignore` entry; no entry is ever deleted.
- **Ignore_Scope**: The breadth of an `ignore` Disposition, chosen each time: `element` (one page, viewport, rule, and CSS target), `page-rule` (one rule on one page, all viewports), or `site-rule` (one rule on every page and viewport).
- **Regression**: A Finding that reappears in a run after a `resolve` Disposition that is in effect for that run. Its Lifecycle_State is `regression`.
- **Active_Finding**: A detected Finding that is not an Ignored_Finding for the run. Unless a criterion says otherwise, every count, total, chart, KPI card, and filtered view of "Findings" in this document means Active_Findings.
- **Ignored_Finding**: A detected Finding that is matched by an `ignore` Disposition that is in effect for the run. It is excluded from all Active_Finding counts and shown only in the Ignored count and Ignored list.
- **Effective_From**: The rule that decides which runs a Disposition applies to: a Disposition applies to a run if and only if its timestamp is earlier than that run's finish time and it was present in the Disposition_Log snapshot the Guardian read when it finalised that run. Runs that finished earlier are never recounted.

## Requirements

### Requirement 1: Published Element-Level Evidence Data Model

**User Story:** As a developer viewing the Dashboard, I want each accessibility Finding to carry the rule explanation and the affected elements, so that I can see exactly what is failing.

#### Acceptance Criteria

1. WHEN the Publisher builds Published_Data for a run, THE Publisher SHALL read each Raw_Axe_Result for that run and SHALL publish, for every Rule_Violation, the rule id, Impact, description, help text, help URL, and WCAG tags.
2. WHEN the Publisher publishes a Rule_Violation, THE Publisher SHALL publish its Affected_Elements, each with an HTML snippet, a CSS target selector, and a failure summary.
3. THE Publisher SHALL associate each published Rule_Violation with the page URL, viewport (`desktop` or `mobile`), and Run_ID of the Finding it explains.
4. THE Publisher SHALL pass every published Element_Evidence field through the Sanitizer before writing it to Published_Data.
5. THE Publisher SHALL truncate each HTML snippet to a maximum of 500 characters and SHALL publish at most 10 Affected_Elements per Rule_Violation per page and viewport.
6. WHEN Affected_Elements are omitted because of the Published_Cap, THE Publisher SHALL publish the total count of affected nodes and the count of omitted nodes.
7. THE Publisher SHALL publish Element_Evidence as part of the existing per-run data under `/data/runs/<Run_ID>/` and SHALL keep the existing published file names and fields so that earlier consumers continue to work.
8. IF the Sanitizer cannot confirm that an Element_Evidence field is free of secrets and local file paths, THEN THE Publisher SHALL withhold that field, SHALL publish a marker stating that the field was withheld, and SHALL record the reason.
9. IF a Raw_Axe_Result is missing or cannot be parsed, THEN THE Publisher SHALL publish the Finding without Element_Evidence, SHALL mark the Finding as having no element detail, and SHALL continue publishing the remaining data.
10. FOR ALL published Element_Evidence, THE Publisher SHALL produce output that contains no local absolute file path, no secret value, and no non-ASCII control characters.
11. THE Publisher SHALL produce a total published size per run that does not exceed the Published_Cap for run size, and SHALL record the omission when data is dropped to stay within the cap.
12. THE Publisher SHALL NOT make any network or large-language-model call while building Element_Evidence.

### Requirement 2: Correct Severity From Real Rule Impact

**User Story:** As a QA lead, I want severity to reflect the real impact of each rule, so that serious issues are not reported as critical and counts can be trusted.

#### Acceptance Criteria

1. THE Publisher SHALL publish, for each accessibility Finding, a Severity equal to the Impact of its Rule_Violation.
2. THE Dashboard SHALL display the Severity published for a Finding and SHALL NOT derive Severity by matching text in the Finding detail string.
3. WHEN a single page and viewport has Rule_Violations with different Impacts, THE Publisher SHALL publish one Finding per Rule_Violation, each with its own Severity.
4. THE Dashboard SHALL count critical, serious, moderate, and minor Findings separately in all totals, KPI cards, and charts.
5. WHEN the Dashboard displays a count of Findings for a Severity, THE Dashboard SHALL display the same count in the KPI card, the severity chart, and the corresponding Filtered_Findings_View for the same run selection.
6. WHERE a Finding is not an accessibility Finding, THE Publisher SHALL publish the Severity assigned by its deterministic check and SHALL publish a value of `unrated` when the check assigns none.
7. WHERE a Finding has Severity `unrated`, THE Dashboard SHALL display the label "Not rated" and SHALL NOT display a numeric or colour-coded severity that implies a rating.
8. IF a published run predates this feature and lacks per-rule Severity, THEN THE Dashboard SHALL display the label "Severity not recorded for this run" for those Findings and SHALL NOT infer a Severity from detail text.
9. FOR ALL runs, THE sum of Active_Findings counted across all Severity values SHALL equal the total Active_Finding count shown for that run, and the Active_Finding total plus the Ignored_Finding count SHALL equal the number of detected Findings in that run (invariant; see Requirement 19).

### Requirement 3: Finding Detail View

**User Story:** As a developer, I want each Finding explained in plain English with the element, the reason, and how to fix it, so that I know what is wrong and what to do.

#### Acceptance Criteria

1. WHEN a viewer selects a Finding, THE Dashboard SHALL open the Finding_Detail_View for that Finding.
2. THE Finding_Detail_View SHALL display a Plain_English_Summary that states what is wrong, who is affected, and whether the problem affects the whole page or specific elements.
3. THE Finding_Detail_View SHALL display the rule id, Severity, WCAG tags, and a link to the help URL for the rule.
4. THE Finding_Detail_View SHALL display the page URL, the viewport, and the Run_ID and run date of the Finding.
5. WHERE Element_Evidence exists for the Finding, THE Finding_Detail_View SHALL list each Affected_Element with its sanitized HTML snippet, CSS target selector, and failure summary.
6. WHERE the count of omitted Affected_Elements is greater than zero, THE Finding_Detail_View SHALL display the total node count and the number of nodes not shown.
7. THE Finding_Detail_View SHALL display how to fix the problem, taken from the Rule_Catalogue entry for the rule id or, when none exists, from the published help text.
8. IF a rule id is not present in the Rule_Catalogue, THEN THE Finding_Detail_View SHALL display the published description and help text and SHALL NOT display invented explanatory text.
9. WHERE a screenshot exists for the Finding's page and viewport, THE Finding_Detail_View SHALL display it with an Evidence_Caption.
10. WHERE a Finding has no Element_Evidence, THE Finding_Detail_View SHALL display the text "No element detail was recorded for this finding" and SHALL display the Finding's existing detail string.
11. WHEN the Finding_Detail_View displays an HTML snippet, THE Dashboard SHALL render the snippet as escaped text and SHALL NOT interpret it as markup.
12. THE Finding_Detail_View SHALL include, for a Finding that is the same rule on other pages, a count of the other pages with the same rule id in the same run and a link to the Filtered_Findings_View for that rule.
13. WHEN a viewer selects the same Finding via a Deep_Link, THE Dashboard SHALL open the same Finding_Detail_View.
14. FOR ALL Rule_Catalogue entries, THE Plain_English_Summary SHALL contain no pronoun without a named subject and SHALL be written in the same terms as the rule's help text.

### Requirement 4: Visual Difference Findings Explained

**User Story:** As a QA lead, I want a visual difference finding to say what changed and let me compare it with the baseline, so that I can judge whether it matters.

#### Acceptance Criteria

1. WHEN a Finding records a screenshot difference, THE Finding_Detail_View SHALL state that the current screenshot differs from the approved Baseline_Image for that page and viewport.
2. WHEN a visual difference is suppressed as a standalone Finding because the page already has a failing deterministic rule, THE Finding_Detail_View SHALL state that reason in plain English and SHALL name the failing rule or rules on that page.
3. THE Finding_Detail_View SHALL display the percentage or pixel count of difference when the published data records it.
4. WHERE the published data records a difference measure, THE Finding_Detail_View SHALL display it alongside the page and viewport.
5. WHERE a visual difference has no assigned Severity, THE Finding_Detail_View SHALL display "Not rated - visual changes need human review".
6. THE Finding_Detail_View SHALL link to the Visual_Comparison for the page and viewport.
7. THE Finding_Detail_View SHALL identify the Run_ID and run date of the current image and, when available, the Run_ID and approval date of the Baseline_Image.

### Requirement 5: Visual Comparison With Published Baselines

**User Story:** As a tech leader, I want to see the baseline, current, and difference images side by side, so that I can judge a visual change.

#### Acceptance Criteria

1. WHEN the Publisher builds Published_Data for a run that has a screenshot difference, THE Publisher SHALL publish the Baseline_Image used for that comparison under `/data/runs/<Run_ID>/` alongside the current image and the Diff_Image.
2. THE Publisher SHALL NOT publish Baseline_Images for pages and viewports that have no screenshot difference in the run.
3. WHEN a viewer opens a Visual_Comparison, THE Dashboard SHALL display the Baseline_Image, the current image, and the Diff_Image for the same page and viewport.
4. THE Visual_Comparison SHALL provide a layout that shows the three images side by side where the viewport width allows and stacked otherwise.
5. WHERE the Baseline_Image and current image are both available, THE Visual_Comparison SHALL provide a control that switches between them in place, operable by keyboard.
6. THE Visual_Comparison SHALL label each image with an Evidence_Caption that names it as "Approved baseline", "Current run", or "Difference highlight" and states what the Difference highlight colour means.
7. IF the Baseline_Image is not available in Published_Data, THEN THE Visual_Comparison SHALL display the current image and the Diff_Image, SHALL state that the baseline image was not published, and SHALL NOT display a placeholder as if it were the baseline.
8. THE Publisher SHALL pass every published image through the same size limits as other Published_Data, and SHALL record the omission when an image is dropped to stay within the Published_Cap.
9. THE Visual_Comparison SHALL provide a text alternative for each image that states the page, viewport, and image role.
10. WHEN a screenshot is taller than the available area, THE Visual_Comparison SHALL allow scrolling within the comparison and SHALL allow opening each image at full size.

### Requirement 6: Evidence Captioning

**User Story:** As a viewer, I want every evidence image to say which run and page it is from and what it shows, so that I do not have to guess.

#### Acceptance Criteria

1. THE Dashboard SHALL display an Evidence_Caption with every evidence image it renders.
2. THE Evidence_Caption SHALL state the page URL, the viewport, the Run_ID, the run date and time, and the image role.
3. WHERE an evidence image is a Diff_Image, THE Evidence_Caption SHALL state that highlighted areas are pixel differences from the approved baseline and SHALL state what the highlight colour means.
4. WHERE an evidence image is a full-page screenshot, THE Evidence_Caption SHALL state that it is a full-page capture at the stated viewport.
5. THE Dashboard SHALL provide an alt text for each evidence image that matches the information in its Evidence_Caption.
6. IF the run date or Run_ID of an evidence image cannot be determined, THEN THE Dashboard SHALL display the caption "Run not recorded" for that field and SHALL NOT display an assumed value.
7. WHEN a viewer selects an evidence image, THE Dashboard SHALL open it at full size with its Evidence_Caption and SHALL allow closing it with the keyboard.

### Requirement 7: Honest Automated Guidance

**User Story:** As the Reviewer, I want automated notes to be specific and honestly labelled, so that viewers are not misled about their source.

#### Acceptance Criteria

1. THE Dashboard SHALL NOT label any template-based or heuristic text as large-language-model output, AI commentary, or AI analysis.
2. THE Dashboard SHALL label template-based and heuristic text as "Automated guidance" and SHALL state that it is generated by fixed rules and is not a deterministic test result.
3. WHEN the Dashboard displays Automated_Guidance for a Finding, THE Dashboard SHALL name the page, the rule or check, the Severity, and the problem in plain English.
4. WHEN the Dashboard displays Automated_Guidance that asks for human review, THE Dashboard SHALL state what the Reviewer is to decide, for example whether the visual change is intended, and SHALL link to the Finding_Detail_View and to related evidence.
5. IF a note contains no more information than the generic text "a failing deterministic check may affect users; recommend human review", THEN THE Dashboard SHALL NOT display that note.
6. THE Dashboard SHALL display Automated_Guidance visually distinct from deterministic facts, in accordance with the existing separation of deterministic facts from opinion.
7. THE Publisher SHALL publish the Finding identifier, page URL, rule or check id, and Severity with each Automated_Guidance item so that the Dashboard can link it to its Finding.
8. IF an Automated_Guidance item cannot be linked to a published Finding, THEN THE Dashboard SHALL NOT display that item.
9. WHERE the product has no large language model, THE Dashboard SHALL NOT display any confidence value presented as a model confidence.
10. THE Dashboard SHALL display the Automated_Guidance list as a list of items each showing page, problem, Severity, and a link to the Finding_Detail_View.

### Requirement 8: Scalable Page Navigation

**User Story:** As a QA lead with a large site, I want pages grouped, searchable, filterable, and sortable, so that I can find a page among 100 or more.

#### Acceptance Criteria

1. THE Dashboard SHALL organise the page list into Page_Groups derived deterministically from the URL path of each page.
2. THE Dashboard SHALL display, for each Page_Group, its name, the number of pages, and the count of Findings by Severity.
3. WHEN a viewer selects a Page_Group, THE Dashboard SHALL expand or collapse the pages in that group.
4. THE Dashboard SHALL provide a search control that filters pages by URL or title text.
5. WHEN a viewer enters search text, THE Dashboard SHALL update the page list to show only matching pages and SHALL show the count of matches.
6. THE Dashboard SHALL provide filters for Severity, Lifecycle_State, and whether a page has Findings.
7. THE Dashboard SHALL provide sort options for page URL, number of Findings, and highest Severity.
8. WHEN no page matches the search text and filters, THE Dashboard SHALL display the message "No pages match" and the active filters, and SHALL provide a control that clears them.
9. WHEN a viewer changes search text, filters, or sort, THE Dashboard SHALL record them in the Deep_Link.
10. WHILE the page list contains 100 or more pages, THE Dashboard SHALL render the list so that the page remains responsive, by rendering only the pages in expanded groups.
11. THE Dashboard SHALL give every Page_Group and page row a visible keyboard focus indicator and an accessible name that includes its Finding count.
12. FOR ALL search texts, THE set of pages displayed SHALL be a subset of the set of pages displayed with an empty search text under the same filters (metamorphic property).
13. WHERE a page has Findings of several Severities, THE Dashboard SHALL display the highest Severity on the page row.

### Requirement 9: Large Page Detail View With Deep Links

**User Story:** As a developer, I want a large detail view for a page that I can link to, so that I can use the whole screen and share exactly what I am looking at.

#### Acceptance Criteria

1. WHEN a viewer selects a page, THE Dashboard SHALL open the Page_Detail_View using the full width of the content area and SHALL NOT restrict it to a narrow side panel.
2. THE Page_Detail_View SHALL display the page URL, the highest Severity, the Finding count by Severity, and the Findings grouped by viewport.
3. THE Page_Detail_View SHALL display each Finding with its Severity, Plain_English_Summary, and a link to its Finding_Detail_View.
4. THE Page_Detail_View SHALL display the evidence for the page with Evidence_Captions and a link to the Visual_Comparison when one exists.
5. THE Page_Detail_View SHALL display the history of the page across runs, showing for each run the Finding count and the Lifecycle_State of each Finding.
6. WHEN the Page_Detail_View opens, THE Dashboard SHALL update the URL to a Deep_Link that identifies the page and the selected run.
7. WHEN a viewer opens a Deep_Link directly, THE Dashboard SHALL restore the Page_Detail_View, Finding_Detail_View, Run_View, or Filtered_Findings_View that the Deep_Link identifies.
8. WHEN a viewer uses the browser back and forward controls, THE Dashboard SHALL restore the previous or next view and its selection.
9. IF a Deep_Link refers to a page, run, or Finding that is not in the Published_Data, THEN THE Dashboard SHALL display the message "That item is not in the published data" with a link to the overview.
10. WHEN the Page_Detail_View opens, THE Dashboard SHALL move keyboard focus to the Page_Detail_View heading, and WHEN the viewer closes it, THE Dashboard SHALL return focus to the control that opened it.
11. THE Page_Detail_View SHALL provide a control that returns to the previous list with its search, filters, sort, and scroll position preserved.
12. FOR ALL views, THE Deep_Link produced by the Dashboard SHALL, when opened, restore an equivalent view (round-trip property).

### Requirement 10: Interactive Trend Chart And Run View

**User Story:** As a QA lead, I want to click a run on the trend chart and see that run's findings, so that I can investigate when things changed.

#### Acceptance Criteria

1. THE Dashboard SHALL render the issues-per-run trend chart with one selectable point for each run.
2. WHEN a viewer selects a point on the trend chart, THE Dashboard SHALL open the Run_View for that run.
3. THE Run_View SHALL display the Run_ID, run date and time, trigger, pages scanned, the Finding count by Severity, and the Findings of that run as a Filtered_Findings_View.
4. THE Run_View SHALL display the change in Finding count compared with the previous run.
5. THE Dashboard SHALL provide a run selector that lists all published runs by date and allows a viewer to choose which run the overview displays.
6. WHEN a viewer chooses a run in the run selector, THE Dashboard SHALL update the KPI cards, the severity chart, the lifecycle chart, and the page list to that run.
7. WHILE a run other than the latest is selected, THE Dashboard SHALL display a notice stating the selected Run_ID and date and SHALL provide a control that returns to the latest run.
8. WHERE a chart point is selected with the pointer, THE Dashboard SHALL provide an equivalent keyboard-operable control, such as a run list or table, that performs the same action.
9. THE Dashboard SHALL display a tooltip for each trend chart point with the Run_ID, date, and Finding count.
10. IF the Published_Data lists a run whose per-run data is missing, THEN THE Dashboard SHALL display that run as "Run data not published" and SHALL NOT open an empty Run_View.
11. FOR ALL runs, THE Active_Finding count shown for a point on the trend chart SHALL equal the number of Active_Findings listed in that run's Run_View (invariant).
12. WHERE Dispositions took effect in a run, THE Dashboard SHALL mark that run's point on the trend chart and its row in the run table with the text of the effect, for example "12 issues ignored from this run" (see Requirement 19).

### Requirement 11: Interactive Severity Chart

**User Story:** As a QA lead, I want to click a severity slice and see those findings, so that I can start with the most serious.

#### Acceptance Criteria

1. THE Dashboard SHALL render the severity chart with one selectable segment for each Severity that has at least one Finding.
2. WHEN a viewer selects a severity segment, THE Dashboard SHALL open a Filtered_Findings_View of the Findings with that Severity for the selected run.
3. THE Filtered_Findings_View SHALL display for each Finding the page URL, the viewport, the rule or check, the Plain_English_Summary, and a link to the Finding_Detail_View.
4. THE Filtered_Findings_View SHALL display the active filters and the number of Findings shown.
5. THE Filtered_Findings_View SHALL allow the viewer to add or remove filters for Severity, Lifecycle_State, Page_Group, and rule id.
6. THE Dashboard SHALL display the count and label of each severity segment as text in addition to colour.
7. WHERE a chart segment is selected with the pointer, THE Dashboard SHALL provide an equivalent keyboard-operable control that performs the same action.
8. THE Dashboard SHALL record the active filters in the Deep_Link.
9. IF the Filtered_Findings_View has zero Findings, THEN THE Dashboard SHALL display "No findings match these filters" with a control that clears the filters.
10. FOR ALL severity segments, THE number of Active_Findings shown in the Filtered_Findings_View SHALL equal the count labelled on the segment (invariant).

### Requirement 12: Lifecycle Chart And Filtered View

**User Story:** As a QA lead, I want the new-versus-recurring chart to be correct and clickable, so that I can see which issues are new and which are persisting.

#### Acceptance Criteria

1. THE Dashboard SHALL render the lifecycle chart with a series for each of the Lifecycle_States `new`, `recurring`, `existing-unresolved`, `regression`, and `resolved`.
2. THE Dashboard SHALL render each Lifecycle_State series with a distinct label and pattern or colour that does not rely on colour alone.
3. WHEN a viewer selects a bar or segment of the lifecycle chart, THE Dashboard SHALL open a Filtered_Findings_View of the Findings with that Lifecycle_State for that run.
4. THE Dashboard SHALL read the Lifecycle_State of each Finding from published data produced from the A11y_History and SHALL NOT assign a Lifecycle_State when none is recorded.
5. IF a Finding has no recorded Lifecycle_State, THEN THE Dashboard SHALL count it as "State not recorded" and SHALL display that group in the lifecycle chart and its legend.
6. THE Dashboard SHALL NOT omit any Active_Finding from the lifecycle chart because of its Lifecycle_State.
7. WHERE a chart bar is selected with the pointer, THE Dashboard SHALL provide an equivalent keyboard-operable control that performs the same action.
8. THE Dashboard SHALL display the count of each Lifecycle_State as text.
9. FOR ALL runs, THE sum of Active_Findings across the present-state series (`new`, `recurring`, `existing-unresolved`, `regression`, and "State not recorded") in the lifecycle chart SHALL equal the total Active_Finding count of that run, and the `resolved` series SHALL be shown separately and excluded from that sum (invariant).
10. WHEN the first run for a page has no earlier run, THE Dashboard SHALL treat the Findings of that run as `new`.

### Requirement 13: A11y History Persistence And Lifecycle Computation

**User Story:** As the Reviewer, I want accessibility history to persist across CI runs, so that new, recurring, and resolved states are real.

#### Acceptance Criteria

1. WHEN the Cloud_Runner starts a run, THE Cloud_Runner SHALL restore the A11y_History from the Run_Data_Branch before the run begins.
2. WHEN a run completes, THE Cloud_Runner SHALL write the updated A11y_History to the Run_Data_Branch together with the run artifacts.
3. THE Guardian SHALL identify a Finding across runs by the combination of page URL, viewport, and rule id.
4. WHEN a Finding is present in the current run and absent from the A11y_History, THE Guardian SHALL record its Lifecycle_State as `new`.
5. WHEN a Finding is present in the current run and was `new` or `recurring` in the immediately preceding run, THE Guardian SHALL record its Lifecycle_State as `recurring`.
6. WHEN a Finding was present in the A11y_History as unresolved and is absent from the current run, THE Guardian SHALL record its Lifecycle_State as `resolved` for that run.
7. WHEN a Finding was `resolved` and is present in the current run, THE Guardian SHALL record its Lifecycle_State as `new`.
8. IF the A11y_History cannot be restored or parsed, THEN THE Guardian SHALL continue the run, SHALL record a warning that history was unavailable, and SHALL mark the run's Findings as "State not recorded" instead of `new`.
9. THE Publisher SHALL publish the Lifecycle_State of each Finding in the per-run Published_Data.
10. THE Publisher SHALL publish the Lifecycle_State of resolved Findings for the run in which they were resolved, including their page URL, viewport, rule id, and Severity.
11. THE Guardian SHALL write the A11y_History so that earlier recorded runs are preserved and a failed write leaves the previous A11y_History intact.
12. FOR ALL sequences of runs, THE A11y_History after applying the same run results twice SHALL be equal to the A11y_History after applying them once (idempotence).
13. FOR ALL Findings, THE Lifecycle_State computed from the A11y_History SHALL depend only on the A11y_History and the current run Findings (determinism).
14. THE A11y_History persistence SHALL use only the Run_Data_Branch and free GitHub features.

### Requirement 14: Run Selection And Overview Consistency

**User Story:** As a tech leader, I want the overview to be consistent for the run I select, so that numbers match wherever I look.

#### Acceptance Criteria

1. THE Dashboard SHALL display on the overview the Run_ID and date of the run whose data it shows.
2. WHEN the viewer changes the selected run, THE Dashboard SHALL update every figure and chart on the overview to that run.
3. THE Dashboard SHALL display KPI cards for health, runs tracked, total Findings, Findings by Severity, and pages scanned, each with a text label and a definition available to assistive technology.
4. THE Dashboard SHALL remove KPI cards whose meaning duplicates another card, so that no two cards present the same figure under different names.
5. WHEN a viewer selects a KPI card that represents Findings, THE Dashboard SHALL open the Filtered_Findings_View that matches the card.
6. IF Published_Data for the latest run cannot be loaded, THEN THE Dashboard SHALL display an error message naming the data that failed to load and SHALL display the most recent run that loaded, if any.
7. FOR ALL runs, THE KPI total Active_Finding count SHALL equal the sum of the severity chart segments and the sum of the present-state lifecycle chart series (invariant).
8. THE Dashboard SHALL display a KPI card that shows the Ignored_Finding count for the selected run, labelled "Ignored", separate from the Active_Finding total.

### Requirement 15: Dashboard Accessibility (WCAG 2.2 AA Goal)

**User Story:** As a viewer who uses assistive technology, I want the Dashboard to be accessible, so that a quality-monitoring product meets its own standard.

#### Acceptance Criteria

1. THE Dashboard SHALL be operable using the keyboard alone, including the page list, search, filters, charts' keyboard equivalents, Finding_Detail_View, Visual_Comparison, and full-size image view.
2. THE Dashboard SHALL display a visible focus indicator on every interactive element with a contrast ratio of at least 3:1 against adjacent colours.
3. THE Dashboard SHALL present text with a contrast ratio of at least 4.5:1 against its background, and large text with at least 3:1.
4. THE Dashboard SHALL NOT convey Severity, Lifecycle_State, or chart series by colour alone.
5. THE Dashboard SHALL provide a text alternative for each chart, consisting of a data table or a text summary of the same values.
6. THE Dashboard SHALL use landmark regions, a logical heading order, and labelled controls.
7. WHEN the view changes, THE Dashboard SHALL announce the new view or result count to assistive technology through a live region.
8. THE Dashboard SHALL provide interactive targets of at least 24 by 24 CSS pixels.
9. WHERE the viewer's system requests reduced motion, THE Dashboard SHALL disable chart animation and other non-essential motion.
10. THE Dashboard SHALL remain usable when text is resized to 200 percent and at a viewport width of 320 CSS pixels without loss of content or function.
11. THE Dashboard SHALL be checked by the Guardian's own accessibility scan, and WHEN that scan reports a critical or serious violation on the Dashboard, THE Guardian SHALL report it as a Finding in the run summary.
12. THE Dashboard SHALL NOT claim WCAG 2.2 AA conformance, and SHALL describe it as a goal that requires manual testing with assistive technologies.

### Requirement 16: Dashboard Performance And Scale

**User Story:** As a viewer on an ordinary connection, I want the Dashboard to load quickly even with many pages and runs, so that it remains usable as the site grows.

#### Acceptance Criteria

1. THE Dashboard SHALL load the overview from the aggregate data (`index.json` and `dashboard.json`) and SHALL load per-run and per-page detail only when the viewer opens it.
2. WHILE the Published_Data contains 100 or more pages and 50 or more runs, THE Dashboard SHALL display the overview within 3 seconds of data load on a desktop browser.
3. WHEN a viewer filters or searches the page list, THE Dashboard SHALL update the displayed results within 200 milliseconds for a list of 500 pages.
4. THE Dashboard SHALL load evidence images lazily, so that images outside the viewport are not fetched until they are needed.
5. THE Publisher SHALL keep the size of `dashboard.json` independent of the number of Affected_Elements, by publishing Element_Evidence only in per-run files.
6. IF a per-run file fails to load, THEN THE Dashboard SHALL display an error naming the file and SHALL keep the rest of the Dashboard usable.
7. WHILE a per-run file is loading, THE Dashboard SHALL display a loading indicator announced to assistive technology.
8. WHEN the Publisher builds Published_Data, THE Publisher SHALL publish screenshots, Diff_Images, and Baseline_Images only for the runs in the Image_Retention_Window, whose size N is configurable and defaults to 10.
9. THE Publisher SHALL continue to publish Findings, Element_Evidence, and all other JSON for runs outside the Image_Retention_Window.
10. WHEN the Publisher omits an image because its run is outside the Image_Retention_Window, THE Publisher SHALL record each omission with the reason `image-retention`.
11. WHERE an image is not published because its run is outside the Image_Retention_Window, THE Dashboard SHALL display the text "Images not kept for this run (only the latest 10 runs keep images)" in place of the image, using the published retention count for the number, and SHALL NOT render a broken image.
12. FOR ALL sets of published runs, THE number of runs that have published images SHALL be at most N, and every run in the Image_Retention_Window that has images on the Run_Data_Branch SHALL have them published unless another Published_Cap omission is recorded (invariant).

### Requirement 17: Preserve Existing Guarantees And Constraints

**User Story:** As the Reviewer, I want the existing guarantees preserved, so that this feature strengthens usability without weakening safety.

#### Acceptance Criteria

1. THE Guardian SHALL remain deterministic and SHALL consume zero AI tokens, with no large-language-model call at runtime.
2. THE Guardian SHALL remain free, using no paid service, no paid hosting, and no paid dependency.
3. THE Dashboard SHALL remain plain HTML, JavaScript, and CSS with the vendored Chart.js and SHALL NOT introduce a framework or a build step.
4. THE Dashboard and all files written by this feature SHALL contain only ASCII characters.
5. THE Publisher SHALL continue to publish only genuine run data and SHALL NOT fabricate Findings, runs, images, or states.
6. THE Publisher SHALL continue to exclude secrets, local file paths, and raw traces from Published_Data.
7. THE Dashboard SHALL remain read-only and SHALL NOT submit forms, modify data, record a Disposition, or link to a route that records a Disposition or opens a GitHub issue.
8. THE Dashboard SHALL continue to function in Replay_Mode from static files with no server.
9. WHEN Published_Data was produced before this feature, THE Dashboard SHALL display it using the fields it has, SHALL label missing detail as not recorded, and SHALL NOT fail to load.
10. WHERE a data migration is required, THE Guardian SHALL record the migration.
11. THE Guardian SHALL preserve the tamper-evident append-only audit log and the Approved_Domain restriction.
12. WHEN a new dependency is introduced, THE Guardian SHALL record its cost and licence before adoption.
13. THE Virtual Office SHALL remain unchanged by this feature.
14. FOR ALL published JSON files, THE Publisher SHALL produce output that parses as valid JSON and whose serialisation, parsed and serialised again, is equal (round-trip property).

### Requirement 18: Human Resolve And Ignore Decisions

**User Story:** As the Reviewer, I want to mark an issue as resolved or ignore it from the local Admin_GUI, so that issues I have judged are not flagged again.

#### Acceptance Criteria

1. THE Admin_GUI SHALL list the Findings of the selected local run and SHALL provide, for each Active_Finding, a "Mark resolved" control and an "Ignore" control, and for each Ignored_Finding an "Un-ignore" control.
2. THE Dashboard SHALL NOT provide any control, form, or link that records, changes, or submits a Disposition.
3. WHEN the Reviewer chooses Ignore, THE Admin_GUI SHALL require the Reviewer to choose exactly one Ignore_Scope from `element`, `page-rule`, and `site-rule` for that decision.
4. WHEN the Reviewer chooses Ignore or Mark resolved, THE Admin_GUI SHALL require a reason and a Reviewer name.
5. IF the reason or the Reviewer name is empty or contains only whitespace, THEN THE Admin_GUI SHALL reject the decision, SHALL display which field is missing, and SHALL record nothing.
6. IF the reason is longer than 500 characters or the Reviewer name is longer than 80 characters, THEN THE Admin_GUI SHALL reject the decision, SHALL display the limit, and SHALL record nothing.
7. WHEN the Reviewer chooses Mark resolved, THE Admin_GUI SHALL apply the decision to the Finding identified by page URL, viewport, and rule id.
8. WHEN the Reviewer selects an Ignore_Scope, THE Admin_GUI SHALL display, before submission, a plain-English description of the scope and the number of Active_Findings in the selected run that the scope matches.
9. WHEN the Reviewer submits a decision, THE Admin_GUI SHALL record it through the Approval_Gate so that the audit log receives an entry with the Reviewer, decision, reason, and timestamp.
10. IF the Approval_Gate rejects a decision, for example because the Reviewer name is an agent identity, THEN THE Admin_GUI SHALL display the rejection reason and SHALL NOT add an entry to the Disposition_Log.
11. WHEN the Reviewer chooses Un-ignore, THE Admin_GUI SHALL require a reason and a Reviewer name and SHALL add an `unignore` entry that refers to the entry it undoes, and SHALL NOT delete or edit any earlier entry.
12. WHEN a decision is recorded, THE Admin_GUI SHALL state that the decision takes effect from the next run and that earlier runs keep their original counts.
13. THE Admin_GUI SHALL list every entry of the Disposition_Log, including undone entries, with its scope, reason, Reviewer, date, and sync state.
14. WHERE the Reviewer uses the command-line `approve` command, THE Guardian SHALL accept the same decisions, scopes, reason, and Reviewer name, SHALL apply the same validation, and SHALL record them through the Approval_Gate.
15. THE Admin_GUI SHALL involve no large-language-model call and SHALL record a decision only when a human submits it.

### Requirement 19: Decision Effects On Counts, Charts, And History

**User Story:** As a QA lead, I want ignored issues removed from every count and chart from the decision onward, while history stays honest, so that an ignored issue is not reported as recurring and past runs are not rewritten.

#### Acceptance Criteria

1. THE Guardian SHALL apply a Disposition to a run if and only if the Disposition satisfies Effective_From for that run.
2. WHEN the Guardian finalises a run, THE Guardian SHALL record the set of Disposition ids that apply to that run in a file in the run directory, and THE Publisher SHALL use that recorded set instead of re-evaluating the Disposition_Log.
3. WHEN a Disposition is added to the Disposition_Log, THE Publisher SHALL publish every run that finished before the Disposition timestamp with the same Findings, counts, and Lifecycle_States as before the Disposition was added.
4. THE Publisher and the Dashboard SHALL exclude every Ignored_Finding from every count, total, severity chart, lifecycle chart, trend chart, KPI card, Page_Group and page count, Run_View count, default Filtered_Findings_View, and Automated_Guidance item.
5. FOR ALL runs, THE number of Active_Findings plus the number of Ignored_Findings SHALL equal the number of Findings detected in that run, and no Finding SHALL be counted as both (invariant).
6. THE Publisher SHALL publish, for each run, the Ignored_Finding count and the list of Ignored_Findings with rule id, page, viewport, scope, reason, Reviewer, and decision date.
7. THE Dashboard SHALL display the Ignored_Finding count and an "Ignored" list for the selected run showing rule, page or pages, scope, reason, Reviewer, and decision date.
8. THE Dashboard SHALL provide an "Ignored" filter in the Filtered_Findings_View, and the default Filtered_Findings_View SHALL exclude Ignored_Findings.
9. WHEN a Finding has a `resolve` Disposition that applies to a run and the Finding is detected in that run, THE Publisher SHALL publish the Finding as an Active_Finding with Lifecycle_State `regression`.
10. WHEN the Dashboard displays a Regression, THE Dashboard SHALL label it "Reappeared after being marked resolved on <date> by <reviewer>" using the decision date and Reviewer name of the latest applicable `resolve` Disposition.
11. WHEN a Finding has a `resolve` Disposition that applies to a run and the Finding is not detected in that run, THE Publisher SHALL list the Finding as resolved in that run.
12. WHEN an `unignore` entry applies to a run, THE Publisher SHALL treat the Finding as an Active_Finding in that run and in later runs, and SHALL NOT change any earlier run.
13. WHEN a Finding that was an Ignored_Finding becomes an Active_Finding through an `unignore` entry, THE Guardian SHALL set its Lifecycle_State from the A11y_History as `recurring` if the history records the Finding as present in the preceding run, and as `new` otherwise.
14. THE Guardian SHALL continue to record detection of Ignored_Findings in the A11y_History, so that ignoring never deletes history.
15. WHEN an `ignore` Disposition with scope `element` matches only some of the Affected_Elements of a Finding, THE Publisher SHALL keep the Finding as an Active_Finding, SHALL exclude the matched elements from its published node counts, and SHALL record the number of ignored elements.
16. WHEN an `ignore` Disposition with scope `element` matches all Affected_Elements of a Finding, THE Publisher SHALL publish the Finding as an Ignored_Finding.
17. IF the CSS target of an Affected_Element differs from the CSS target recorded in an `element` Disposition, THEN THE Publisher SHALL NOT match the element, and the Finding SHALL be flagged again.
18. WHERE a Finding kind has no Affected_Elements, THE Publisher SHALL treat an `element` Disposition as matching the Finding identified by page URL, viewport, and rule id.
19. WHEN more than one Disposition matches a Finding, THE Publisher SHALL treat the Finding as ignored if at least one applicable `ignore` entry that has not been undone matches it, and an applicable `ignore` SHALL take precedence over an applicable `resolve`.
20. THE Publisher SHALL publish, for each run, the Dispositions that first took effect in that run and the number of Findings each one affects.
21. WHERE Dispositions first took effect in a run, THE Dashboard SHALL state the effect in the trend chart annotation and run table, for example "12 issues ignored from this run".
22. IF the Disposition_Log could not be loaded for a run, THEN THE Publisher SHALL publish the run with status `unavailable` for decisions and THE Dashboard SHALL display the notice "Decisions could not be loaded for this run; counts may include issues that were ignored".
23. THE Dashboard SHALL display every Regression prominently with a text label and a symbol, and SHALL NOT rely on colour alone.
24. FOR ALL logs and run Findings, THE Publisher SHALL produce the same Active_Findings, Ignored_Findings, and Lifecycle_States regardless of the order of entries in the Disposition_Log (determinism).

### Requirement 20: Disposition Persistence, Synchronisation, And Security

**User Story:** As the Reviewer, I want my decisions stored safely, synchronised to the cloud, and protected from other web pages, so that no decision is lost or forged.

#### Acceptance Criteria

1. THE Guardian SHALL store Dispositions in a versioned, append-only Disposition_Log whose entries each hold an id, decision, Ignore_Scope, matcher (normalised page URL, viewport, rule id, CSS target), reason, Reviewer, timestamp, and for `unignore` the id it undoes.
2. THE Guardian SHALL derive each entry id deterministically from the content of the entry and SHALL reject any entry whose id does not match its content.
3. THE Guardian SHALL match a Finding by normalised page URL, viewport, rule id, and CSS target, where scope `page-rule` ignores viewport and CSS target and scope `site-rule` ignores page, viewport, and CSS target.
4. WHEN two Disposition_Logs are merged, THE Guardian SHALL produce the union of their entries by id, so that merge is commutative and idempotent and drops no entry.
5. WHEN the Reviewer chooses to synchronise, THE Admin_GUI SHALL commit the Disposition_Log additively to the Run_Data_Branch and push it using the Reviewer's local git credentials, without force, without rebase of existing commits, and without rewriting history, and without changing the Reviewer's current branch or working tree.
6. IF the push fails, THEN THE Admin_GUI SHALL keep the decisions locally, SHALL display "Not yet synced" against each unsynchronised entry, and SHALL provide a retry control.
7. WHEN the Cloud_Runner starts a run, THE Cloud_Runner SHALL restore the Disposition_Log from the Run_Data_Branch before the Guardian runs.
8. THE Cloud_Runner SHALL NOT overwrite, drop, or modify any entry of the Disposition_Log on the Run_Data_Branch when it commits run data.
9. IF the Disposition_Log cannot be restored or parsed, THEN THE Cloud_Runner SHALL continue the run, SHALL record a warning, and SHALL publish the run with decision status `unavailable`.
10. THE Admin_GUI SHALL accept requests only on the loopback interface.
11. WHEN a state-changing request for a Disposition is received, THE Admin_GUI SHALL verify that the Host header names the loopback address and port, that any Origin header names the same loopback origin, and that the content type is JSON, and IF any check fails, THEN THE Admin_GUI SHALL reject the request with status 403 and SHALL record nothing.
12. THE Publisher SHALL pass every published Reviewer name and reason through the Sanitizer, and THE Dashboard SHALL render them as plain text.
13. THE Admin_GUI SHALL state, next to the reason and Reviewer fields, that these values are published on the public Dashboard.
14. THE Guardian SHALL write the Disposition_Log with every non-ASCII character escaped so that the file contains only ASCII characters.
15. THE Disposition features SHALL remain deterministic, zero-token, and free, and SHALL leave the Virtual Office unchanged.
16. FOR ALL valid Disposition_Logs, THE Disposition_Log serialised, parsed, and serialised again SHALL be equal (round-trip property).
