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

Current development build: **V1.4.5**, internal build **123**
(build date: August 23, 2026). The About dialog
identifies the developer, links to the official GitHub account, and clearly
states that TaxiNow is a free-of-charge application for personal
flight-simulator use only.
On first launch, a bilingual English/Chinese welcome screen identifies the
official distribution channel, warns against paid or unauthorized copies, and
offers a per-device **Do not show again / 不再显示** option.

Official binaries are published only by `skylarkning` through the
[official TaxiNow page on flightsim.to](https://flightsim.to/addon/112712/taxinow)
and the [TaxiNow-Release repository](https://github.com/skylarkning/TaxiNow-Release).
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
  runway-edge outlines, threshold bars, threshold stripes, touchdown-zone pairs,
  end-designators, taxiway centerlines, and zoom-dependent labels, informed by
  the proven SkyCharts map-drawing behavior.
- Taxiway pavement is layered below runway pavement while yellow centerlines
  remain continuous above it. Long taxiway references repeat at collision-aware
  intervals using the SkyCharts marker-density convention.
- Live MSFS 2020 and MSFS 2024 ground-position tracking through SimConnect,
  with a
  heading-oriented ownship icon and smooth SignalR/WebView animation. The icon
  is hidden when the aircraft leaves the selected airport's map perimeter.
- Simulator status is visible in the header: red when MSFS is not running,
  orange while no flight is active, and green when position is synchronized.
  Ending a flight or closing MSFS clears the last position, and the map's
  refresh control can request an immediate one-shot SimConnect position sample.
- Performance-aware telemetry uses event-driven SimConnect callbacks, bounded
  buffers, change filtering, a low-frequency health watchdog, and a one-second
  parked publish heartbeat rather than a high-rate web polling loop.
- V1.1 adds local taxi-route planning from the synchronized aircraft position
  to an individual runway end or gate/stand. The planner builds a connected
  graph from downloaded taxiway and taxilane centerlines, penalizes excessive
  turns, reversals, unnamed links, and needless taxiway changes. It also ranks
  taxiways by the number of junctions they serve so routes leave gate branches
  for well-connected main taxiways and remain on them when practical, while
  still bounding detours. The planner offers up
  to five reasonable alternatives instead of treating geometric distance as
  the only objective. Selecting an option highlights a route such as
  `Gate 105 → A → H → Q → RWY23` in blue. Guidance progressively removes
  passed route segments, presents upcoming left/right/continue cues, remaining
  distance, and an off-route warning, while reusing the existing low-overhead
  SimConnect position stream. Routing is advisory only and never overrides
  ATC instructions, airport signs, closures, or pilot judgment.
- An experimental custom-route editor accepts ordered, comma-separated
  taxiways ending in a runway or gate, for example
  `D, E, H, T1, RWY01L`. TaxiNow validates identifiers against the active map,
  highlights valid custom routes, suggests likely typo corrections, and offers
  automatic route finding when the requested sequence cannot be connected.
- V1.4 supplements custom text entry with an intersection-aware taxiway picker:
  every selection narrows the next choices to physically connected taxiways,
  and removable sequence pills make corrections immediate. Right-clicking the
  map can set a manual taxi start and destination, including while no simulator
  position is available.
- V1.4 adds persistent light and dark appearances plus optional automatic
  update checks. The update dialog shows the available version and changelog,
  links to both official download channels, or can securely fetch and launch
  the official release installer after validating its GitHub SHA-256 digest.
- V1.3 adds Korean alongside English, Simplified Chinese, Traditional Chinese,
  Japanese, French, and German; remembers the last displayed airport; and adds
  an optional heading-up map lock that follows the aircraft at the lower center
  of the screen. Arrival routing now uses the live aircraft heading to reject
  reverse runway exits and strongly avoids near-180-degree ground turns while
  retaining the preference for well-connected main taxiways.
- The language selector now lives inside a gear-shaped Settings menu. The
  Windows app can persistently keep its window above the simulator, and narrow
  headers collapse the airport name before controls can overlap.
- Schema v2 validation and a schema v1 adapter.
- Visible map downloader and asset manager for ICAO, country/region, and
  optional province/state downloads, with byte-level progress, transfer speed,
  estimated time remaining, installed-map sizes, free disk space, queue
  clearing, and deletion. Country/region downloads can run 1, 2, 4, 8, or 16
  airport acquisition workers. One is the default because public Overpass
  instances apply per-user slots and cooldowns; all public OSM requests are
  serialized across workers to prevent self-throttling. Higher worker counts
  can still overlap cache work, normalization, and fallback sources.
  Source-side waits that expose no measurable byte progress use an animated
  active state and elapsed timer instead of a misleading `0%` and guessed ETA;
  percentages, speed, and ETA appear once progress becomes measurable. Beta 4
  additionally marks a source wait as visibly stalled after 45 seconds and
  limits the complete OSM attempt to 120 seconds.
- OpenStreetMap remains the preferred detailed source. Runway-derived query
  bounds reduce unnecessary urban geometry, adaptive endpoint health avoids
  repeatedly selecting a slow service, and bundled/mirrored OurAirports
  catalogs keep catalog connection resets from aborting downloads. Named
  terminal anchors without a nearby footprint trigger a small OSM
  terminal-only repair query, while per-gate-cluster coverage detects a
  missing secondary terminal that a large main terminal would otherwise hide.
  Generic buildings are promoted only when supported by a terminal label,
  gate cluster, or connected accepted footprint. Preprocessed packs add FAA
  Airport Mapping, Overture Buildings, and Microsoft Global ML Building
  Footprints as controlled supplements. Complete parent-building outlines win
  over overlapping building parts, and reliable nearby terminal/concourse
  names are propagated to accepted unnamed footprints. X-Plane Gateway
  terminal facades remain excluded whenever a stronger footprint exists,
  preventing modular scenery pieces from replacing continuous terminals.
- English, Simplified Chinese, French, and German are selectable from the
  header. Download guidance, statuses, controls, dialogs, About/FAQ content,
  and the downloaded-asset hierarchy are localized. The first-run welcome
  remains bilingual in English and Chinese.
- Header airport search switches among installed maps. Entering a missing
  four-character ICAO code offers an immediate download beside the search.
- Installed assets are grouped as country/region → province/state → airport,
  following the SkyCharts asset hierarchy, and folded groups retain their state
  during live download refreshes. Country/region and province/state rows can
  delete every map beneath them after confirmation. Chinese provinces and
  Japanese prefectures use human-readable localized names instead of raw ISO
  subdivision codes.
- Isolated nearby-airport or heliport geometry is excluded from rendering and
  map bounds, so **Fit airport** frames the selected airport correctly.
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
  OpenStreetMap queries, FAA building supplementation, X-Plane Scenery Gateway
  operational-detail fallback, and an OurAirports runway fallback.
  Country/region and province/state downloads first use verified, resumable
  regional map packs when available, then acquire only missing airports
  on-demand. Already installed ICAOs are skipped.
- A repeatable global preprocessing planner maps the Geofabrik extract catalog
  to countries and province/state subdivisions, builds bounded ZIP shards,
  caches large source inputs, emits per-airport terminal-completeness reports,
  and records failed regions without stopping unrelated builds. Country
  downloads become fast as their generated packs are published to the official
  index; unpublished countries retain the slower on-demand fallback.
- A self-contained Windows maintainer GUI runs those builds locally, applies a
  strict no-partial/no-warning publication gate, merges the public index, and
  writes exact TaxiNow-Release upload instructions. Map-pack generation no
  longer depends on GitHub Actions.
- Official managed SimConnect integration for MSFS 2020 and MSFS 2024, plus the native x64
  C ABI spike, JSONL recorder, and deterministic replay source.

Live simulator compatibility is tracked in
[`docs/WINDOWS_ENVIRONMENT.md`](docs/WINDOWS_ENVIRONMENT.md).
The map-source quality and regional-pack direction is documented in
[`docs/architecture/ADR-0005-airport-map-source-strategy.md`](docs/architecture/ADR-0005-airport-map-source-strategy.md).

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
uninstaller. During uninstall, TaxiNow asks whether to retain downloaded maps
and user data for a later installation; retaining data is the recommended
upgrade choice. If deletion is selected, the uninstaller removes the current
user's downloaded maps, asset database, caches, settings, logs, WebView2
profile, and any custom TaxiNow data folder carrying TaxiNow's ownership
marker. Custom storage selection accepts only an empty dedicated folder or an
existing marked TaxiNow folder, preventing the uninstaller from deleting
unrelated user content.

The build packages the Python map pipeline as
`pipeline\taxinow-map-pipeline.exe`, so the desktop downloader does not require
a separate Python installation at runtime. PyInstaller is downloaded into the
ignored `artifacts` directory when needed.

Live simulator builds discover the SimConnect SDK from `MSFS_SDK_ROOT`, then
`C:\MSFS 2024 SDK`, and finally `C:\MSFS SDK`. The MSFS 2024 client library is
preferred because it has been verified live against both MSFS 2020 and MSFS
2024. The build copies the required managed wrapper and native runtime beside
TaxiNow. A build made without an SDK remains usable for maps and replay but
cannot connect to either simulator.

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

Live MSFS 2020/2024 telemetry is the default. To run without the simulator, select
the deterministic replay source:

```powershell
$env:TaxiNow__TelemetryMode = 'replay'
dotnet run --project .\src\TaxiNow.App
```

Set `TaxiNow__ReplayPath` to select another JSONL recording. Supplying a replay
path without an explicit telemetry mode also selects replay for compatibility.

## Repository layout

The implementation follows the boundaries and milestones in
[`docs/IMPLEMENTATION_HANDOFF.md`](docs/IMPLEMENTATION_HANDOFF.md). TaxiNow
V1.1 includes local taxi-route planning and live ground guidance; planned
routes remain advisory and must not be treated as ATC clearance.

## Map data

Airport geometry downloaded from OpenStreetMap is © OpenStreetMap contributors
and licensed under the ODbL 1.0. The included CYYZ regression asset retains that
attribution in its metadata and in the map UI. See [`NOTICE`](NOTICE) for data
licensing details.
