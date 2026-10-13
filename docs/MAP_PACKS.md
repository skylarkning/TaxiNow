# TaxiNow regional map packs

Regional packs replace thousands of repeated public Overpass requests with
versioned, compressed downloads built once from regional OSM extracts. The
interactive ICAO path remains available for airports that are missing from a
pack or need an immediate refresh.

## Source policy

Feature priority is applied per feature class:

1. OSM provides terminal footprints/names, taxiways, aprons, gates, and stands.
2. FAA Airport Mapping supplements incomplete US buildings and, when necessary,
   taxiway/apron polygons.
3. Overture Buildings and Building Parts supplement missing global footprints.
   Complete parent-building outlines are preferred; overlapping building parts
   are discarded so modular pieces cannot redraw a continuous terminal as
   fragments. A candidate must still be supported by a terminal label, gate
   cluster, or accepted terminal polygon.
4. Microsoft Global ML Building Footprints provide a second global geometric
   fallback. Tiles are cached by quadkey and go through the same strict spatial
   promotion rules; an airport bounding box alone is never enough.
5. X-Plane Gateway supplements operational taxi routes and parking positions.
   Its terminal/hangar facade polygons are excluded whenever an authoritative
   OSM/FAA/Overture/Microsoft terminal footprint exists.
6. OurAirports provides catalog metadata and runway fallback.

This prevents the modular 3D facade pieces used by X-Plane scenery from
appearing as fragmented 2D terminal buildings at airports such as CYVR.

## Global preprocessing workflow

`global_map_pack_builder.py` turns the Geofabrik index and bundled OurAirports
catalog into a repeatable worldwide build plan. Large countries are split into
province/state extracts when complete subdivision coverage is available.
Outputs are split at 250 airports or 250 MiB uncompressed by default, so client
downloads can resume and run concurrently without one enormous country file.

```powershell
python .\tools\map_pipeline\global_map_pack_builder.py plan `
  --output .\artifacts\global-packs\plan.json

python .\tools\map_pipeline\global_map_pack_builder.py build `
  --plan .\artifacts\global-packs\plan.json `
  --output .\artifacts\global-packs\output `
  --version 2026.07.30.1 `
  --base-url https://github.com/skylarkning/TaxiNow/releases/download/v1.0.0-beta.4
```

The build is resumable by region. It preserves completed metadata, caches
Geofabrik PBFs and Microsoft footprint tiles, writes per-airport quality
reports, records failed regions in `failures.json`, and continues processing
other regions. Individual airports that fail validation are rejected and
recorded without invalidating the rest of the regional pack.

For a bounded run, pass `--country US` to `plan`, or `--only US-CA` to `build`.
Map-pack generation is intentionally local rather than a GitHub Actions job.
The Windows
[Local Map Pack Builder](LOCAL_MAP_PACK_BUILDER.md) runs the same commands,
retains resumable source data on the maintainer PC, applies a strict
publication gate, and produces the exact GitHub upload instructions.
Publishing remains a deliberate maintainer action because release URLs must be
immutable and every ZIP hash in the index must match the uploaded bytes.

Maintainer requirements are Python 3.12+, `osmium-tool`, and
`pip install -r tools/map_pipeline/requirements-map-pack.txt`.

The builder rejects maps with no runway, invalid polygons, or implausible
bounds. Terminal-label and gate-footprint coverage are recorded for auditing.
There is intentionally no manual correction database or editor: repeatable
source fusion is preferred, and unresolved source defects remain explicit
quality warnings.

## Client guarantees

- resumable HTTP range downloads using `.part` files;
- concurrent pack-file downloads according to the selected worker limit;
- SHA-256 verification of the ZIP and every contained map;
- archive path-traversal rejection;
- schema-v2 validation before installation;
- already installed airports skipped during country/region jobs;
- only the newest complete shard set is selected from an index;
- automatic fallback to on-demand sources for airports absent from the pack.

The public Overpass path remains serialized. Increasing the worker selector
does not bypass community-service limits; it benefits independent regional
pack transfers and non-OSM work.

## Coverage and limitations

The incomplete Beta 4 CYVR (`CA-BC`) and KDCA (`US-DC`) pilot packs were
withdrawn from the public index and deleted from the GitHub Release. No
regional package is discoverable until a complete country or subdivision run
passes the local strict publication gate, its ZIPs are uploaded, and its
entries are added to the public index.

No source has complete and current terminal geometry and names for every
airport. Building-only sources cannot reliably invent a `Terminal X` number.
TaxiNow therefore transfers a nearby reliable terminal/concourse name to an
accepted footprint, but leaves it unnamed when no trustworthy label exists.
The app and quality reports explicitly disclose this limitation.
