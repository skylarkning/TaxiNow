# TaxiNow

TaxiNow is a Windows ground-navigation map for Microsoft Flight Simulator 2020
and Microsoft Flight Simulator 2024. It uses one MapLibre renderer in the
desktop WebView2 shell and in an optional browser view.

> Flight simulation use only. Not for real-world navigation.

Current release: **V1.0 Beta** (build date: July 29, 2026). The About dialog
identifies the developer, links to the official GitHub account, and clearly
states that TaxiNow is free software for personal flight-simulator use only.

## Current vertical slice

- ASP.NET Core host with status, airport-map, storage, download-job, and
  telemetry endpoints.
- Shared MapLibre SPA with a full-detail CYYZ regression asset: 5 physical
  runways, 400 taxiways/taxilanes, 402 stands, and 4 terminal polygons.
- Proportional runway pavement, centerlines, thresholds, aiming marks,
  end-designators, taxiway centerlines, and zoom-dependent labels, informed by
  the proven SkyCharts map-drawing behavior.
- Taxiway pavement is layered below runway pavement while yellow centerlines
  remain continuous above it. Long taxiway references repeat at collision-aware
  intervals using the SkyCharts marker-density convention.
- Live MSFS 2024 ground-position tracking through SimConnect, with a
  heading-oriented ownship icon and smooth SignalR/WebView animation.
- Simulator status is visible in the header: red when MSFS is not running,
  orange while no flight is active, and green when position is synchronized.
- Performance-aware telemetry uses event-driven SimConnect callbacks, bounded
  buffers, change filtering, and a one-second parked heartbeat rather than a
  high-rate polling loop.
- Schema v2 validation and a schema v1 adapter.
- Visible map downloader and asset manager for ICAO, country/region, and
  optional province/state downloads, with byte-level progress, transfer speed,
  estimated time remaining, installed-map sizes, free disk space, queue
  clearing, and deletion. Country/region downloads include inline guidance and
  a link to the official ISO 3166-1 two-letter code list.
- Header airport search switches among installed maps. Entering a missing
  four-character ICAO code offers an immediate download beside the search.
- Installed assets are grouped as country/region → province/state → airport,
  following the SkyCharts asset hierarchy, and folded groups retain their state
  during live download refreshes. Country/region and province/state rows can
  delete every map beneath them after confirmation.
- SQLite-backed asset catalog and atomic map replacement.
- WPF/WebView2 desktop shell with deterministic Close/Quit behavior and
  minimize-to-tray support. Left-click the tray icon to restore it, or
  right-click it for Open and Quit commands.
- The header shows the active private-network browser address, for example
  `http://192.168.2.33:8780`, so a phone or tablet on the same trusted network
  can open the map.
- JSON-lines Python acquisition pipeline with the proven SkyCharts
  airport-geometry acquisition logic, country/ICAO jobs, caching, coordinated
  OpenStreetMap queries, X-Plane Scenery Gateway detail fallback, and an
  OurAirports runway fallback. Country/region and province/state downloads skip
  ICAOs that are already installed and acquire every remaining airport in the
  selected scope.
- Official managed SimConnect integration for MSFS 2024, plus the native x64
  C ABI spike, JSONL recorder, and deterministic replay source.

Live simulator compatibility is tracked in
[`docs/WINDOWS_ENVIRONMENT.md`](docs/WINDOWS_ENVIRONMENT.md).

## Build

```powershell
.\scripts\build.ps1
```

The build packages the Python map pipeline as
`pipeline\taxinow-map-pipeline.exe`, so the desktop downloader does not require
a separate Python installation at runtime. PyInstaller is downloaded into the
ignored `artifacts` directory when needed.

Live MSFS 2024 builds currently discover the SimConnect SDK from
`MSFS_SDK_ROOT`, or from `C:\MSFS SDK` when the environment variable is not
set. The build copies the required managed wrapper and native runtime beside
TaxiNow. A build made without that SDK remains usable for maps and replay but
cannot connect to the simulator.

Run the browser/server vertical slice:

```powershell
dotnet run --project .\src\TaxiNow.Server
```

Then open <http://127.0.0.1:8780>. The WPF shell uses the same URL:

```powershell
dotnet run --project .\src\TaxiNow.App
```

Closing the desktop window quits TaxiNow and releases the local server port.
Minimizing hides the window in the Windows notification area instead.

For another device, use the **Access Map on Other Device's Browser** address
shown in the TaxiNow header. Both devices must be on the same trusted LAN. If
Windows Firewall asks, allow TaxiNow on **Private networks** only; do not expose
port 8780 through a router or public-network firewall profile.

The built Windows executable is:

```text
src\TaxiNow.App\bin\x64\Debug\net10.0-windows\win-x64\TaxiNow.App.exe
```

Live MSFS 2024 telemetry is the default. To run without the simulator, select
the deterministic replay source:

```powershell
$env:TaxiNow__TelemetryMode = 'replay'
dotnet run --project .\src\TaxiNow.App
```

Set `TaxiNow__ReplayPath` to select another JSONL recording. Supplying a replay
path without an explicit telemetry mode also selects replay for compatibility.

## Repository layout

The implementation follows the boundaries and milestones in
[`docs/IMPLEMENTATION_HANDOFF.md`](docs/IMPLEMENTATION_HANDOFF.md). No
taxi-route/pathfinding code is included.

## Map data

Airport geometry downloaded from OpenStreetMap is © OpenStreetMap contributors
and licensed under the ODbL 1.0. The included CYYZ regression asset retains that
attribution in its metadata and in the map UI. See [`NOTICE`](NOTICE) for data
licensing details.
