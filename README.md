# TaxiNow

TaxiNow is a Windows ground-navigation map for Microsoft Flight Simulator 2020
and Microsoft Flight Simulator 2024. It uses one MapLibre renderer in the
desktop WebView2 shell and in an optional browser view.

> Flight simulation use only. Not for real-world navigation.

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
- Smooth replay ownship animation through a SignalR telemetry stream.
- Schema v2 validation and a schema v1 adapter.
- Visible map downloader and asset manager for ICAO, country, and optional
  region downloads, with byte-level progress, transfer speed, estimated time
  remaining, installed-map sizes, free disk space, queue clearing, and deletion.
- Header airport search switches among installed maps. Entering a missing
  four-character ICAO code offers an immediate download beside the search.
- Installed assets are grouped as country → region → airport, following the
  SkyCharts asset hierarchy, and folded groups retain their state during live
  download refreshes. Country and region rows can delete every map beneath
  them after confirmation.
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
  OurAirports runway fallback. Country and region downloads skip ICAOs that are
  already installed, applying the requested download limit only to new maps.
- Native x64 SimConnect C ABI spike, managed wrapper, JSONL recorder, and replay
  source.

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

The replay fixture loops by default. Set `TaxiNow__ReplayPath` to another JSONL
recording to override it.

## Repository layout

The implementation follows the boundaries and milestones in
[`docs/IMPLEMENTATION_HANDOFF.md`](docs/IMPLEMENTATION_HANDOFF.md). No
taxi-route/pathfinding code is included.

## Map data

Airport geometry downloaded from OpenStreetMap is © OpenStreetMap contributors
and licensed under the ODbL 1.0. The included CYYZ regression asset retains that
attribution in its metadata and in the map UI. See [`NOTICE`](NOTICE) for data
licensing details.
