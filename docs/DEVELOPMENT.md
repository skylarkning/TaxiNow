# TaxiNow development guide

## Current vertical slice

- Build 129 adds a separate **Show SayIntentions Traffic** setting. TaxiNow
  reads the current SayIntentions `flight_id` from its documented local
  `flightJSON` endpoint, then retrieves that flight's injected traffic from the
  official SayIntentions Tracker so labels use real callsigns instead of MSFS
  `AI-<object-id>` placeholders. Positions are matched back to SimConnect object
  IDs when possible for one-second movement. VATSIM, BeyondATC, and
  SayIntentions are mutually exclusive: selecting one turns the other two off.
  References: [SayIntentions API documentation](https://p2.sayintentions.ai/p2/docs/)
  and [official Tracker](https://tracker.sayintentions.ai/).
- V1.6 adds a separate, per-device **Show BeyondATC Traffic** setting. TaxiNow
  reads nearby non-user aircraft directly from MSFS through SimConnect once per
  second and draws them as smaller violet aircraft with callsign labels. This
  follows BeyondATC's supported setup, where MSFS traffic and other injectors
  are disabled; SimConnect does not identify which client created an aircraft,
  so TaxiNow deliberately treats all simulator AI aircraft as BeyondATC traffic
  while this setting is enabled.
- V1.5.1 can optionally display nearby live VATSIM traffic. TaxiNow retrieves the
  official public network-data feed through its local PC service, refreshes a
  shared cache at the feed's 15-second cadence, and sends only anonymous
  aircraft fields within the selected airport area to desktop and iPad maps.
  The user's MSFS aircraft remains cyan; VATSIM aircraft use smaller orange
  versions of the same plane silhouette with an upright callsign label below
  each icon. The setting is off by default and is stored independently on each
  browser/device.
- Build 126 documents VATSIM's approximately 15-second traffic-data refresh
  cadence in the FAQ. Customized taxi routes now accept commas, spaces, or a
  mixture of both as separators, while preserving destinations such as
  `GATE B19`.
- Build 127 restores aircraft tracking automatically after a legitimate
  long-distance telemetry gap, so a destination-airport position no longer
  requires restarting TaxiNow. When the aircraft is on the ground outside the
  selected map, TaxiNow identifies the nearest airport and switches to its
  downloaded map. If that map is missing, the airport picker opens with a clear
  download prompt; a completed download opens automatically.
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
- Live MSFS 2020/2024 tracking through SimConnect and X-Plane 12 tracking through its local UDP DataRef interface,
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
- An experimental custom-route editor accepts ordered taxiways separated by
  commas or spaces and ending in a runway or gate, for example
  `D E H T1 RWY01L`. TaxiNow validates identifiers against the active map,
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
[`docs/WINDOWS_ENVIRONMENT.md`](../docs/WINDOWS_ENVIRONMENT.md).
The map-source quality and regional-pack direction is documented in
[`docs/architecture/ADR-0005-airport-map-source-strategy.md`](../docs/architecture/ADR-0005-airport-map-source-strategy.md).

## Build

```powershell
.\scripts\build.ps1
```

Create the self-contained Windows installer and portable ZIP:

```powershell
.\scripts\package-windows.ps1
```

The installer displays [`EULA.txt`](../EULA.txt), detects or installs Microsoft
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
Minimizing keeps TaxiNow in the taskbar by default. Enable **Minimize to tray**
in Settings to hide the window in the Windows notification area instead; this
preference is remembered on the PC.

In TAXI, the heading-up aircraft control continuously follows both position and
heading, including when the aircraft moves outside the current view. In MAP,
the **Follow aircraft** button beside **Locate aircraft** enables continuous
position and heading follow; **Locate aircraft** remains a one-time action.

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
[`docs/DISTRIBUTION.md`](../docs/DISTRIBUTION.md).

Live MSFS 2020/2024 telemetry is the default. To run without the simulator, select
the deterministic replay source:

```powershell
$env:TaxiNow__TelemetryMode = 'replay'
dotnet run --project .\src\TaxiNow.App
```

Set `TaxiNow__ReplayPath` to select another JSONL recording. Supplying a replay
path without an explicit telemetry mode also selects replay for compatibility.

## MAP vertical profile

In **MAP**, select **PROFILE** below TAXI to open the route's vertical profile.
Import or restore a SimBrief plan to see terrain, the planned altitude path,
available waypoint restrictions, and departure/arrival elevations. Paths inferred
from cruise altitude are labelled **Estimated**. The profile fills the MAP main
region on desktop and mobile, hiding the map and its overlays while keeping the
top bar and MAP/TAXI/PROFILE rail available. Closing it restores the map. It
remembers its open state for the browser session; TAXI keeps the existing FROM,
TO, and Plan Taxi controls. On screens up to 620 px wide it starts collapsed.

Terrain is acquired online from Open-Meteo and cached locally for 30 days.
If a refresh fails, an existing profile remains visible as **Cached / offline**;
without a cache, the planned path remains available with a terrain-unavailable
message and Retry. Attribution: **Elevation: Open-Meteo · Copernicus DEM**
(90-metre DEM). The service endpoint and optional API key can be configured with
`TaxiNow__Elevation__BaseUrl` and `TaxiNow__Elevation__ApiKey`; commercial use
requires an appropriately licensed endpoint or a compatible self-hosted service.

MSFS 2020/2024 supplies MSL and AGL altitude through SimConnect; X-Plane 12
supplies the corresponding altitude data through UDP, converted from metres to
feet. A disconnected, stale, or invalid simulator position hides the aircraft
marker while retaining the route and terrain. Terrain colours and clearance
values are **simulation advisories only**, not certified terrain avoidance or
real-world navigation guidance.

## Repository layout

The implementation follows the boundaries and milestones in
[`docs/IMPLEMENTATION_HANDOFF.md`](../docs/IMPLEMENTATION_HANDOFF.md). TaxiNow
V1.1 includes local taxi-route planning and live ground guidance; planned
routes remain advisory and must not be treated as ATC clearance.

## Map data

Airport geometry downloaded from OpenStreetMap is © OpenStreetMap contributors
and licensed under the ODbL 1.0. The included CYYZ regression asset retains that
attribution in its metadata and in the map UI. See [`NOTICE`](../NOTICE) for data
licensing details.
