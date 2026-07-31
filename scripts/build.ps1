[CmdletBinding()]
param(
    [ValidateSet('Debug', 'Release')]
    [string] $Configuration = 'Debug',
    [switch] $SkipWebInstall,
    [switch] $SkipPipelinePackage,
    [switch] $SkipTests
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$webRoot = Join-Path $repositoryRoot 'src\TaxiNow.Web'
$pipelineRoot = Join-Path $repositoryRoot 'tools\map_pipeline'
$pipelineScript = Join-Path $repositoryRoot 'tools\map_pipeline\taxinow_map_pipeline.py'
$pipelineModule = Join-Path $repositoryRoot 'tools\map_pipeline\skycharts_airport_map.py'
$pipelineSpec = Join-Path $pipelineRoot 'taxinow_map_pipeline.spec'
$pipelineExecutable = Join-Path $pipelineRoot 'dist\taxinow-map-pipeline.exe'
$pyInstallerRoot = Join-Path `
    $repositoryRoot `
    'artifacts\pyinstaller-runtime-6.21.0-clean'

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
    if ($SkipWebInstall) {
        & $node (Join-Path $webRoot 'node_modules\typescript\bin\tsc') `
            --noEmit
        Assert-NativeSuccess 'TypeScript check'
        & $node (Join-Path $webRoot 'node_modules\vite\bin\vite.js') `
            build --configLoader runner
        Assert-NativeSuccess 'Web build'
        if (-not $SkipTests) {
            & $node (Join-Path $webRoot 'node_modules\vitest\vitest.mjs') `
                run --configLoader runner
            Assert-NativeSuccess 'Web tests'
        }
    }
    else {
        & $pnpm run build
        Assert-NativeSuccess 'Web build'
        if (-not $SkipTests) {
            & $pnpm run test
            Assert-NativeSuccess 'Web tests'
        }
    }
}
finally {
    Pop-Location
}

& $python -m py_compile $pipelineScript $pipelineModule
Assert-NativeSuccess 'Python compilation'
if (-not $SkipTests) {
    & $python -m unittest discover `
        -s (Join-Path $repositoryRoot 'tools\map_pipeline') `
        -p 'test_*.py'
    Assert-NativeSuccess 'Python tests'
}

if (-not $SkipPipelinePackage) {
$pipelineInputs = @(
    $pipelineScript,
    $pipelineModule,
    $pipelineSpec,
    (Join-Path $pipelineRoot 'data\airports.csv.gz'),
    (Join-Path $pipelineRoot 'data\runways.csv.gz')
)
    $packageRequired =
        -not (Test-Path -LiteralPath $pipelineExecutable) -or
        ($pipelineInputs | Where-Object {
            (Get-Item -LiteralPath $_).LastWriteTimeUtc -gt
                (Get-Item -LiteralPath $pipelineExecutable).LastWriteTimeUtc
        }).Count -gt 0
    if ($packageRequired) {
        $pyInstallerModule = Join-Path $pyInstallerRoot 'PyInstaller\__init__.py'
        if (-not (Test-Path -LiteralPath $pyInstallerModule)) {
            New-Item -ItemType Directory -Path $pyInstallerRoot -Force | Out-Null
            & $python -m pip install `
                --disable-pip-version-check `
                --target $pyInstallerRoot `
                'PyInstaller==6.21.0'
            Assert-NativeSuccess 'PyInstaller installation'
        }

        $previousPythonPath = $env:PYTHONPATH
        $env:PYTHONPATH = if ([string]::IsNullOrWhiteSpace($previousPythonPath)) {
            $pyInstallerRoot
        }
        else {
            "$pyInstallerRoot;$previousPythonPath"
        }
        Push-Location $pipelineRoot
        try {
            & $python -m PyInstaller --clean --noconfirm $pipelineSpec
            Assert-NativeSuccess 'Pipeline packaging'
        }
        finally {
            Pop-Location
            $env:PYTHONPATH = $previousPythonPath
        }
    }
}

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
