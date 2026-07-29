[CmdletBinding()]
param(
    [ValidateSet('Debug', 'Release')]
    [string] $Configuration = 'Debug',
    [switch] $SkipWebInstall,
    [switch] $SkipTests
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$webRoot = Join-Path $repositoryRoot 'src\TaxiNow.Web'
$pipelineScript = Join-Path $repositoryRoot 'tools\map_pipeline\taxinow_map_pipeline.py'

function Resolve-Tool {
    param(
        [Parameter(Mandatory)]
        [string] $Name,
        [Parameter(Mandatory)]
        [string[]] $Fallbacks
    )

    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($null -ne $command) {
        return $command.Source
    }

    foreach ($candidate in $Fallbacks) {
        if (Test-Path -LiteralPath $candidate) {
            return $candidate
        }
    }

    throw "Required tool '$Name' was not found. See docs/WINDOWS_ENVIRONMENT.md."
}

$codexDependencies = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies'
$pnpm = Resolve-Tool -Name 'pnpm' -Fallbacks @(
    (Join-Path $codexDependencies 'bin\fallback\pnpm.cmd'),
    (Join-Path $codexDependencies 'bin\pnpm.cmd')
)
$python = Resolve-Tool -Name 'python' -Fallbacks @(
    (Join-Path $codexDependencies 'python\python.exe')
)
$node = Resolve-Tool -Name 'node' -Fallbacks @(
    (Join-Path $codexDependencies 'node\bin\node.exe')
)
$nodeDirectory = Split-Path -Parent $node
if (($env:PATH -split ';') -notcontains $nodeDirectory) {
    $env:PATH = "$nodeDirectory;$env:PATH"
}

Push-Location $webRoot
try {
    if (-not $SkipWebInstall) {
        if (Test-Path -LiteralPath (Join-Path $webRoot 'pnpm-lock.yaml')) {
            & $pnpm install --frozen-lockfile
        }
        else {
            & $pnpm install
        }
    }
    & $pnpm run build
    if (-not $SkipTests) {
        & $pnpm run test
    }
}
finally {
    Pop-Location
}

& $python -m py_compile $pipelineScript
& dotnet restore (Join-Path $repositoryRoot 'TaxiNow.sln')
& dotnet build (Join-Path $repositoryRoot 'TaxiNow.sln') `
    --configuration $Configuration `
    --no-restore

if (-not $SkipTests) {
    & dotnet test (Join-Path $repositoryRoot 'TaxiNow.sln') `
        --configuration $Configuration `
        --no-build
}

Write-Host "TaxiNow build completed successfully." -ForegroundColor Green
