@echo off
setlocal

set "PIPELINE_DIR=%~dp0"
set "APP_DIR=%PIPELINE_DIR%.."
set "MICROMAMBA=%APP_DIR%\runtime\micromamba.exe"
set "DATA_ROOT=%LOCALAPPDATA%\TaxiNow Map Pack Builder"
set "MAMBA_ROOT_PREFIX=%DATA_ROOT%\micromamba"
set "ENV_PREFIX=%DATA_ROOT%\environment"
set "ENV_FILE=%PIPELINE_DIR%environment-map-pack-windows.yml"

if not exist "%MICROMAMBA%" (
  echo TaxiNow dependency installer could not find:
  echo %MICROMAMBA%
  exit /b 2
)

if not exist "%ENV_FILE%" (
  echo TaxiNow dependency definition could not be found:
  echo %ENV_FILE%
  exit /b 3
)

if not exist "%DATA_ROOT%" mkdir "%DATA_ROOT%"

echo Installing TaxiNow map-pack dependencies.
echo This downloads Python, osmium-tool, and the Overture Maps client.
echo Environment: %ENV_PREFIX%

if exist "%ENV_PREFIX%\python.exe" (
  "%MICROMAMBA%" install --yes --root-prefix "%MAMBA_ROOT_PREFIX%" --prefix "%ENV_PREFIX%" --file "%ENV_FILE%"
) else (
  "%MICROMAMBA%" create --yes --root-prefix "%MAMBA_ROOT_PREFIX%" --prefix "%ENV_PREFIX%" --file "%ENV_FILE%"
)

if errorlevel 1 exit /b %errorlevel%

"%ENV_PREFIX%\python.exe" --version
if errorlevel 1 exit /b %errorlevel%

"%ENV_PREFIX%\Library\bin\osmium.exe" --version
if errorlevel 1 exit /b %errorlevel%

"%ENV_PREFIX%\python.exe" -m pip show overturemaps
if errorlevel 1 exit /b %errorlevel%

echo TaxiNow map-pack dependencies are ready.
endlocal
