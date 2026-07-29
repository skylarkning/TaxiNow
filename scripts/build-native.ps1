[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string] $SdkRoot,
    [ValidateSet('Debug', 'Release')]
    [string] $Configuration = 'Release'
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$nativeRoot = Join-Path $repositoryRoot 'src\TaxiNow.SimConnect.Native'

if (-not (Test-Path -LiteralPath (Join-Path $SdkRoot 'SimConnect SDK\include\SimConnect.h'))) {
    throw "SimConnect.h was not found below '$SdkRoot'."
}

& cmake `
    -S $nativeRoot `
    -B (Join-Path $nativeRoot 'out\build\windows-x64') `
    -A x64 `
    -D "MSFS_SDK_ROOT=$SdkRoot" `
    -D 'TAXINOW_WITH_SIMCONNECT=ON'
& cmake `
    --build (Join-Path $nativeRoot 'out\build\windows-x64') `
    --config $Configuration

