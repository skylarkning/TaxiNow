# Windows development environment

Audit date: 2026-07-29; MSFS 2020 compatibility update: 2026-07-31
Machine: Windows 10/11 x64 (`10.0.26200`)  
Audit scope: MSFS 2020/2024 SimConnect integration and toolchain compatibility

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
| Microsoft Flight Simulator 2020 | Microsoft Store/Xbox package | `FlightSimulator.exe` | Yes on 2026-07-31; live flight at CYYZ Gate B19 |
| Microsoft Flight Simulator 2024 | `D:\XboxGames\Microsoft Flight Simulator 2024` | `D:\XboxGames\Microsoft Flight Simulator 2024\Content\FlightSimulator2024.exe` | Yes on 2026-07-29; live flight at CYYZ |

Both package/content trees are present. File-version resources on the protected
Xbox executables did not expose a product version to PowerShell, so the
simulator build numbers remain to be recorded from the in-simulator UI.

## SimConnect SDK discovery

Two SDK installations are now available:

```text
C:\MSFS SDK
  managed wrapper assembly                 11.0.62651.3
  SimConnect SDK\lib\SimConnect.dll        67,072 bytes

C:\MSFS 2024 SDK
  managed wrapper assembly                 12.2.0.0
  SimConnect SDK\lib\SimConnect.dll        84,480 bytes
```

The header contains the modern facility-data calls
`SimConnect_AddToFacilityDefinition`, `SimConnect_RequestFacilityData`, and
`SimConnect_RequestFacilityData_EX1`, plus airport/runway/taxi
point/taxi path/taxi name/taxi parking/jetway/pavement facility types. The
installation does **not** contain the official SimConnect sample source tree.

TaxiNow prefers the MSFS 2024 client library because the same deployed client
has now passed live telemetry tests against both simulator editions. The older
SDK remains available for comparison but is not shipped alongside the newer
assembly because both managed wrappers have the same assembly name.

## Compatibility matrix

`Not run` means the test has not yet been executed. It is not a compatibility
failure.

| Test | MSFS 2020 | MSFS 2024 | Finding |
|---|---:|---:|---|
| Open/Close connection | Pass | Pass | The MSFS 2024 managed client connected to active flights in both simulator editions |
| Request Data: required five variables | Pass | Pass | Latitude, longitude, true heading, on-ground state, and ground speed were received live |
| Force one-shot position refresh | Pass | Pass | MSFS 2020 advanced the telemetry sequence immediately; the same request path was previously verified in MSFS 2024 |
| Facility airport/runway data | Not run | Not run | Header/API surface discovered; live response not verified |
| Facility taxi/parking/name data | Not run | Not run | Header/API surface discovered; live response not verified |
| Connect before simulator starts | Not run | Not run | The source has a non-crashing disconnected state; interactive behavior still needs verification |
| Reconnect after simulator restart | Not run | Not run | Requires interactive simulator test |

MSFS 2024 accepted the TaxiNow client on 2026-07-29. The parked CYYZ sample was
`43.6805474, -79.6166645`, true heading `136.56°`, on-ground `true`, and
approximately zero ground speed. This position falls on the installed Gate 133
parking feature.

MSFS 2020 accepted the same TaxiNow client on 2026-07-31. At CYYZ Gate B19 it
returned `43.6846629, -79.6233418`, true heading `328.58°`, on-ground `true`,
and essentially zero ground speed. The API reported `simulator: msfs2020`,
`state: groundTracking`, and a force-refresh request advanced the live sequence.

## Desktop WebView finding

`WebView2CompositionControl` blocked during WPF window realization in the
automated desktop smoke session with WebView2 Runtime 150.0.4078.105. The shell
therefore uses the standard WPF `WebView2` control as the documented fallback.
The shared SPA and loopback host are unchanged. Re-test the composition control
interactively after graphics-driver or WebView2 updates; if it succeeds, it
remains the preferred control.

## Required follow-up on this PC

1. Install the Visual Studio native desktop and ASP.NET/web workloads plus
   CMake tools for Windows before resuming the native bridge spike.
2. Install Node.js LTS/Corepack/pnpm and Python 3.12 or 3.13/PyInstaller as
   system developer prerequisites.
3. Include the official SDK samples when installing, or retrieve them through
   each simulator's Developer Mode SDK workflow.
4. With both editions, execute Facility Data and restart/reconnect tests and record the
   simulator build, SDK version, selected DLL, returned structures, and any
   packing or variable differences.

## Runtime-loading policy for TaxiNow

Automated smoke tests may set `TaxiNow:EnableTestShutdown=true` to expose a
loopback-only graceful-stop endpoint. It is disabled by default and is not part
of the production API.

The shared MSFS 2020/2024 source uses Microsoft's managed SimConnect wrapper.
The build discovers it through `MSFS_SDK_ROOT`, `C:\MSFS 2024 SDK`, or
`C:\MSFS SDK`, in that order, then copies the managed wrapper and native
`SimConnect.dll` into the application output. Calls are owned by one background
thread because SimConnect is not thread-safe.

Position delivery is callback-driven rather than timer-polled. TaxiNow requests
changed data on visual frames with an interval of four, retains at most sixteen
pending samples, suppresses insignificant parked jitter, and emits a one-second
heartbeat while stationary. The UI render loop is capped near 30 FPS. These
limits preserve low perceived latency while bounding CPU and memory work.

Distribution licensing and installer handling for the SDK runtime must be
resolved before a public binary release. Edition-specific behavior remains
isolated behind `ITelemetrySource` and must be documented here or in an ADR.
