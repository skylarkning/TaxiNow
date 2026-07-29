# TaxiNow map pipeline

This standalone Python 3.12+ component implements the versioned JSON-lines
boundary used by `TaxiNow.Pipeline`. It uses only the standard library so it can
be packaged with PyInstaller.

Development:

```powershell
python .\tools\map_pipeline\taxinow_map_pipeline.py serve
```

Send one JSON request on standard input. Progress and completion events are
written to standard output. Source responses and negative results are cached
separately from normalized assets.

The acquisition layer reuses and refactors the same-maintainer SkyCharts airport
map generator. It coordinates smaller OpenStreetMap/Overpass queries, rebuilds
OSM relations, and can use the X-Plane Scenery Gateway for airport detail when
OSM is incomplete. OurAirports provides the catalog and the runway-only final
fallback. TaxiNow then converts the result into its validated schema v2 asset.

To convert an existing SkyCharts schema-v1 map without downloading it:

```powershell
python .\tools\map_pipeline\taxinow_map_pipeline.py convert-skycharts `
  .\CYYZ-skycharts.json .\CYYZ.json `
  --country-code CA --region-code CA-ON --municipality Toronto
```

The bundled CYYZ regression asset is the current acceptance baseline: 5
physical runways, 400 taxiways/taxilanes, 402 stands, 4 terminal polygons, and
1,117 total features.
