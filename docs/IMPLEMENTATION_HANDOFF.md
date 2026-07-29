# TaxiNow — Windows Implementation Handoff

## Paste this into Codex on the Windows PC

> You are continuing development of **TaxiNow**, repository
> `https://github.com/skylarkning/TaxiNow.git`.
>
> Read this entire document before changing code. Treat the requirements,
> architecture decisions, scope boundaries, milestones, and acceptance criteria
> below as the project specification.
>
> Start by verifying the local Windows development environment and the installed
> Microsoft Flight Simulator 2020 and 2024 SDKs. Run the official SimConnect
> Open/Close, Request Data, and Facility Data samples against both simulators.
> Record the discovered SDK paths and compatibility findings in
> `docs/WINDOWS_ENVIRONMENT.md`.
>
> Then implement Milestone 0 and Milestone 1. Also create the native SimConnect
> bridge spike and telemetry recorder from Milestone 2 early enough to remove
> integration uncertainty. Do not begin taxi-route pathfinding. Do not redesign
> the architecture without recording the reason and trade-off in an ADR.
>
> Prefer a working vertical slice over disconnected scaffolding: the first slice
> should launch the Windows app, display a bundled sample airport map in both the
> embedded desktop view and a browser, and move a synthetic aircraft icon using
> replay telemetry.
>
> After every iteration: build, run relevant automated tests, launch the app, and
> report exactly what is functional, what remains simulated, and what still
> requires testing in MSFS 2020 or MSFS 2024.

---

## 1. Project summary

**Product name:** TaxiNow  
**Repository:** <https://github.com/skylarkning/TaxiNow.git>  
**Primary platform:** Windows 10/11, x64  
**Simulator support:** Microsoft Flight Simulator 2020 and Microsoft Flight
Simulator 2024  
**Initial release type:** Desktop application with an optional local-network web
view

TaxiNow is a ground-navigation map for Microsoft Flight Simulator. It displays a
vector airport map containing runways, taxiways, aprons, terminals, gates, and
parking stands. While the aircraft is on the ground, a directional aircraft
symbol moves across the map using the simulator's live latitude, longitude, and
heading.

TaxiNow is deliberately focused. It is not a chart viewer, flight planner,
airborne navigation system, or traffic display. Taxi-route calculation is a
future feature and must not block the initial map application.

### 1.1 Core user experience

1. The user launches TaxiNow on the same Windows PC as MSFS.
2. TaxiNow connects automatically to either MSFS 2020 or MSFS 2024 through
   SimConnect.
3. When the aircraft is on the ground, TaxiNow selects the nearby installed
   airport and opens its map.
4. A small aircraft icon appears at the correct geographic position and points
   in the aircraft's true heading.
5. The user can pan, zoom, fit the airport, or manually choose another airport.
6. The same live map can optionally be opened on a tablet, laptop, or other
   device on the local network.
7. The user can download airport maps by ICAO code or ISO 3166-1
   country/region, inspect their storage usage, refresh them, and delete them.

## 2. Scope

### 2.1 Required for the first functional release

- Windows desktop GUI.
- Compatibility with MSFS 2020 and MSFS 2024.
- Live user-aircraft latitude, longitude, true heading, ground state, and ground
  velocity through SimConnect.
- Ground-only tracking.
- Vector airport maps with:
  - runways and runway identifiers;
  - taxiway pavement and centerlines;
  - repeated, collision-aware taxiway labels;
  - aprons;
  - parking positions and gates;
  - terminal and hangar polygons where available;
  - zoom-dependent levels of detail.
- Automatic nearby-airport selection with manual override.
- Offline airport-map storage.
- Downloads by ICAO code and country/region.
- Download progress, cancellation, retry, and cache reuse.
- Content manager with size at airport and hierarchy levels, total TaxiNow
  storage, and free disk space.
- Embedded map in the Windows client.
- Optional browser view served by the Windows client.
- Smooth aircraft animation even when simulator samples arrive slower than the
  display frame rate.
- Clear source attribution and data provenance.

### 2.2 Explicitly out of scope until the map application is stable

- Taxi-route/pathfinding calculation.
- Turn-by-turn taxi instructions.
- ATC clearance parsing.
- AI or multiplayer traffic.
- NOTAM/runway-closure services.
- Approach, departure, en-route, or other aviation charts.
- Microsoft Flight Planner login, cookies, chart APIs, or chart downloads.
- Airborne map tracking.
- Native iOS or Android applications.
- Internet-facing hosting or cloud accounts.

## 3. What can be reused from SkyCharts

TaxiNow should reuse the proven data concepts from SkyCharts, but it should not
port the legacy iOS/UIKit renderer.

### 3.1 Reusable technology and behavior

- OpenStreetMap/Overpass airport acquisition.
- X-Plane Scenery Gateway fallback acquisition.
- OurAirports catalog and runway fallback.
- Source prioritization and quality checks.
- ISO 3166-1 country/region airport selection.
- Normalized airport feature schema.
- Positive and negative caching.
- Concurrent downloads with rate limiting and backoff.
- Airport-map bundling and metadata.
- Zoom-dependent feature visibility.
- Collision-aware labels.
- Repeated labels along long taxiways.
- Runway drawing concepts.
- Terminal, stand, and taxiway label categorization.
- Hierarchical content management and storage aggregation.

### 3.2 Technology that should be replaced

- Objective-C and UIKit.
- iOS 6 custom drawing and scroll-view behavior.
- DEB/IPA packaging.
- The Mac pack-agent transfer flow.
- Chart packages and Microsoft Flight Planner authentication.

TaxiNow should have one modern renderer shared by the embedded desktop view and
the local-network browser view. This avoids implementing two map engines and
keeps their behavior identical.

## 4. Architecture decisions

### 4.1 Desktop and service host

Use:

- **.NET 10 LTS**, x64;
- **WPF** for the Windows shell and native dialogs;
- **ASP.NET Core/Kestrel** hosted in the desktop process for REST, SignalR, and
  static web assets;
- **WebView2CompositionControl** for the embedded browser;
- **TypeScript + Vite + MapLibre GL JS** for the airport-map renderer;
- **SQLite** for the airport catalog, asset metadata, jobs, settings, and source
  history.

.NET 10 is an active LTS release in the intended development period. WPF gives
TaxiNow a straightforward Windows-native shell, while WebView2 allows the same
GPU-accelerated web renderer to run in both the application and ordinary LAN
browsers. The composition control should be preferred because it avoids common
WPF/WebView airspace limitations.

### 4.2 SimConnect compatibility layer

Use a small **native C++ x64 SimConnect bridge DLL** with a narrow C ABI, called
from .NET by P/Invoke.

Reasons:

- Microsoft officially documents C/C++ and managed out-of-process clients, but
  its documented managed wrapper targets .NET Framework and is installed in the
  Global Assembly Cache.
- TaxiNow should use a current supported .NET runtime without relying on an
  undocumented .NET Framework wrapper-loading behavior.
- Both simulator generations expose a common SimConnect C/C++ subset suitable
  for the required telemetry.
- SimConnect is not thread-safe. The bridge can enforce a single owner thread
  and present thread-safe snapshots to the application.
- Native SDK paths and library differences are isolated from the rest of the
  codebase.

If the bridge cannot be made compatible with both simulators during the initial
Windows spike, the approved fallback is a small .NET Framework 4.7.2 helper
process using Microsoft's managed wrapper and a versioned named-pipe protocol.
Do not mix simulator calls directly into WPF view models.

### 4.3 Shared map renderer

Use MapLibre GL JS with no external basemap. TaxiNow renders its own offline
airport geometry from GeoJSON:

- line and fill layers for runways, taxiways, aprons, and buildings;
- symbol layers for runway, taxiway, terminal, gate, and stand labels;
- line-placement symbols for repeated taxiway labels;
- zoom expressions for LOD and label sizing;
- collision handling;
- a dedicated, frequently updated source/layer for the ownship icon.

The embedded desktop map and the LAN map must load the same compiled SPA and
the same API. Platform-specific UI remains outside the map surface.

### 4.4 Airport data pipeline

For fastest delivery, refactor the SkyCharts Python airport-map generator into a
standalone `tools/map_pipeline` component and package it as a Windows executable
with PyInstaller. End users must not need Python installed.

The .NET application launches the pipeline through a versioned JSON-lines
protocol, captures progress and cancellation, validates output, and imports the
result into the local store. A C# rewrite is not required for the first release.

## 5. SimConnect design

### 5.1 Connection behavior

TaxiNow must:

- connect automatically after launch;
- detect whether MSFS 2020 or MSFS 2024 accepted the connection;
- survive simulator startup after TaxiNow;
- survive simulator shutdown and restart;
- reconnect with bounded exponential backoff;
- show a non-blocking status: Disconnected, Connecting, Connected, Airborne,
  Ground Tracking, or Reconnecting;
- never freeze the UI while waiting for SimConnect.

Maintain exactly one SimConnect owner thread. It opens the connection, dispatches
messages, records the latest sample, and handles reconnects. No other thread may
call SimConnect directly.

### 5.2 Minimum telemetry

Define these variables using explicit units and numeric types:

| Sim variable | Unit | Suggested type | Use |
|---|---|---:|---|
| `PLANE LATITUDE` | degrees | `FLOAT64` | ownship coordinate |
| `PLANE LONGITUDE` | degrees | `FLOAT64` | ownship coordinate |
| `PLANE HEADING DEGREES TRUE` | degrees | `FLOAT64` | icon rotation |
| `SIM ON GROUND` | bool/number | `INT32` | ground-only mode |
| `GROUND VELOCITY` | knots | `FLOAT64` | smoothing and status |

Verify whether `IS ON GROUND` offers better cross-version behavior during the
Windows compatibility spike. Use only variables confirmed against both
simulators in production.

Request the user aircraft with `SIMCONNECT_OBJECT_ID_USER`. Start with
`SIMCONNECT_PERIOD_VISUAL_FRAME` or `SIMCONNECT_PERIOD_SIM_FRAME`, then store only
the latest sample. The web clients do not need every simulator callback.

### 5.3 Telemetry publication

- Publish snapshots to SignalR at 10–20 Hz.
- Include a monotonic source timestamp and server timestamp.
- Do not rebuild or resend airport geometry for telemetry changes.
- Browser clients retain two recent samples and interpolate with
  `requestAnimationFrame`.
- Render at the display refresh rate, targeting 60 frames per second.
- Use a small interpolation delay, approximately 100 ms, to absorb jitter.
- Limit extrapolation to approximately 250 ms.
- Reject impossible coordinate jumps and stale samples.
- Normalize headings across 0/360 degrees using shortest-arc interpolation.

Example telemetry contract:

```json
{
  "sequence": 18342,
  "simulator": "MSFS2024",
  "connected": true,
  "onGround": true,
  "latitude": 43.676217,
  "longitude": -79.630612,
  "trueHeadingDegrees": 237.4,
  "groundSpeedKnots": 14.2,
  "sourceTimestampUtc": "2026-07-29T19:41:12.414Z",
  "serverTimestampUtc": "2026-07-29T19:41:12.419Z"
}
```

### 5.4 Ground-only rules

- Show live tracking only while the aircraft is reported on the ground.
- When it becomes airborne, retain the last airport map but hide or dim the
  ownship and show `Airborne — ground tracking paused`.
- Require several consecutive on-ground samples before resuming to avoid state
  flicker.
- Do not auto-switch airports while airborne.

## 6. Simulator-derived airport geometry

SimConnect Facility Data can expose the airport layout installed in the user's
simulator, including runways, taxi points, taxi paths, taxi names, taxi parking,
jetways, and, in the 2024 API, additional pavement data.

This source is valuable because it can align TaxiNow with the user's installed
simulator scenery better than a public database. It should be introduced after
the core public-source downloader works.

### 6.1 Source priority

Use this order:

1. **SimConnect Facility Data**, when the simulator is connected and the current
   airport is requested. Prefer it for runways, taxi points/paths, parking, and
   simulator-specific layout.
2. **OpenStreetMap**, especially for terminal, hangar, apron, and building
   polygons and for offline downloads.
3. **X-Plane Scenery Gateway**, when OSM lacks adequate operational geometry.
4. **OurAirports**, for catalog data and runway fallback.

Merge complementary sources rather than discarding a complete OSM terminal
polygon merely because SimConnect supplied taxi paths. Every output feature must
retain its source.

### 6.2 Practical constraint

Do not request simulator facility data for an entire country during a bulk
download. That would be slow and would require the simulator to be running.
Country/region downloads should use the existing public-source pipeline.

When a user loads or tracks at an airport, TaxiNow may offer or automatically
perform a lightweight `Refine from simulator` update. Cache it with simulator
edition, simulator build, retrieval date, and airport ICAO. Provide an explicit
refresh command because third-party scenery can change.

### 6.3 Facility-data spike

The Windows spike must prove:

- a facility definition can request an airport and child runway/taxi data;
- coordinates or local biases can be converted accurately to WGS84;
- taxi names can be joined to taxi paths;
- both MSFS versions return compatible structures for the chosen common subset;
- the query does not block the UI;
- malformed or partial facilities fall back safely.

## 7. Airport selection

### 7.1 Automatic selection

Build a spatial index from installed airport centers and bounds. SQLite R*Tree is
acceptable.

While on the ground:

1. Find airports whose expanded bounds contain the aircraft.
2. Rank by containment, distance to airport reference point, and map quality.
3. Select the best candidate.
4. Use hysteresis so nearby airports do not cause rapid switching.
5. Keep the selected airport until the aircraft clearly leaves its expanded
   boundary or the user overrides it.

If no installed map matches, display the nearest airport and offer a download.
Do not silently begin large country downloads.

### 7.2 Manual selection

The user can search by ICAO, airport name, or municipality. Manual selection
temporarily disables automatic switching until `Resume automatic selection` is
chosen.

## 8. Airport-map data model

Use schema version 2 for TaxiNow. Maintain a reader/adaptor for SkyCharts schema
version 1 so existing test maps can be imported.

```json
{
  "schemaVersion": 2,
  "airport": {
    "icao": "CYYZ",
    "name": "Toronto Pearson International Airport",
    "countryCode": "CA",
    "regionCode": "CA-ON",
    "municipality": "Toronto",
    "center": [-79.6306, 43.6762],
    "bounds": {
      "minLon": -79.675,
      "maxLon": -79.585,
      "minLat": 43.645,
      "maxLat": 43.705
    }
  },
  "generatedAt": "2026-07-29T19:30:00Z",
  "sources": [
    {
      "name": "OpenStreetMap",
      "url": "https://www.openstreetmap.org/",
      "license": "ODbL 1.0",
      "retrievedAt": "2026-07-29T19:29:00Z",
      "revision": "optional-revision"
    }
  ],
  "counts": {
    "runways": 5,
    "taxiways": 400,
    "stands": 250,
    "terminals": 2
  },
  "features": [
    {
      "id": "source-stable-or-generated-id",
      "kind": "taxiway",
      "points": [[-79.6306, 43.6762], [-79.6301, 43.6767]],
      "ref": "A",
      "name": null,
      "surface": "asphalt",
      "widthMeters": 23.0,
      "headingDegrees": null,
      "closed": false,
      "source": "OpenStreetMap"
    }
  ]
}
```

Supported `kind` values initially:

- `runway`
- `taxiway`
- `taxilane`
- `apron`
- `parking_position`
- `gate`
- `holding_position`
- `terminal`
- `hangar`
- `jetway`
- `pavement`

Use longitude, latitude order consistently in serialized geometry and GeoJSON.
Validate coordinate ranges and reject maps whose bounds or feature counts are
obviously invalid.

## 9. Map rendering and UX

### 9.1 Default view

- North-up by default.
- Fit the full airport on first load.
- The map must be centered after layout completes, not at the top-left.
- A `Fit Airport` button restores this view.
- Preserve the user's zoom and center when transient panels open.
- A later `Track Up` option is allowed but not required for the MVP.

### 9.2 Ownship

- Use a compact airplane silhouette with a clearly visible nose.
- Anchor it precisely at the telemetry coordinate.
- Rotate it using true heading.
- Keep the on-screen symbol approximately constant in pixel size across zoom
  levels; do not let it become enormous.
- Apply a halo or contrasting outline for legibility.
- Keep it above airport geometry but below modal UI.
- Display a subtle stale/disconnected treatment if telemetry stops.

### 9.3 Level of detail

At whole-airport zoom:

- runways and runway numbers;
- major taxiway pavement and repeated taxiway identifiers;
- terminal names;
- ownship;
- no individual stand numbers unless density permits.

At medium zoom:

- all relevant taxiway identifiers;
- terminal/hangar detail;
- major apron names;
- selected stand groups.

At close zoom:

- gates and parking stand labels;
- taxilanes;
- holding positions;
- jetways where available.

Use smooth opacity and size expressions between zoom thresholds. Do not destroy
and recreate label views during pan or zoom. MapLibre symbols must move with map
coordinates continuously and take part in the same transform as the geometry.

### 9.4 Taxiway labels

- Use line placement where geometry permits.
- Repeat identifiers along long taxiways at a controlled screen-space interval.
- Keep labels upright and collision-aware.
- Give every named major taxiway a chance to place at least one label.
- Do not place labels on every tiny disconnected segment.
- At intersections, prefer the dominant/longer segment and avoid overlapping
  stand or runway labels.

### 9.5 Performance

Targets:

- 60 FPS local animation on a typical current Windows gaming PC.
- Cached airport visible in under 2 seconds.
- Telemetry-to-LAN-display p95 latency below 250 ms on a healthy local network.
- Idle CPU below approximately 5% when connected and not interacting.
- Smooth behavior on large airports with several thousand features.

Techniques:

- split static geometry and dynamic ownship into different sources;
- update only ownship properties on telemetry changes;
- generate simplified geometry levels during import;
- avoid repeated JSON parsing;
- use a Web Worker for expensive conversion;
- debounce non-visual UI updates;
- cap telemetry publication while preserving rendering interpolation;
- keep label collision work zoom-dependent;
- use gzip/Brotli for map responses;
- reuse buffers and immutable style layers.

## 10. Downloader and caching

### 10.1 Download modes

**By ICAO**

- validate and normalize the ICAO;
- show airport name and country/region before download;
- download or reuse each source;
- generate one normalized asset;
- report source, feature counts, size, and warnings.

**By country/region**

- use ISO 3166-1 alpha-2 selection;
- enumerate airports from the maintained catalog;
- let the user choose all, major airports, or a maximum count;
- show estimated airport count and available space;
- process with bounded concurrency;
- skip known negative-cache entries quickly;
- allow cancellation and resume.

### 10.2 Cache behavior

- Cache source responses separately from normalized assets.
- Reuse unchanged source data.
- Support positive and negative cache entries.
- Negative entries need a reason and retry-after time.
- Distinguish `no suitable data` from transient network failure.
- Apply exponential backoff and endpoint cooldown for Overpass failures.
- Do not hammer several Overpass instances independently for every feature type.
- Validate output before replacing a previously working map.
- Write downloads atomically through a temporary file and rename.
- Preserve old assets if refresh fails.

### 10.3 Progress

Every job reports:

- phase;
- airports completed/total;
- bytes written when known;
- current ICAO;
- percentage;
- elapsed time;
- estimated remaining time after enough samples exist;
- current source;
- warnings and skipped airports.

## 11. Storage and content manager

Default root:

```text
%LOCALAPPDATA%\TaxiNow\
  TaxiNow.db
  maps\
    CYYZ.json.gz
  source-cache\
  pipeline\
  web\
  logs\
```

Suggested SQLite tables:

- `airports`
- `map_assets`
- `asset_sources`
- `source_attempts`
- `download_jobs`
- `settings`
- `telemetry_sessions` (optional, opt-in diagnostic recording)

The asset manager should display:

```text
Continent
  Country/Region
    State/Province
      City
        ICAO — Airport Name
```

Each level shows total installed size and airport count. The page also shows:

- total TaxiNow storage;
- available disk space;
- last update;
- source mix;
- map quality/warnings.

Deletion at any level must clearly state how many airports and bytes will be
removed. Remove database rows and files transactionally where practical.

## 12. Local and LAN web access

### 12.1 Correct terminology

`localhost` works only on the Windows PC itself. TaxiNow now also listens on
the PC's active RFC 1918 private LAN interfaces and shows the preferred address
in the header for another device on the same trusted network.

### 12.2 Default behavior

- Bind to loopback and active RFC 1918 private interfaces only.
- Use configurable port 8780 by default.
- The embedded WebView uses this same local URL.
- Show the routed private address first and list alternate private addresses in
  status metadata.

### 12.3 LAN mode

For the current trusted-LAN vertical slice:

- bind only to suitable private interfaces, not a public or cloud interface;
- show the usable URL and a QR code;
- require a high-entropy session token;
- prompt before creating a Windows Firewall rule;
- restrict accepted origins and Host headers;
- do not use UPnP or automatic router port forwarding;
- do not expose SimConnect directly;
- provide `Disable LAN access` and `Regenerate access token`;
- document that LAN mode is for trusted networks.

Session tokens, a QR-code pairing flow, and the LAN enable/disable control
remain security-hardening follow-ups. Until those land, Windows Firewall access
must be limited to the Private profile and users must not forward the port.

Kestrel serves:

- compiled static SPA assets;
- REST endpoints;
- the SignalR telemetry hub.

SignalR is preferred over a custom WebSocket protocol because it provides
connection management and fallback behavior. The actual telemetry contract must
remain versioned and transport-independent.

## 13. HTTP and SignalR contract

Initial REST API:

```text
GET    /api/v1/status
GET    /api/v1/telemetry
GET    /api/v1/airports?query=CYYZ
GET    /api/v1/airports/{icao}
GET    /api/v1/airports/{icao}/map
POST   /api/v1/downloads
GET    /api/v1/downloads
GET    /api/v1/downloads/{jobId}
POST   /api/v1/downloads/{jobId}/cancel
DELETE /api/v1/downloads/completed
DELETE /api/v1/assets/{icao}
GET    /api/v1/storage
```

SignalR:

```text
/hubs/telemetry
```

Events:

- `TelemetryUpdated`
- `ConnectionStateChanged`
- `SelectedAirportChanged`
- `DownloadJobUpdated`

Use OpenAPI for REST. Keep response DTOs separate from SQLite entities and
SimConnect structs.

## 14. Repository structure

```text
TaxiNow.sln
README.md
LICENSE
docs/
  IMPLEMENTATION_HANDOFF.md
  WINDOWS_ENVIRONMENT.md
  architecture/
    ADR-0001-shared-web-renderer.md
    ADR-0002-native-simconnect-bridge.md
src/
  TaxiNow.App/
    WPF shell, view models, dialogs, WebView2 host
  TaxiNow.Core/
    domain models, airport selection, telemetry smoothing
  TaxiNow.Server/
    Kestrel, REST, SignalR, static SPA hosting
  TaxiNow.SimConnect.Native/
    native C++ x64 bridge
  TaxiNow.SimConnect/
    managed bridge wrapper and reconnection service
  TaxiNow.Storage/
    SQLite, asset store, migrations, spatial index
  TaxiNow.Pipeline/
    process protocol and map import validation
  TaxiNow.Web/
    TypeScript, Vite, MapLibre renderer
tools/
  map_pipeline/
    refactored SkyCharts Python acquisition and normalization
tests/
  TaxiNow.Core.Tests/
  TaxiNow.Server.Tests/
  TaxiNow.Storage.Tests/
  TaxiNow.Web.Tests/
  TaxiNow.Integration.Tests/
  fixtures/
    airport-maps/
    telemetry/
```

Keep boundaries strict:

- `Core` knows neither WPF nor SimConnect.
- `Server` consumes application services, not native structs.
- `Web` consumes versioned HTTP/SignalR contracts.
- `Storage` does not render maps.
- `SimConnect.Native` has no GUI or web behavior.

## 15. Testing strategy

### 15.1 Replay mode

Replay mode is required. It makes most development and automated testing
possible without launching a simulator and allows work to continue on macOS or
CI.

A telemetry recorder writes timestamped JSON Lines:

```json
{"tMs":0,"lat":43.6762,"lon":-79.6306,"heading":237.4,"groundSpeed":0,"onGround":true}
{"tMs":100,"lat":43.67619,"lon":-79.63065,"heading":238.1,"groundSpeed":4.5,"onGround":true}
```

Replay supports:

- real time;
- 0.5×, 1×, 2×;
- looping;
- deliberate packet gaps;
- a transition to airborne;
- impossible-jump test cases.

### 15.2 Automated tests

At minimum:

- schema v1-to-v2 import;
- coordinate validation;
- bounds and fit calculations;
- heading interpolation across 359°/0°;
- telemetry smoothing and stale state;
- ground-only state transitions;
- automatic airport selection and hysteresis;
- map-source merge precedence;
- atomic asset replacement;
- cache reuse and negative-cache expiry;
- size aggregation and cascading deletion;
- REST authorization in LAN mode;
- SignalR contract serialization;
- web ownship interpolation;
- representative large-airport render benchmark.

### 15.3 Live compatibility matrix

Test on the Windows PC:

| Test | MSFS 2020 | MSFS 2024 |
|---|---:|---:|
| connect before simulator starts | required | required |
| connect after simulator starts | required | required |
| latitude/longitude/heading | required | required |
| on-ground state | required | required |
| simulator restart/reconnect | required | required |
| facility airport/runway data | required | required |
| facility taxi/parking data | required | required |
| third-party airport scenery | required | required |
| pause/menu behavior | required | required |

Record simulator versions and SDK versions with test results.

## 16. Milestones and acceptance criteria

### Milestone 0 — Bootstrap and architectural spike

Deliver:

- repository and solution structure;
- WPF shell;
- Kestrel host;
- embedded WebView2;
- SPA loaded in desktop and ordinary browser;
- bundled sample airport;
- synthetic/replay aircraft movement;
- CI build and unit tests;
- native SimConnect connection spike against both simulators.

Accept when:

- one command builds the solution;
- the desktop app opens the sample map centered and fitted;
- a browser on the same PC shows the same map;
- replay moves and rotates the aircraft smoothly;
- Windows environment findings are documented;
- both simulators have accepted a basic SimConnect client.

### Milestone 1 — Offline map viewer and asset management

Deliver:

- schema v2;
- v1 importer;
- GeoJSON conversion;
- MapLibre style and LOD;
- refactored map pipeline;
- ICAO downloads;
- country/region downloads;
- SQLite catalog;
- content manager and storage calculations.

Accept when:

- at least CYYZ, KJFK, ZBAA, ZGGG, VHHH, CYVR, and CYUL can be used as
  regression fixtures where source data exists;
- maps remain smooth and labels move correctly during zoom and pan;
- cached assets work offline;
- deleting one airport or a hierarchy updates database and disk usage;
- downloads reuse cache and report ETA.

### Milestone 2 — Live ownship tracking

Deliver:

- production native bridge;
- reconnect service;
- live telemetry;
- recorder and replay;
- ground-only state;
- automatic airport selection.

Accept when:

- live aircraft tracks correctly while taxiing in both simulator versions;
- icon direction agrees with simulator heading;
- simulator restart does not require TaxiNow restart;
- airborne state pauses tracking;
- no simulator callback runs on the UI thread;
- recorded telemetry reproduces the same map movement.

### Milestone 3 — Simulator facility refinement

Deliver:

- airport facility query;
- runway/taxi/parking conversion;
- source merge;
- refresh command;
- simulator/scenery provenance.

Accept when:

- a selected airport can be refined from installed simulator scenery;
- results align with the simulator at tested default and third-party airports;
- missing terminal polygons can still come from OSM/X-Plane;
- failed or partial facility requests retain the previous working map.

### Milestone 4 — Secure LAN view

Deliver:

- opt-in LAN binding;
- access token;
- QR code;
- firewall workflow;
- origin/host validation;
- remote responsive UI.

Accept when:

- a tablet on the same LAN opens the map and receives live telemetry;
- the server is loopback-only by default;
- an invalid/missing token cannot access map or telemetry endpoints;
- disabling LAN mode immediately removes remote access;
- no internet or router exposure is configured.

### Milestone 5 — Reliability and packaging

Deliver:

- self-contained Windows x64 package;
- WebView2 runtime check/bootstrap;
- logs and diagnostics export;
- crash recovery;
- update-safe data migrations;
- user guide.

Start with a self-contained ZIP for testing. Use WiX v4/MSI or MSIX only after
the application architecture is stable.

Accept when:

- a clean Windows machine can install and run TaxiNow without a developer SDK;
- user map assets survive application upgrades;
- uninstall behavior clearly offers to retain or delete map data;
- SDK files are not redistributed improperly;
- license notices and OSM attribution are visible.

## 17. Windows development prerequisites

Install or verify:

- Visual Studio 2022 with:
  - .NET desktop development;
  - ASP.NET and web development;
  - Desktop development with C++;
- .NET 10 SDK;
- Microsoft Edge WebView2 Runtime;
- Node.js LTS and Corepack/pnpm;
- Python 3.12 or 3.13;
- PyInstaller for pipeline packaging;
- Git;
- MSFS 2020 SDK;
- MSFS 2024 SDK.

Install the simulator SDKs through each simulator's Developer Mode workflow.
Do not guess SDK include/lib/runtime locations. Record the actual paths on the
Windows PC.

## 18. First Windows session checklist

1. Clone `https://github.com/skylarkning/TaxiNow.git`.
2. Copy this file to `docs/IMPLEMENTATION_HANDOFF.md`.
3. Record installed tool versions.
4. Locate both MSFS SDKs.
5. Build the official SimConnect Open/Close sample for x64.
6. Run it against MSFS 2020.
7. Run it against MSFS 2024.
8. Build a Request Data sample for the five required variables.
9. Verify units and struct packing in both simulators.
10. Build a Facility Data Definition sample and inspect runway, taxi, parking,
    and taxi-name data from one airport.
11. Record DLL, header, library, and runtime-loading behavior.
12. Scaffold the solution and replay vertical slice.
13. Create the native bridge C ABI.
14. Commit the environment document and spike results before expanding features.

## 19. Risks and mitigations

### Native SimConnect compatibility

**Risk:** MSFS 2020 and 2024 SDK libraries or structures differ.  
**Mitigation:** use the smallest verified common C API, isolate version-specific
code, and test both simulators immediately.

### Managed wrapper/runtime mismatch

**Risk:** Microsoft's managed wrapper is documented for .NET Framework, not
modern .NET.  
**Mitigation:** native bridge; net48 helper process only as fallback.

### Public-source map gaps

**Risk:** OSM and X-Plane may omit stands, terminals, or taxiway names.  
**Mitigation:** merge sources, use simulator facility data for current-airport
operational geometry, expose provenance and quality warnings.

### Overpass availability and rate limiting

**Risk:** bulk downloads can cause timeouts or refusal.  
**Mitigation:** bounded concurrency, combined queries, endpoint cooldown,
backoff, positive/negative cache, resume.

### Renderer load at large airports

**Risk:** thousands of labels reduce frame rate.  
**Mitigation:** GPU web renderer, zoom LOD, collision control, pre-simplified
geometry, worker conversion, dynamic-ownship isolation.

### LAN exposure

**Risk:** a local server can unintentionally expose data.  
**Mitigation:** loopback by default, explicit opt-in, token, private-interface
binding, no UPnP, firewall confirmation, origin/host validation.

### Data licensing

**Risk:** combining or redistributing source databases creates attribution or
share-alike obligations.  
**Mitigation:** store feature provenance, ship license notices, show OSM
attribution, review X-Plane Gateway terms before distributing cached data, and
avoid bundling a large prebuilt map database until licensing is reviewed.

## 20. Data and product policies

- Airport maps are for flight simulation use and are not for real-world
  navigation.
- Do not claim affiliation with Microsoft, Jeppesen, Navigraph, Laminar
  Research, or OpenStreetMap.
- Show `© OpenStreetMap contributors` when OSM-derived features are displayed.
- OurAirports states that its downloadable data is public domain, but retain
  provenance anyway.
- Review X-Plane Gateway redistribution terms before distributing generated
  data in releases.
- Do not transmit simulator telemetry outside the PC or local network without a
  later explicit user-controlled feature.
- Do not collect telemetry analytics by default.
- Diagnostic recordings must be opt-in and easy to delete.

## 21. Future pathfinding boundary

Taxi-route pathfinding can begin only after Milestones 0–5 meet their acceptance
criteria.

The future feature will likely require:

- a directed taxi graph derived from taxi points and paths;
- runway crossing and closure semantics;
- aircraft size and wingspan constraints;
- hold-short nodes;
- source confidence;
- start/end snapping;
- route visualization and instruction generation.

Do not prematurely shape the renderer around one pathfinding algorithm. Preserve
stable feature IDs and connectivity information during normalization so the
future graph can be built without re-downloading every airport.

## 22. Official technical references

### Microsoft Flight Simulator

- [MSFS 2024 SimConnect SDK](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/SimConnect_SDK.htm)
- [MSFS 2020 SimConnect SDK](https://docs.flightsimulator.com/html/Programming_Tools/SimConnect/SimConnect_SDK.htm)
- [MSFS 2024 managed-code clients](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/Programming_SimConnect_Clients_using_Managed_Code.htm)
- [MSFS 2020 managed-code clients](https://docs.flightsimulator.com/html/Programming_Tools/SimConnect/Programming_SimConnect_Clients_using_Managed_Code.htm)
- [SimConnect_RequestDataOnSimObject](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/Events_And_Data/SimConnect_RequestDataOnSimObject.htm)
- [Aircraft miscellaneous SimVars](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimVars/Aircraft_SimVars/Aircraft_Misc_Variables.htm)
- [Miscellaneous SimVars](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimVars/Miscellaneous_SimVars.htm)
- [SIMCONNECT_PERIOD](https://docs.flightsimulator.com/html/Programming_Tools/SimConnect/API_Reference/Structures_And_Enumerations/SIMCONNECT_PERIOD.htm)
- [SimConnect_AddToFacilityDefinition](https://docs.flightsimulator.com/html/Programming_Tools/SimConnect/API_Reference/Facilities/SimConnect_AddToFacilityDefinition.htm)
- [SimConnect_RequestFacilityData](https://docs.flightsimulator.com/html/Programming_Tools/SimConnect/API_Reference/Facilities/SimConnect_RequestFacilityData.htm)
- [MSFS 2024 facility data types](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/Structures_And_Enumerations/SIMCONNECT_FACILITY_DATA_TYPE.htm)

### Windows application stack

- [.NET support policy](https://dotnet.microsoft.com/en-us/platform/support/policy)
- [WPF documentation](https://learn.microsoft.com/en-us/dotnet/desktop/wpf/)
- [WebView2 for WPF](https://learn.microsoft.com/en-us/microsoft-edge/webview2/platforms/wpf)
- [Kestrel web server](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/servers/kestrel?view=aspnetcore-10.0)
- [ASP.NET Core WebSockets](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/websockets?view=aspnetcore-10.0)
- [Kestrel security considerations](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/servers/kestrel/security-considerations?view=aspnetcore-10.0)

### Airport data

- [OpenStreetMap copyright and ODbL attribution](https://www.openstreetmap.org/copyright)
- [OurAirports open data](https://ourairports.com/data/)
- [X-Plane data development documentation](https://developer.x-plane.com/docs/data-development-documentation/)
- [X-Plane Scenery Gateway upload terms](https://gateway.x-plane.com/docs/TermsAndConditionsForUploadOfAirportScenery.pdf)
