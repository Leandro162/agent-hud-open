# Run interactively on the SERVER under the same Windows account as the reader.
# Never pass a key as a parameter, command argument, or environment variable.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$credentialRoot = 'C:\Users\Wintools\credentials'
$credentialPath = Join-Path $credentialRoot 'agent-hud-deepseek.dpapi'
$indexPath = Join-Path $credentialRoot 'index.json'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
Write-Host "Windows account: $identity"
New-Item -ItemType Directory -Force -Path $credentialRoot | Out-Null
$entries = @()
if (Test-Path -LiteralPath $indexPath) {
    $entries = @(Get-Content -Raw -LiteralPath $indexPath | ConvertFrom-Json)
    $existing = @($entries | Where-Object { $_.service -eq 'DeepSeek' })
    if ($existing.Count -gt 0) {
        Write-Host 'Existing DeepSeek credential metadata found. Review and validate the appropriate existing credential before adding another.'
        $existing | Select-Object service, credential_alias, status | Format-Table
        throw 'Existing credential requires review; no key requested and no files changed.'
    }
}
if (Test-Path -LiteralPath $credentialPath) { throw 'Encrypted credential already exists; no files changed.' }
$secret = Read-Host 'DeepSeek API Key (hidden input)' -AsSecureString
$pointer = [IntPtr]::Zero
$temporaryPath = "$credentialPath.pending"
try {
    $secret | ConvertFrom-SecureString | Set-Content -LiteralPath $temporaryPath -Encoding ASCII
    $roundTrip = Get-Content -Raw -LiteralPath $temporaryPath | ConvertTo-SecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($roundTrip)
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    $originalPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
    try {
        if ($plain -cne [Runtime.InteropServices.Marshal]::PtrToStringBSTR($originalPointer)) { throw 'DPAPI round-trip verification failed.' }
    } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($originalPointer) }
    if ([string]::IsNullOrWhiteSpace($plain) -or $plain -match '[\r\n\x00]') { throw 'Invalid credential format.' }
    $validation = 'network_error'
    $permissions = @('DPAPI CurrentUser round-trip verified')
    try {
        $null = Invoke-RestMethod -Method Get -Uri 'https://api.deepseek.com/user/balance' -Headers @{ Authorization = "Bearer $plain" } -TimeoutSec 15
        $validation = 'active'
        $permissions += 'GET /user/balance succeeded; no inference request sent'
    } catch {
        $statusCode = 0
        if ($_.Exception.Response) { $statusCode = [int]$_.Exception.Response.StatusCode }
        if ($statusCode -eq 401) { $validation = 'expired_or_revoked' }
        elseif ($statusCode -eq 403) { $validation = 'permission_denied' }
        elseif ($statusCode -gt 0) { $validation = 'service_error' }
    }
    Move-Item -LiteralPath $temporaryPath -Destination $credentialPath
    $entries += [ordered]@{
        service = 'DeepSeek'; account = $identity; credential_alias = 'agent-hud-deepseek'
        purpose = 'Agent HUD official DeepSeek API balance monitoring'
        declared_permissions = @('User API key; monitoring uses balance read only; provider may allow inference')
        verified_permissions = $permissions; expiry = $null; encrypted_file_path = $credentialPath
        status = $validation; last_validation_time = [DateTime]::UtcNow.ToString('o')
    }
    $indexTemp = "$indexPath.pending"
    ConvertTo-Json -InputObject @($entries) -Depth 12 | Set-Content -LiteralPath $indexTemp -Encoding UTF8
    Move-Item -LiteralPath $indexTemp -Destination $indexPath -Force
    Write-Host "Saved alias agent-hud-deepseek to $credentialPath; DPAPI CurrentUser round-trip verified; validation: $validation"
    Write-Host 'DPAPI is tied to this Windows account/computer. Reconfigure after changing account or computer.'
} finally {
    $plain = $null
    if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    if (Test-Path -LiteralPath $temporaryPath) { Remove-Item -LiteralPath $temporaryPath }
}
