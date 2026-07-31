@echo off
setlocal
set "REPO_ROOT=%~dp0.."
set "OUTPUT=%REPO_ROOT%\artifacts\map-pack-builder"
set "ZIP=%REPO_ROOT%\artifacts\TaxiNow-Local-Map-Pack-Builder.zip"
set "INSTALLER_OUTPUT=%REPO_ROOT%\artifacts\map-pack-builder-installer"
set "INSTALLER=%INSTALLER_OUTPUT%\TaxiNow-Local-Map-Pack-Builder-Build-103-Setup.exe"
set "PREREQUISITES=%REPO_ROOT%\artifacts\prerequisites"
set "MICROMAMBA=%PREREQUISITES%\micromamba.exe"
set "MICROMAMBA_DOWNLOAD=%PREREQUISITES%\micromamba-win-64.exe"
set "MICROMAMBA_URL=https://github.com/mamba-org/micromamba-releases/releases/download/2.8.1-1/micromamba-win-64.exe"
set "MICROMAMBA_SHA256=B645A5259CB92B5869B0E60943390DD0D362CAE45BC7E2F5BA8C7E4A4B06C7AA"
set "ISCC=C:\Program Files (x86)\Inno Setup 6\ISCC.exe"

dotnet publish "%REPO_ROOT%\tools\TaxiNow.MapPackBuilder\TaxiNow.MapPackBuilder.csproj" ^
  --configuration Release ^
  --runtime win-x64 ^
  --self-contained true ^
  --output "%OUTPUT%"

if errorlevel 1 exit /b %errorlevel%

if not exist "%OUTPUT%\pipeline\data\airports.csv.gz" (
  echo Required bundled airport catalog was not published.
  exit /b 1
)
if not exist "%OUTPUT%\pipeline\data\runways.csv.gz" (
  echo Required bundled runway catalog was not published.
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "if (Test-Path -LiteralPath '%ZIP%') { Remove-Item -LiteralPath '%ZIP%' -Force }; Compress-Archive -Path '%OUTPUT%\*' -DestinationPath '%ZIP%' -CompressionLevel Optimal"

if errorlevel 1 exit /b %errorlevel%

if not exist "%PREREQUISITES%" mkdir "%PREREQUISITES%"
if not exist "%MICROMAMBA_DOWNLOAD%" (
  curl.exe --location --fail --output "%MICROMAMBA_DOWNLOAD%" "%MICROMAMBA_URL%"
  if errorlevel 1 exit /b %errorlevel%
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$actual = (Get-FileHash -Algorithm SHA256 -LiteralPath '%MICROMAMBA_DOWNLOAD%').Hash; if ($actual -ne '%MICROMAMBA_SHA256%') { throw 'micromamba SHA-256 verification failed.' }; Copy-Item -LiteralPath '%MICROMAMBA_DOWNLOAD%' -Destination '%MICROMAMBA%' -Force"

if errorlevel 1 exit /b %errorlevel%

if not exist "%ISCC%" (
  echo Inno Setup 6 was not found in its standard installation directory.
  exit /b 1
)

"%ISCC%" ^
  "/DRepoRoot=%REPO_ROOT%" ^
  "/DPublishDir=%OUTPUT%" ^
  "/DPrerequisiteDir=%PREREQUISITES%" ^
  "/DInstallerOutputDir=%INSTALLER_OUTPUT%" ^
  "%REPO_ROOT%\installer\TaxiNow.MapPackBuilder.iss"

if errorlevel 1 exit /b %errorlevel%

echo.
echo TaxiNow Local Map Pack Builder:
echo %OUTPUT%\TaxiNow.MapPackBuilder.exe
echo %ZIP%
echo %INSTALLER%
endlocal
