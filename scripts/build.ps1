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
$pipelineModule = Join-Path $repositoryRoot 'tools\map_pipeline\skycharts_airport_map.py'

function Resolve-Tool {
    param(
        [Parameter(Mandatory)]
        [string] $Name,
        [Parameter(Mandatory)]
        [string[]] $Fallbacks
    )

    foreach ($candidate in $Fallbacks) {
        if (Test-Path -LiteralPath $candidate) {
            return $candidate
        }
    }

    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($null -ne $command) {
        return $command.Source
    }

    throw "Required tool '$Name' was not found. See docs/WINDOWS_ENVIRONMENT.md."
}

function Assert-NativeSuccess {
    param(
        [Parameter(Mandatory)]
        [string] $Step
    )

    if ($LASTEXITCODE -ne 0) {
        throw "$Step failed with exit code $LASTEXITCODE."
    }
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
            Assert-NativeSuccess 'pnpm install'
        }
        else {
            & $pnpm install
            Assert-NativeSuccess 'pnpm install'
        }
    }
    & $pnpm run build
    Assert-NativeSuccess 'Web build'
    if (-not $SkipTests) {
        & $pnpm run test
        Assert-NativeSuccess 'Web tests'
    }
}
finally {
    Pop-Location
}

& $python -m py_compile $pipelineScript $pipelineModule
Assert-NativeSuccess 'Python compilation'
& dotnet restore (Join-Path $repositoryRoot 'TaxiNow.sln')
Assert-NativeSuccess '.NET restore'
& dotnet build (Join-Path $repositoryRoot 'TaxiNow.sln') `
    --configuration $Configuration `
    --no-restore
Assert-NativeSuccess '.NET build'

if (-not $SkipTests) {
    & dotnet test (Join-Path $repositoryRoot 'TaxiNow.sln') `
        --configuration $Configuration `
        --no-build
    Assert-NativeSuccess '.NET tests'
}

Write-Host "TaxiNow build completed successfully." -ForegroundColor Green
