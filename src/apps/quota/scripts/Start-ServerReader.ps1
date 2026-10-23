[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$nodeExecutable = (Get-Command node.exe -ErrorAction Stop).Source
$readerEntry = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\server\main.mjs'))
if (!(Test-Path -LiteralPath $readerEntry -PathType Leaf)) { throw 'Quota reader entry not found.' }
& $nodeExecutable $readerEntry
exit $LASTEXITCODE
