[CmdletBinding()]
param(
    [ValidateSet('Debug', 'Release')]
    [string] $Configuration = 'Release',
    [switch] $SkipBuild,
    [switch] $SkipTests
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = [System.IO.Path]::GetFullPath(
    (Split-Path -Parent $PSScriptRoot))
$artifactsRoot = [System.IO.Path]::GetFullPath(
    (Join-Path $repositoryRoot 'artifacts'))
$publishRoot = Join-Path $artifactsRoot 'publish\win-x64'
$installerRoot = Join-Path $artifactsRoot 'installer'
$prerequisiteRoot = Join-Path $installerRoot 'prerequisites'
$installerOutput = Join-Path $installerRoot 'output'
$portableOutput = Join-Path $installerRoot 'TaxiNow-V1.4.3-Build-121-Portable.zip'
$project = Join-Path $repositoryRoot 'src\TaxiNow.App\TaxiNow.App.csproj'
$solution = Join-Path $repositoryRoot 'TaxiNow.sln'
$innoCompiler = 'C:\Program Files (x86)\Inno Setup 6\ISCC.exe'
$innoScript = Join-Path $repositoryRoot 'installer\TaxiNow.iss'
$webView2Bootstrapper = Join-Path `
    $prerequisiteRoot `
    'MicrosoftEdgeWebview2Setup.exe'

function Assert-NativeSuccess {
    param([Parameter(Mandatory)][string] $Step)
    if ($LASTEXITCODE -ne 0) {
        throw "$Step failed with exit code $LASTEXITCODE."
    }
}

function Reset-ArtifactDirectory {
    param([Parameter(Mandatory)][string] $Path)
    $resolved = [System.IO.Path]::GetFullPath($Path)
    $allowedPrefix = $artifactsRoot.TrimEnd('\') + '\'
    if (-not $resolved.StartsWith(
            $allowedPrefix,
            [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to reset a directory outside artifacts: $resolved"
    }
    if (Test-Path -LiteralPath $resolved) {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
    New-Item -ItemType Directory -Path $resolved -Force | Out-Null
}

if (-not (Test-Path -LiteralPath $innoCompiler)) {
    throw 'Inno Setup 6 is required to create the TaxiNow installer.'
}

if (-not $SkipBuild) {
    $buildArguments = @{
        Configuration = $Configuration
        SkipWebInstall = $true
    }
    if ($SkipTests) {
        $buildArguments.SkipTests = $true
    }
    & (Join-Path $PSScriptRoot 'build.ps1') @buildArguments
}

Reset-ArtifactDirectory $publishRoot
New-Item -ItemType Directory -Path $prerequisiteRoot -Force | Out-Null
Reset-ArtifactDirectory $installerOutput

& dotnet restore $project --runtime win-x64
Assert-NativeSuccess '.NET publish restore'
& dotnet publish $project `
    --configuration $Configuration `
    --runtime win-x64 `
    --self-contained true `
    --no-restore `
    -p:Platform=x64 `
    -p:DebugSymbols=false `
    -p:DebugType=None `
    --output $publishRoot
Assert-NativeSuccess '.NET self-contained publish'

Copy-Item -LiteralPath (Join-Path $repositoryRoot 'LICENSE') `
    -Destination (Join-Path $publishRoot 'LICENSE.txt') -Force
Copy-Item -LiteralPath (Join-Path $repositoryRoot 'EULA.txt') `
    -Destination (Join-Path $publishRoot 'EULA.txt') -Force
Copy-Item -LiteralPath (Join-Path $repositoryRoot 'NOTICE') `
    -Destination (Join-Path $publishRoot 'NOTICE') -Force

if (-not (Test-Path -LiteralPath $webView2Bootstrapper)) {
    Invoke-WebRequest `
        -Uri 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' `
        -OutFile $webView2Bootstrapper
}
$signature = Get-AuthenticodeSignature -FilePath $webView2Bootstrapper
if ($signature.Status -ne 'Valid' -or
    $signature.SignerCertificate.Subject -notlike '*Microsoft*') {
    throw 'The downloaded WebView2 bootstrapper does not have a valid Microsoft signature.'
}

& $innoCompiler `
    "/DRepoRoot=$repositoryRoot" `
    "/DPublishDir=$publishRoot" `
    "/DPrerequisiteDir=$prerequisiteRoot" `
    "/DInstallerOutputDir=$installerOutput" `
    $innoScript
Assert-NativeSuccess 'Inno Setup compiler'

if (Test-Path -LiteralPath $portableOutput) {
    Remove-Item -LiteralPath $portableOutput -Force
}
Compress-Archive `
    -Path (Join-Path $publishRoot '*') `
    -DestinationPath $portableOutput `
    -CompressionLevel Optimal

$installerPath = Join-Path `
    $installerOutput `
    'TaxiNow-V1.4.3-Build-121-Setup.exe'
if (-not (Test-Path -LiteralPath $installerPath)) {
    throw 'The expected TaxiNow installer was not created.'
}

$checksums = @(
    Get-FileHash -Algorithm SHA256 -LiteralPath $installerPath
    Get-FileHash -Algorithm SHA256 -LiteralPath $portableOutput
)
$checksums |
    ForEach-Object { "$($_.Hash)  $([System.IO.Path]::GetFileName($_.Path))" } |
    Set-Content -LiteralPath (Join-Path $installerRoot 'SHA256SUMS.txt')

Write-Host "TaxiNow installer: $installerPath" -ForegroundColor Green
Write-Host "TaxiNow portable ZIP: $portableOutput" -ForegroundColor Green
