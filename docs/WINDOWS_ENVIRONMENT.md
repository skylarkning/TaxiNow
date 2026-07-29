# Windows development environment

Audit date: 2026-07-29  
Machine: Windows 10/11 x64 (`10.0.26200`)  
Audit scope: Milestone 0 SimConnect/toolchain compatibility spike

## Installed tools

| Component | Result |
|---|---|
| .NET SDK | 10.0.102 (also 8.0.413) |
| .NET runtime | Microsoft.NETCore.App 10.0.9; ASP.NET Core 10.0.2; Windows Desktop 10.0.9 |
| Visual Studio | Visual Studio Community 2026 18.2.0 at `C:\Program Files\Microsoft Visual Studio\18\Community` |
| WPF workload | Detected |
| ASP.NET/web workload | Not detected by `vswhere` |
| Native C++ desktop workload | Not detected by `vswhere`; MSVC toolchain directory not present |
| Edge WebView2 Runtime | 150.0.4078.105 |
| Git | Codex-bundled 2.53.0.windows.3; HTTPS remote helper is absent |
| Node.js / pnpm | Not installed on system `PATH`; Codex workspace bundle is available (`node\bin\node.exe`, `bin\fallback\pnpm.cmd`) |
| Python | Not installed on system `PATH`; Codex workspace bundle is available for development |
| CMake / Ninja | Not installed on system `PATH` |

The Codex workspace bundle used during this implementation supplies Node.js,
pnpm, and Python, but it is not a replacement for installing the project
prerequisites on a normal developer machine.

## Simulator installations

| Simulator | Installation | Executable | Live process during audit |
|---|---|---|---|
| Microsoft Flight Simulator 2020 | `D:\XboxGames\Microsoft Flight Simulator` | `D:\XboxGames\Microsoft Flight Simulator\Content\FlightSimulator.exe` | No |
| Microsoft Flight Simulator 2024 | `D:\XboxGames\Microsoft Flight Simulator 2024` | `D:\XboxGames\Microsoft Flight Simulator 2024\Content\FlightSimulator2024.exe` | No |

Both package/content trees are present. File-version resources on the protected
Xbox executables did not expose a product version to PowerShell, so the
simulator build numbers remain to be recorded from the in-simulator UI.

## SimConnect SDK discovery

One SDK installation was found:

```text
C:\MSFS SDK
  version.txt                              0.24.5
  SimConnect SDK\include\SimConnect.h
  SimConnect SDK\lib\SimConnect.lib
  SimConnect SDK\lib\SimConnect.dll
  SimConnect SDK\lib\static\SimConnect.lib
  SimConnect SDK\lib\managed\Microsoft.FlightSimulator.SimConnect.dll
```

The header contains the modern facility-data calls
`SimConnect_AddToFacilityDefinition`, `SimConnect_RequestFacilityData`, and
`SimConnect_RequestFacilityData_EX1`, plus airport/runway/taxi
point/taxi path/taxi name/taxi parking/jetway/pavement facility types. The
installation does **not** contain the official SimConnect sample source tree.

The shared default path and version file do not identify whether another SDK was
previously installed and overwritten. Until both SDK installers are run to
edition-specific paths, this installation is treated as the only discovered SDK
and not claimed as a verified 2020/2024 pair.

## Compatibility matrix

`Not run` means the executable or SDK sample could not be built/launched during
this non-interactive audit. It is not a compatibility failure.

| Test | MSFS 2020 | MSFS 2024 | Finding |
|---|---:|---:|---|
| Official Open/Close sample | Not run | Not run | Official sample source is absent; simulators were not running |
| Request Data: required five variables | Not run | Not run | Native spike source is included in this repository; native C++ workload is missing |
| Facility airport/runway data | Not run | Not run | Header/API surface discovered; live response not verified |
| Facility taxi/parking/name data | Not run | Not run | Header/API surface discovered; live response not verified |
| Connect before simulator starts | Not run | Not run | Requires interactive simulator test |
| Reconnect after simulator restart | Not run | Not run | Requires interactive simulator test |

No statement that either simulator has accepted a client is made yet.

## Desktop WebView finding

`WebView2CompositionControl` blocked during WPF window realization in the
automated desktop smoke session with WebView2 Runtime 150.0.4078.105. The shell
therefore uses the standard WPF `WebView2` control as the documented fallback.
The shared SPA and loopback host are unchanged. Re-test the composition control
interactively after graphics-driver or WebView2 updates; if it succeeds, it
remains the preferred control.

## Required follow-up on this PC

1. Install the Visual Studio native desktop and ASP.NET/web workloads plus
   CMake tools for Windows.
2. Install Node.js LTS/Corepack/pnpm and Python 3.12 or 3.13/PyInstaller as
   system developer prerequisites.
3. Reinstall each simulator SDK to a distinct path such as
   `C:\MSFS SDK 2020` and `C:\MSFS SDK 2024`; record exact versions.
4. Include the official SDK samples when installing, or retrieve them through
   each simulator's Developer Mode SDK workflow.
5. With each simulator running, execute Open/Close, Request Data, and Facility
   Data tests and record simulator build, SDK version, DLL selected at runtime,
   returned facility structures, and any packing/variable differences.

## Runtime-loading policy for TaxiNow

Automated smoke tests may set `TaxiNow:EnableTestShutdown=true` to expose a
loopback-only graceful-stop endpoint. It is disabled by default and is not part
of the production API.

The repository does not redistribute an SDK `SimConnect.dll`. The native bridge
links against an SDK selected explicitly with `MSFS_SDK_ROOT`, and runtime
loading is left to the installed simulator/SimConnect runtime. Only the narrow
verified common API may enter production code. Edition-specific behavior must
remain isolated behind the bridge and documented here or in a new ADR.
