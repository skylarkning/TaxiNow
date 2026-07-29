# TaxiNow

TaxiNow is a Windows ground-navigation map for Microsoft Flight Simulator 2020
and Microsoft Flight Simulator 2024. It uses one MapLibre renderer in the
desktop WebView2 shell and in an optional browser view.

> Flight simulation use only. Not for real-world navigation.

## Current vertical slice

- ASP.NET Core host with status, airport-map, storage, download-job, and
  telemetry endpoints.
- Shared MapLibre SPA with a bundled CYYZ fixture.
- Proportional runway pavement, centerlines, thresholds, aiming marks,
  end-designators, taxiway centerlines, and zoom-dependent labels, informed by
  the proven SkyCharts map-drawing behavior.
- Smooth replay ownship animation through a SignalR telemetry stream.
- Schema v2 validation and a schema v1 adapter.
- SQLite-backed asset catalog and atomic map replacement.
- WPF/WebView2 desktop shell.
- JSON-lines Python acquisition pipeline with multiple Overpass endpoints,
  positive/negative caching, country/ICAO jobs, and an OurAirports runway
  fallback.
- Native x64 SimConnect C ABI spike, managed wrapper, JSONL recorder, and replay
  source.

Live simulator compatibility is tracked in
[`docs/WINDOWS_ENVIRONMENT.md`](docs/WINDOWS_ENVIRONMENT.md).

## Build

```powershell
.\scripts\build.ps1
```

Run the browser/server vertical slice:

```powershell
dotnet run --project .\src\TaxiNow.Server
```

Then open <http://127.0.0.1:8780>. The WPF shell uses the same URL:

```powershell
dotnet run --project .\src\TaxiNow.App
```

The replay fixture loops by default. Set `TaxiNow__ReplayPath` to another JSONL
recording to override it.

## Repository layout

The implementation follows the boundaries and milestones in
[`docs/IMPLEMENTATION_HANDOFF.md`](docs/IMPLEMENTATION_HANDOFF.md). No
taxi-route/pathfinding code is included.
