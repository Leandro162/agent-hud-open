# Win32_Process reports command lines and the owner's SID without reading any
# process environment. A reused parent PID must not be newer than its child.
# https://learn.microsoft.com/windows/win32/cimwin32prov/win32-process
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$owner = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$child = Get-CimInstance Win32_Process -Filter "ProcessId = $([uint32]$env:AGENT_HUD_CALLER_PID)"
$seen = [System.Collections.Generic.HashSet[uint32]]::new()
for ($count = 0; $count -lt 16 -and $null -ne $child; $count++) {
    $parentId = [uint32]$child.ParentProcessId
    if ($parentId -eq 0 -or -not $seen.Add($parentId)) { break }
    try { $parent = Get-CimInstance Win32_Process -Filter "ProcessId = $parentId" }
    catch { break }
    if ($null -eq $parent -or $null -eq $parent.CreationDate -or
        $null -eq $child.CreationDate -or $parent.CreationDate -gt $child.CreationDate) { break }
    try { $identity = Invoke-CimMethod -InputObject $parent -MethodName GetOwnerSid }
    catch { break }
    if ($identity.ReturnValue -ne 0 -or $identity.Sid -ne $owner -or
        [string]::IsNullOrEmpty($parent.ExecutablePath) -or
        [string]::IsNullOrEmpty($parent.CommandLine)) { break }
    @{ executable = $parent.ExecutablePath; command = $parent.CommandLine } | ConvertTo-Json -Compress
    $child = $parent
}
