[CmdletBinding()]
param([switch]$StartNow)
$ErrorActionPreference = 'Stop'
$taskName = 'Agent HUD Quota Reader'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
if ($identity -match '(^|\\)SYSTEM$') { throw 'Run as the Windows user who owns the Codex login and DPAPI credential.' }
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) { throw 'The reader task already exists; no task was changed.' }
$null = Get-Command node.exe -ErrorAction Stop
$launcher = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'Start-ServerReader.ps1'))
if (!(Test-Path -LiteralPath $launcher -PathType Leaf)) { throw 'Reader launcher not found.' }
$arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $launcher + '"'
$action = New-ScheduledTaskAction -Execute (Join-Path $PSHOME 'powershell.exe') -Argument $arguments
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $taskName -Action $action -Principal $principal -Trigger $trigger -Settings $settings -Description 'Read Codex quota and official DeepSeek API balance on loopback only; current Windows user credentials.' | Out-Null
if ($StartNow) { Start-ScheduledTask -TaskName $taskName }
Write-Host "Installed $taskName for $identity. Starts at this user's logon; remote-desktop disconnection does not log the user off."
Write-Host 'No Windows password was collected. Do not change the task account to SYSTEM.'
