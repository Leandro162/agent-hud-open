[CmdletBinding()]
param([Parameter(Mandatory=$true)][ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]*$')][string]$SshAlias)
$ErrorActionPreference = 'Stop'
# Define the alias and key authentication in the local Windows OpenSSH config.
# Host key enrollment must be done once interactively and verified separately.
& ssh.exe -N -T -o BatchMode=yes -o StrictHostKeyChecking=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -L '127.0.0.1:17843:127.0.0.1:17843' $SshAlias
if ($LASTEXITCODE -ne 0) { throw 'Secure tunnel failed. Check the SSH alias, verified host key, and key authentication.' }
