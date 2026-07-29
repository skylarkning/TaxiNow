[CmdletBinding()]
param(
    [ValidateSet('Debug', 'Release')]
    [string] $Configuration = 'Debug'
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
& dotnet run `
    --project (Join-Path $repositoryRoot 'src\TaxiNow.Server') `
    --configuration $Configuration `
    --no-build

