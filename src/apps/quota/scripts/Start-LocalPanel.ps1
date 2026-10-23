[CmdletBinding()]
param([Parameter(Mandatory=$true)][ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]*$')][string]$SshAlias)
$ErrorActionPreference = 'Stop'
$panelExecutable = Join-Path $PSScriptRoot 'agent-hud-quota.exe'
$tunnelScript = Join-Path $PSScriptRoot 'Start-LocalTunnel.ps1'
if (!(Test-Path -LiteralPath $panelExecutable -PathType Leaf)) { throw 'Keep this launcher beside agent-hud-quota.exe.' }
if (!(Test-Path -LiteralPath $tunnelScript -PathType Leaf)) { throw 'Tunnel launcher not found.' }
if (Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort 17843 -State Listen -ErrorAction SilentlyContinue) { throw 'Local port 17843 is already occupied. Verify the existing tunnel before starting the panel.' }
$tunnelArgs = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $tunnelScript + '" -SshAlias ' + $SshAlias
$tunnelProcess = Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList $tunnelArgs -WindowStyle Hidden -PassThru
$ready = $false
try {
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        if ($tunnelProcess.HasExited) { throw 'Tunnel failed. First verify SSH key authentication and host fingerprint.' }
        $connection = Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort 17843 -State Listen -ErrorAction SilentlyContinue
        if ($connection) { $ready = $true; break }
        Start-Sleep -Milliseconds 250
    }
    if (!$ready) { throw 'Tunnel startup timed out.' }
    $snapshot = Invoke-RestMethod -Uri 'http://127.0.0.1:17843/api/snapshot' -Method Get -TimeoutSec 5
    if ($snapshot.schemaVersion -ne 1 -or !$snapshot.providers.codex -or !$snapshot.providers.deepseek) { throw 'The tunnel did not return a supported quota snapshot.' }
    Start-Process -FilePath $panelExecutable -WorkingDirectory $PSScriptRoot -WindowStyle Normal
    Write-Host 'Secure tunnel verified and local panel started. Closing the panel to its tray keeps the tunnel available.'
} catch {
    if (!$tunnelProcess.HasExited) {
        # Only terminate the launcher we just created and its child process.
        Get-CimInstance Win32_Process -Filter "ParentProcessId=$($tunnelProcess.Id)" | Where-Object { $_.Name -eq 'ssh.exe' } | ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }
        Stop-Process -Id $tunnelProcess.Id -ErrorAction SilentlyContinue
    }
    throw 'Local startup failed. Check the SSH alias, key authentication, verified host fingerprint, and server reader.'
}
