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
3. Overture may supplement building footprints during maintainer builds, but
   only buildings connected to a terminal label, gate cluster, or accepted
   terminal polygon are promoted.
4. X-Plane Gateway supplements operational taxi routes and parking positions.
   Its terminal/hangar facade polygons are excluded whenever an authoritative
   OSM/FAA terminal footprint exists.
5. OurAirports provides catalog metadata and runway fallback.

This prevents the modular 3D facade pieces used by X-Plane scenery from
appearing as fragmented 2D terminal buildings at airports such as CYVR.

## Build workflow

1. Download the smallest appropriate Geofabrik extract. Split large countries
   such as the United States by state.
2. Run `map_pack_builder.py from-geofabrik`. This requires `osmium` on the
   maintainer machine.
3. Review every blocking quality failure. Do not publish a pack merely by
   suppressing the check.
4. Inspect high-complexity airports and any terminal-fragmentation warnings.
5. Publish the ZIP as a release asset.
6. Add its metadata and immutable release URL to
   `TaxiNow-Release/map-packs/index.json`.

The builder rejects maps with no runway, invalid polygons, or implausible
bounds. It records non-blocking quality warnings in the map so later pack
builds can be audited.

## Client guarantees

- resumable HTTP range downloads using `.part` files;
- concurrent pack-file downloads according to the selected worker limit;
- SHA-256 verification of the ZIP and every contained map;
- archive path-traversal rejection;
- schema-v2 validation before installation;
- already installed airports skipped during country/region jobs;
- automatic fallback to on-demand sources for airports absent from the pack.

The public Overpass path remains serialized. Increasing the worker selector
does not bypass community-service limits; it benefits independent regional
pack transfers and non-OSM work.

## Pilot coverage

The first Beta 4 pilot packs contain CYVR (`CA-BC`) and KDCA (`US-DC`) so the
transport, validation, and terminal-fusion behavior can be exercised before
larger province/state packs are published.
