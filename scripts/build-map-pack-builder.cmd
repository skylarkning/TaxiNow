@echo off
setlocal
set "REPO_ROOT=%~dp0.."
set "OUTPUT=%REPO_ROOT%\artifacts\map-pack-builder"
set "ZIP=%REPO_ROOT%\artifacts\TaxiNow-Local-Map-Pack-Builder.zip"

dotnet publish "%REPO_ROOT%\tools\TaxiNow.MapPackBuilder\TaxiNow.MapPackBuilder.csproj" ^
  --configuration Release ^
  --runtime win-x64 ^
  --self-contained true ^
  --output "%OUTPUT%"

if errorlevel 1 exit /b %errorlevel%

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "if (Test-Path -LiteralPath '%ZIP%') { Remove-Item -LiteralPath '%ZIP%' -Force }; Compress-Archive -Path '%OUTPUT%\*' -DestinationPath '%ZIP%' -CompressionLevel Optimal"

if errorlevel 1 exit /b %errorlevel%

echo.
echo TaxiNow Local Map Pack Builder:
echo %OUTPUT%\TaxiNow.MapPackBuilder.exe
echo %ZIP%
endlocal
