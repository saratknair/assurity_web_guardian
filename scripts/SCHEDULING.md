# Scheduled Daily Guardian Run (Windows Task Scheduler)

The Guardian can run once per day automatically, using your computer's local
timezone. Scheduled runs use the EXACT SAME pipeline as a manual run (same
approved pages, safety controls, baselines, telemetry, evidence, reporting,
and human-review gates). A scheduled run NEVER bypasses human approval, and two
runs can never overlap (a lockfile prevents it; an overlap is recorded as a
skipped-run event).

## Prerequisites
- Node is at: C:\Users\nairs\nodejs\node-v22.11.0-win-x64\node.exe
- Project is at: C:\Users\nairs\assurity-web-guardian

## Commands (run in PowerShell from the project folder)

Install (default 09:00 local time; pass HH:mm to change):
  powershell -ExecutionPolicy Bypass -File scripts\guardian-task.ps1 install 09:00

Check status:
  powershell -ExecutionPolicy Bypass -File scripts\guardian-task.ps1 status

Run it now (manual trigger of the scheduled task):
  powershell -ExecutionPolicy Bypass -File scripts\guardian-task.ps1 run

Disable (keep the task, stop it running):
  powershell -ExecutionPolicy Bypass -File scripts\guardian-task.ps1 disable

Re-enable:
  powershell -ExecutionPolicy Bypass -File scripts\guardian-task.ps1 enable

Remove the task entirely:
  powershell -ExecutionPolicy Bypass -File scripts\guardian-task.ps1 remove

## Notes
- If Windows reports you need administrator rights to register the task, re-run
  the "install" command from an elevated PowerShell (Run as administrator).
- The daily summary is written to artifacts\daily-summary.json after each run.
- No email or external messaging is used. Everything stays local.
- Overlap: if a run is already active, the next run is skipped and recorded in
  artifacts\skipped-runs.jsonl; the active run is preserved.
