[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]*$')][string]$SshAlias,
    [Parameter(Mandatory=$true)][string]$PanelPath
)
$ErrorActionPreference = 'Stop'
$tunnelTask = 'Agent HUD Quota Tunnel'
$panelTask = 'Agent HUD Quota Panel'
foreach ($taskName in @($tunnelTask, $panelTask)) {
    if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) { throw 'An Agent HUD local startup task already exists; no tasks were changed.' }
}
$tunnelScript = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'Start-LocalTunnel.ps1'))
$panelExecutable = [IO.Path]::GetFullPath($PanelPath)
if (!(Test-Path -LiteralPath $panelExecutable -PathType Leaf) -or [IO.Path]::GetExtension($panelExecutable) -ne '.exe') { throw 'Provide the installed or portable panel executable.' }
if (!(Test-Path -LiteralPath $tunnelScript -PathType Leaf)) { throw 'Tunnel launcher not found.' }
$null = Get-Command ssh.exe -ErrorAction Stop
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$tunnelArgs = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $tunnelScript + '" -SshAlias ' + $SshAlias
$tunnelAction = New-ScheduledTaskAction -Execute (Join-Path $PSHOME 'powershell.exe') -Argument $tunnelArgs
$panelAction = New-ScheduledTaskAction -Execute $panelExecutable -WorkingDirectory ([IO.Path]::GetDirectoryName($panelExecutable))
Register-ScheduledTask -TaskName $tunnelTask -Action $tunnelAction -Principal $principal -Trigger $trigger -Settings $settings -Description 'SSH key-only forwarding to the quota reader; no account keys stored locally.' | Out-Null
try {
    Register-ScheduledTask -TaskName $panelTask -Action $panelAction -Principal $principal -Trigger $trigger -Settings $settings -Description 'Local Agent HUD quota panel at user logon.' | Out-Null
} catch {
    Unregister-ScheduledTask -TaskName $tunnelTask -Confirm:$false
    throw 'Panel startup registration failed; tunnel startup registration was rolled back.'
}
Write-Host 'Installed panel and tunnel logon tasks. A failed tunnel will restart after one minute.'
Write-Host 'First verify SSH key authentication, host fingerprint, and manual tunnel connectivity before relying on startup.'
