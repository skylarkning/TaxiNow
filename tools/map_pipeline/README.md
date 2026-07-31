# TaxiNow map pipeline

This standalone Python 3.12+ component implements the versioned JSON-lines
boundary used by `TaxiNow.Pipeline`. It uses only the standard library so it can
be packaged with PyInstaller.

Development:

```powershell
python .\tools\map_pipeline\taxinow_map_pipeline.py serve
```

The normal repository build packages this process as
`tools\map_pipeline\dist\taxinow-map-pipeline.exe` and copies it into the
desktop application's `pipeline` directory. `PipelineProcessClient` redirects
its standard streams, so the packaged executable does not open a console
window.

Send one JSON request on standard input. Progress and completion events are
written to standard output. Source responses and negative results are cached
separately from normalized assets.

The acquisition layer reuses and refactors the same-maintainer SkyCharts airport
map generator. It coordinates smaller OpenStreetMap/Overpass queries, rebuilds
OSM relations, and can use FAA Airport Mapping data for US terminal/building
gaps. X-Plane Scenery Gateway can supplement missing taxi routes and parking
positions, but its modular facade geometry is excluded whenever an
authoritative OSM/FAA terminal footprint exists. OurAirports provides the
catalog and the runway-only final fallback. TaxiNow then converts the result
into its validated schema v2 asset.
Country jobs can include an optional ISO 3166-2 region code such as `CA-ON`.
They can also set `maxParallel` to `1`, `2`, `4`, `8`, or `16`. The pipeline
uses a bounded worker pool and aggregates progress, speed, and ETA across
active airports. Source-specific coordination still limits each public
Overpass endpoint to one in-flight request at a time.

## Regional map packs

Country and province/state jobs first check the official versioned map-pack
index. Pack files support concurrent and resumed HTTP downloads, ZIP-level and
per-map SHA-256 validation, safe extraction, installed-airport skipping, and
automatic on-demand fallback for missing airports.

Maintainers can package already normalized schema-v2 maps:

```powershell
python .\tools\map_pipeline\map_pack_builder.py from-maps `
  --input .\artifacts\maps\CA-BC `
  --output .\artifacts\TaxiNow-MapPack-CA-BC-2026-07-30.zip `
  --metadata-output .\artifacts\CA-BC.metadata.json `
  --id ca-bc-2026-07-30 --version 2026.07.30.1 `
  --country CA --region CA-BC
```

For full regions, `from-geofabrik` uses a local or downloaded Geofabrik PBF
and the `osmium` CLI to extract each airport before normalization:

```powershell
python .\tools\map_pipeline\map_pack_builder.py from-geofabrik `
  --pbf-url https://download.geofabrik.de/north-america/canada/british-columbia-latest.osm.pbf `
  --output .\artifacts\TaxiNow-MapPack-CA-BC-2026-07-30.zip `
  --id ca-bc-2026-07-30 --version 2026.07.30.1 `
  --country CA --region CA-BC
```

Add `--with-overture` only on a maintainer machine with the official
`overturemaps` CLI installed. Overture building footprints are passed through
the same strict gate/label/connectivity promotion rules; they are not imported
as terminals solely because they fall inside an airport bounding box.

See [the map-pack maintainer guide](../../docs/MAP_PACKS.md) for publishing and
quality-gate details.

To convert an existing SkyCharts schema-v1 map without downloading it:

```powershell
python .\tools\map_pipeline\taxinow_map_pipeline.py convert-skycharts `
  .\CYYZ-skycharts.json .\CYYZ.json `
  --country-code CA --region-code CA-ON --municipality Toronto
```

The bundled CYYZ regression asset is the current acceptance baseline: 5
physical runways, 400 taxiways/taxilanes, 402 stands, 4 terminal polygons, and
1,117 total features.
