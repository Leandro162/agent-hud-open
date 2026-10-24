[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$Installer,
    [Parameter(Mandatory=$true)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$Version,
    [Parameter(Mandatory=$true)][string]$Notes,
    [string]$EncryptedKey = 'C:\Users\Wintools\credentials\agent-hud-quota-updater.dpapi'
)
$ErrorActionPreference = 'Stop'
$installerFile = Get-Item -LiteralPath $Installer
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../../..'))
$cli = Join-Path $repo 'src/apps/quota/node_modules/@tauri-apps/cli/tauri.js'
$key = ConvertTo-SecureString ([IO.File]::ReadAllText($EncryptedKey).Trim())
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($key)
$processInfo = New-Object System.Diagnostics.ProcessStartInfo
$processInfo.FileName = (Get-Command node.exe).Source
$processInfo.Arguments = '"' + $cli + '" signer sign --app-version ' + $Version + ' "' + $installerFile.FullName + '"'
$processInfo.UseShellExecute = $false
$processInfo.CreateNoWindow = $true
$processInfo.RedirectStandardOutput = $true
$processInfo.RedirectStandardError = $true
try {
    $processInfo.EnvironmentVariables['TAURI_SIGNING_PRIVATE_KEY'] = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    $processInfo.EnvironmentVariables['TAURI_SIGNING_PRIVATE_KEY_PASSWORD'] = ''
    $signer = [System.Diagnostics.Process]::Start($processInfo)
    $capturedOutput = $signer.StandardOutput.ReadToEnd()
    $capturedError = $signer.StandardError.ReadToEnd()
    $signer.WaitForExit()
    if ($signer.ExitCode -ne 0) { throw 'Signing failed; signer output withheld to protect process secrets.' }
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    $processInfo.EnvironmentVariables.Remove('TAURI_SIGNING_PRIVATE_KEY')
    $capturedOutput = $null
    $capturedError = $null
}
$signaturePath = $installerFile.FullName + '.sig'
& node.exe (Join-Path $PSScriptRoot 'verify-update.mjs') $installerFile.FullName $signaturePath (Join-Path $repo 'src/apps/quota/src-tauri/updater.pub') $Version
if ($LASTEXITCODE -ne 0) { throw 'Independent signature verification failed; do not publish.' }
$manifest = [ordered]@{
    version = $Version
    notes = $Notes
    pub_date = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ')
    platforms = @{
        'windows-x86_64' = @{
            signature = [IO.File]::ReadAllText($signaturePath).Trim()
            url = 'https://github.com/Leandro162/agent-hud-open/releases/download/quota-v' + $Version + '/' + $installerFile.Name
        }
    }
}
$manifestPath = Join-Path $installerFile.DirectoryName 'latest.json'
[IO.File]::WriteAllText($manifestPath,($manifest | ConvertTo-Json -Depth 10),(New-Object Text.UTF8Encoding($false)))
Write-Output ('Signed and independently verified v' + $Version + '. Manifest: ' + $manifestPath)
