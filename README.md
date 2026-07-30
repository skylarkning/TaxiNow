<p align="center">
  <img src="src/TaxiNow.Web/public/branding/taxinow-logo.png"
       width="540"
       alt="TaxiNow" />
</p>

# TaxiNow

TaxiNow is a Windows ground-navigation map for Microsoft Flight Simulator 2020
and Microsoft Flight Simulator 2024. It uses one MapLibre renderer in the
desktop WebView2 shell and in an optional browser view.

> Flight simulation use only. Not for real-world navigation.

## License

TaxiNow is free of charge for personal, non-commercial flight-simulation use,
but it is **not open-source or public-domain software**. Commercial use,
real-world aviation/navigation use, modification, derivative works, resale,
and redistribution are prohibited unless Sky Ning provides prior express
written permission. Public binaries and release documents are available from
the [TaxiNow-Release repository](https://github.com/skylarkning/TaxiNow-Release).
The installer carries the TaxiNow Personal Non-Commercial License, EULA, and
third-party notices.

Current release: **V1.0 Beta 2** (build date: July 30, 2026). The About dialog
identifies the developer, links to the official GitHub account, and clearly
states that TaxiNow is a free-of-charge application for personal
flight-simulator use only.
On first launch, a bilingual English/Chinese welcome screen identifies the
official distribution channel, warns against paid or unauthorized copies, and
offers a per-device **Do not show again / 不再显示** option.

Official binaries are published only by `skylarkning` through flightsim.to and
the [TaxiNow-Release repository](https://github.com/skylarkning/TaxiNow-Release).
TaxiNow is provided **“AS IS”**, without warranties of any kind. Source code is
not publicly available; qualified independent security or privacy experts may
request limited review access solely to verify TaxiNow's security and privacy.

Production branding assets live in
[`src/TaxiNow.Web/public/branding`](src/TaxiNow.Web/public/branding). The wide
taxiway-marker wordmark is used in the repository, app header, and About page;
the square red-over-black mark is used for the Windows executable, window, and
notification-area icon. The two generated pictures under the `concepts`
subdirectory are the source artwork; the production PNG/ICO files only crop
their surrounding white canvas and create the required output sizes.

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
  heading-oriented ownship icon and smooth SignalR/WebView animation. The icon
  is hidden when the aircraft leaves the selected airport's map perimeter.
- Simulator status is visible in the header: red when MSFS is not running,
  orange while no flight is active, and green when position is synchronized.
  Ending a flight or closing MSFS clears the last position, and the map's
  refresh control can request an immediate one-shot SimConnect position sample.
- Performance-aware telemetry uses event-driven SimConnect callbacks, bounded
  buffers, change filtering, a low-frequency health watchdog, and a one-second
  parked publish heartbeat rather than a high-rate web polling loop.
- Schema v2 validation and a schema v1 adapter.
- Visible map downloader and asset manager for ICAO, country/region, and
  optional province/state downloads, with byte-level progress, transfer speed,
  estimated time remaining, installed-map sizes, free disk space, queue
  clearing, and deletion. Country/region downloads can run 1, 2, 4, 8, or 16
  airport acquisitions in parallel, with four as the balanced default and
  source-aware throttling to avoid sending simultaneous requests to the same
  Overpass endpoint. Inline guidance explains both country codes and the
  bandwidth, resource, and source-rate-limit tradeoffs of higher concurrency.
  Source-side waits that expose no measurable byte progress use an animated
  active state and elapsed timer instead of a misleading `0%` and guessed ETA;
  percentages, speed, and ETA appear once progress becomes measurable.
- Header airport search switches among installed maps. Entering a missing
  four-character ICAO code offers an immediate download beside the search.
- Installed assets are grouped as country/region → province/state → airport,
  following the SkyCharts asset hierarchy, and folded groups retain their state
  during live download refreshes. Country/region and province/state rows can
  delete every map beneath them after confirmation.
- SQLite-backed asset catalog and atomic map replacement.
- Desktop users can choose the downloaded-map and asset-catalog folder from
  **Maps & storage**. The per-user choice persists across launches; changing it
  requires a restart, and TaxiNow leaves the previous folder untouched.
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

Create the self-contained Windows installer and portable ZIP:

```powershell
.\scripts\package-windows.ps1
```

The installer displays [`EULA.txt`](EULA.txt), detects or installs Microsoft
Edge WebView2 Evergreen, installs TaxiNow per user, and creates a matching
uninstaller. Uninstalling removes the current user's downloaded maps, asset
database, caches, settings, logs, WebView2 profile, and any custom TaxiNow data
folder carrying TaxiNow's ownership marker. Custom storage selection accepts
only an empty dedicated folder or an existing marked TaxiNow folder, preventing
the uninstaller from deleting unrelated user content.

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

For another device, use the **Access at:** address shown in the TaxiNow header.
Enter that local IP address in a phone or iPad browser; Firefox is recommended.
Both devices must be on the same trusted LAN. If Windows Firewall asks, allow
TaxiNow on **Private networks** only; do not expose port 8780 through a router
or public-network firewall profile.

The built Windows executable is:

```text
src\TaxiNow.App\bin\x64\Debug\net10.0-windows\win-x64\TaxiNow.App.exe
```

For public releases, use a signed Windows installer as the primary download and
offer a portable ZIP as a secondary option for advanced users. The installer
provides prerequisite checks, clean upgrades, shortcuts, and uninstall support;
the portable build remains useful for troubleshooting. See
[`docs/DISTRIBUTION.md`](docs/DISTRIBUTION.md).

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
