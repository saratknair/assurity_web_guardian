# Requirements Document

## Introduction

Web Guardian is a deterministic website quality monitor. It checks a human-approved set of pages on one approved domain, compares what it sees with human-approved baselines, records findings, and publishes the results as a static Dashboard and a Virtual_Office replay. It calls no AI model and needs no AI account or key. Every number, status and finding is computed by code. Any prose such as summaries and captions is fixed template text that is labelled as template text.

Guardian has five parts:

- The Engine (src/) crawls nothing on its own. It scans the approved pages on a desktop and a mobile viewport, runs accessibility and basic page checks, compares screenshots with approved visual baselines, classifies outcomes, tracks finding lifecycle, applies reviewer decisions, and writes a run directory.
- The Admin_Console (admin-ui/ and src/admin/) is a local web console, bound to the loopback address, that sets up the domain, approve URLs and baselines, record decisions, publish configuration, edit the schedule and pull runs from GitHub.
- The Dashboard (dashboard/) is a static site that reads published JSON and shows runs, findings, pages, evidence and visual comparisons.
- The Virtual_Office (office/) is a static three.js replay of a published run, with a transcript, telemetry, swimlane and inspector that show the same facts as text.
- The Workflow (.github/workflows/guardian.yml) runs Guardian on a schedule, publishes the site to GitHub Pages and stores raw run history on the runs-data branch.

Guardian is gentle on the monitored site: one page at a time, spacing between requests, no form submission and no load testing. Nothing becomes a baseline without explicit human approval. Nothing is sent to external services other than the monitored site and the user's own Git remote.

This document describes the system as it behaves today. Site-specific values such as the domain, owner and repository come from configuration, and examples use example.com.

## Glossary

- **Guardian**: The Web Guardian product as a whole: Engine, Admin_Console, Dashboard, Virtual_Office and Workflow.
- **Engine**: The TypeScript code in src/ that scans pages, compares, classifies, tracks lifecycle and publishes data.
- **Admin_Console**: The local web console in admin-ui/ and src/admin/, started with `npm run console`.
- **Dashboard**: The static site in dashboard/ published to GitHub Pages.
- **Virtual_Office**: The static three.js replay site in office/, published under /office/.
- **Workflow**: The GitHub Actions workflow at .github/workflows/guardian.yml.
- **Approved_Domain**: The one host that Guardian may visit, together with its subdomains, set by `approvedDomain` in the app configuration.
- **Approved_Scope**: The list of pages the Engine scans. It comes from the human-approved scope file for the configured domain, or from the page seed file when that scope file has no pages.
- **Baseline**: A human-approved text specification of a page, stored as baselines/<slug>/baseline.v<N>.md.
- **Visual_Baseline**: A human-approved screenshot of a page at one viewport, stored as baselines-visual/<slug>/<viewport>.png.
- **Reviewer**: The person who approves baselines and records decisions. A Reviewer_Name is typed into the Admin_Console and is not a verified identity.
- **Approval_Gate**: The only code path that promotes a draft to a Baseline.
- **Run**: One execution of the Engine over the Approved_Scope. Each Run has a Run_ID and a Run_Directory.
- **Run_Directory**: artifacts/runs/<run-id>/, holding the raw output of one Run.
- **Finding**: A recorded problem for one page, one viewport and one rule. It is an a11y-rule Finding, a check Finding or a visual Finding.
- **Finding_Key**: The identity of a Finding across runs: the page URL, the viewport and the rule id joined with a vertical bar.
- **Severity**: One of critical, serious, moderate, minor, unrated or not-recorded.
- **Lifecycle**: The state of a Finding across runs: new, recurring, existing-unresolved, regression or not-recorded. Resolved Findings are reported separately.
- **Lifecycle_History**: The file artifacts/a11y-history.json that records which Findings were seen in which runs.
- **Disposition**: A Reviewer decision recorded in the Disposition_Log: ignore, resolve or unignore.
- **Disposition_Log**: The append-only, content-addressed log of Dispositions at artifacts/dispositions.json.
- **Applied_Dispositions**: The frozen copy of the effective Dispositions that a Run stores as dispositions-applied.json when it finishes.
- **Active_Finding**: A Finding that no applicable Disposition ignores or resolves. Dashboard counts use Active_Findings.
- **Ignored_Finding**: A Finding that an applicable ignore Disposition covers. Ignored_Findings are listed separately and are not counted as active.
- **Template_Text**: Prose produced from fixed templates, with no model call, and labelled as template text.
- **Published_Data**: The sanitised static JSON tree under data/ that the Dashboard and Virtual_Office read.
- **Sanitizer**: The publish-time code that removes secrets, personal data and absolute paths from published data and withholds anything it cannot confirm clean.
- **Runs_Data_Branch**: The git branch runs-data that stores raw Run_Directories and history files added by the Workflow.
- **Display_Title**: The optional product title in the app configuration, shown in the Dashboard, Virtual_Office and Admin_Console. The default is "Web Guardian".
- **Instance_Data**: Data and configuration specific to one monitored site: config files, baselines, visual baselines, the Disposition_Log, run output and the Runs_Data_Branch.
- **Step**: One recorded unit of Engine work for a page and viewport, named test-plan, load, screenshot, visual-compare, accessibility-scan, compare, notes, triage, history or decisions.
- **Station**: A named place in the Virtual_Office that groups Steps: test-plan-desk, browser-bay, visual-check, accessibility-check, review-desk or records-room.
- **Enriched_Run**: A Run whose events record Steps (replay schema 1).
- **Replay_Timeline**: The model the Virtual_Office builds from a run's events. It is enriched when the run has Step events and coarse otherwise.
- **Legacy_Run**: A published run recorded in an older data shape: no rule-level accessibility data (detailLevel "legacy"), no Step events, no per-page counts in the Dashboard data, or no Ignored_Findings field.
- **Local_Guard**: The Admin_Console check that a request comes from the loopback origin and is allowed to change state.
- **Size_Gate**: The Workflow step that fails the run when the published office folder or a published events file is over its byte limit.
- **Self_Scan**: A non-blocking automated accessibility check of the built Dashboard or Virtual_Office.
- **Supported_Platforms**: Windows, macOS and Linux with Node and Git on PATH.

## Requirements

### Requirement 1: Approved scope and site safety

**User Story:** As a site owner, I want Guardian to visit only the pages I approved, slowly and read-only, so that monitoring never harms or leaves my site.

#### Acceptance Criteria

1. WHEN the configured domain has an approved scope file with at least one page, THE Engine SHALL scan those pages, limited to `limits.maxApprovedPages` (default 500, at most 500), and OTHERWISE THE Engine SHALL scan the approved URLs of the page seed file.
2. THE Engine SHALL scan only an approved scope and SHALL never scan a proposed scope.
3. IF a navigation URL has a host that is neither the Approved_Domain nor a subdomain of it, THEN THE Engine SHALL block the navigation and raise a domain boundary error.
4. THE Engine SHALL scan with concurrency 1 and SHALL wait at least `limits.requestSpacingMs` between page loads.
5. IF `limits.requestSpacingMs` is below 1000, THEN THE Engine SHALL reject the configuration.
6. THE Engine SHALL NOT submit forms, sign in or generate load.
7. IF the page seed file lists more URLs than its `maxUrls` or more than `limits.pages`, THEN THE Engine SHALL reject the seed file.
8. WHEN an approved page has no approved Baseline, THE Engine SHALL skip the page and record a page.skipped event that names the page and the reason.

### Requirement 2: Per-page checks and run outputs

**User Story:** As a Reviewer, I want each run to check every approved page the same way on desktop and mobile, so that I can compare runs.

#### Acceptance Criteria

1. WHEN the Engine scans a page, THE Engine SHALL load it on the desktop and the mobile viewport, with the sizes from the configuration (default 1440x900 and 390x844), using the navigation timeout `limits.navTimeoutMs`.
2. THE Engine SHALL record for each viewport four load checks named `<viewport>:http` (status from 200 to 399), `<viewport>:title` (non-empty title), `<viewport>:h1` (visible first heading) and `<viewport>:nav` (at least one nav element).
3. THE Engine SHALL capture one screenshot per page and viewport as screenshots/<slug>.<viewport>.png.
4. THE Engine SHALL run the axe accessibility scan with the tags wcag2a, wcag2aa and wcag22aa, write the raw result to accessibility/<slug>.<viewport>.json, and record a check `<viewport>:a11y-critical-serious` that fails when any violation has impact critical or serious.
5. THE Engine SHALL count a page and viewport as scanned only when the navigation produced a response.
6. THE Engine SHALL generate test source from the approved Baseline version and write test-manifest.json with repository-relative paths only.
7. THE Engine SHALL write results.json, findings.json (run id, correlation id, awaitingReview and per-page outcomes, template items and visual results), report/index.html, and the markers origin, trigger and run-source.json.
8. IF report or dashboard generation fails, THEN THE Engine SHALL fail the Run and SHALL NOT publish it.
9. WHEN a Run ends, THE Engine SHALL apply the retention policy (`retention.maxRuns` and `retention.maxAgeDays`) and SHALL NOT delete a Run that awaits human review.

### Requirement 3: Baselines and the Approval_Gate

**User Story:** As a Reviewer, I want only my explicit approval to create or change a baseline, so that monitoring reflects what I accepted.

#### Acceptance Criteria

1. WHILE a specification is a draft, THE Engine SHALL NOT use it as a Baseline.
2. WHEN a Reviewer approves a draft, THE Approval_Gate SHALL promote it to the next versioned Baseline file by writing a temporary file and renaming it, and SHALL write the success entry to the audit log only after the rename succeeds.
3. IF a promotion fails, THEN THE Approval_Gate SHALL record the failed attempt in the audit log and SHALL NOT record a success.
4. IF an approval names a component identity such as an agent or the Orchestrator as the approver, THEN THE Approval_Gate SHALL reject it and record the rejected attempt.
5. THE Approval_Gate SHALL record the Reviewer_Name, the decision, the reason, the Baseline version and a review id for each approval.
6. THE Engine SHALL NOT update a Baseline or a Visual_Baseline as a result of a failed check, a difference or a screenshot comparison.
7. WHEN no Visual_Baseline exists for a page and viewport, THE Engine SHALL store the current screenshot under the run's proposed-visual-baselines folder for human approval and SHALL NOT adopt it.

### Requirement 4: Comparison and classification

**User Story:** As a Reviewer, I want differences classified instead of all being failures, so that I spend my attention where it matters.

#### Acceptance Criteria

1. IF a deterministic expectation is violated, THEN THE Engine SHALL record a failed-check outcome with the classification deterministic-test-evidence that requires human review.
2. IF an observed difference violates no deterministic expectation, THEN THE Engine SHALL record an observed-website-change outcome that is not a failed check.
3. WHEN a screenshot differs from its Visual_Baseline, THE Engine SHALL record a visual-finding outcome, UNLESS a deterministic rule is violated in the same comparison, in which case THE Engine SHALL record only the failed check.
4. THE Engine SHALL set awaitingReview to true in findings.json when any outcome requires human review.
5. THE Engine SHALL compare screenshots with pixelmatch at threshold 0.1 and SHALL record differs, diffPixels, totalPixels, diffRatio, dimensionsChanged, a 16-character baseline hash and a note for each page and viewport.
6. IF the baseline and current screenshot have different dimensions, THEN THE Engine SHALL record a difference with dimensionsChanged true and SHALL write no diff image.
7. THE Engine SHALL NOT fail a page on a pixel percentage alone.
8. THE Engine SHALL store Template_Text items as separate records linked to the outcome by relatedFindingId, labelled "Template text (not a deterministic fact)", and SHALL NOT change a deterministic outcome's classification.

### Requirement 5: Findings and lifecycle

**User Story:** As a Reviewer, I want to know whether a finding is new, recurring or resolved, so that I can see what changed.

#### Acceptance Criteria

1. THE Engine SHALL identify a Finding by its Finding_Key, the page URL, viewport and rule id.
2. THE Engine SHALL publish one a11y-rule Finding for each distinct page, viewport and axe rule, with the severity equal to the violation's impact, or unrated when the impact is missing or not one of critical, serious, moderate or minor.
3. THE Engine SHALL give a check Finding or a visual Finding the severity unrated.
4. WHEN a Finding is absent from the Lifecycle_History or was resolved, and is present in a Run, THE Engine SHALL give it the lifecycle new, and WHEN it was new, recurring or existing-unresolved and is present, THE Engine SHALL give it recurring.
5. WHEN an unresolved Finding is absent from a Run and its page and viewport were scanned, THE Engine SHALL mark it resolved, and WHEN its page and viewport were not scanned, THE Engine SHALL leave its state unchanged.
6. THE Engine SHALL apply a Run to the Lifecycle_History idempotently, so that applying the same run id twice gives the same history, and SHALL only add runs and Findings, never remove them.
7. THE Engine SHALL write the Lifecycle_History through a temporary file and a rename, so that a failed write leaves the previous file unchanged.
8. IF the Lifecycle_History cannot be restored or read, THEN THE Engine SHALL record the history status unavailable, SHALL leave the stored history untouched, SHALL list no resolved items and SHALL give every Finding the lifecycle not-recorded.
9. THE Engine SHALL record the history status as restored, first-run or unavailable from the status marker the Workflow writes next to the history file, and SHALL accept both the current history format and the older fingerprint-map format.
10. THE Engine SHALL produce the same lifecycle result for the same history and observation, independent of the current time except through the timestamp in the observation.

### Requirement 6: Reviewer decisions

**User Story:** As a Reviewer, I want to ignore, resolve or restore findings with a reason, so that known and accepted issues stop cluttering the counts without being lost.

#### Acceptance Criteria

1. THE Engine SHALL store each Disposition as an entry with a content-derived id, a decision (ignore, resolve or unignore), a scope, a matcher, a reason, a Reviewer_Name, a timestamp, the id it undoes and its source.
2. THE Engine SHALL accept ignore with the scopes element, page-rule or site-rule, resolve with the scope finding, and unignore with the scope undo.
3. IF a reason is empty or longer than 500 characters, or a Reviewer_Name is empty or longer than 80 characters, THEN THE Engine SHALL reject the entry and name the field.
4. THE Engine SHALL merge two Disposition_Logs as a lossless union that is commutative, associative and idempotent.
5. WHEN a Run finishes, THE Engine SHALL freeze the effective Dispositions into dispositions-applied.json with a status of applied or unavailable and a digest of the log, and SHALL read the Disposition_Log only once.
6. WHEN a Run is published, THE Engine SHALL apply only that Run's Applied_Dispositions, never the live log, so that a decision never changes a Run that finished before the decision.
7. THE Engine SHALL match a page-rule ignore on page and rule for any viewport, a site-rule ignore on rule only, and an element ignore only when every affected node matches, and SHALL count affected nodes exactly.
8. THE Engine SHALL keep Active_Findings and Ignored_Findings disjoint, with their union equal to the detected set, and SHALL exclude Ignored_Findings from every active count.
9. WHEN a Finding was resolved by a Disposition and appears again in a later Run, THE Engine SHALL give it the lifecycle regression.
10. WHEN an unignore entry takes effect, THE Engine SHALL restore the affected Findings from the entry's own time onward only.
11. THE Engine SHALL give the same result for the same entries regardless of their order.
12. THE Engine SHALL report for each Run the count of applied decisions and the decisions that are new in that Run, with their effect counts.

### Requirement 7: Evidence, telemetry and audit

**User Story:** As a Reviewer, I want each run to keep its evidence and an append-only record of what happened, so that I can inspect any run later.

#### Acceptance Criteria

1. THE Engine SHALL write each Run into its own Run_Directory with the subfolders screenshots, traces, accessibility, agent-tasks and report, using temporary-file and rename writes for JSON.
2. THE Engine SHALL append each telemetry event to events.jsonl and each audit record to audit.jsonl, and SHALL expose no operation that edits an existing entry.
3. IF code attempts to overwrite an existing log entry, THEN THE Engine SHALL reject the attempt with an integrity error and leave the file content unchanged.
4. THE Engine SHALL give every event the run's correlation id, and SHALL prefix run ids with run_ and finding ids with their kind.
5. THE Engine SHALL redact emails, tokens and sensitive keys, including nested ones, from telemetry records.
6. THE Engine SHALL identify each evidence item by an evidence id and SHALL keep every recorded evidence reference resolvable to an existing file.

### Requirement 8: Step events and replay trace

**User Story:** As a Reviewer, I want each run to record what it did, step by step, so that the replay shows real activity and nothing invented.

#### Acceptance Criteria

1. THE Engine SHALL write replaySchema 1 in the run.started event, and SHALL write one step.completed event for each completed Step with its sequence number, step name, agent, page URL, slug, viewport, start time, end time, duration, result summary and finding rule ids.
2. THE Engine SHALL use only the step names test-plan, load, screenshot, visual-compare, accessibility-scan, compare, notes, triage, history and decisions, and SHALL map them to the stations test-plan-desk, browser-bay, visual-check, accessibility-check, review-desk and records-room.
3. THE Engine SHALL mark the notes and triage Steps as Template_Text steps and SHALL never record an agent role of "ai" in an Enriched_Run.
4. THE Engine SHALL omit the page URL from the history and decisions Steps and SHALL include it in every other Step.
5. IF a Step throws, THEN THE Engine SHALL record its step.completed event with a failed result and no error text, and SHALL then raise the error.
6. THE Engine SHALL record a page.skipped event for each skipped page, and SHALL emit agent.working and agent.completed events for each component so that readers of older runs keep working.

### Requirement 9: Published data build and sanitisation

**User Story:** As a site owner, I want published data to be clean and safe, so that publishing a run never leaks a secret or a local path.

#### Acceptance Criteria

1. WHEN the Engine builds Published_Data, THE Engine SHALL write data/index.json, data/dashboard.json, data/pages/<slug>.json and, for each run, data/runs/<id>/ with summary.json, events.json, findings.json, run-findings.json, visual.json, guidance.json, evidence/*.json and screenshots.
2. THE Sanitizer SHALL remove secrets, tokens and personal data, and SHALL replace absolute, UNC and internal home paths in every string and key with "[path removed]".
3. THE Sanitizer SHALL leave repository-relative paths and URL schemes intact.
4. IF a file cannot be confirmed clean after sanitising and a residual-path rescan, THEN THE Engine SHALL withhold the file, record its name and reason in the run's withheld and omissions lists, and continue publishing the files that are clean.
5. THE Engine SHALL fail the build when index.json or dashboard.json cannot be confirmed clean.
6. THE Engine SHALL derive a run's origin from the origin marker file (exactly "cloud" or "local"), then from the AWG_RUN_ORIGIN value, and SHALL default to local, treating only the exact token cloud as cloud.
7. THE Engine SHALL list runs in index.json newest first, by finish time when known and otherwise by directory modification time.
8. THE Engine SHALL publish for each run its health, page count, failed check count, pending review flag, origin, detail level, trigger, image availability and, when known, its domain.
9. THE Engine SHALL set the index domain from the explicit option, or else from the newest run's domain, and SHALL never use a fixed host.
10. THE Engine SHALL write the Display_Title, resolved from the configuration, into index.json.
11. THE Engine SHALL produce published structures that round-trip through JSON and are deterministic for the same input.

### Requirement 10: Published run detail

**User Story:** As a Reviewer, I want each published run to carry its findings, evidence, visual comparisons and guidance, so that the Dashboard can answer questions without the raw run.

#### Acceptance Criteria

1. THE Engine SHALL write run-findings.json with schemaVersion 2, the run id, finish time, detailLevel, historyStatus, totals, decisions, pages, findings, resolved items, ignored Findings and omissions.
2. THE Engine SHALL make totals.all equal the number of Active_Findings, and SHALL make the sums of the severity counts and of the lifecycle counts each equal totals.all, with resolved and ignored counts reported separately.
3. THE Engine SHALL publish element evidence for an a11y-rule Finding with at most 10 nodes per violation, and SHALL record nodeCount and omittedNodeCount so that omitted equals count minus published.
4. THE Engine SHALL limit published HTML to 500 characters, target to 300, and failure summary to 600, marking truncation, and SHALL sanitise each string before truncating and rescan after.
5. IF an evidence field cannot be confirmed clean, THEN THE Engine SHALL publish it as "[withheld]" and list it in the node's withheld array.
6. THE Engine SHALL publish a baseline image for a page and viewport exactly when the screenshot differs and the baseline file exists and is within the size budget, and SHALL publish a null baseline with a reason otherwise.
7. THE Engine SHALL derive the published difference measure from the diff image and make it equal to the comparer's pixel count.
8. WHEN a visual Finding is suppressed by failing rules on the same page, THE Engine SHALL list the ids of the page's non-visual Findings in suppressedBy.
9. THE Engine SHALL publish guidance for at most 100 Findings per run, each item specific to its Finding, linked to a known finding id and labelled as Template_Text, and SHALL omit generic guidance and confidence values.
10. THE Engine SHALL publish a per-page history file whose entries match each run's Findings for that page.
11. THE Engine SHALL compute the aggregate counts independently of element detail, so that the aggregates do not change when node html, target or node count change.
12. THE Engine SHALL assign each page a group equal to the lowercased first path segment of its URL, or "(home)" when the path is empty, and SHALL make the group name identical in the Engine and in the Dashboard.

### Requirement 11: Size budget and image retention

**User Story:** As a site owner, I want published data to stay within size limits, so that the Pages site and the repository stay small.

#### Acceptance Criteria

1. THE Engine SHALL limit the published size of a run to 64 MiB and of a single image to 8 MiB.
2. WHEN a run exceeds its budget, THE Engine SHALL keep JSON first, then evidence, then diff images, then baseline images, then current images, each ordered by priority, and SHALL drop the rest.
3. THE Engine SHALL record each dropped file with its path, role and reason, one of run-cap, image-cap or image-retention.
4. THE Engine SHALL never drop a run's core JSON files.
5. THE Engine SHALL publish images only for the newest N runs, where N is AWG_IMAGE_RETENTION_RUNS when it is an integer of at least 1 and otherwise 10, and SHALL record image-retention omissions for older runs.
6. THE Engine SHALL set the dropped image paths in visual.json to null.
7. THE Engine SHALL select the same retention set regardless of input order.

### Requirement 12: Local publishing

**User Story:** As a user running Guardian on my computer, I want a finished run to update my local Dashboard without risking the previous copy.

#### Acceptance Criteria

1. WHEN a Run succeeds and AWG_SKIP_LOCAL_PUBLISH is not "1", THE Engine SHALL build the site in a staging folder and swap it into artifacts/published.
2. IF the build fails, THEN THE Engine SHALL leave the existing artifacts/published untouched and return a failed result with a reason.
3. IF the swap fails midway, THEN THE Engine SHALL restore the previous bundle.
4. THE Engine SHALL record a publish.completed or publish.failed event and SHALL NOT fail an otherwise successful Run because publishing failed.
5. THE Engine SHALL copy the static Dashboard files into the staging folder, so that the published folder is self-contained.

### Requirement 13: Admin_Console access and request guard

**User Story:** As a user, I want the console reachable only from my own computer, so that nobody else can change my setup.

#### Acceptance Criteria

1. THE Admin_Console SHALL bind its HTTP server to 127.0.0.1 only, with the port from the option or 7787, and SHALL contain no 0.0.0.0, no "::" host and no listen call without a host.
2. THE Admin_Console SHALL reject with 403 every request whose Host is not 127.0.0.1 or localhost with the console port, and SHALL send no detail.
3. THE Admin_Console SHALL accept a state-changing request only when the Host is loopback with the console port, any Origin is the same loopback origin, any Sec-Fetch-Site is not cross-site or same-site, and the content type is application/json.
4. THE Admin_Console SHALL mark every POST route as state-changing, SHALL apply the guard to every non-GET method on every path, and SHALL record nothing when the guard fails.
5. THE Admin_Console SHALL send no CORS headers.
6. THE Admin_Console SHALL serve only a fixed list of files from admin-ui/ and the read-only local Dashboard folder, SHALL refuse paths that are not plain names, and SHALL never list directories.
7. THE Admin_Console SHALL send Cache-Control no-store, X-Content-Type-Options nosniff and Referrer-Policy no-referrer, and a Content-Security-Policy on HTML that allows only same-origin scripts, styles, images and connections.
8. THE Admin_Console SHALL reject a path that is absolute, contains "..", a drive letter, a backslash or a NUL byte, and SHALL match run ids, slugs and log names against fixed patterns before using them in a path.
9. THE Admin_Console SHALL have no sign-in and SHALL attribute decisions to the typed Reviewer_Name.

### Requirement 14: Admin_Console limits, jobs and display scrubbing

**User Story:** As a user, I want console requests and background jobs to be bounded and safe, so that a bad request cannot hang or damage my machine.

#### Acceptance Criteria

1. THE Admin_Console SHALL give each route a body ceiling in bytes, and SHALL answer 413 without running the handler when a body exceeds it by byte length or a declared content length exceeds it.
2. IF a body within the ceiling is not valid JSON, THEN THE Admin_Console SHALL answer 400 and record nothing.
3. THE Admin_Console SHALL run at most one background job at a time, of the kinds discovery, spec-drafts and visual-capture, each from a fixed script path, with an argument array, no shell and a per-kind timeout (12, 10 and 15 minutes).
4. THE Admin_Console SHALL start a job with an environment of an allow-list of base variables plus validated variables whose names start with AWG_.
5. THE Admin_Console SHALL keep job output as a bounded ring of at most 200 lines and 64 KiB.
6. THE Admin_Console SHALL scrub text it shows from outside the console, removing tokens, Bearer headers, credential URLs, absolute paths, the project root and home folder and control characters other than newline and tab, capping lines at 2000 characters and leaving 40-character commit hashes intact.
7. THE Admin_Console SHALL make scrubbing idempotent and total for any string.
8. THE Admin_Console SHALL answer 410 for POST /api/run, start nothing, and say that a run on GitHub starts when the user publishes.

### Requirement 15: Admin_Console setup

**User Story:** As a new user, I want to choose my site, approve URLs and capture baselines in the console, so that I can start monitoring without editing files by hand.

#### Acceptance Criteria

1. THE Admin_Console SHALL show the monitored domain, the Display_Title, the approved URL count against the limit, the unpublished change count, the last publish result, the running job and the live Pages address derived from the origin remote.
2. WHEN a user starts a new-domain draft, THE Admin_Console SHALL validate the host syntax only (https, no path, query or fragment, not a reserved local suffix), keep the draft apart from the project, and leave the project configuration and baselines byte-identical until the user confirms.
3. WHEN a user cancels a draft, THE Admin_Console SHALL remove the draft and its staging folder.
4. THE Admin_Console SHALL stage URL additions, removals and edits, keep the list within the lesser of the seed `maxUrls` and `limits.pages`, and write config/page-seed.json only when the user chooses Update project.
5. THE Admin_Console SHALL list discovery candidates from a job that runs one request at a time with the configured spacing, and SHALL approve only the candidates the user ticks.
6. IF the browser is not installed, THEN THE Admin_Console SHALL tell the user to run `npx playwright install chromium`.
7. THE Admin_Console SHALL write spec drafts and capture visual proposals through jobs, show proposals with images, and approve a Baseline or Visual_Baseline only for a typed Reviewer_Name through the Approval_Gate.
8. THE Admin_Console SHALL show per page whether the spec, the desktop screenshot and the mobile screenshot are approved, and SHALL call a page Ready only when all three are.
9. WHEN a user adopts a cloud run's screenshots, THE Admin_Console SHALL approve them as Visual_Baselines through the Approval_Gate.
10. THE Admin_Console SHALL record each setup action in the setup activity log, which it shows newest first with paging.

### Requirement 16: Admin_Console decisions, runs and sync

**User Story:** As a Reviewer, I want to review findings, pull cloud runs and sync my decisions, so that decisions made on my computer reach the next cloud run.

#### Acceptance Criteria

1. THE Admin_Console SHALL list findings of a pulled run and let the user record ignore, resolve and unignore Dispositions with a reason and a Reviewer_Name, validated as in Requirement 6.
2. THE Admin_Console SHALL list runs newest first using the same run facts and order as the published index.
3. THE Admin_Console SHALL serve a run's log files through a fixed name pattern and only for run ids that match the id pattern.
4. WHEN a user pulls runs from GitHub, THE Admin_Console SHALL fetch the Runs_Data_Branch with a plain fetch, copy in only run ids that are absent locally, write an origin marker "cloud" into each, and leave existing local runs untouched.
5. IF the fetch or a copy fails, THEN THE Admin_Console SHALL leave the local store unchanged and report a reason.
6. WHEN a user syncs decisions, THE Admin_Console SHALL fetch the Runs_Data_Branch, union the remote and local Disposition_Logs, build one additive commit on the fetched tip with git plumbing and a temporary index, and push it without force.
7. IF a push is rejected as non-fast-forward, THEN THE Admin_Console SHALL fetch again, union again and retry, at most 3 attempts.
8. IF a sync fails, THEN THE Admin_Console SHALL keep the local log, report "Not yet synced" with a scrubbed reason, and leave the user's branch, index and working tree untouched.
9. THE Admin_Console SHALL show decision effects only for runs that finish after the decision.

### Requirement 17: Admin_Console publish and schedule

**User Story:** As a user, I want to publish my configuration to GitHub and set the schedule from the console, so that I never run git commands by hand.

#### Acceptance Criteria

1. THE Admin_Console SHALL publish only paths from config/app.config.json, config/page-seed.json, config/domains/, baselines/, baselines-visual/ and the workflow file, and SHALL never publish anything under artifacts/.
2. THE Admin_Console SHALL list the delta against the last known origin/main and SHALL disable publishing and create no commit when the delta is empty.
3. WHEN a user publishes, THE Admin_Console SHALL require a Reviewer_Name and a confirmation, add acknowledgements when files will be deleted or a large amount of image data is added, and block any single file over 50 MB.
4. THE Admin_Console SHALL make one commit on top of origin/main that contains exactly the delta and push it without force, rebase or branch switch, using the user's own git credentials and storing no token.
5. IF a publish fails, THEN THE Admin_Console SHALL show the reason and the raw scrubbed git output, and SHALL change nothing locally.
6. THE Admin_Console SHALL read and edit the schedule only as the single cron line of the workflow file, in UTC.
7. THE Admin_Console SHALL accept a schedule of five fields with the grammar of lists, ranges and steps, with month and weekday names, and SHALL reject any schedule with a gap under 5 minutes, macros, Sunday as 7, the characters ?, L, W and #, a wrong field count, or empty fields.
8. WHEN a schedule is saved, THE Admin_Console SHALL change the working tree only, log a schedule-changed entry, and make clear that the change reaches GitHub after a publish.
9. THE Admin_Console SHALL show a warning for a schedule at minute 0.

### Requirement 18: Dashboard data access and navigation

**User Story:** As a reader, I want the Dashboard to load fast, link deeply and fail clearly, so that I can share exact views.

#### Acceptance Criteria

1. THE Dashboard SHALL read only published JSON through relative same-origin URLs under ./data/, SHALL load only index.json and dashboard.json at start, and SHALL load a run, evidence or page file when a view needs it.
2. THE Dashboard SHALL reject a data path that is empty, contains a backslash, or has an empty, "." or ".." segment, and SHALL encode each segment.
3. THE Dashboard SHALL use hash routes #/, #/run/<runId>, #/findings, #/page/<slug>, #/finding/<runId>/<findingId> and #/visual/<runId>/<slug>/<viewport>, with the query parameters run, q, sev, state, has, sort, dir, group, rule, page and scope in a fixed order.
4. THE Dashboard SHALL give parseRoute(formatRoute(r)) the value normalizeRoute(r) for any route, and SHALL give a parsed canonical hash back unchanged when formatted.
5. THE Dashboard SHALL fall back to the overview for a route that lacks a required segment, ignore unknown parameters, keep the first of a repeated parameter, and default scope to active without writing it.
6. WHEN a file fails to load, THE Dashboard SHALL show the file name, the HTTP status and a Retry control, and SHALL announce the error in an alert region.
7. WHEN the view changes, THE Dashboard SHALL move focus to the view's heading, set the document title and announce the view in a polite status region.
8. THE Dashboard SHALL restore scroll position and focus when the user goes back.
9. THE Dashboard SHALL show the Display_Title from index.json in the tab and the header, and "Web Guardian" when it is absent.
10. THE Dashboard SHALL label a run from a different domain than its neighbour and SHALL NOT filter or rewrite runs.

### Requirement 19: Dashboard overview and run views

**User Story:** As a reader, I want a clear summary of site health and each run, so that I can tell at a glance what needs attention.

#### Acceptance Criteria

1. THE Dashboard SHALL show a run selector, KPI cards, a run health trend chart, a severity chart, a lifecycle chart and a page explorer for the selected run, with the latest run taken from dashboard.json without another request.
2. THE Dashboard SHALL give every view of a run's counts the same value: the KPI card, the chart segment, the data table, the number of Findings the filters return and the run list.
3. THE Dashboard SHALL show severity with a text label and a distinct symbol, never by colour alone, and SHALL show unrated as "Not rated".
4. THE Dashboard SHALL show Findings with lifecycle not-recorded in a "State not recorded" group and never as new.
5. THE Dashboard SHALL show a run table with an Ignored count per run, and "Not applicable" for a run that has no such field.
6. THE Dashboard SHALL list resolved items for a run separately from Active_Findings.
7. THE Dashboard SHALL give a chart a data table with the same numbers.
8. WHEN a run has no published run data, THE Dashboard SHALL say so and SHALL NOT show invented figures.
9. THE Dashboard SHALL link each run to the same run in the Virtual_Office with a relative deep link.

### Requirement 20: Dashboard pages, findings, evidence and visual comparison

**User Story:** As a reader, I want to search pages and findings and see the evidence behind each one, so that I can decide what to fix.

#### Acceptance Criteria

1. THE Dashboard SHALL group pages by the lowercased first path segment and let the user search, filter by severity, state and presence of findings, sort by URL, finding count or highest severity in either direction, and expand groups.
2. THE Dashboard SHALL make search and filters only narrow the result: a filtered result is a subset of the unfiltered result and its count equals the rows shown.
3. THE Dashboard SHALL give each page row its highest severity as the most severe present, sort stably, and keep filtering and sorting of 500 pages under 200 ms.
4. THE Dashboard SHALL show a Finding detail with the rule, severity, lifecycle, plain-English summary, evidence nodes, guidance and a link to the producing step in the Virtual_Office when one is recorded.
5. THE Dashboard SHALL generate plain-English summaries from a rule catalogue and the published facts, containing what the rule checks, who it affects and the scope statement, with no placeholder text.
6. THE Dashboard SHALL show guidance only when it is linked to a known finding id, is not generic, and is labelled as Template_Text.
7. THE Dashboard SHALL show a visual comparison with the baseline, current and diff images, a lightbox and captions that carry the URL, viewport, role, and run id and date or "Run not recorded".
8. IF an image was dropped by the size budget or the retention window, THEN THE Dashboard SHALL say why and SHALL NOT show a broken image.
9. THE Dashboard SHALL show Ignored_Findings only when the scope parameter is ignored, with the decision that ignored them.

### Requirement 21: Dashboard and Virtual_Office page safety and accessibility

**User Story:** As a reader using assistive technology, I want both sites to be safe and operable, so that I can use them with a keyboard and a screen reader.

#### Acceptance Criteria

1. THE Dashboard and THE Virtual_Office SHALL put published and user-visible strings into the page with textContent or createElement, never with markup strings, and SHALL contain no innerHTML, eval or dynamic Function construction in their own code.
2. THE Dashboard and THE Virtual_Office SHALL make no request to an absolute URL, to a loopback address or to a third-party host, SHALL open no EventSource, and SHALL serve every library from the repository.
3. THE Dashboard and THE Virtual_Office SHALL contain no form that posts data.
4. THE Dashboard and THE Virtual_Office SHALL contain only ASCII characters in their own files.
5. THE Dashboard and THE Admin_Console SHALL meet WCAG 2.2 AA text contrast for their colour tokens.
6. THE Dashboard and THE Virtual_Office SHALL be operable by keyboard with visible focus.
7. THE Virtual_Office SHALL read the reduced-motion preference when it is set and when it changes, and SHALL apply it to the Diorama.

### Requirement 22: Virtual_Office replay timeline

**User Story:** As a Reviewer, I want to replay what a run actually did, so that I can see which step found which finding.

#### Acceptance Criteria

1. THE Virtual_Office SHALL build the Replay_Timeline from the run's events.json with a pure function that never throws, never reads the clock and never uses randomness.
2. THE Virtual_Office SHALL treat the run as enriched when run.started carries a replay schema of 1 or lower and at least one step.completed event is present, and SHALL treat it as coarse otherwise.
3. WHEN the replay schema is above 1, THE Virtual_Office SHALL show a coarse replay and state that the schema is not supported.
4. THE Virtual_Office SHALL place each event at its time relative to run.started, order entries by start time then source order, and skip with a recorded note any event that is malformed, duplicated, unknown or missing its time.
5. THE Virtual_Office SHALL show a figure for a component only when the timeline has an entry for it up to the current time, and SHALL show a station screen from the latest reached entry only.
6. THE Virtual_Office SHALL infer nothing: a value the run did not record SHALL be shown as "not recorded".
7. IF events.json is missing, empty, not a list or lacks run.started, THEN THE Virtual_Office SHALL show an empty replay with the reason and keep every other view working.
8. WHEN a run has a replay truncation record, THE Virtual_Office SHALL tell the user which event kinds were dropped and how many.
9. THE Virtual_Office SHALL map each finding rule to its producing step by the Finding_Key, and SHALL show no producing step when none matches.

### Requirement 23: Virtual_Office playback, views and deep links

**User Story:** As a Reviewer, I want to play, scrub and link to a moment in a run, so that I can show a colleague exactly what I saw.

#### Acceptance Criteria

1. THE Virtual_Office SHALL offer play, pause, previous and next step, a seek bar, a speed of 1, 2, 5 or 10, a page jump list, a read-steps-aloud option that is off by default and a Reset view control.
2. THE Virtual_Office SHALL limit one frame to 100 ms of real time, pause when the tab is hidden, and stop at the end of the run.
3. THE Virtual_Office SHALL disable the page jump for a coarse timeline and say that pages were not recorded.
4. THE Virtual_Office SHALL use the hash route #/run/<runId>?t=<ms>&station=<id>, load the newest run for #/, clamp t to the run duration, ignore an unknown station, and keep the address in step with the run, position and selection.
5. WHEN the run in the address does not exist, THE Virtual_Office SHALL say so and keep the run picker usable.
6. THE Virtual_Office SHALL show a Transcript, a Telemetry panel, a Swimlane view and an Inspector that present the same facts as text, and a run picker and a station list.
7. THE Virtual_Office SHALL show evidence thumbnails from the published screenshots and SHALL say when images were pruned.
8. THE Virtual_Office SHALL announce steps through a polite live region at most once per 1.5 seconds and only while read-aloud is on.
9. WHEN a keyboard shortcut applies, THE Virtual_Office SHALL apply it only while focus is inside the Diorama, SHALL map no shortcut to Tab, and SHALL ignore any combination with Ctrl, Alt or Meta.
10. THE Virtual_Office SHALL show a run page's title from index.json and "Web Guardian" when absent.

### Requirement 24: Virtual_Office Diorama and fallback

**User Story:** As a Reviewer, I want a 3D view that never blocks the rest of the page, so that the replay works on any browser.

#### Acceptance Criteria

1. THE Virtual_Office SHALL draw the Diorama with the vendored three.js module and OrbitControls from procedural geometry, load it lazily and import no other library.
2. THE Virtual_Office SHALL place the six stations in process order, show component figures labelled with component names and "automated template step" for Template_Text steps, and focus a station when the user selects it.
3. IF WebGL is missing, the renderer throws, the dynamic import fails or the context is lost without recovery, THEN THE Virtual_Office SHALL replace the Diorama with a status message and keep every other view working.
4. WHEN the Diorama is unavailable, THE Virtual_Office SHALL disable Reset view with an explanation and hide the Diorama-only help.
5. IF one view throws, THEN THE Virtual_Office SHALL replace only that view with an error message, announce it, and continue with the other views.
6. THE Virtual_Office SHALL keep the built office folder within 1,572,864 bytes in total.

### Requirement 25: Virtual_Office honesty and telemetry reconciliation

**User Story:** As a Reviewer, I want the office to tell the truth about automation and totals, so that I can trust it.

#### Acceptance Criteria

1. THE Virtual_Office SHALL state that Guardian uses zero AI tokens and that template steps use fixed text, and SHALL keep those statements in one file.
2. THE Virtual_Office SHALL use the words AI, model, LLM and autonomous only in negated statements in that file, and nowhere in labels, tooltips or descriptions.
3. THE Virtual_Office SHALL derive every Telemetry panel value from the timeline and the run's findings, show "not recorded" for a missing value, and show only run duration and station durations for a coarse timeline.
4. WHEN the event-derived finding total equals totals.detected, THE Virtual_Office SHALL say how many findings were ignored by reviewer decisions and are not counted on the Dashboard.
5. WHEN the event-derived total differs from totals.detected, THE Virtual_Office SHALL classify each recorded key as active, ignored or absent, state the difference, and state a reason only when a published field proves it (detail level, omissions), and SHALL otherwise say the reason could not be determined.
6. THE Virtual_Office SHALL keep the Station mapping and step names equal to those in the Engine.

### Requirement 26: Workflow triggers and jobs

**User Story:** As a site owner, I want a scheduled, reproducible cloud run that publishes my site, so that monitoring needs no server of mine.

#### Acceptance Criteria

1. THE Workflow SHALL run on a daily schedule with one cron line, on manual dispatch, on pull requests, and on pushes to main that change config/**, baselines/**, baselines-visual/** or the workflow file.
2. THE Workflow SHALL never be started by a push to the Runs_Data_Branch.
3. THE Workflow SHALL run at most one non-pull-request run at a time and SHALL NOT cancel one that is in progress, with a separate concurrency group for each pull request ref.
4. THE Workflow SHALL run, in the run job: checkout, setup Node from .nvmrc, `npm ci`, Playwright Chromium install, build, restore of the accessibility history and dispositions, `node scripts/run-guardian.mjs`, restore of earlier runs, the published data build, the Dashboard copy, the Dashboard Self_Scan, the Office copy, the Size_Gate, the build stamp, the Office Self_Scan and the uploads.
5. THE Workflow SHALL deploy the Pages artifact in a publish job after the run job.
6. THE Workflow SHALL set AWG_RUN_ORIGIN to cloud, AWG_SKIP_LOCAL_PUBLISH to 1, and the run trigger, GitHub run id, commit and event name from GitHub-controlled values only.
7. THE Workflow SHALL treat both Self_Scans as non-blocking and the Size_Gate as blocking, and SHALL require instance data in these steps by setting GUARDIAN_REQUIRE_INSTANCE_DATA to 1.
8. THE Workflow SHALL run a platform verification job on Linux and macOS for pull requests from the same repository and for manual runs, which builds and runs the full test suite without installing browsers.
9. THE Workflow SHALL set job timeouts of 30 minutes for the run job, 10 for publish, 15 for commit-runs-data and 20 for platform verification.
10. THE Workflow SHALL append a ?v=<short commit> stamp to the entry script and stylesheet URLs of the Dashboard and Virtual_Office pages, and SHALL leave the site unchanged when the value is not a hexadecimal commit.

### Requirement 27: Run history and the Runs_Data_Branch

**User Story:** As a site owner, I want run history to accumulate across cloud runs, so that trends and lifecycle work.

#### Acceptance Criteria

1. WHEN the run job starts, THE Workflow SHALL restore artifacts/a11y-history.json and artifacts/dispositions.json from the Runs_Data_Branch when present, and SHALL write a status marker of restored, first-run or unavailable next to each.
2. IF the restored dispositions file is not valid with schemaVersion 1, THEN THE Workflow SHALL remove it from the workspace only and mark it unavailable.
3. WHEN the run ends, THE Workflow SHALL copy earlier runs from the Runs_Data_Branch into artifacts/runs without overwriting the run just produced, before it builds the published data.
4. THE Workflow SHALL commit the raw Run_Directories and the merged accessibility history to the Runs_Data_Branch in a separate job, creating the branch as an orphan when it does not exist.
5. THE Workflow SHALL stage only path-scoped Run_Directories and the history file, SHALL NOT stage the Disposition_Log or a status marker, and SHALL commit nothing when nothing is new.
6. IF a push is rejected, THEN THE Workflow SHALL fetch, merge the remote tip and push again, at most 3 attempts, with no force push and no history rewrite.
7. THE Workflow SHALL never commit raw run artifacts to main.

### Requirement 28: Workflow hardening

**User Story:** As a security reviewer, I want the workflow to follow least privilege and supply-chain practice, so that it is safe to run.

#### Acceptance Criteria

1. THE Workflow SHALL declare the default token permission contents: read, and SHALL grant write scopes only per job: pages and id-token write in publish, and contents write in commit-runs-data.
2. THE Workflow SHALL pin every third-party action to a 40-character commit hash with a version comment.
3. THE Workflow SHALL skip every job in a GitHub fork, and SHALL run the platform verification job for a pull request only when the head repository is the same repository.
4. THE Workflow SHALL NOT use pull_request_target and SHALL NOT interpolate event input into a run: shell step; such values reach shells only through env.
5. THE Workflow SHALL use no repository or organisation secrets and rely on the automatic GITHUB_TOKEN only.

### Requirement 29: Configuration and Display_Title

**User Story:** As a product team member, I want all site-specific values in configuration, so that I can point Guardian at my own site.

#### Acceptance Criteria

1. THE Engine SHALL read the app configuration from config/app.config.json, the page seed from the path in seedFilePath, and per-domain settings from config/domains/<slug>.json, with committed *.example.json templates and `npm run init-config` copying each template without overwriting an existing file.
2. IF a required setting is missing or has the wrong type, THEN THE Engine SHALL fail with a message that names the setting, the file and the example file to compare with.
3. THE Engine SHALL require approvedDomain, baseUrl, seedFilePath, the limits (pages, crawlDepth, concurrency, requestSpacingMs, retries, navTimeoutMs, runTimeoutMs), retention (maxRuns, maxAgeDays) and the desktop and mobile viewport sizes in the app configuration.
4. THE Engine SHALL require domain, baseUrl, approvedSchemes (non-empty), maxDiscoveryCount, largeScopeThreshold, requestSpacingMs and scopeFile in each domain configuration, and maxUrls and a non-empty approvedUrls in the page seed.
5. THE Engine SHALL reject a negative or non-numeric limit and a `maxApprovedPages` above 500.
6. THE Engine SHALL resolve the Display_Title as the trimmed value of displayTitle, or "Web Guardian" when it is unset, empty or only spaces, and SHALL reject a title longer than 80 characters after trimming or one that is not a string.
7. THE Guardian SHALL show the resolved Display_Title in the Dashboard, Virtual_Office and Admin_Console without any code change.
8. WHERE instance data is absent, THE verification and self-scan scripts SHALL report "skipped: no instance data" and exit 0, and WHERE GUARDIAN_REQUIRE_INSTANCE_DATA is set to a truthy value, THE scripts SHALL fail instead of skipping.

### Requirement 30: Security and privacy of data

**User Story:** As a security reviewer, I want to know what Guardian stores and sends, so that I can approve it.

#### Acceptance Criteria

1. THE Guardian SHALL call no AI or language-model service and send no data to external telemetry services, and SHALL contact only the monitored site and the user's own Git remote.
2. THE Guardian SHALL NOT store or read a GitHub token; git operations from the Admin_Console SHALL use the user's own git credentials.
3. THE Guardian SHALL NOT capture authenticated areas of a site.
4. THE Engine SHALL remove local file paths, home folders and secret-shaped values from published data, including older manifests that hold absolute paths.
5. THE Admin_Console SHALL run child processes with an argument array and no shell, using process.execPath for Node, and SHALL scrub paths and secrets from any git output it shows.
6. THE Admin_Console SHALL treat symbolic links as refused for run logs and the local Dashboard.
7. THE Guardian SHALL record in the Disposition_Log and in the commit message of a publish the typed Reviewer_Name, and the documentation SHALL state that published data is public when the repository or its Pages site is public.
8. THE security documentation SHALL state the trust model, the data Guardian stores, the permissions it needs, how to report a vulnerability, the known advisories and what Guardian cannot guarantee.

### Requirement 31: Supply chain, scans and documentation

**User Story:** As a maintainer, I want automated checks that keep the repository clean, so that quality does not depend on memory.

#### Acceptance Criteria

1. THE Guardian SHALL pin every dependency to an exact version and commit the lock file.
2. THE Guardian SHALL vendor the browser libraries it uses (Chart.js, three.js, OrbitControls) in the repository, record in docs/VENDORED.md each library's name, version, licence and SHA-256 hash, and verify them with `node scripts/dev/hash-vendored.mjs --check`.
3. THE `npm run scan:secrets` command SHALL scan tracked files for secret-shaped strings, accept exceptions only from an allow file where each has a reason, and fail on a stale exception.
4. THE `npm run scan:history` command SHALL scan tracked files, other than vendored, instance and lock files, for requirement numbers, phase, task and stage narration, history words, design narration and non-ASCII characters, with a documented allowlist, and SHALL allow requirement numbers and Validates lines only in the product spec files.
5. THE `npm run check:links` command SHALL check that relative links, anchors, npm script names and repository paths in the documentation exist.
6. THE test fixtures for the Sanitizer SHALL build secret-shaped values at run time and SHALL NOT commit them.
7. THE repository SHALL contain a README, a setup guide, a security document, a contributing guide, a vendored-library record and a licence placeholder.
8. THE setup guide SHALL state the costs and limits of an instance, including Actions minutes, Pages size and Runs_Data_Branch growth, and how to prune the branch with a normal commit.

### Requirement 32: Cross-platform operation

**User Story:** As a product team member, I want Guardian to run on my operating system, so that I can use it on Windows, macOS or Linux.

#### Acceptance Criteria

1. THE Guardian SHALL run on the Supported_Platforms using only commands defined in package.json scripts, including at least `console`, `guardian`, `build`, `test` and `verify`.
2. THE scripts SHALL use Node and node:path, start Node child processes with process.execPath, and contain no drive letters, portable install paths or shell-specific syntax.
3. THE Guardian SHALL declare the supported Node version in .nvmrc and in package.json engines.
4. WHEN a user runs `npm run console`, THE Admin_Console SHALL start on any Supported_Platform.
5. THE `guardian` script SHALL build dist/ with the local TypeScript when dist/ is missing and SHALL stop with the build's exit code when the build fails.
6. THE Workflow SHALL verify the build and the full test suite on Linux and macOS.

### Requirement 33: Run data layout

**User Story:** As a developer, I want a documented layout for raw and published data, so that tools can read it.

#### Acceptance Criteria

1. THE Engine SHALL store raw run data under artifacts/runs/<run-id>/ with events.jsonl, audit.jsonl, results.json, findings.json, test-manifest.json, lifecycle.json, a11y-history-summary.json, dispositions-applied.json, run-source.json, origin, trigger, screenshots/, accessibility/, traces/, agent-tasks/ and report/.
2. THE Engine SHALL keep artifacts/a11y-history.json, artifacts/dispositions.json and artifacts/audit.jsonl at the artifacts level, and SHALL write the local site to artifacts/published.
3. THE Engine SHALL publish only the allowed files of a run: findings.json, results.json, test-manifest.json, a11y-history-summary.json, events.json (parsed from events.jsonl), the files of Requirement 10 and budgeted screenshots.
4. THE Engine SHALL name screenshots <slug>.<viewport>.png and diff images <slug>.<viewport>.diff.png, with viewport desktop or mobile.
5. THE Engine SHALL keep the Disposition_Log and the Lifecycle_History on the Runs_Data_Branch at artifacts/dispositions.json and artifacts/a11y-history.json.
6. THE Engine SHALL add fields to published data without renaming persisted fields, including aiItems, so that older runs stay readable.

### Requirement 34: Legacy_Runs

**User Story:** As a reader, I want runs recorded in older data shapes to stay readable and honest, so that history is not lost and nothing is invented.

#### Acceptance Criteria

1. THE Engine SHALL give a run the detailLevel "legacy" when none of its accessibility files can be read, and "rule" otherwise.
2. WHEN a run has detailLevel "legacy", THE Engine SHALL publish each failed check as a Finding with the rule id legacy-outcome, the severity not-recorded, the lifecycle not-recorded and the original detail text unchanged, and SHALL publish no visual Finding.
3. THE Dashboard SHALL normalise run data that lacks a schema version, rule-level fields or lifecycle, without throwing, and SHALL give each Finding the severity not-recorded and the lifecycle not-recorded, keeping the original detail text unchanged and never reading a severity out of that text.
4. THE Dashboard SHALL show "Severity not recorded for this run" for a legacy Finding, a failed-check heading without a rule name, and the figures that the run does not have as "Not recorded".
5. WHEN dashboard.json lacks runs and latest, THE Dashboard SHALL build the overview from runHealthTrend, findingsByPage and findingsBySeverity, and SHALL hide the pages-scanned card for that summary.
6. WHEN a run has no domain, THE Dashboard SHALL leave it unlabelled and SHALL NOT break the trend, and SHALL compare each run with the previous run whose domain is known.
7. WHEN a run has no Step events, THE Virtual_Office SHALL show a coarse timeline built only from agent.working and agent.completed events of the known components, with each bar labelled "step, page and viewport not recorded", and SHALL list what is not recorded.
8. THE Virtual_Office SHALL ignore setup placeholder agents (Discovery crawler, Inventory_Agent and Specification_Agent) in a coarse timeline and skip unknown agents with a note.
9. WHEN a run has detailLevel "legacy", THE Virtual_Office SHALL give the reason in the totals reconciliation that findings were not recorded per rule.
10. THE Dashboard and THE Virtual_Office SHALL keep every published run readable, including each Legacy_Run.
11. WHEN the Lifecycle_History is in the older fingerprint-map format, THE Engine SHALL convert it to the current format keyed by page, viewport and rule, and SHALL keep recorded human dispositions.

### Requirement 35: Verification and self-scans

**User Story:** As a maintainer, I want one set of checks that proves the system is intact, so that I can change code with confidence.

#### Acceptance Criteria

1. THE repository SHALL provide `npm run build`, `npm run typecheck` and `npm test`, with the full test suite made of unit tests, property-based tests and instance tests, and the instance tests needing instance data.
2. THE `npm run verify` command SHALL check the last two runs for layout, screenshots, findings shape, separation of deterministic outcomes from template items, awaiting-review flags and an audit log that rejects edits, and SHALL check that the sanitizer removes secrets and paths, that the console binds to loopback only, that every character in the office is backed by an event with an agent name, that step events are well formed, that the static sites make no network calls, that every scanned page is in the approved scope, that the workflow is hardened, that dependencies are pinned and that cloud sync is additive.
3. THE `scripts/scan-dashboard.mjs` and `scripts/scan-office.mjs` commands SHALL run an axe scan of a built site, write the result and a summary, and report a skip when the site has no published data.
4. THE `scripts/check-site-sizes.mjs` command SHALL fail when the office folder is over 1,572,864 bytes in total or a published events.json is over 262,144 bytes, and SHALL name the largest file or the offending path.
5. THE Guardian SHALL treat an automated scan as evidence and not as a claim of conformance, and SHALL say so wherever it reports one.
