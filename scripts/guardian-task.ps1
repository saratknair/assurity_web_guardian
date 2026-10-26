# Guardian Scheduled Task management (Windows Task Scheduler). Local only.
# Usage: powershell -ExecutionPolicy Bypass -File scripts\guardian-task.ps1 <install|status|run|disable|enable|remove> [HH:mm]
#
# The canonical schedule lives in config/schedule.json ({ enabled, intervalHours, dailyAt }).
# To keep the PS1 and the JSON from drifting, when no [HH:mm] arg is passed the install
# action reads dailyAt from schedule.json. An explicit [HH:mm] arg (e.g. when the Admin GUI
# re-registers after a schedule edit) overrides it.
param([Parameter(Mandatory=$true)][string]$Action, [string]$Time)

$TaskName = "AssurityWebGuardianDaily"
$Node = "C:\Users\nairs\nodejs\node-v22.11.0-win-x64\node.exe"
$Project = "C:\Users\nairs\assurity-web-guardian"
$Script = "$Project\scripts\run-scheduled.mjs"
$ScheduleJson = "$Project\config\schedule.json"

# Resolve the schedule time: explicit arg wins; otherwise read schedule.json; else default.
if ([string]::IsNullOrWhiteSpace($Time)) {
  if (Test-Path $ScheduleJson) {
    try {
      $cfg = Get-Content $ScheduleJson -Raw | ConvertFrom-Json
      if ($cfg.dailyAt) { $Time = $cfg.dailyAt }
    } catch { }
  }
  if ([string]::IsNullOrWhiteSpace($Time)) { $Time = "09:00" }
}

switch ($Action) {
  "install" {
    # Uses the computer's local timezone. One run per day at $Time. No overlap (guarded by lockfile).
    $action = New-ScheduledTaskAction -Execute $Node -Argument "`"$Script`"" -WorkingDirectory $Project
    $trigger = New-ScheduledTaskTrigger -Daily -At $Time
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description "Assurity Web Guardian daily local run" -Force
    Write-Output "Installed $TaskName daily at $Time (local time)."
  }
  "status"  { Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo }
  "run"     { Start-ScheduledTask -TaskName $TaskName; Write-Output "Triggered $TaskName." }
  "disable" { Disable-ScheduledTask -TaskName $TaskName; Write-Output "Disabled $TaskName." }
  "enable"  { Enable-ScheduledTask -TaskName $TaskName; Write-Output "Enabled $TaskName." }
  "remove"  { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false; Write-Output "Removed $TaskName." }
  default   { Write-Output "Unknown action. Use install|status|run|disable|enable|remove." }
}
